// 画面の切り替えと描画（requirements.md 3章・4-1・4-2・10章）。
// 計算は logic.js の関数に任せ、ここでは画面に出すことと、画面の切り替えだけを扱う。
// S2〜S5 は Phase 5 で作る。それまでは S2〜S4 を仮の表示にしている。
// 店名やヒントなどのデータを画面に出すときは textContent を使い、innerHTML に入れない。

import { DECLINATION_DEG, INITIAL_ACCURACY_M, NOTICE_SEC } from "./config.js";
import {
  appMode,
  bearingDeg,
  compassAngles,
  distanceM,
  formatDistance,
  headingUsable,
  hintProgress,
  hintSlots,
  reselectOutcome,
  resolveTarget,
  selectShop,
  shopRecord,
  spinAngle,
  trophySummary,
  unwrapAngle,
} from "./logic.js";
import {
  createStore,
  getLocalStorage,
  loadDebugSettings,
  saveDebugSettings,
  emptyDebugSettings,
  testShopsStorage,
} from "./storage.js";
import { createSensors } from "./sensors.js";
import { createTrophyIcon } from "./trophy-icons.js";

// デバッグの初期位置（公共の場所。12章）
export const DEBUG_DEFAULT_POSITION = { lat: 35.7295, lng: 139.7109, accuracy: 10 }; // 池袋駅

const SHOPS_URL = "./shops.json";
const TEST_SHOPS_URL = "./tests/fixtures/shops.json"; // ダミー店モード（?debug=1&shops=test）だけ
const SPIN_MS = 1500; // 行き先が変わったときの回転（CSS の 1.4s より少し長く）

const $ = (id) => document.getElementById(id);

async function loadShops(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.shops) ? data.shops : [];
  } catch (e) {
    console.error("店データを読み込めませんでした", e);
    return [];
  }
}

