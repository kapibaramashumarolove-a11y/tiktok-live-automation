'use strict';

/**
 * 色ごと（任意でカテゴリ指定）にメッセージを抽選する。
 * 色ごとに直近 historySize 件の履歴を保持し、その範囲での重複を避ける。
 * 候補がすべて履歴に含まれる場合は、最も古い履歴から順に再解禁する。
 */
class MessagePicker {
  constructor(data, { historySize = 10, random = Math.random } = {}) {
    if (!data || typeof data.colors !== 'object') {
      throw new Error('messages data must have a "colors" object');
    }
    this.categories = data.categories || {};
    this.random = random;
    this.historySize = historySize;
    this.pool = new Map(); // color -> [{id, category, text}]
    this.history = new Map(); // color -> [id, ...] (古い順)

    for (const [color, byCategory] of Object.entries(data.colors)) {
      const items = [];
      for (const [category, texts] of Object.entries(byCategory)) {
        texts.forEach((text, i) => items.push({ id: `${color}:${category}:${i}`, category, text }));
      }
      this.pool.set(color, items);
      this.history.set(color, []);
    }
  }

  colors() {
    return [...this.pool.keys()];
  }

  hasColor(color) {
    return this.pool.has(color);
  }

  pick(color, category) {
    const items = this.pool.get(color);
    if (!items) throw new Error(`unknown color: ${color}`);
    const candidates = category ? items.filter((m) => m.category === category) : items;
    if (candidates.length === 0) throw new Error(`no messages for ${color}/${category}`);

    const hist = this.history.get(color);
    // 候補数より履歴が長いと全候補が除外されるため、候補数-1 を上限とする
    const window = Math.min(this.historySize, candidates.length - 1);
    const recent = new Set(hist.slice(Math.max(0, hist.length - window)));
    const fresh = window > 0 ? candidates.filter((m) => !recent.has(m.id)) : candidates;

    const chosen = fresh[Math.floor(this.random() * fresh.length)];
    hist.push(chosen.id);
    if (hist.length > Math.max(this.historySize, 1)) hist.splice(0, hist.length - this.historySize);

    return {
      id: chosen.id,
      color,
      category: chosen.category,
      categoryLabel: this.categories[chosen.category] || chosen.category,
      text: chosen.text,
    };
  }
}

module.exports = { MessagePicker };
