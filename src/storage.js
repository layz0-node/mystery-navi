// localStorage の読み書き・取り消し・お知らせの判定・バックアップの書き出しと読み込み
// （requirements.md 4-3・4-4・6章・11章）。
//
// 守っていること
// - 評価の記録（visits）を消すのは、取り消し（直前の1件・5秒以内）と、記録の読み込みと、デバッグのリセットだけ（6章）
// - 記録の読み込みとデバッグのリセットは、前の保存データをそのまま別のキーに退避してから行う
// - 端末の保存データは、読めない記録や知らない項目も含めて、元の形のまま書き戻す
// - 壊れた保存データは、別のキーにそのまま退避してから空で始める。退避できなければ保存しない
// - 新しい版（schemaVersion が 1 より大きい）の保存データには、退避も上書きもしない
// - 現在時刻は引数 now で受け取る（テストで固定できるように）

import { STORAGE_KEY, SCHEMA_VERSION, SCORE, TROPHY_LEVELS, UNDO_SEC } from "./config.js";
import { trophySummary } from "./logic.js";

export const BACKUP_APP = "mystery-navi";
export const BROKEN_KEY_PREFIX = `${STORAGE_KEY}.broken.`;
export const BEFORE_IMPORT_KEY_PREFIX = `${STORAGE_KEY}.beforeImport.`;
export const BEFORE_RESET_KEY_PREFIX = `${STORAGE_KEY}.beforeReset.`;
const ASIDE_KEY_PREFIXES = [BROKEN_KEY_PREFIX, BEFORE_IMPORT_KEY_PREFIX, BEFORE_RESET_KEY_PREFIX];
// デバッグの設定（12章）。評価の記録とは別のキー。schemaVersion 1 の保存データには入れない
export const DEBUG_KEY = "mysteryNavi.debug";
const MAX_SHOP_ID_LENGTH = 64;
const MAX_HINTS = 2;

// ---------- 検査（純粋な関数） ----------

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// 末尾が Z か ±HH:MM の日時だけを受け付ける（6章）。
// 時差のない日時は端末のタイムゾーンで読まれて日付がずれるので受け付けない。
// Date.parse は 2月30日や 24:00 を繰り上げて読んでしまうので、各値の範囲も確かめる。
export function isValidTimestamp(value) {
  if (typeof value !== "string") return false;
  const m = TIMESTAMP_PATTERN.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

export function isValidShopId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SHOP_ID_LENGTH;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 店ID・値（6種類）・日時がすべて読める記録か
export function isValidVisit(v) {
  return (
    isPlainObject(v) &&
    isValidShopId(v.shopId) &&
    typeof v.value === "string" &&
    Object.hasOwn(SCORE, v.value) &&
    isValidTimestamp(v.at)
  );
}

// 記録の3項目だけを取り出す
function pickVisit(v) {
  return { shopId: v.shopId, value: v.value, at: v.at };
}

// 保存された案内先が読めるなら、その写しを返す。読めなければ null（6章：案内先は破棄してよい一時的な記録）
export function readTarget(t) {
  if (!isPlainObject(t)) return null;
  if (!isValidShopId(t.shopId) || !isValidTimestamp(t.selectedAt)) return null;
  if (!Number.isInteger(t.unlockedHints) || t.unlockedHints < 0 || t.unlockedHints > MAX_HINTS) return null;
  if (t.arrivedAt !== null && !isValidTimestamp(t.arrivedAt)) return null;
  return { shopId: t.shopId, selectedAt: t.selectedAt, unlockedHints: t.unlockedHints, arrivedAt: t.arrivedAt };
}

// 保存データの文字列を分類する
// → { kind: "empty" } | { kind: "ok", data } | { kind: "newer" } | { kind: "broken" }
export function classifyStored(raw) {
  if (raw === null || raw === undefined) return { kind: "empty" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "broken" };
  }
  if (!isPlainObject(data)) return { kind: "broken" };
  const version = data.schemaVersion;
  if (typeof version === "number" && Number.isFinite(version) && version > SCHEMA_VERSION) {
    return { kind: "newer" };
  }
  if (version !== SCHEMA_VERSION) return { kind: "broken" };
  if (!Array.isArray(data.visits)) return { kind: "broken" };
  return { kind: "ok", data };
}

