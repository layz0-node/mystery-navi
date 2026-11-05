// 位置情報・方位センサー・デバッグ上書き（requirements.md 4-1・10章・12章）。
// 計算は logic.js の純粋な関数に任せ、ここではブラウザのイベントとタイマーだけを扱う。
// 位置情報は端末の外に送らない（CLAUDE.md 6）。

import { INITIAL_FIX_TIMEOUT_SEC, HEADING_TIMEOUT_SEC } from "./config.js";
import {
  headingFromReading,
  smoothHeading,
  headingStatusStart,
  nextHeadingStatus,
  initialFixStart,
  initialFixStep,
} from "./logic.js";

// 画面の回転角（度）。古いiPhoneは window.orientation（-90 もある）
export function readScreenAngle(env = globalThis) {
  const a = env.screen?.orientation?.angle;
  if (Number.isFinite(a)) return a;
  const legacy = env.orientation;
  return Number.isFinite(legacy) ? legacy : 0;
}

// env：window の代わり（テストやデバッグで差し替えられるように）
// overrides：デバッグの上書き { position: { lat, lng, accuracy } | null, heading: number | null, timeOffsetMs: number | null }
export function createSensors({ env = globalThis, overrides = null } = {}) {
  const listeners = new Set();
  let ov = { position: null, heading: null, timeOffsetMs: null, ...(overrides ?? {}) };

  // 位置
  let positionWanted = false;
  let watchId = null;
  let realPosition = null; // { lat, lng, accuracy, atMs }
  let positionError = null; // { code, message }

  // 方位
  let headingStarted = false;
  let headingState = null; // nextHeadingStatus の state
  let headingSource = null; // "ios" | "absolute" | "deviceorientation-absolute"
  let rawHeading = null; // 画面の回転を補正した後、平滑化する前
  let smoothed = null;
  let headingTimer = null;

  function emit() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ---------- 時刻 ----------

  function now() {
    return new Date(Date.now() + (ov.timeOffsetMs ?? 0));
  }

  // ---------- 位置 ----------

  function effectivePosition() {
    if (ov.position) return { ...ov.position, source: "debug" };
    if (realPosition) return { ...realPosition, source: "gps" };
    return null;
  }

  function stopWatch() {
    if (watchId !== null) {
      env.navigator?.geolocation?.clearWatch(watchId);
      watchId = null;
    }
  }

  // 上書きがあるあいだは、実際の位置情報を取りに行かない
  function syncWatch() {
    if (!positionWanted || ov.position) {
      stopWatch();
      return;
    }
    if (watchId !== null) return;
    const geo = env.navigator?.geolocation;
    if (!geo) {
      positionError = { code: "unsupported", message: "位置情報が使えません" };
      emit();
      return;
    }
    watchId = geo.watchPosition(
      (p) => {
        realPosition = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          atMs: Date.now(),
        };
        positionError = null;
        emit();
      },
      (err) => {
        positionError = { code: err.code, message: err.message };
        emit();
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }

  function startPosition() {
    positionWanted = true;
    syncWatch();
  }

  // 誤差が INITIAL_ACCURACY_M 以下になるまで、最大 INITIAL_FIX_TIMEOUT_SEC 秒待つ（4-1）
  // → Promise<{ position, lowAccuracy }>
  function waitInitialFix() {
    startPosition();
    return new Promise((resolve) => {
      let state = initialFixStart(Date.now());
      let lastSeen = null;
      const step = (event) => {
        state = initialFixStep(state, event);
        if (state.done) {
          clearTimeout(timer);
          listeners.delete(onChange);
          resolve(state.result);
        }
      };
      const feed = () => {
        const p = effectivePosition();
        if (!p) return;
        const key = `${p.lat},${p.lng},${p.accuracy},${p.atMs ?? ""}`;
        if (key === lastSeen) return;
        lastSeen = key;
        step({ type: "fix", fix: { lat: p.lat, lng: p.lng, accuracy: p.accuracy }, atMs: Date.now() });
      };
      const onChange = () => feed();
      listeners.add(onChange);
      const timer = setTimeout(() => step({ type: "tick", atMs: Date.now() }), INITIAL_FIX_TIMEOUT_SEC * 1000);
      feed();
    });
  }

  // ---------- 方位 ----------

  function onReading(reading) {
    const h = headingFromReading(reading, readScreenAngle(env));
    if (h === null) return;
    rawHeading = h;
    smoothed = smoothHeading(smoothed, h);
    headingState = nextHeadingStatus(headingState, { type: "value", heading: h, atMs: Date.now() });
    emit();
  }

  function listenHeading() {
    const DOE = env.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      // iPhone：webkitCompassHeading だけを使う
      headingSource = "ios";
      env.addEventListener("deviceorientation", (e) => onReading({ compass: e.webkitCompassHeading }));
    } else if ("ondeviceorientationabsolute" in env) {
      // Android（Chrome など）：絶対方位のイベント（T1）
      headingSource = "absolute";
      env.addEventListener("deviceorientationabsolute", (e) => onReading({ alpha: e.alpha }));
    } else {
      // 絶対方位のイベントがないブラウザ：absolute が true の値だけを使う。相対の値は使わない
      headingSource = "deviceorientation-absolute";
      env.addEventListener("deviceorientation", (e) => {
        if (e.webkitCompassHeading !== undefined) onReading({ compass: e.webkitCompassHeading });
        else if (e.absolute === true) onReading({ alpha: e.alpha });
      });
    }
  }

  // 「はじめる」などのボタンの中で呼ぶ（iPhone の許可ダイアログはユーザー操作が必須）
  // → Promise<"granted" | "denied" | "unsupported">
  async function startHeading() {
    if (headingStarted) return headingState?.status === "denied" ? "denied" : "granted";
    headingStarted = true;
    headingState = headingStatusStart(Date.now());
    const DOE = env.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      let result = "denied";
      try {
        result = await DOE.requestPermission();
      } catch {
        result = "denied";
      }
      if (result !== "granted") {
        headingState = nextHeadingStatus(headingState, { type: "denied" });
        emit();
        return "denied";
      }
    }
    if (!DOE && !("ondeviceorientationabsolute" in env)) {
      headingState = nextHeadingStatus(headingState, { type: "tick", atMs: Infinity });
      emit();
      return "unsupported";
    }
    listenHeading();
    headingTimer = setTimeout(() => {
      headingState = nextHeadingStatus(headingState, { type: "tick", atMs: Date.now() });
      emit();
    }, HEADING_TIMEOUT_SEC * 1000 + 50);
    emit();
    return "granted";
  }

  // ---------- 状態 ----------

  function getState() {
    const debugHeading = Number.isFinite(ov.heading);
    return {
      position: effectivePosition(),
      positionError: ov.position ? null : positionError,
      positionWanted,
      heading: debugHeading ? ov.heading : smoothed,
      rawHeading: debugHeading ? ov.heading : rawHeading,
      headingStatus: debugHeading ? "active" : headingState?.status ?? "idle",
      headingSource: debugHeading ? "debug" : headingSource,
      screenAngle: readScreenAngle(env),
      timeOverridden: Number.isFinite(ov.timeOffsetMs),
    };
  }

  return {
    now,
    startPosition,
    waitInitialFix,
    startHeading,
    getState,
    // デバッグの上書きを変える（渡した項目だけ。null で解除）
    setOverrides(patch) {
      ov = { ...ov, ...patch };
      syncWatch();
      emit();
    },
    getOverrides() {
      return { ...ov };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      stopWatch();
      clearTimeout(headingTimer);
    },
  };
}
