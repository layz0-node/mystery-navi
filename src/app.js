// 画面の切り替えと描画（requirements.md 3章・4章・10章）。
// 計算は logic.js の関数に任せ、ここでは画面に出すことと、画面の切り替えだけを扱う。
// 店名やヒントなどのデータを画面に出すときは textContent を使い、innerHTML に入れない。

import { DECLINATION_DEG, INITIAL_ACCURACY_M, INITIAL_FIX_TIMEOUT_SEC, NOTICE_SEC, UNDO_SEC } from "./config.js";
import {
  appMode,
  arrivalHoldExpired,
  bearingDeg,
  compassAngles,
  distanceM,
  errorView,
  exportDateLabel,
  formatDistance,
  headingUsable,
  hintProgress,
  hintSlots,
  importConfirmText,
  importErrorText,
  locationGate,
  mapSearchUrl,
  outOfAreaMessage,
  RATING_BUTTONS,
  ratingLabel,
  ratingValue,
  recordsPanelModel,
  reselectOutcome,
  resolveTarget,
  savingFailed,
  selectShop,
  shopRecord,
  spinAngle,
  trophySummary,
  unreadableNotice,
  unwrapAngle,
  waitingText,
} from "./logic.js";
import {
  createStore,
  getLocalStorage,
  loadDebugSettings,
  parseBackup,
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
const HOLD_CHECK_MS = 30 * 1000; // 到着画面を出している間に、保持の期限を確かめる間隔
const LOW_ACCURACY_TEXT = "位置の精度が低いため、案内がずれることがあります";
const RECOVERED_TEXT = "保存データが読めなかったため、新しく記録を始めます。前のデータは端末に残してあります";

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

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

// ---------- 一時的なお知らせ（S1・S3 のコンパスの上） ----------
// 数秒で消えるもの（取り消し・行き先の変更など）は順番に出す。
// 消えないもの（昇格。×を押すまで出す）は1つだけ持ち、数秒のお知らせがないときに出す
function createNotices(node) {
  const queue = [];
  let current = null;
  let timer = null;
  let sticky = null;

  function paint() {
    const item = current ?? sticky;
    node.replaceChildren();
    node.classList.toggle("is-visible", Boolean(item));
    node.classList.toggle("notice--card", Boolean(item?.icon));
    if (!item) return;
    if (item.icon !== undefined) node.append(createTrophyIcon(document, item.icon, 22));
    node.append(make("span", "notice-text", item.text));
    for (const a of item.actions ?? []) {
      const b = make("button", a.className ?? "notice-action", a.label);
      b.type = "button";
      if (a.ariaLabel) b.setAttribute("aria-label", a.ariaLabel);
      b.addEventListener("click", a.onClick);
      node.append(b);
    }
  }

  function next() {
    clearTimeout(timer);
    timer = null;
    current = queue.shift() ?? null;
    if (current && current.durationMs !== null) timer = setTimeout(next, current.durationMs);
    paint();
  }

  return {
    // text、actions：[{ label, onClick, className, ariaLabel }]、durationMs（null で出したまま）
    push(text, { actions = [], durationMs = NOTICE_SEC * 1000 } = {}) {
      queue.push({ text, actions, durationMs });
      if (current === null) next();
    },
    // 終わるまで出しておくもの（「探しています…」など）。待っているお知らせは捨てる
    hold(text) {
      queue.length = 0;
      clearTimeout(timer);
      timer = null;
      current = { text, actions: [], durationMs: null };
      paint();
    },
    // 数秒のお知らせを消す（消えないお知らせは残す）
    clear() {
      queue.length = 0;
      clearTimeout(timer);
      timer = null;
      current = null;
      paint();
    },
    setSticky(item) {
      sticky = item;
      paint();
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
      ? {
          position: debugSettings.position,
          heading: debugSettings.heading,
          timeOffsetMs: debugSettings.timeOffsetMs,
          positionFailure: debugSettings.positionFailure,
        }
      : null,
  });
  const store = createStore({ storage, now: sensors.now() });
  const shops = await loadShops(mode.testShops ? TEST_SHOPS_URL : SHOPS_URL);
  const wakeLock = createWakeLock();
  const notices = createNotices($("notice"));

  const state = {
    screen: "start", // start | nav | arrived | out | searching | error
    shop: null, // 案内中の店（S1）・到着した店（S2）
    busy: false,
    flow: 0, // 位置を待つ処理の番号。取り消しなどで別の画面に移ったら、古い処理の結果は使わない
    reselecting: false, // 選び直しの間は描画しない（案内先が一時的にないため）
    shownDial: null, // CSS に入れた連続した角度
    shownArrow: null,
    spinRequested: false,
    spinning: false,
    trophyKey: undefined,
    hintsKey: null,
    recoveredShown: false,
    undoTimer: null,
    restartOnClose: false, // 記録を読み込んだら、記録パネルを閉じたときに起動画面に戻る
    confirmAction: null,
  };

  const tempTarget = () => debugSettings?.tempTarget ?? null;

  // ---------- 画面の切り替え ----------

  const SECTIONS = {
    start: "screen-start",
    nav: "screen-nav",
    arrived: "screen-arrived",
    out: "screen-out",
    searching: "screen-out",
    error: "screen-error",
  };

  function showScreen(name) {
    state.screen = name;
    for (const id of new Set(Object.values(SECTIONS))) $(id).hidden = id !== SECTIONS[name];
    $("top-layer").hidden = !["nav", "out", "searching"].includes(name);
    if (name === "nav") wakeLock.enable();
    else wakeLock.disable();
  }

  // 新しい流れを始める。前の流れの結果は捨てる
  function newFlow() {
    state.flow += 1;
    return state.flow;
  }

  function showStart() {
    newFlow();
    state.shop = null;
    state.busy = false;
    notices.clear();
    showScreen("start");
  }

  // S1 か S3 を出したとき：トロフィーと、まだ出していないお知らせ
  function afterTopScreen() {
    renderTrophy();
    if (!state.recoveredShown && store.status().recoveredKey) {
      state.recoveredShown = true;
      notices.push(RECOVERED_TEXT);
    }
    checkPromotion();
  }

  function showNav() {
    state.hintsKey = null;
    state.trophyKey = undefined;
    showScreen("nav");
    render();
    if (state.screen === "nav") afterTopScreen();
  }

  function showOut(code) {
    state.shop = null;
    const [title, detail] = outOfAreaMessage(code);
    $("out-title").textContent = title;
    $("out-detail").textContent = detail;
    $("out-detail").hidden = false;
    $("out-retry").hidden = false;
    $("out-status").textContent = "";
    state.trophyKey = undefined;
    showScreen("out");
    afterTopScreen();
  }

  // 評価の後などで、位置を待っているあいだ（S3 の場所に「探しています」を出す）
  function showSearching() {
    state.shop = null;
    $("out-title").textContent = "次のお店を探しています…";
    $("out-detail").hidden = true;
    $("out-retry").hidden = true;
    $("out-status").textContent = waitingText(false);
    state.trophyKey = undefined;
    showScreen("searching");
    renderTrophy();
  }

  function showError(kind) {
    state.shop = null;
    notices.clear();
    const v = errorView(kind);
    $("error-title").textContent = v.title;
    $("error-help").hidden = !v.help;
    $("error-retry").hidden = !v.retry;
    $("error-retry").disabled = false;
    $("error-status").textContent = "";
    showScreen("error");
  }

  // ---------- S2 到着画面 ----------

  function renderArrivedHints(hints) {
    const labels = ["ヒント1", "ヒント2", "入口"];
    $("arrived-hints").replaceChildren(
      ...labels.map((label, i) => {
        const li = make("li", "hint hint--open");
        li.append(make("span", "hint-label", label), make("span", "hint-text", String(hints?.[i] ?? "")));
        return li;
      }),
    );
  }

  function showRatingButtons() {
    $("rating").hidden = false;
    $("rating-reasons").hidden = true;
  }

  function showReasons(button) {
    $("rating-reasons-title").textContent = button.label;
    $("rating-reasons-buttons").replaceChildren(
      ...button.reasons.map((r) => {
        const b = make("button", `rating-button rating-button--${button.id}`, r.label);
        b.type = "button";
        b.addEventListener("click", () => rate(ratingValue(button.id, r.value)));
        return b;
      }),
    );
    $("rating").hidden = true;
    $("rating-reasons").hidden = false;
    $("rating-reasons-buttons").firstElementChild?.focus();
  }

  function showArrived(shop) {
    newFlow();
    state.busy = false;
    state.shop = shop;
    notices.clear();
    $("confirm").hidden = true;
    $("arrived-name").textContent = shop.name;
    renderArrivedHints(shop.hints);
    $("map-link").href = mapSearchUrl(shop);
    showRatingButtons();
    showScreen("arrived");
    renderArrived();
  }

  function renderArrived() {
    if (state.screen !== "arrived" || !state.shop) return;
    const p = sensors.getState().position;
    $("arrived-distance").textContent = p ? formatDistance(distanceM(p, state.shop)) : "—";
  }

  // 到着画面を保つ期限を過ぎたら、記録を残さずに選び直す（S2・Q4）
  function checkArrivalHold() {
    if (state.screen !== "arrived" || state.busy || !state.shop) return;
    const target = store.getTarget();
    if (!target || target.shopId !== state.shop.id) return showStart(); // デバッグのリセットや別のタブ
    if (arrivalHoldExpired(target, sensors.now())) reselect();
  }

  // ---------- 位置を待つ ----------

  // promise が終わるのを待つ → { value }。
  // 位置が1回も取れないまま、エラーが来るか POSITION_FAIL_TIMEOUT_SEC 秒たったら → { error }（S4）
  // onSlow(text)：INITIAL_FIX_TIMEOUT_SEC 秒を過ぎたときに一度だけ呼ぶ
  function untilPositionOrError(promise, onSlow = () => {}) {
    return new Promise((resolve) => {
      const startedAtMs = Date.now();
      let done = false;
      let slowShown = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        unsub();
        clearInterval(timer);
        resolve(v);
      };
      const check = () => {
        if (done) return;
        const s = sensors.getState();
        const nowMs = Date.now();
        const g = locationGate({ secure: s.secureContext, position: s.position, positionError: s.positionError, startedAtMs, nowMs });
        if (g.kind === "error") return finish({ error: g.error });
        if (!slowShown && nowMs - startedAtMs >= INITIAL_FIX_TIMEOUT_SEC * 1000) {
          slowShown = true;
          onSlow(waitingText(true));
        }
      };
      const unsub = sensors.subscribe(check);
      const timer = setInterval(check, 250);
      promise.then((value) => finish({ value }));
      check();
    });
  }

  // 精度を待たずに、最初に届いた位置
  function firstPosition() {
    return new Promise((resolve) => {
      const p = sensors.getState().position;
      if (p) return resolve(p);
      const unsub = sensors.subscribe(() => {
        const q = sensors.getState().position;
        if (q) {
          unsub();
          resolve(q);
        }
      });
    });
  }

  // 店を選ぶための位置 → { position, lowAccuracy } | { error }
  // how："fix"（精度を待つ）／"reuse"（今の位置の精度が足りていればそれ。なければ精度を待つ）／
  //      "latest"（精度を待たずに今の位置。なければ最初に届いた位置）
  async function acquirePosition(how, onSlow) {
    const p = sensors.getState().position;
    if (p && how === "latest") return { position: p, lowAccuracy: p.accuracy > INITIAL_ACCURACY_M };
    if (p && how === "reuse" && p.accuracy <= INITIAL_ACCURACY_M) return { position: p, lowAccuracy: false };
    const promise =
      how === "latest"
        ? firstPosition().then((q) => ({ position: q, lowAccuracy: q.accuracy > INITIAL_ACCURACY_M }))
        : sensors.waitInitialFix();
    const r = await untilPositionOrError(promise, onSlow);
    return r.error ? { error: r.error } : r.value;
  }

  function hasUsablePosition() {
    const p = sensors.getState().position;
    return Boolean(p && p.accuracy <= INITIAL_ACCURACY_M);
  }

  // ---------- 店を選ぶ（4-1） ----------

  function choose(position, avoidShopId) {
    return selectShop({ shops, visits: store.visits(), position, now: sensors.now(), random: Math.random, avoidShopId });
  }

  function setGuide(shop) {
    store.setTarget({ shopId: shop.id, selectedAt: sensors.now() });
    state.shop = shop;
  }

  // 起動・「もう一度試す」・「もう一度探す」で、案内先を決めて S1・S2・S3・S4 のどれかに進む
  async function route(onSlow) {
    const flow = newFlow();
    if (tempTarget()) {
      const r = await untilPositionOrError(firstPosition(), onSlow);
      if (flow !== state.flow) return;
      if (r.error) return showError(r.error);
      return showNav();
    }

    const r = resolveTarget(store.getTarget(), shops, store.visits(), sensors.now());
    if (r.action === "arrived") return showArrived(r.shop);
    if (r.action === "resume") {
      const w = await untilPositionOrError(firstPosition(), onSlow);
      if (flow !== state.flow) return;
      if (w.error) return showError(w.error);
      state.shop = r.shop;
      return showNav();
    }
    if (store.getTarget()) store.clearTarget();

    const fix = await acquirePosition("fix", onSlow);
    if (flow !== state.flow) return;
    if (fix.error) return showError(fix.error);
    const result = choose(fix.position, null);
    if (result.result !== "ok") return showOut(result.result);
    setGuide(result.shop);
    showNav();
    if (fix.lowAccuracy) notices.push(LOW_ACCURACY_TEXT);
  }

  // statusNode に待っている間の文言を出しながら route する
  async function routeWithStatus(statusNode, button) {
    if (state.busy) return;
    state.busy = true;
    if (button) button.disabled = true;
    statusNode.textContent = waitingText(false);
    // iPhone の方位センサーの許可は、ボタンを押した処理の中で求める（10章）
    sensors.startHeading().catch(() => {});
    try {
      await route((text) => {
        statusNode.textContent = text;
      });
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
      statusNode.textContent = "";
    }
  }

  function start() {
    sensors.startPosition();
    return routeWithStatus($("start-status"), $("start-button"));
  }

  // S4「もう一度試す」：位置の監視を始め直す
  function retryFromError() {
    if (state.busy) return;
    sensors.restartPosition();
    return routeWithStatus($("error-status"), $("error-retry"));
  }

  // S3「もう一度探す」
  function retryFromOut() {
    sensors.startPosition();
    return routeWithStatus($("out-status"), $("out-retry"));
  }

  // 「別のお店にする」（S1）・「評価せずに別のお店へ」（S2）・到着画面の保持の期限切れ（4-2）
  async function reselect() {
    if (state.busy || !state.shop) return;
    const flow = newFlow();
    state.busy = true;
    const previous = state.shop;
    const fromNav = state.screen === "nav";
    state.reselecting = true;
    try {
      store.clearTarget();
      let onSlow;
      if (fromNav) {
        notices.hold("探しています…");
        onSlow = (text) => notices.hold(text);
      } else {
        if (!hasUsablePosition()) showSearching();
        onSlow = (text) => {
          $("out-status").textContent = text;
        };
      }
      const fix = await acquirePosition("reuse", onSlow);
      if (flow !== state.flow) return;
      if (fix.error) return showError(fix.error);
      const result = choose(fix.position, previous.id);
      const outcome = reselectOutcome(previous.id, result);
      notices.clear();
      if (outcome === "none") return showOut(result.result);
      setGuide(result.shop);
      if (outcome === "changed") {
        state.hintsKey = null;
        if (!prefersReducedMotion()) state.spinRequested = true;
        notices.push("行き先が変わりました");
      } else {
        notices.push("近くで案内できるお店はここだけです");
      }
      if (fix.lowAccuracy) notices.push(LOW_ACCURACY_TEXT);
      state.reselecting = false;
      if (fromNav) render();
      else showNav();
    } finally {
      if (flow === state.flow) state.busy = false;
      state.reselecting = false;
    }
  }

  // ---------- 評価と取り消し（S2・4-4） ----------

  async function rate(value) {
    if (value === null || state.busy || state.screen !== "arrived" || !state.shop) return;
    const flow = newFlow();
    state.busy = true;
    const shop = state.shop;
    try {
      store.addVisit(shop.id, value, sensors.now()); // 案内先も消える
      startUndo(ratingLabel(value));
      if (!sensors.getState().position) showSearching();
      // 精度は待たない（待つと取り消しの5秒が過ぎてしまうため。Q1）
      const fix = await acquirePosition("latest", (text) => {
        $("out-status").textContent = text;
      });
      if (flow !== state.flow) return;
      if (fix.error) return showError(fix.error);
      const result = choose(fix.position, null);
      if (result.result !== "ok") showOut(result.result);
      else {
        setGuide(result.shop);
        showNav();
      }
      if (fix.lowAccuracy) notices.push(LOW_ACCURACY_TEXT);
    } finally {
      if (flow === state.flow) state.busy = false;
    }
  }

  // 取り消しのお知らせ（5秒）。5秒たったら、昇格のお知らせを確かめる
  function startUndo(label) {
    notices.clear();
    notices.push(label, {
      durationMs: UNDO_SEC * 1000,
      actions: [{ label: "取り消す", onClick: undo, className: "notice-action" }],
    });
    clearTimeout(state.undoTimer);
    state.undoTimer = setTimeout(() => {
      state.undoTimer = null;
      if (state.screen === "nav" || state.screen === "out") checkPromotion();
    }, UNDO_SEC * 1000 + 100);
  }

  function undo() {
    const ok = store.undo(sensors.now());
    clearTimeout(state.undoTimer);
    state.undoTimer = null;
    notices.clear();
    if (!ok) {
      notices.push("取り消せませんでした");
      return;
    }
    // 評価した店（到着済み）に戻る
    const r = resolveTarget(store.getTarget(), shops, store.visits(), sensors.now());
    if (r.action === "arrived") showArrived(r.shop);
    else showStart();
  }

  // ---------- 昇格のお知らせ（4-3） ----------

  function checkPromotion() {
    const level = store.pendingTrophyNotice(sensors.now());
    if (!level) return;
    store.markAnnounced(level.id);
    notices.setSticky({
      icon: level.id,
      text: `${level.name}トロフィー`,
      actions: [
        {
          label: "記録を書き出す",
          className: "notice-link",
          onClick: () => {
            notices.setSticky(null);
            openRecords({ exportNow: true });
          },
        },
        { label: "×", ariaLabel: "閉じる", className: "notice-close", onClick: () => notices.setSticky(null) },
      ],
    });
    renderTrophy();
  }

  // ---------- S5 記録パネル ----------

  function renderRecords() {
    const m = recordsPanelModel(store.visits());
    $("records-icon").replaceChildren(createTrophyIcon(document, m.level?.id ?? null, 40));
    $("records-title").textContent = m.level ? `${m.level.name}トロフィー` : "トロフィーはまだありません";
    $("records-count").textContent = m.countText;
    $("records-next").textContent = m.nextText;
    $("records-levels").replaceChildren(
      ...m.levels.map((l) => {
        const li = make("li", `records-level${l.earned ? " records-level--earned" : ""}`);
        li.append(
          createTrophyIcon(document, l.earned ? l.id : null, 22),
          make("span", "records-level-name", l.name),
          make("span", "records-level-count", l.countText),
        );
        return li;
      }),
    );
    $("records-visited").textContent = m.visitedText;
    $("records-good").textContent = m.goodText;
    $("records-bad").textContent = m.badText;
    $("records-saving").hidden = !savingFailed(store.status());
    $("export-date").textContent = `最後に書き出した日：${exportDateLabel(store.lastExportAt())}`;
    const unreadable = unreadableNotice(store.unreadableCount());
    $("records-unreadable").hidden = unreadable === null;
    $("records-unreadable").textContent = unreadable ?? "";
  }

  function setMessage(id, text, isError = false) {
    $(id).textContent = text;
    $(id).classList.toggle("records-message--error", isError);
  }

  function openRecords({ exportNow = false } = {}) {
    setMessage("export-message", "");
    setMessage("import-message", "");
    $("export-text").hidden = true;
    renderRecords();
    $("records").hidden = false;
    $("records").scrollTop = 0;
    if (exportNow) doExport();
    else $("records-close").focus({ preventScroll: true }); // パネルは上から見せる
  }

  function closeRecords() {
    $("records").hidden = true;
    $("confirm").hidden = true;
    if (state.restartOnClose) {
      state.restartOnClose = false;
      showStart();
    }
  }

  // 書き出し（11章）。クリップボードにコピーする。できなければ、選べる形で表示する
  function doExport() {
    const text = store.exportBackup(sensors.now());
    renderRecords();
    const box = $("export-text");
    box.value = text;
    const copy = (() => {
      try {
        return navigator.clipboard.writeText(text);
      } catch (e) {
        return Promise.reject(e);
      }
    })();
    copy.then(
      () => {
        box.hidden = true;
        setMessage("export-message", "コピーしました。メモアプリなどに貼り付けて保存してください");
      },
      () => {
        box.hidden = false;
        box.focus();
        box.select();
        setMessage("export-message", "コピーできませんでした。下の文字列をすべて選んでコピーし、メモアプリなどに貼り付けて保存してください");
      },
    );
  }

  // 読み込み（11章）。検査 → 回数を添えて確認 → 置き換え
  function doImport() {
    const parsed = parseBackup($("import-text").value);
    if (!parsed.ok) return setMessage("import-message", importErrorText(parsed.reason), true);
    const current = trophySummary(store.visits()).count;
    const incoming = trophySummary(parsed.visits).count;
    askConfirm(importConfirmText(current, incoming), "上書きする", () => {
      const r = store.importVisits(parsed.visits, sensors.now());
      if (!r.ok) return setMessage("import-message", importErrorText(r.reason), true);
      // 案内先は消える。記録パネルを閉じたら起動画面からやり直す
      state.restartOnClose = true;
      clearTimeout(state.undoTimer);
      state.undoTimer = null;
      notices.clear();
      notices.setSticky(null);
      $("import-text").value = "";
      setMessage("import-message", `読み込みました（${incoming}回）。「閉じる」で最初の画面に戻ります`);
      renderRecords();
      state.trophyKey = undefined;
      renderTrophy();
    });
  }

  // ---------- 確認 ----------

  function askConfirm(text, yesLabel, onYes) {
    $("confirm-text").textContent = text;
    $("confirm-yes").textContent = yesLabel;
    state.confirmAction = onYes;
    $("confirm").hidden = false;
    $("confirm-yes").focus();
  }

  // ---------- S1 の描画 ----------

  function renderTrophy() {
    const { level } = trophySummary(store.visits());
    const key = level?.id ?? null;
    if (key === state.trophyKey) return;
    state.trophyKey = key;
    const btn = $("trophy");
    btn.replaceChildren(createTrophyIcon(document, key, 26));
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
        if (s.open) {
          const li = make("li", "hint hint--open");
          const mark = make("span", "hint-mark", "◈");
          mark.setAttribute("aria-hidden", "true");
          li.append(mark, make("span", "", s.text));
          return li;
        }
        return make("li", "hint hint--locked", s.lockLabel);
      }),
    );
  }

  function setRotation(node, deg) {
    node.style.transform = `rotate(${deg}deg)`;
  }

  function render() {
    if (state.screen !== "nav" || state.reselecting) return;
    const temp = tempTarget();
    const saved = store.getTarget();
    if (!temp && (!state.shop || !saved)) {
      // デバッグのリセットや記録の読み込みなどで案内先がなくなった
      return showStart();
    }
    if (!temp && saved.arrivedAt) return showArrived(state.shop); // 別のタブで到着した
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
      $("gps-weak").hidden = true;
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
    // 誤差が60mを超えている間は「GPSの精度が下がっています」と小さく出す（5章）。到着の判定と同じ条件
    $("gps-weak").hidden = !hintProgress(d, p.accuracy).lowAccuracy;

    if (temp) {
      // 仮の目的地：到着画面の代わりに表示だけ。記録・トロフィー・点数には関係しない（12章）
      const arrived = hintProgress(d, p.accuracy).arrived;
      $("temp-label").hidden = false;
      $("temp-label").textContent = arrived ? `仮の目的地に着きました（${Math.round(d)}m）` : "仮の目的地";
      return;
    }
    $("temp-label").hidden = true;

    const prog = hintProgress(d, p.accuracy, saved.unlockedHints);
    if (prog.unlockedHints > saved.unlockedHints) store.updateTarget({ unlockedHints: prog.unlockedHints });
    if (prog.arrived) {
      // 到着。到着した日時を保存し、到着画面へ（5章）。以後はGPSで戻らない
      store.updateTarget({ arrivedAt: now });
      return showArrived(state.shop);
    }
    renderHints(state.shop.hints, prog.unlockedHints);
  }

  function onSensors() {
    if (state.screen === "nav") render();
    else if (state.screen === "arrived") renderArrived();
  }

  // ---------- 操作 ----------

  $("install-guide").hidden = isStandalone();
  $("start-button").addEventListener("click", start);
  $("error-retry").addEventListener("click", retryFromError);
  $("out-retry").addEventListener("click", retryFromOut);

  $("reselect").addEventListener("click", () => {
    askConfirm("今のお店をやめて、別のお店を探しますか？", "探す", reselect);
  });
  $("skip-rating").addEventListener("click", () => {
    askConfirm("評価せずに、別のお店を探しますか？", "探す", reselect);
  });
  $("confirm-no").addEventListener("click", () => {
    $("confirm").hidden = true;
    state.confirmAction = null;
  });
  $("confirm-yes").addEventListener("click", () => {
    $("confirm").hidden = true;
    const action = state.confirmAction;
    state.confirmAction = null;
    action?.();
  });

  // 評価ボタン（理由を選ぶボタンは、その場に理由と［戻る］を出す）
  $("rating").replaceChildren(
    ...RATING_BUTTONS.map((b) => {
      const btn = make("button", `rating-button rating-button--${b.id}`, b.label);
      btn.type = "button";
      btn.addEventListener("click", () => (b.reasons ? showReasons(b) : rate(ratingValue(b.id))));
      return btn;
    }),
  );
  $("rating-back").addEventListener("click", showRatingButtons);

  // トロフィーをタップすると記録パネル（S5）を開く
  $("trophy").addEventListener("click", () => openRecords());
  $("records-close").addEventListener("click", closeRecords);
  $("export-button").addEventListener("click", doExport);
  $("import-button").addEventListener("click", doImport);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("confirm").hidden) $("confirm-no").click();
    else if (!$("records").hidden) closeRecords();
  });

  sensors.subscribe(onSensors);
  setInterval(checkArrivalHold, HOLD_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkArrivalHold();
  });

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
          const r = state.shop ? resolveTarget(store.getTarget(), shops, store.visits(), sensors.now()) : null;
          if (r?.action === "arrived") showArrived(r.shop);
          else if (state.shop && store.getTarget()) render();
          else showStart();
        } else if (state.screen === "arrived") {
          // 時刻を変えたら、到着画面を保つ期限を確かめる
          checkArrivalHold();
          renderArrived();
        } else {
          if (state.screen === "out") {
            state.trophyKey = undefined;
            renderTrophy();
          }
          render();
        }
      },
    });
  }
}

main();