// バックアップの文字列を検査する。何も変えない（11章）
// → { ok: true, visits } | { ok: false, reason: "json" | "app" | "version" | "visits" | "record" }
export function parseBackup(text) {
  if (typeof text !== "string") return { ok: false, reason: "json" };
  let data;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return { ok: false, reason: "json" };
  }
  if (!isPlainObject(data) || data.app !== BACKUP_APP) return { ok: false, reason: "app" };
  if (data.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "version" };
  if (!Array.isArray(data.visits)) return { ok: false, reason: "visits" };
  if (!data.visits.every(isValidVisit)) return { ok: false, reason: "record" };
  return { ok: true, visits: data.visits.map(pickVisit) };
}

function toIso(time) {
  return time instanceof Date ? time.toISOString() : new Date(time).toISOString();
}

function toMs(time) {
  return time instanceof Date ? time.getTime() : Date.parse(time);
}

function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    visits: [],
    currentTarget: null,
    trophy: { announcedLevel: null },
    lastExportAt: null,
  };
}

function levelRank(levelId) {
  return TROPHY_LEVELS.findIndex((l) => l.id === levelId);
}

// ---------- localStorage ----------

// 使える localStorage を返す。プライベートブラウズなどで使えなければ null
export function getLocalStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = `${STORAGE_KEY}.probe`;
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

// ---------- ダミー店モードの保存先（12章） ----------

// ダミー店モード（?debug=1&shops=test）で使う保存データのキー。本物の記録と混ざらないように分ける
export const TEST_SHOPS_STORAGE_KEY = "mysteryNavi.test.v1";

function isAppKey(key) {
  return key === STORAGE_KEY || key.startsWith(`${STORAGE_KEY}.`);
}

function isTestKey(key) {
  return key === TEST_SHOPS_STORAGE_KEY || key.startsWith(`${TEST_SHOPS_STORAGE_KEY}.`);
}

// storage を包み、保存データのキー（mysteryNavi.v1 と、それで始まる退避先）を
// mysteryNavi.test.v1… に読み替える。ほかのキー（デバッグの設定など）はそのまま通す。
// 包んだ側からは本物の保存データは見えず、書き換えもできない。保存データの形は変えない
export function testShopsStorage(storage) {
  if (!storage) return null;
  const toReal = (key) => (isAppKey(key) ? TEST_SHOPS_STORAGE_KEY + key.slice(STORAGE_KEY.length) : key);
  const visibleKeys = () => {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k !== "string" || isAppKey(k)) continue; // 本物の保存データは見せない
      out.push(isTestKey(k) ? STORAGE_KEY + k.slice(TEST_SHOPS_STORAGE_KEY.length) : k);
    }
    return out;
  };
  return {
    getItem: (key) => storage.getItem(toReal(key)),
    setItem: (key, value) => storage.setItem(toReal(key), value),
    removeItem: (key) => storage.removeItem(toReal(key)),
    get length() {
      return visibleKeys().length;
    },
    key: (i) => visibleKeys()[i] ?? null,
    // 表示用：実際に保存されているキーの名前
    realKey: toReal,
  };
}

// 保存データの本体と、退避したデータ（broken・beforeImport・beforeReset）を、加工しない文字列のまま返す（12章）。
// 読むだけ。ほかのキー（デバッグの設定など）は含めない
// → [{ key, raw, kind: "main" | "broken" | "beforeImport" | "beforeReset" }]
export function listStoredEntries(storage) {
  if (!storage) return [];
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  } catch {
    return [];
  }
  const entries = [];
  const main = storage.getItem(STORAGE_KEY);
  if (main !== null) entries.push({ key: STORAGE_KEY, raw: main, kind: "main" });
  const kinds = { [BROKEN_KEY_PREFIX]: "broken", [BEFORE_IMPORT_KEY_PREFIX]: "beforeImport", [BEFORE_RESET_KEY_PREFIX]: "beforeReset" };
  for (const key of keys.filter((k) => typeof k === "string").sort()) {
    const prefix = ASIDE_KEY_PREFIXES.find((p) => key.startsWith(p));
    if (!prefix) continue;
    const raw = storage.getItem(key);
    if (raw !== null) entries.push({ key, raw, kind: kinds[prefix] });
  }
  return entries;
}

