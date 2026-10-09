// Bounded by entry count and optionally by total weight, so a cache whose
// entries vary widely in size can be capped by memory.
class LRUCache {
  constructor(maxSize = 50000, maxWeight = Infinity) {
    this.max = maxSize;
    this.maxWeight = maxWeight;
    this.weight = 0;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.val;
  }

  set(key, val, weight = 1) {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      this.weight -= old.weight;
    }
    this.map.set(key, { val, weight });
    this.weight += weight;
    // The entry just added always survives, even if it alone exceeds maxWeight.
    while (this.map.size > this.max || (this.weight > this.maxWeight && this.map.size > 1)) {
      const [oldestKey, oldest] = this.map.entries().next().value;
      this.map.delete(oldestKey);
      this.weight -= oldest.weight;
    }
  }
}

module.exports = LRUCache;
