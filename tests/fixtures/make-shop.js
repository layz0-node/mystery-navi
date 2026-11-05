// テスト用のダミー店を組み立てる補助。座標は池袋駅（公共の場所）を基準にする。

export const BASE = { lat: 35.7295, lng: 139.7109 }; // 池袋駅

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// from から方位 bearing（度）へ distance（m）進んだ点
export function offset(from, distance, bearing = 0) {
  const δ = distance / R;
  const θ = rad(bearing);
  const φ1 = rad(from.lat);
  const λ1 = rad(from.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lng: deg(λ2) };
}

// 毎日同じ営業時間
export function everyDay(ranges) {
  return Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [...ranges]]));
}

export const ALWAYS = everyDay(["00:00-24:00"]);

// BASE から distance（m）・方位 bearing の位置に店を置く。営業時間は既定で24時間
export function makeShop(id, { distance = 500, bearing = 0, hours = ALWAYS } = {}) {
  return {
    id,
    name: `テスト店${id}`,
    ward: "豊島区",
    ...offset(BASE, distance, bearing),
    hours,
    hints: ["ダミーのヒント1", "ダミーのヒント2", "ダミーのヒント3"],
  };
}

// 日本時間で書いた日時を Date にする（例：jst("2026-11-09T23:00")）
export function jst(text) {
  return new Date(`${text}:00+09:00`);
}

// 決まった順に値を返す乱数
export function sequence(...values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("乱数を想定より多く使いました");
    return values[i++];
  };
}

export function visit(shopId, value, at) {
  return { shopId, value, at: at instanceof Date ? at.toISOString() : at };
}