// ---------- デバッグの設定（12章） ----------

const DEBUG_COLORS = ["normal", "mint", "bad"];

// デバッグで起こせる位置のエラー（S4 の再現用）
// denied：拒否／unavailable：取れない／timeout：タイムアウト／silent：位置もエラーも来ない／insecure：HTTPSでない扱い
export const DEBUG_POSITION_FAILURES = ["denied", "unavailable", "timeout", "silent", "insecure"];

function isLatLng(p) {
  return (
    isPlainObject(p) &&
    Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
    Number.isFinite(p.lng) && p.lng >= -180 && p.lng <= 180
  );
}

export function emptyDebugSettings() {
  return { position: null, heading: null, timeOffsetMs: null, tempTarget: null, positionFailure: null };
}

// 保存されたデバッグの設定を読む。読めない項目は「上書きなし」（null）にする
export function readDebugSettings(raw) {
  const out = emptyDebugSettings();
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isPlainObject(d)) return out;
  if (isLatLng(d.position)) {
    const accuracy = Number.isFinite(d.position.accuracy) && d.position.accuracy >= 0 ? d.position.accuracy : 10;
    out.position = { lat: d.position.lat, lng: d.position.lng, accuracy };
  }
  if (Number.isFinite(d.heading)) out.heading = ((d.heading % 360) + 360) % 360;
  if (Number.isFinite(d.timeOffsetMs)) out.timeOffsetMs = d.timeOffsetMs;
  if (DEBUG_POSITION_FAILURES.includes(d.positionFailure)) out.positionFailure = d.positionFailure;
  if (isLatLng(d.tempTarget)) {
    out.tempTarget = {
      lat: d.tempTarget.lat,
      lng: d.tempTarget.lng,
      color: DEBUG_COLORS.includes(d.tempTarget.color) ? d.tempTarget.color : "normal",
    };
  }
  return out;
}

// → 保存した設定（読み直したもの）。書けなくても止めない
export function saveDebugSettings(storage, settings) {
  const clean = readDebugSettings(JSON.stringify(settings));
  if (storage) {
    try {
      storage.setItem(DEBUG_KEY, JSON.stringify(clean));
    } catch {
      // 保存できない端末では、その場かぎりの設定として使う
    }
  }
  return clean;
}

export function loadDebugSettings(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEBUG_KEY);
    return raw === null ? null : readDebugSettings(raw);
  } catch {
    return null;
  }
}

// ---------- 保存の本体 ----------

