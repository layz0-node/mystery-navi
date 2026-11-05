// トロフィーの形（requirements.md 8章・N3）。コンパスの針をモチーフに、段階が上がるほど形を複雑にする。
// 回転軸付きの針 → 南北の針 → 太い十字 → 輪付きの十字 → 8方位 → 二重の輪付きの8方位 → 伴星を連れた北極星。
// アイアンはナビ画面の矢印（三角）と取り違えないよう、線と回転軸だけで描く。
// ポラリスは上下に長い、左右非対称の星に小さな星を添え、シルバーの十字と形だけで見分けられるようにする。
// SVG は createElementNS で組み立てる（innerHTML は使わない）。
// 色は currentColor。段階ごとの色は style.css の .trophy-icon--<段階> で付ける。

const NS = "http://www.w3.org/2000/svg";
const C = 12; // viewBox 0 0 24 24 の中心

const fmt = (n) => Number(n.toFixed(2));

// 光の筋のような星。outer は各頂点の長さ（上から時計回り）、inner は谷の深さ
function rays(outer, inner, { cx = C, cy = C } = {}) {
  const n = outer.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (const [r, offset] of [[outer[i], 0], [inner, 0.5]]) {
      const a = ((-90 + (360 / n) * (i + offset)) * Math.PI) / 180;
      pts.push(`${fmt(cx + r * Math.cos(a))},${fmt(cy + r * Math.sin(a))}`);
    }
  }
  return pts.join(" ");
}

// 形の部品。fill は塗りの濃さ（0 で線だけ）
const circle = (r, fill = 0) => ["circle", { cx: C, cy: C, r, fill }];
const dot = (cx, cy, r) => ["circle", { cx, cy, r, fill: 0.9 }];
const poly = (points, fill = 0.25) => ["polygon", { points, fill }];
const path = (d) => ["path", { d, fill: 0 }];

const EIGHT_POINTS = rays([10, 5.6, 10, 5.6, 10, 5.6, 10, 5.6], 2.2);

// 段階ごとの形（none はアイアン前：線だけの薄いアイコン）
export const TROPHY_SHAPES = {
  none: [circle(8)],
  iron: [path("M12 3.5V20.5"), dot(C, 4.4, 1.5), circle(2.6, 0.3)],
  bronze: [poly("12,3 14.2,12 12,21 9.8,12", 0.15), poly("12,3 14.2,12 9.8,12", 0.8)],
  silver: [poly(rays([9.5, 9.5, 9.5, 9.5], 3.6))],
  gold: [circle(6.6), poly(rays([10, 10, 10, 10], 2.4))],
  emerald: [poly(EIGHT_POINTS)],
  diamond: [circle(6.6), circle(10.6), poly(EIGHT_POINTS)],
  polaris: [
    poly(rays([11.2, 2.6, 6.2, 2.6, 9, 2.6, 6.2, 2.6], 1.3, { cx: 11, cy: 12 }), 0.7),
    poly(rays([2.8, 2.8, 2.8, 2.8], 0.7, { cx: 19.6, cy: 4.6 }), 0.9),
    poly(rays([2, 2, 2, 2], 0.5, { cx: 4.4, cy: 19.4 }), 0.9),
    dot(19.8, 18.6, 0.9),
  ],
};

// トロフィーのアイコン（<svg>）を作る。levelId が null ならアイアン前
export function createTrophyIcon(doc, levelId, size = 24) {
  const id = Object.hasOwn(TROPHY_SHAPES, levelId ?? "none") ? levelId ?? "none" : "none";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `trophy-icon trophy-icon--${id}`);
  for (const [tag, attrs] of TROPHY_SHAPES[id]) {
    const node = doc.createElementNS(NS, tag);
    const { fill = 0, ...rest } = attrs;
    for (const [k, v] of Object.entries(rest)) node.setAttribute(k, String(v));
    node.setAttribute("fill", fill > 0 ? "currentColor" : "none");
    if (fill > 0) node.setAttribute("fill-opacity", String(fill));
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", "1.3");
    node.setAttribute("stroke-linejoin", "round");
    node.setAttribute("stroke-linecap", "round");
    svg.append(node);
  }
  return svg;
}
