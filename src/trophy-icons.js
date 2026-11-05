// トロフィーの形（requirements.md 8章・N3）。段階が上がるほど形を複雑にする。
// 3案を用意し、たまおが選んだら TROPHY_DESIGN をその案にして、ほかの案は消す。
// SVG は createElementNS で組み立てる（innerHTML は使わない）。
// 色は currentColor。段階ごとの色は style.css の .trophy-icon--<段階> で付ける。

export const TROPHY_DESIGN = "a"; // 仮。たまおが選んだ案にする

const NS = "http://www.w3.org/2000/svg";
const C = 12; // viewBox 0 0 24 24 の中心

const fmt = (n) => Number(n.toFixed(2));

// 正多角形の頂点（上の頂点から時計回り）
function polygon(n, r, { cx = C, cy = C, rotate = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotate - 90 + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${fmt(cx + r * Math.cos(a))},${fmt(cy + r * Math.sin(a))}`);
  }
  return pts.join(" ");
}

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
const circle = (r, fill = 0, extra = {}) => ["circle", { cx: C, cy: C, r, fill }, extra];
const poly = (points, fill = 0.25) => ["polygon", { points, fill }];
const path = (d, fill = 0) => ["path", { d, fill }];

// 案A：8章の案どおり（メダル → リボン付きメダル → 盾 → 杯 → 宝石付きの杯 → カットされた宝石 → 光る星）
const CUP = [
  path("M7 4H17V8C17 11.5 14.8 13.5 12 13.5C9.2 13.5 7 11.5 7 8Z", 0.25),
  path("M7 6H5C5 8.8 6 10 7.5 10.3M17 6H19C19 8.8 18 10 16.5 10.3M12 13.5V17.5"),
  path("M9 20.5H15L14 17.5H10Z", 0.25),
];
const DESIGN_A = {
  label: "案A：メダルから星へ",
  shapes: {
    none: [circle(7)],
    iron: [circle(6, 0.25), circle(3.4)],
    bronze: [path("M8 2.5L10.8 9.3M16 2.5L13.2 9.3"), ["circle", { cx: C, cy: 14.6, r: 5.6, fill: 0.25 }], ["circle", { cx: C, cy: 14.6, r: 3 }]],
    silver: [path("M12 3L19 5.8V11C19 15.8 16 19.2 12 21C8 19.2 5 15.8 5 11V5.8Z", 0.25), path("M12 6.5V17.5M8.5 10.5H15.5")],
    gold: CUP,
    emerald: [...CUP, poly("12,5.4 14,8 12,10.6 10,8", 0.9)],
    diamond: [poly("7,4.5 17,4.5 21,9.5 12,20.5 3,9.5"), path("M3 9.5H21M9.6 4.5L7.8 9.5L12 20.5L16.2 9.5L14.4 4.5")],
    polaris: [poly(rays([10.5, 5, 10.5, 5, 10.5, 5, 10.5, 5], 1.9), 0.6)],
  },
};

// 案B：幾何学（点 → 三角 → 四角 → 五角 → 六角 → 八芒星 → 光る星）。頂点が増えていく
const DESIGN_B = {
  label: "案B：頂点が増える図形",
  shapes: {
    none: [circle(7, 0, { "stroke-dasharray": "1.6 2.4" })],
    iron: [circle(2.8, 0.9)],
    bronze: [poly(polygon(3, 8, { cy: 13.2 }))],
    silver: [poly(polygon(4, 8.2, { rotate: 45 }))],
    gold: [poly(polygon(5, 8.6, { cy: 12.6 }))],
    emerald: [poly(polygon(6, 8.8)), ["polygon", { points: polygon(6, 4.2), fill: 0 }]],
    diamond: [poly(rays([9.8, 9.8, 9.8, 9.8, 9.8, 9.8, 9.8, 9.8], 5.4))],
    polaris: [poly(rays([10.8, 6, 10.8, 6, 10.8, 6, 10.8, 6], 2.2), 0.6), circle(4.4)],
  },
};

// 案C：コンパスの針（1本 → 南北の針 → 十字 → 輪付きの十字 → 8方位 → 輪付きの8方位 → 光る北極星）
const DESIGN_C = {
  label: "案C：コンパスの針",
  shapes: {
    none: [circle(8)],
    iron: [poly("12,3 14.2,12.5 9.8,12.5", 0.7)],
    bronze: [poly("12,3 14.2,12 12,21 9.8,12", 0.15), poly("12,3 14.2,12 9.8,12", 0.8)],
    silver: [poly(rays([9.5, 9.5, 9.5, 9.5], 2.4))],
    gold: [circle(6.6), poly(rays([10, 10, 10, 10], 2.4))],
    emerald: [poly(rays([10, 5.6, 10, 5.6, 10, 5.6, 10, 5.6], 2.2))],
    diamond: [circle(6.6), circle(10.6), poly(rays([10, 5.6, 10, 5.6, 10, 5.6, 10, 5.6], 2.2))],
    polaris: [poly(rays([11, 4.2, 7.2, 4.2, 11, 4.2, 7.2, 4.2, 11, 4.2, 7.2, 4.2, 11, 4.2, 7.2, 4.2], 1.8), 0.6)],
  },
};

export const TROPHY_DESIGNS = { a: DESIGN_A, b: DESIGN_B, c: DESIGN_C };

// トロフィーのアイコン（<svg>）を作る。levelId が null ならアイアン前（線だけの薄いアイコン）
export function createTrophyIcon(doc, levelId, designId = TROPHY_DESIGN, size = 24) {
  const id = levelId ?? "none";
  const design = TROPHY_DESIGNS[designId] ?? TROPHY_DESIGNS[TROPHY_DESIGN];
  const parts = design.shapes[id] ?? design.shapes.none;
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `trophy-icon trophy-icon--${id}`);
  for (const [tag, attrs, extra = {}] of parts) {
    const node = doc.createElementNS(NS, tag);
    const { fill = 0, ...rest } = attrs;
    for (const [k, v] of Object.entries({ ...rest, ...extra })) node.setAttribute(k, String(v));
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