// storage：getItem / setItem を持つもの（localStorage と同じ形）。null なら保存せずにメモリ上で動く
// now：起動した時刻（壊れたデータの退避先の名前に使う）
//
// status().reason
//   null           保存できている
//   "unavailable"  localStorage が使えない
//   "newer"        新しい版のアプリの保存データがある。触らない
//   "unsafe"       壊れたデータを退避できなかった、または途中で保存データが読めなくなった。元を上書きしない
export function createStore({ storage = null, now = new Date() } = {}) {
  let saving = storage !== null;
  let reason = storage === null ? "unavailable" : null;
  let recoveredKey = null; // 壊れたデータを退避して空で始めたときの退避先
  let lastWriteFailed = false;
  let data = emptyData();
  let lastAdd = null; // 取り消し用：{ visit, previousTarget, atMs }。メモリにだけ持つ

  function stopSaving(why) {
    saving = false;
    reason = why;
  }

  function readRaw() {
    return storage.getItem(STORAGE_KEY);
  }

  // 既にあるキーと重ならない名前で、そのまま書き込む。書けたらキー名を返す
  function writeAside(prefix, raw, time) {
    let key = prefix + toIso(time);
    for (let i = 2; storage.getItem(key) !== null; i++) key = `${prefix}${toIso(time)}#${i}`;
    storage.setItem(key, raw);
    return key;
  }

  // 起動時の読み込み
  if (saving) {
    try {
      const raw = readRaw();
      const c = classifyStored(raw);
      if (c.kind === "ok") data = c.data;
      else if (c.kind === "newer") stopSaving("newer");
      else if (c.kind === "broken") {
        try {
          recoveredKey = writeAside(BROKEN_KEY_PREFIX, raw, now);
          storage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
          recoveredKey = null;
          stopSaving("unsafe");
        }
      }
    } catch {
      stopSaving("unavailable");
    }
  }

  // 変更は、保存データを読み直してから当てて書き込む（別のタブの記録を消さないため）
  function mutate(fn) {
    if (saving) {
      try {
        const c = classifyStored(readRaw());
        if (c.kind === "ok") data = c.data;
        else if (c.kind === "newer") stopSaving("newer");
        else if (c.kind === "broken") stopSaving("unsafe");
        // empty のときは、メモリ上の状態をそのまま使う
      } catch {
        lastWriteFailed = true;
      }
    }
    const result = fn(data);
    if (saving) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(data));
        lastWriteFailed = false;
      } catch {
        lastWriteFailed = true;
      }
    }
    return result;
  }

  function validVisits() {
    return data.visits.filter(isValidVisit).map(pickVisit);
  }

  function announcedLevel() {
    const id = isPlainObject(data.trophy) ? data.trophy.announcedLevel : null;
    return levelRank(id) >= 0 ? id : null;
  }

  function setAnnounced(d, levelId) {
    if (isPlainObject(d.trophy)) d.trophy.announcedLevel = levelId;
    else d.trophy = { announcedLevel: levelId };
  }

  function inUndoWindow(now) {
    return lastAdd !== null && toMs(now) - lastAdd.atMs <= UNDO_SEC * 1000;
  }

  function lastVisitIs(d, v) {
    const last = d.visits[d.visits.length - 1];
    return isPlainObject(last) && last.shopId === v.shopId && last.value === v.value && last.at === v.at;
  }

  return {
    // 保存の状態（Phase 5 で画面のお知らせに使う）
    status() {
      return { saving, reason, recoveredKey, lastWriteFailed };
    },

    // 計算に使う記録（読めない記録を除く）
    visits: validVisits,

    unreadableCount() {
      return data.visits.filter((v) => !isValidVisit(v)).length;
    },

    // 評価を1件追加し、案内先を消す（6章）
    addVisit(shopId, value, now) {
      if (!isValidShopId(shopId) || !Object.hasOwn(SCORE, value)) {
        throw new TypeError(`記録できない評価です：${shopId} ${value}`);
      }
      const visit = { shopId, value, at: toIso(now) };
      mutate((d) => {
        lastAdd = { visit, previousTarget: readTarget(d.currentTarget), atMs: toMs(now) };
        d.visits.push({ ...visit });
        d.currentTarget = null;
      });
      return { ...visit };
    },

    canUndo(now) {
      return inUndoWindow(now) && lastVisitIs(data, lastAdd.visit);
    },

    // 直前の評価を取り消し、評価した店を到着済みの案内先に戻す（4-4）
    undo(now) {
      if (!inUndoWindow(now)) return false;
      const { visit, previousTarget } = lastAdd;
      const done = mutate((d) => {
        if (!lastVisitIs(d, visit)) return false;
        d.visits.pop();
        d.currentTarget = previousTarget ? { ...previousTarget } : null;
        return true;
      });
      lastAdd = null;
      return done;
    },

    getTarget() {
      return readTarget(data.currentTarget);
    },

    setTarget({ shopId, selectedAt, unlockedHints = 0, arrivedAt = null }) {
      const target = {
        shopId,
        selectedAt: toIso(selectedAt),
        unlockedHints,
        arrivedAt: arrivedAt === null ? null : toIso(arrivedAt),
      };
      if (!readTarget(target)) throw new TypeError("保存できない案内先です");
      mutate((d) => {
        d.currentTarget = target;
      });
    },

    // 解放したヒントの数・到着した日時を書き込む。案内先がなければ何もしない
    updateTarget(patch) {
      return mutate((d) => {
        const current = readTarget(d.currentTarget);
        if (!current) return false;
        const next = { ...current };
        if (patch.unlockedHints !== undefined) next.unlockedHints = patch.unlockedHints;
        if (patch.arrivedAt !== undefined) next.arrivedAt = patch.arrivedAt === null ? null : toIso(patch.arrivedAt);
        if (!readTarget(next)) throw new TypeError("保存できない案内先です");
        d.currentTarget = next;
        return true;
      });
    },

    // 「別のお店にする」「評価せずに別のお店へ」（4-2）。評価の記録は変えない
    clearTarget() {
      mutate((d) => {
        d.currentTarget = null;
      });
    },

    // お知らせする段階（TROPHY_LEVELS の要素）か null（4-3）
    // 取り消しの5秒の間は出さない。段階を飛ばして上がったら、一番上の段階を1回だけ
    pendingTrophyNotice(now) {
      if (inUndoWindow(now)) return null;
      const { level } = trophySummary(validVisits());
      if (!level) return null;
      return levelRank(level.id) > levelRank(announcedLevel()) ? level : null;
    },

    markAnnounced(levelId) {
      if (levelRank(levelId) < 0) throw new TypeError(`知らない段階です：${levelId}`);
      mutate((d) => setAnnounced(d, levelId));
    },

    lastExportAt() {
      return isValidTimestamp(data.lastExportAt) ? data.lastExportAt : null;
    },

    // 書き出し（11章）。読める記録だけを入れる。案内先と位置情報は入れない
    exportBackup(now) {
      const exportedAt = toIso(now);
      const text = JSON.stringify({
        app: BACKUP_APP,
        schemaVersion: SCHEMA_VERSION,
        exportedAt,
        visits: validVisits(),
      });
      mutate((d) => {
        d.lastExportAt = exportedAt;
      });
      return text;
    },

    // 読み込み（11章）。visits は parseBackup が返したもの。
    // 上書きの前に、今の保存データをそのまま別のキーに退避する。退避できなければ何も変えない。
    // → { ok: true, backupKey } | { ok: false, reason: "backup-failed" }
    importVisits(visits, now) {
      if (!Array.isArray(visits) || !visits.every(isValidVisit)) {
        throw new TypeError("parseBackup を通した記録を渡してください");
      }
      let backupKey = null;
      if (saving) {
        try {
          const raw = readRaw();
          if (raw !== null) backupKey = writeAside(BEFORE_IMPORT_KEY_PREFIX, raw, now);
        } catch {
          return { ok: false, reason: "backup-failed" };
        }
      }
      const imported = visits.map(pickVisit);
      const { level } = trophySummary(imported);
      mutate((d) => {
        d.visits = imported.map((v) => ({ ...v }));
        d.currentTarget = null;
        setAnnounced(d, level ? level.id : null);
      });
      lastAdd = null;
      return { ok: true, backupKey };
    },

    // ---------- デバッグ用（12章）。?debug=1 のパネルからだけ使う ----------

    // 記録を末尾に追加するだけ。案内先は消さず、取り消しの対象にもしない
    debugAppendVisits(visits) {
      if (!Array.isArray(visits) || !visits.every(isValidVisit)) {
        throw new TypeError("記録できない評価が含まれています");
      }
      mutate((d) => {
        for (const v of visits) d.visits.push(pickVisit(v));
      });
      return visits.length;
    },

    // 初めて開いた状態に戻す。前に、今の保存データをそのまま beforeReset に退避する。
    // 退避できなければ何も変えない。退避したデータ（broken・beforeImport・beforeReset）は消さない
    // → { ok: true, backupKey } | { ok: false, reason: "backup-failed" }
    debugReset(now) {
      let backupKey = null;
      if (storage !== null) {
        try {
          const raw = readRaw();
          if (raw !== null) backupKey = writeAside(BEFORE_RESET_KEY_PREFIX, raw, now);
          storage.removeItem(STORAGE_KEY);
        } catch {
          return { ok: false, reason: "backup-failed" };
        }
        saving = true;
        reason = null;
        recoveredKey = null;
        lastWriteFailed = false;
      }
      data = emptyData();
      lastAdd = null;
      return { ok: true, backupKey };
    },
  };
}
