// デバッグパネル（requirements.md 12章）。URL に ?debug=1 を付けたときだけ app.js から読み込む。
// 表示はすべて textContent で行い、innerHTML は使わない（CLAUDE.md 8）。
// 位置の初期値・プリセットは駅などの公共の場所だけにする（CLAUDE.md 7）。

import { DECLINATION_DEG, TROPHY_LEVELS, JST_OFFSET_MIN } from "./config.js";
import {
  distanceM,
  bearingDeg,
  arrowAngle,
  formatDistance,
  hintProgress,
  offsetPosition,
  makeDebugVisits,
  parseJstLocal,
  formatJstLocal,
  trophySummary,
  DEBUG_MAX_BULK_VISITS,
} from "./logic.js";
import { listStoredEntries, saveDebugSettings, isValidVisit, DEBUG_POSITION_FAILURES } from "./storage.js";

const STATIONS = [
  { name: "池袋駅", lat: 35.7295, lng: 139.7109 },
  { name: "新宿駅", lat: 35.6896, lng: 139.7006 },
  { name: "渋谷駅", lat: 35.658, lng: 139.7016 },
  { name: "六本木駅", lat: 35.6627, lng: 139.7314 },
];

const VALUE_LABELS = {
  good: "お店良かった",
  bad: "お店悪かった",
  declined: "入る気にならなかった",
  closed: "閉まっていた",
  skip: "今日はやめておく",
  full: "満席・入れなかった",
};

const COLOR_LABELS = { normal: "通常", mint: "ミント", bad: "赤黒" };

const FAILURE_LABELS = {
  denied: "拒否された",
  unavailable: "取れない",
  timeout: "タイムアウト",
  silent: "黙り続ける（位置もエラーも来ない）",
  insecure: "HTTPSでない扱い",
};

const DIRECTIONS = [
  { label: "北", deg: 0 },
  { label: "東", deg: 90 },
  { label: "南", deg: 180 },
  { label: "西", deg: 270 },
];

const HEADING_STATUS_LABELS = {
  idle: "未開始",
  waiting: "待機中",
  active: "取得中",
  unavailable: "使えない",
  denied: "拒否された",
};

const SOURCE_LABELS = {
  debug: "デバッグの上書き",
  gps: "GPS",
  ios: "iPhone（webkitCompassHeading）",
  absolute: "deviceorientationabsolute",
  "deviceorientation-absolute": "deviceorientation（absolute のみ）",
};

const KIND_LABELS = {
  main: "保存データ",
  broken: "退避（読めなかったデータ）",
  beforeImport: "退避（読み込みの前）",
  beforeReset: "退避（リセットの前）",
};

// ---------- 小さな部品 ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function section(title, children) {
  return el("section", { class: "debug-section" }, [el("h2", { text: title }), ...children]);
}

function field(label, input) {
  return el("label", { class: "debug-field" }, [el("span", { text: label }), input]);
}

function button(text, id, onclick, cls = "") {
  return el("button", { type: "button", id, class: `debug-button ${cls}`.trim(), text, onclick });
}

function select(id, options, value) {
  const s = el("select", { id });
  for (const [v, label] of options) {
    const o = el("option", { value: v, text: label });
    if (v === value) o.selected = true;
    s.append(o);
  }
  return s;
}

function row(label, valueId) {
  return el("div", { class: "debug-row" }, [el("dt", { text: label }), el("dd", { id: valueId, text: "—" })]);
}

function setText(id, text) {
  const n = document.getElementById(id);
  if (n) n.textContent = text;
}

function fmtDeg(d) {
  return Number.isFinite(d) ? `${d.toFixed(1)}°` : "—";
}

function fmtJst(time) {
  const d = new Date(time.getTime() + JST_OFFSET_MIN * 60000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}

async function copyText(text, fallbackNode) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // コピーできない端末では、選択した状態にして手でコピーしてもらう
    if (fallbackNode) {
      const range = document.createRange();
      range.selectNodeContents(fallbackNode);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return false;
  }
}

