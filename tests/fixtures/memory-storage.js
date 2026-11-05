// localStorage の代わりになる、メモリ上の模擬ストレージ（テスト用）。
// 読み書きで例外を出す端末（プライベートブラウズ・容量オーバー）も再現できる。

export class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
    this.failReads = false; // true なら getItem で例外
    this.failWrites = false; // true なら setItem で例外
    this.failWritesTo = null; // (key) => boolean。true を返したキーへの setItem で例外
  }

  getItem(key) {
    if (this.failReads) throw new Error("SecurityError");
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites || (this.failWritesTo && this.failWritesTo(key))) {
      throw new Error("QuotaExceededError");
    }
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }

  keys() {
    return [...this.map.keys()];
  }

  // テスト用：保存データを JSON として読む
  json(key) {
    return JSON.parse(this.map.get(key));
  }
}
