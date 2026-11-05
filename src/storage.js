// localStorage の読み書き・取り消し・お知らせの判定・バックアップの書き出しと読み込み
// （requirements.md 4-3・4-4・6章・11章）。
//
// 守っていること
// - 評価の記録（visits）を消すのは、取り消し（直前の1件・5秒以内）と、記録の読み込みだけ（6章）
// - 端末の保存データは、読めない記録や知らない項目も含めて、元の形のまま書き戻す
// - 壊れた保存データは、別のキーにそのまま退避してから空で始める。退避できなければ保存しない
// - 新しい版（schemaVersion が 1 より大きい）の保存データには、退避も上書きもしない
// - 現在時刻は引数 now で受け取る（テストで固定できるように）

import { STORAGE_KEY, SCHEMA_VERSION, SCORE, TROPHY_LEVELS, UNDO_SEC } from "./config.js";
import { trophySummary } from "./logic.js";

export const BACKUP_APP = "mystery-navi";
export const BROKEN_KEY_PREFIX = `${STORAGE_KEY}.broken.`;
export const BEFORE_IMPORT_KEY_PREFIX = `${STORAGE_KEY}.beforeImport.`;
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
  };
}