// ---------- ホーム画面対応（11章） ----------

// sw.js の CACHE_PREFIX と同じ（tests/pwa-files.test.js で確かめる）
export const APP_CACHE_PREFIX = "mystery-navi-";

// アプリのキャッシュを消す：このページの範囲（scopeUrl）のサービスワーカーの登録を解除し、
// APP_CACHE_PREFIX で始まるキャッシュだけを消す。評価の記録（localStorage）には絶対に触らない。
// 引数で渡したもの以外は使わない → { registrations: 解除した数, caches: [消したキャッシュの名前] }
export async function clearAppCaches({ serviceWorker, caches, scopeUrl }) {
  const removed = { registrations: 0, caches: [] };
  if (serviceWorker?.getRegistrations) {
    for (const r of await serviceWorker.getRegistrations()) {
      if (r.scope !== scopeUrl) continue;
      if (await r.unregister()) removed.registrations++;
    }
  }
  if (caches?.keys) {
    for (const key of await caches.keys()) {
      if (!key.startsWith(APP_CACHE_PREFIX)) continue;
      if (await caches.delete(key)) removed.caches.push(key);
    }
  }
  return removed;
}

function loadImageSize(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(`${img.naturalWidth}px`);
    img.onerror = () => resolve("読み込めません");
    img.src = src;
  });
}

// ---------- パネル ----------

