// 調整用の定数（requirements.md 9章）
// 実地テストで調整するときは、ここだけを書き換える。

export const SEARCH_RADIUS_M = 1000; // 候補を探す半径
export const MIN_TARGET_DISTANCE_M = 200; // これより近い店は選ばない
export const HINT1_RADIUS_M = 500; // ヒント1の解放距離
export const HINT2_RADIUS_M = 300; // ヒント2の解放距離
export const ARRIVAL_RADIUS_M = 100; // 到着とみなす距離
export const MAX_ACCURACY_FOR_ARRIVAL_M = 60; // 到着判定に使うGPS誤差の上限
export const INITIAL_ACCURACY_M = 100; // 店を選ぶ前に待つ位置の精度
export const INITIAL_FIX_TIMEOUT_SEC = 10; // 位置の精度を待つ最大秒数
export const MIN_REMAINING_OPEN_MIN = 75; // 閉店までの残りがこの分数以内の店は選ばない
export const UNVISITED_PICK_RATE = 0.7; // 両方に候補があるとき、未訪問グループから選ぶ確率（1.0で必ず未訪問）
export const BAD_PICK_WEIGHT = 0.5; // 訪問済みグループの中で、点数がマイナスの店の選ばれやすさ（他の店は1）
export const CLOSED_EXCLUDE_DAYS = 7; // 「閉まっていた」の後、選ばない日数（記録の日時から 日数×24時間）
export const TARGET_TTL_HOURS = 3; // 未到着の案内先を保持する時間
export const ARRIVAL_MIN_HOLD_HOURS = 3; // 到着画面を保つ最短の時間（到着した日の翌朝5時と、到着からこの時間後の遅いほうまで保つ）
export const DAY_BOUNDARY_HOUR = 5; // 「同じ日」を切り替える時刻（日本時間）
export const UNDO_SEC = 5; // 評価を取り消せる秒数
export const NOTICE_SEC = 4; // 昇格・行き先の変更などのお知らせを表示する秒数
// 「地図で見る」で開くURLの雛形。{query} に「店名 区名」をURLエンコードして入れる
export const MAP_SEARCH_URL = "https://www.google.com/maps/search/?api=1&query={query}";
export const HEADING_TIMEOUT_SEC = 3; // 方位センサーを待つ秒数。届かなければ「使えない」扱い。後から届いたら方位ありに戻す
export const DECLINATION_DEG = 0; // 磁北と真北のずれの補正。西はマイナス（東京は西に約7度なので −7）。実機で必要と分かったら設定する

// 日本時間（UTC+9）。時刻の判定はすべてこの時差で行い、端末のタイムゾーンに頼らない（requirements.md T4）
export const JST_OFFSET_MIN = 9 * 60;

// トロフィーの段階（回数の少ない順）。後から段階を足せる
export const TROPHY_LEVELS = [
  { id: "iron", name: "アイアン", count: 5 },
  { id: "bronze", name: "ブロンズ", count: 10 },
  { id: "silver", name: "シルバー", count: 20 },
  { id: "gold", name: "ゴールド", count: 35 },
  { id: "emerald", name: "エメラルド", count: 60 },
  { id: "diamond", name: "ダイヤ", count: 100 },
  { id: "polaris", name: "ポラリス", count: 150 },
];

// 記録ごとの点数（requirements.md 6章）
export const SCORE = { good: 1, bad: -1, declined: -1, closed: -1, skip: 0, full: 0 };

// 保存データ（requirements.md 6章）
export const STORAGE_KEY = "mysteryNavi.v1";
export const SCHEMA_VERSION = 1;