// ホーム画面から開いているか（11章）
function isStandalone() {
  try {
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ---------- 画面のスリープ防止（10章） ----------
// S1 の間だけかける。使えない端末や断られたときは何もしない
function createWakeLock() {
  let wanted = false;
  let sentinel = null;
  let pending = false;

  async function acquire() {
    if (!wanted || sentinel || pending || document.visibilityState !== "visible") return;
    if (!navigator.wakeLock?.request) return;
    pending = true;
    try {
      const s = await navigator.wakeLock.request("screen");
      if (!wanted) {
        s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener("release", () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // 使えない・断られた
    } finally {
      pending = false;
    }
  }

  // 裏に回ると自動で解除されるので、表に戻ったらかけ直す
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") acquire();
  });

  return {
    enable() {
      wanted = true;
      acquire();
    },
    disable() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      s?.release().catch(() => {});
    },
  };
}

async function main() {
  const mode = appMode(location.search);
  const realStorage = getLocalStorage();
  // ダミー店モードでは、本物の記録と混ざらないよう保存先を分ける（12章）
  const storage = mode.testShops ? testShopsStorage(realStorage) : realStorage;

  // デバッグの設定は ?debug=1 のときだけ読む。初めて開いたときは、現在地を池袋駅に上書きする
  let debugSettings = null;
  if (mode.debug) {
    debugSettings = loadDebugSettings(storage);
    if (debugSettings === null) {
      debugSettings = saveDebugSettings(storage, { ...emptyDebugSettings(), position: DEBUG_DEFAULT_POSITION });
    }
  }

  const sensors = createSensors({
    overrides: debugSettings
      ? { position: debugSettings.position, heading: debugSettings.heading, timeOffsetMs: debugSettings.timeOffsetMs }
      : null,
  });
  const store = createStore({ storage, now: sensors.now() });
  const shops = await loadShops(mode.testShops ? TEST_SHOPS_URL : SHOPS_URL);
  const wakeLock = createWakeLock();

  const state = {
    screen: "start", // start | nav | other
    shop: null, // 案内中の店
    busy: false,
    reselecting: false, // 選び直しの間は描画しない（案内先が一時的にないため）
    shownDial: null, // CSS に入れた連続した角度
    shownArrow: null,
    spinRequested: false,
    spinning: false,
    trophyKey: undefined,
    hintsKey: null,
  };

  const tempTarget = () => debugSettings?.tempTarget ?? null;

  // ---------- お知らせ（コンパスの上に数秒） ----------
  const notices = [];
  let noticeTimer = null;
  function showNextNotice() {
    const n = $("notice");
    const text = notices.shift();
    if (text === undefined) {
      n.classList.remove("is-visible");
      noticeTimer = null;
      return;
    }
    n.textContent = text;
    n.classList.add("is-visible");
    noticeTimer = setTimeout(showNextNotice, NOTICE_SEC * 1000);
  }
  function notice(text) {
    notices.push(text);
    if (noticeTimer === null) showNextNotice();
  }
  // 「探しています…」のように、終わるまで出しておくもの
  function holdNotice(text) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
    notices.length = 0;
    $("notice").textContent = text;
    $("notice").classList.add("is-visible");
  }
  function clearNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = null;
    notices.length = 0;
    $("notice").classList.remove("is-visible");
  }

  // ---------- 画面の切り替え ----------
  function showScreen(name) {
    state.screen = name;
    $("screen-start").hidden = name !== "start";
    $("screen-nav").hidden = name !== "nav";
    $("screen-other").hidden = name !== "other";
    if (name === "nav") wakeLock.enable();
    else wakeLock.disable();
  }

  function showStart() {
    state.shop = null;
    clearNotice();
    showScreen("start");
  }

  function showNav() {
    state.hintsKey = null;
    state.trophyKey = undefined;
    showScreen("nav");
    render();
  }

  // S2〜S4 の仮の表示（Phase 5 で作る）
  function showOther(kind, { shop = null, code = null } = {}) {
    state.shop = kind === "arrived" ? shop : null;
    clearNotice();
    const titles = {
      arrived: "到着しました",
      out: "近くに案内できるお店がありません",
      error: "位置情報を取得できません",
    };
    $("other-title").textContent = titles[kind];
    $("other-name").textContent = kind === "arrived" && shop ? shop.name : "";
    $("other-detail").textContent = kind === "arrived" && shop ? String(shop.hints?.[2] ?? "") : code ? `（${code}）` : "";
    showScreen("other");
  }

  // ---------- 位置を待つ ----------

  // promise が終わるか、位置が1回も取れないまま位置情報のエラーが来るまで待つ。エラーなら null
  function untilPositionOrError(promise) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        unsub();
        resolve(v);
      };
      const check = () => {
        const s = sensors.getState();
        if (!s.position && s.positionError) finish(null);
      };
      const unsub = sensors.subscribe(check);
      promise.then(finish);
      check();
    });
  }

  // 精度を待たずに、最初に届いた位置（案内先の再開・仮の目的地）
  function firstPosition() {
    return untilPositionOrError(
      new Promise((resolve) => {
        const p = sensors.getState().position;
        if (p) return resolve(p);
        const unsub = sensors.subscribe(() => {
          const q = sensors.getState().position;
          if (q) {
            unsub();
            resolve(q);
          }
        });
      }),
    );
  }

  // ---------- 店を選ぶ（4-1） ----------

  function choose(position, avoidShopId) {
    return selectShop({ shops, visits: store.visits(), position, now: sensors.now(), random: Math.random, avoidShopId });
  }

  function setGuide(shop) {
    store.setTarget({ shopId: shop.id, selectedAt: sensors.now() });
    state.shop = shop;
  }

  async function route() {
    if (tempTarget()) {
      if (!(await firstPosition())) return showOther("error");
      return showNav();
    }

    const r = resolveTarget(store.getTarget(), shops, store.visits(), sensors.now());
    if (r.action === "arrived") return showOther("arrived", { shop: r.shop });
    if (r.action === "resume") {
      if (!(await firstPosition())) return showOther("error");
      state.shop = r.shop;
      return showNav();
    }
    if (store.getTarget()) store.clearTarget();

    const fix = await untilPositionOrError(sensors.waitInitialFix());
    if (!fix) return showOther("error");
    const result = choose(fix.position, null);
    if (result.result !== "ok") return showOther("out", { code: result.result });
    setGuide(result.shop);
    showNav();
    if (fix.lowAccuracy) notice("位置の精度が低いため、案内がずれることがあります");
  }

  async function start() {
    if (state.busy) return;
    state.busy = true;
    $("start-button").disabled = true;
    $("start-status").textContent = "現在地を確かめています…";
    // iPhone の方位センサーの許可は、ボタンを押した処理の中で求める（10章）
    sensors.startHeading().catch(() => {});
    sensors.startPosition();
    try {
      await route();
    } finally {
      state.busy = false;
      $("start-button").disabled = false;
      $("start-status").textContent = "";
    }
  }

  // 「別のお店にする」（4-2）
  async function reselect() {
    if (state.busy || !state.shop) return;
    state.busy = true;
    const previous = state.shop;
    state.reselecting = true;
    try {
      store.clearTarget();
      holdNotice("探しています…");
      let position = sensors.getState().position;
      let lowAccuracy = false;
      if (!position || position.accuracy > INITIAL_ACCURACY_M) {
        const fix = await untilPositionOrError(sensors.waitInitialFix());
        if (!fix) return showOther("error");
        position = fix.position;
        lowAccuracy = fix.lowAccuracy;
      }
      const result = choose(position, previous.id);
      const outcome = reselectOutcome(previous.id, result);
      if (outcome === "none") return showOther("out", { code: result.result });
      setGuide(result.shop);
      clearNotice();
      if (outcome === "changed") {
        state.hintsKey = null;
        if (!prefersReducedMotion()) state.spinRequested = true;
        notice("行き先が変わりました");
      } else {
        notice("近くで案内できるお店はここだけです");
      }
      if (lowAccuracy) notice("位置の精度が低いため、案内がずれることがあります");
    } finally {
      state.busy = false;
      state.reselecting = false;
    }
    render();
  }

  // ---------- S1 の描画 ----------

  function renderTrophy() {
    const { level } = trophySummary(store.visits());
    const key = level?.id ?? null;
    if (key === state.trophyKey) return;
    state.trophyKey = key;
    const btn = $("trophy");
    btn.replaceChildren(createTrophyIcon(document, key, undefined, 26));
    btn.setAttribute("aria-label", level ? `記録（${level.name}トロフィー）` : "記録");
  }

  function renderHints(hints, unlocked) {
    const slots = hintSlots(hints, unlocked);
    const key = JSON.stringify(slots);
    if (key === state.hintsKey) return;
    state.hintsKey = key;
    const list = $("hints");
    list.replaceChildren(
      ...slots.map((s) => {
        const li = document.createElement("li");
        if (s.open) {
          li.className = "hint hint--open";
          const mark = document.createElement("span");
          mark.className = "hint-mark";
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = "◈";
          const text = document.createElement("span");
          text.textContent = s.text;
          li.append(mark, text);
        } else {
          li.className = "hint hint--locked";
          li.textContent = s.lockLabel;
        }
        return li;
      }),
    );
  }

  function setRotation(node, deg) {
    node.style.transform = `rotate(${deg}deg)`;
  }

  function render() {
    if (state.screen !== "nav" || state.reselecting) return;
    const temp = tempTarget();
    if (!temp && (!state.shop || !store.getTarget())) {
      // デバッグのリセットなどで案内先がなくなった
      return showStart();
    }
    const target = temp ?? state.shop;
    const now = sensors.now();
    const s = sensors.getState();
    const p = s.position;

    const color = temp ? temp.color : shopRecord(state.shop.id, store.visits(), now).color;
    $("screen-nav").dataset.color = color;
    renderTrophy();
    $("reselect").hidden = Boolean(temp);
    $("hints").hidden = Boolean(temp);

    // 方位センサーが使えないときは、N を上に固定して「北を上にして見てください」
    const usable = headingUsable(s);
    $("north-up").hidden = usable || !["unavailable", "denied"].includes(s.headingStatus);

    if (!p) {
      $("distance").textContent = "—";
      return;
    }

    const d = distanceM(p, target);
    const angles = compassAngles(bearingDeg(p, target), usable ? s.heading : null, DECLINATION_DEG);

    // 文字盤。方位ラベルは逆に回して、いつも正立させる
    state.shownDial = unwrapAngle(state.shownDial, angles.dial);
    setRotation($("compass-dial"), state.shownDial);
    for (const t of document.querySelectorAll("#compass-dial .dial-label")) {
      t.setAttribute("transform", `rotate(${-state.shownDial} ${t.dataset.x} ${t.dataset.y})`);
    }

    // 矢印。行き先が変わったときは1回転してから止まる
    const arrow = $("compass-arrow");
    if (state.spinRequested) {
      state.spinRequested = false;
      state.spinning = true;
      state.shownArrow = spinAngle(state.shownArrow, angles.arrow);
      arrow.classList.add("is-spinning");
      setRotation(arrow, state.shownArrow);
      setTimeout(() => {
        arrow.classList.remove("is-spinning");
        state.spinning = false;
        render();
      }, SPIN_MS);
    } else if (!state.spinning) {
      state.shownArrow = unwrapAngle(state.shownArrow, angles.arrow);
      setRotation(arrow, state.shownArrow);
    }

    $("distance").textContent = formatDistance(d);

    if (temp) {
      // 仮の目的地：到着画面の代わりに表示だけ。記録・トロフィー・点数には関係しない（12章）
      const arrived = hintProgress(d, p.accuracy).arrived;
      $("temp-label").hidden = false;
      $("temp-label").textContent = arrived ? `仮の目的地に着きました（${Math.round(d)}m）` : "仮の目的地";
      return;
    }
    $("temp-label").hidden = true;

    const saved = store.getTarget();
    const prog = hintProgress(d, p.accuracy, saved.unlockedHints);
    if (prog.unlockedHints > saved.unlockedHints) store.updateTarget({ unlockedHints: prog.unlockedHints });
    if (prog.arrived) {
      store.updateTarget({ arrivedAt: now });
      return showOther("arrived", { shop: state.shop });
    }
    renderHints(state.shop.hints, prog.unlockedHints);
  }

  // ---------- 操作 ----------

  $("install-guide").hidden = isStandalone();
  $("start-button").addEventListener("click", start);

  $("reselect").addEventListener("click", () => {
    $("confirm").hidden = false;
    $("confirm-yes").focus();
  });
  $("confirm-no").addEventListener("click", () => {
    $("confirm").hidden = true;
  });
  $("confirm-yes").addEventListener("click", () => {
    $("confirm").hidden = true;
    reselect();
  });
  // トロフィーをタップすると記録パネル（S5）を開く。記録パネルは Phase 5 で作る
  $("trophy").addEventListener("click", () => {});

  sensors.subscribe(render);

  if (mode.debug) {
    const { mountDebugPanel } = await import("./debug.js");
    mountDebugPanel({
      root: document.body,
      store,
      sensors,
      shops,
      storage,
      settings: debugSettings,
      testShops: mode.testShops,
      onChange(settings) {
        const hadTemp = Boolean(debugSettings?.tempTarget);
        debugSettings = settings;
        const hasTemp = Boolean(settings.tempTarget);
        if (hasTemp && !hadTemp && state.screen !== "start") {
          showNav();
        } else if (!hasTemp && hadTemp && state.screen === "nav") {
          // 仮の目的地を解除したら、通常の案内に戻る
          if (state.shop && store.getTarget()) render();
          else showStart();
        } else {
          render();
        }
      },
    });
  }
}

main();
