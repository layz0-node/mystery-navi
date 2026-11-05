// 画面の切り替えと描画。
// 画面の本体（S0〜S5）は Phase 4 以降で実装する。
// 店名やヒントなどのデータを画面に出すときは textContent を使い、innerHTML に入れない。

import { createStore, getLocalStorage, loadDebugSettings, saveDebugSettings, emptyDebugSettings } from "./storage.js";
import { createSensors } from "./sensors.js";

// デバッグの初期位置（公共の場所。12章）
export const DEBUG_DEFAULT_POSITION = { lat: 35.7295, lng: 139.7109, accuracy: 10 }; // 池袋駅

async function loadShops() {
  try {
    const res = await fetch("./shops.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.shops) ? data.shops : [];
  } catch (e) {
    console.error("店データを読み込めませんでした", e);
    return [];
  }
}

async function main() {
  const debug = new URLSearchParams(location.search).get("debug") === "1";
  const storage = getLocalStorage();

  // デバッグの設定は ?debug=1 のときだけ読む。初めて開いたときは、現在地を池袋駅に上書きする
  let debugSettings = null;
  if (debug) {
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
  const shops = await loadShops();

  if (debug) {
    const { mountDebugPanel } = await import("./debug.js");
    mountDebugPanel({ root: document.body, store, sensors, shops, storage, settings: debugSettings });
  }
}

main();