// testShops：ダミー店モード（?debug=1&shops=test）。onChange(settings)：設定や記録を変えたら呼ぶ（画面を描き直す）
// pwa：{ swRegistration: Promise<登録 | null>, persisted: Promise<true | false | null>, shopData: { shops, dataVersion, ms, ok }, standalone }
export function mountDebugPanel({ root, store, sensors, shops, storage, settings, testShops = false, pwa = null, onChange = () => {} }) {
  let current = { ...settings };
  let lastFix = null;
  const message = el("p", { id: "debug-message", class: "debug-message", role: "status" });

  function say(text) {
    message.textContent = text;
  }

  function persist(patch) {
    current = saveDebugSettings(storage, { ...current, ...patch });
    sensors.setOverrides({
      position: current.position,
      heading: current.heading,
      timeOffsetMs: current.timeOffsetMs,
      positionFailure: current.positionFailure,
    });
    render();
    onChange(current);
  }

  const num = (id) => Number(document.getElementById(id).value);
  const val = (id) => document.getElementById(id).value;

  const shopOptions = shops.map((s) => [s.id, `${s.id} ${s.name}`]);
  const valueOptions = Object.entries(VALUE_LABELS);

  // 状態
  const status = section("いまの値", [
    el("dl", { class: "debug-list" }, [
      row("位置", "dbg-position"),
      row("位置の出どころ", "dbg-position-source"),
      row("方位の状態", "dbg-heading-status"),
      row("方位（補正後・平滑化前）", "dbg-heading-raw"),
      row("方位（平滑化後）", "dbg-heading-smooth"),
      row("画面の回転角", "dbg-screen-angle"),
      row("時刻（日本時間）", "dbg-time"),
      row("案内先", "dbg-target"),
      row("距離", "dbg-distance"),
      row("店への方位角", "dbg-bearing"),
      row("矢印の角度", "dbg-arrow"),
      row("最初の位置", "dbg-initial-fix"),
      row("記録", "dbg-visits"),
      row("保存", "dbg-saving"),
      row("動きを減らす設定", "dbg-reduced-motion"),
    ]),
    el("div", { class: "debug-buttons" }, [
      button("センサーを開始", "dbg-start-sensors", async () => {
        sensors.startPosition();
        const r = await sensors.startHeading();
        say(`方位センサー：${r === "granted" ? "開始しました" : r === "denied" ? "許可されませんでした" : "使えません"}`);
        render();
      }),
      button("最初の位置を待つ", "dbg-wait-fix", async () => {
        setText("dbg-initial-fix", "待っています…");
        lastFix = await sensors.waitInitialFix();
        render();
      }),
    ]),
  ]);

  // ホーム画面対応：サービスワーカー・キャッシュ・店リスト・マニフェスト・永続化（11章）
  const pwaSection = section("ホーム画面対応", [
    el("dl", { class: "debug-list" }, [
      row("サービスワーカー", "dbg-sw"),
      row("キャッシュ（＝動いている版）", "dbg-caches"),
      row("店リスト", "dbg-shops"),
      row("マニフェスト", "dbg-manifest"),
      row("保存の永続化", "dbg-persist"),
      row("ホーム画面から開いている", "dbg-standalone"),
    ]),
    el("p", {
      class: "debug-note",
      text: "「アプリのキャッシュを消して読み込み直す」は、サービスワーカーの登録とアプリのキャッシュだけを消します。評価の記録・案内先・デバッグの設定（端末の保存データ）は消しません",
    }),
    el("div", { class: "debug-buttons" }, [
      button("表示を更新", "dbg-refresh-pwa", () => renderPwa()),
      button(
        "アプリのキャッシュを消して読み込み直す",
        "dbg-clear-cache",
        async () => {
          if (!confirm("アプリのキャッシュを消して、読み込み直します。評価の記録は消えません。よろしいですか？")) return;
          try {
            const r = await clearAppCaches({
              serviceWorker: navigator.serviceWorker,
              caches: globalThis.caches,
              scopeUrl: new URL("./", location.href).href,
            });
            say(`消しました（登録の解除 ${r.registrations}件・キャッシュ ${r.caches.length}件）。読み込み直します`);
            location.reload();
          } catch (e) {
            say(`消せませんでした（${e?.message ?? e}）`);
          }
        },
        "debug-danger",
      ),
    ]),
  ]);

  async function renderPwa() {
    const sw = navigator.serviceWorker;
    if (!sw) {
      setText("dbg-sw", "使えません（HTTPS でない、または対応していない）");
    } else {
      const reg = await (pwa?.swRegistration ?? Promise.resolve(null)).catch(() => null);
      let text = "登録できませんでした";
      if (sw.controller) text = "このページを制御しています";
      else if (reg?.installing) text = "インストール中";
      else if (reg?.waiting || reg?.active) text = "登録済み（次に開くと有効）";
      setText("dbg-sw", text);
    }

    try {
      const keys = (await globalThis.caches.keys()).filter((k) => k.startsWith(APP_CACHE_PREFIX));
      setText("dbg-caches", keys.length > 0 ? keys.join("・") : "なし");
    } catch {
      setText("dbg-caches", "使えません");
    }

    const d = pwa?.shopData;
    setText("dbg-shops", !d ? "—" : d.ok ? `${d.shops.length}軒・${d.dataVersion ?? "版の表示なし"}・読み込み ${d.ms}ms` : `読み込めませんでした（${d.ms}ms）`);

    try {
      const link = document.querySelector('link[rel="manifest"]');
      const m = await (await fetch(link.href)).json();
      const srcs = [...new Set((m.icons ?? []).map((i) => new URL(i.src, link.href).href))];
      const touch = document.querySelector('link[rel="apple-touch-icon"]');
      if (touch) srcs.push(touch.href);
      const sizes = await Promise.all(srcs.map(loadImageSize));
      setText("dbg-manifest", `${m.name}（${m.display}・${m.orientation}）・アイコン ${sizes.join("・")}`);
    } catch (e) {
      setText("dbg-manifest", `読み込めません（${e?.message ?? e}）`);
    }

    const asked = await (pwa?.persisted ?? Promise.resolve(null)).catch(() => null);
    let now = null;
    try {
      now = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    } catch {
      now = null;
    }
    setText("dbg-persist", now === null && asked === null ? "対応していません" : now || asked ? "許可されています" : "許可されていません");
    setText("dbg-standalone", pwa?.standalone ? "はい" : "いいえ（ブラウザ）");
  }

  // 現在地
  const pos = current.position;
  const position = section("現在地の上書き", [
    field("緯度", el("input", { id: "dbg-lat", type: "number", step: "0.0001", value: pos?.lat ?? "" })),
    field("経度", el("input", { id: "dbg-lng", type: "number", step: "0.0001", value: pos?.lng ?? "" })),
    field("誤差（m）", el("input", { id: "dbg-accuracy", type: "number", step: "1", min: "0", value: pos?.accuracy ?? 10 })),
    el("div", { class: "debug-buttons" }, [
      button("この位置にする", "dbg-set-position", () => {
        const p = { lat: num("dbg-lat"), lng: num("dbg-lng"), accuracy: num("dbg-accuracy") };
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
          say("緯度・経度を数字で入れてください");
          return;
        }
        persist({ position: p });
        say("現在地を上書きしました");
      }),
      button("実際の位置を使う", "dbg-clear-position", () => {
        persist({ position: null });
        say("実際の位置情報を使います（「センサーを開始」で取得）");
      }),
    ]),
    el(
      "div",
      { class: "debug-buttons" },
      STATIONS.map((s, i) =>
        button(s.name, `dbg-station-${i}`, () => {
          document.getElementById("dbg-lat").value = s.lat;
          document.getElementById("dbg-lng").value = s.lng;
          persist({ position: { lat: s.lat, lng: s.lng, accuracy: num("dbg-accuracy") || 10 } });
          say(`${s.name}にしました`);
        }),
      ),
    ),
    el("h3", { text: "店の近くへワープ" }),
    field("店", select("dbg-warp-shop", [["__target", "案内中のお店"], ...shopOptions], "__target")),
    field("店からの距離（m）", el("input", { id: "dbg-warp-distance", type: "number", min: "0", step: "10", value: "0" })),
    field("方角", select("dbg-warp-direction", DIRECTIONS.map((d) => [String(d.deg), d.label]), "180")),
    el("div", { class: "debug-buttons" }, [
      button("ワープ", "dbg-warp", () => {
        // 「案内中のお店」：どの店が選ばれても、手順ファイルから到着を再現できるように
        const id = val("dbg-warp-shop") === "__target" ? store.getTarget()?.shopId : val("dbg-warp-shop");
        const shop = shops.find((s) => s.id === id);
        if (!shop) return say(val("dbg-warp-shop") === "__target" ? "案内中のお店がありません" : "店がありません");
        const p = offsetPosition(shop, num("dbg-warp-direction"), Math.max(0, num("dbg-warp-distance") || 0));
        document.getElementById("dbg-lat").value = p.lat.toFixed(6);
        document.getElementById("dbg-lng").value = p.lng.toFixed(6);
        persist({ position: { ...p, accuracy: num("dbg-accuracy") || 10 } });
        say(`${shop.name}の近くにワープしました`);
      }),
    ]),
  ]);

  // 位置のエラー（S4 の再現用）
  const failure = section("位置のエラーを起こす", [
    el("p", { class: "debug-note", text: "現在地の上書きより優先します。設定してから「はじめる」や「もう一度試す」を押すと、エラー表示になります" }),
    field(
      "エラー",
      select("dbg-failure", DEBUG_POSITION_FAILURES.map((f) => [f, FAILURE_LABELS[f]]), current.positionFailure ?? "denied"),
    ),
    el("div", { class: "debug-buttons" }, [
      button("このエラーにする", "dbg-set-failure", () => {
        persist({ positionFailure: val("dbg-failure") });
        say(`位置のエラー：${FAILURE_LABELS[val("dbg-failure")]}にしました`);
      }),
      button("エラーをやめる", "dbg-clear-failure", () => {
        persist({ positionFailure: null });
        say("位置のエラーをやめました");
      }),
    ]),
  ]);

  // 向き
  const heading = section("端末の向きの上書き", [
    field(
      "向き（度）",
      el("input", {
        id: "dbg-heading",
        type: "range",
        min: "0",
        max: "359",
        step: "1",
        value: current.heading ?? 0,
        oninput: (e) => persist({ heading: Number(e.target.value) }),
      }),
    ),
    el("div", { class: "debug-buttons" }, [
      button("実際の向きを使う", "dbg-clear-heading", () => {
        persist({ heading: null });
        say("実際の方位センサーを使います");
      }),
    ]),
  ]);

  // 時刻
  const time = section("現在時刻の上書き（日本時間）", [
    field("日時", el("input", { id: "dbg-time-input", type: "datetime-local", value: formatJstLocal(sensors.now()) })),
    el("div", { class: "debug-buttons" }, [
      button("この時刻にする", "dbg-set-time", () => {
        const t = parseJstLocal(val("dbg-time-input"));
        if (!t) return say("日時を正しく入れてください");
        persist({ timeOffsetMs: t.getTime() - Date.now() });
        say("時刻を上書きしました（ここから時計は進みます）");
      }),
      button("実際の時刻に戻す", "dbg-clear-time", () => {
        persist({ timeOffsetMs: null });
        say("実際の時刻に戻しました");
      }),
    ]),
  ]);

  // 記録の追加
  const bulk = section("評価の記録をまとめて追加", [
    field("回数", el("input", { id: "dbg-bulk-count", type: "number", min: "1", max: String(DEBUG_MAX_BULK_VISITS), value: "5" })),
    field("評価", select("dbg-bulk-value", valueOptions, "good")),
    el("p", { class: "debug-note", text: "店は順番に、日付は前日（朝5時区切り）から1日ずつさかのぼります" }),
    el("div", { class: "debug-buttons" }, [
      button("まとめて追加", "dbg-bulk-add", () => {
        try {
          const visits = makeDebugVisits({ count: num("dbg-bulk-count"), shops, value: val("dbg-bulk-value"), now: sensors.now() });
          store.debugAppendVisits(visits);
          say(`${visits.length}件追加しました`);
        } catch (e) {
          say(e.message);
        }
        refresh();
      }),
    ]),
  ]);

  const single = section("指定した店に記録を1件追加", [
    field("店", select("dbg-one-shop", shopOptions)),
    field("評価", select("dbg-one-value", valueOptions, "good")),
    field("日時（日本時間）", el("input", { id: "dbg-one-time", type: "datetime-local", value: formatJstLocal(sensors.now()) })),
    el("div", { class: "debug-buttons" }, [
      button("1件追加", "dbg-one-add", () => {
        const at = parseJstLocal(val("dbg-one-time"));
        const v = { shopId: val("dbg-one-shop"), value: val("dbg-one-value"), at: at ? at.toISOString() : "" };
        if (!isValidVisit(v)) return say("店・評価・日時を確かめてください");
        store.debugAppendVisits([v]);
        say(`${v.shopId} に「${VALUE_LABELS[v.value]}」を追加しました`);
        refresh();
      }),
    ]),
  ]);

  // 仮の目的地
  const tt = current.tempTarget;
  const temp = section("仮の目的地", [
    el("p", { class: "debug-note", text: "店の代わりに案内します。評価の記録・トロフィー・点数には関係しません。端末の中だけに保存します" }),
    field("緯度", el("input", { id: "dbg-temp-lat", type: "number", step: "0.0001", value: tt?.lat ?? "" })),
    field("経度", el("input", { id: "dbg-temp-lng", type: "number", step: "0.0001", value: tt?.lng ?? "" })),
    field("矢印の色", select("dbg-temp-color", Object.entries(COLOR_LABELS), tt?.color ?? "normal")),
    el("div", { class: "debug-buttons" }, [
      button("仮の目的地にする", "dbg-set-temp", () => {
        const t = { lat: num("dbg-temp-lat"), lng: num("dbg-temp-lng"), color: val("dbg-temp-color") };
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lng) || Math.abs(t.lat) > 90 || Math.abs(t.lng) > 180) {
          return say("緯度・経度を数字で入れてください");
        }
        persist({ tempTarget: t });
        say("仮の目的地を設定しました");
      }),
      button("解除", "dbg-clear-temp", () => {
        persist({ tempTarget: null });
        say("仮の目的地を解除しました");
      }),
    ]),
  ]);

  // 保存データ
  const entriesBox = el("div", { id: "dbg-entries" });
  const stored = section("保存データ", [
    entriesBox,
    el("div", { class: "debug-buttons" }, [
      button("表示を更新", "dbg-refresh-entries", () => renderEntries()),
      button(
        "リセット",
        "dbg-reset",
        () => {
          if (!confirm("評価の記録と案内先をリセットします。今のデータは「退避（リセットの前）」に残します。よろしいですか？")) return;
          const r = store.debugReset(sensors.now());
          say(r.ok ? (r.backupKey ? `リセットしました（退避先：${r.backupKey}）` : "リセットしました") : "退避できなかったため、リセットしませんでした");
          refresh();
        },
        "debug-danger",
      ),
    ]),
  ]);

  function renderEntries() {
    entriesBox.replaceChildren();
    const entries = listStoredEntries(storage);
    if (entries.length === 0) {
      entriesBox.append(el("p", { class: "debug-note", text: storage ? "保存データはまだありません" : "この端末では保存できません" }));
      return;
    }
    for (const e of entries) {
      const pre = el("pre", { class: "debug-raw", text: e.raw });
      entriesBox.append(
        el("div", { class: "debug-entry", dataset: { kind: e.kind } }, [
          el("p", { class: "debug-entry-title", text: `${KIND_LABELS[e.kind]}：${storage.realKey ? storage.realKey(e.key) : e.key}` }),
          pre,
          button("コピー", undefined, async () => {
            say((await copyText(e.raw, pre)) ? `${e.key} をコピーしました` : "コピーできませんでした。選択した文字をコピーしてください");
          }),
        ]),
      );
    }
  }

  const modeNote = el("p", {
    class: "debug-note",
    text: testShops
      ? "ダミー店モード：tests/fixtures/shops.json の店で動いています。記録は本物とは別の場所（mysteryNavi.test.v1）に保存します"
      : "本物の店リスト（shops.json）で動いています。ダミー店で試すときは URL に &shops=test を付けます",
  });
  const panel = el("aside", { class: "debug-panel", id: "debug-panel", "aria-label": "デバッグ", hidden: "" }, [
    el("h1", { text: testShops ? "デバッグ（ダミー店）" : "デバッグ" }),
    modeNote,
    message,
    status,
    pwaSection,
    position,
    failure,
    heading,
    time,
    temp,
    bulk,
    single,
    stored,
  ]);
  // 開閉ボタン。最初は閉じておく（ナビ画面を隠さないため）
  const toggle = el("button", {
    type: "button",
    id: "debug-toggle",
    class: "debug-toggle",
    "aria-expanded": "false",
    "aria-controls": "debug-panel",
    text: testShops ? "デバッグ・ダミー店" : "デバッグ",
    onclick: () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) panel.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    },
  });
  root.append(toggle, panel);

  // ---------- 表示の更新 ----------

  function render() {
    const s = sensors.getState();
    const p = s.position;
    setText("dbg-position", p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}（誤差 ${Math.round(p.accuracy)}m）` : s.positionError ? `取得できません（${s.positionError.message || s.positionError.code}）` : "未取得");
    setText("dbg-position-source", current.positionFailure ? `エラーを起こしています（${FAILURE_LABELS[current.positionFailure]}）` : p ? SOURCE_LABELS[p.source] : "—");
    setText("dbg-heading-status", `${HEADING_STATUS_LABELS[s.headingStatus] ?? s.headingStatus}${s.headingSource ? `（${SOURCE_LABELS[s.headingSource] ?? s.headingSource}）` : ""}`);
    setText("dbg-heading-raw", fmtDeg(s.rawHeading));
    setText("dbg-heading-smooth", fmtDeg(s.heading));
    setText("dbg-screen-angle", `${s.screenAngle}°`);
    setText("dbg-time", `${fmtJst(sensors.now())}${s.timeOverridden ? "（上書き中）" : ""}`);

    // 案内先：仮の目的地があればそれ。なければ保存中の案内先（Phase 4 でナビ画面につなぐ）
    let target = null;
    let targetLabel = "なし";
    if (current.tempTarget) {
      target = current.tempTarget;
      targetLabel = `仮の目的地（矢印：${COLOR_LABELS[current.tempTarget.color]}）`;
    } else {
      const saved = store.getTarget();
      const shop = saved && shops.find((x) => x.id === saved.shopId);
      if (shop) {
        target = shop;
        targetLabel = `${shop.id} ${shop.name}${saved.arrivedAt ? "（到着済み）" : ""}`;
      }
    }
    if (target && p) {
      const d = distanceM(p, target);
      const b = bearingDeg(p, target);
      const arrived = hintProgress(d, p.accuracy).arrived;
      setText("dbg-target", current.tempTarget && arrived ? `${targetLabel}：仮の目的地に着きました（${Math.round(d)}m）` : targetLabel);
      setText("dbg-distance", `${formatDistance(d)}（${d.toFixed(1)}m）`);
      setText("dbg-bearing", fmtDeg(b));
      setText("dbg-arrow", Number.isFinite(s.heading) ? fmtDeg(arrowAngle(b, s.heading, DECLINATION_DEG)) : `${fmtDeg(b)}（方位なし：北を上として）`);
    } else {
      setText("dbg-target", targetLabel);
      for (const id of ["dbg-distance", "dbg-bearing", "dbg-arrow"]) setText(id, "—");
    }

    setText(
      "dbg-initial-fix",
      lastFix ? `${lastFix.position.lat.toFixed(6)}, ${lastFix.position.lng.toFixed(6)}（誤差 ${Math.round(lastFix.position.accuracy)}m${lastFix.lowAccuracy ? "・精度が低い" : ""}）` : "—",
    );
    const visits = store.visits();
    const t = trophySummary(visits, TROPHY_LEVELS);
    setText("dbg-visits", `${visits.length}件（読めない記録 ${store.unreadableCount()}件）・トロフィーの回数 ${t.count}回${t.level ? `・${t.level.name}` : ""}`);
    const st = store.status();
    setText("dbg-saving", st.saving && !st.lastWriteFailed ? "保存できています" : `保存できていません（${st.reason ?? "書き込みに失敗"}）`);
  }

  // 記録を変えたとき（センサーの値が変わるたびには一覧を作り直さない。選択中の文字が消えないように）
  function refresh() {
    render();
    renderEntries();
    onChange(current);
  }

  // 動きを減らす設定（prefers-reduced-motion）。オンのときは赤黒の矢印が脈打たず、行き先が変わっても回らない
  const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const renderReducedMotion = () =>
    setText(
      "dbg-reduced-motion",
      reducedMotion === null
        ? "判定できません"
        : reducedMotion.matches
          ? "オン（赤黒の矢印は脈打たず、行き先が変わっても回らない）"
          : "オフ",
    );
  reducedMotion?.addEventListener?.("change", renderReducedMotion);
  renderReducedMotion();

  navigator.serviceWorker?.addEventListener?.("controllerchange", () => renderPwa());
  renderPwa();

  sensors.subscribe(render);
  // 評価や取り消しで記録・案内先が変わっても追いつくように、いまの値を1秒ごとに描き直す
  setInterval(render, 1000);
  refresh();
}
