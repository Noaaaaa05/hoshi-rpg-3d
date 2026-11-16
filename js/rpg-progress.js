export class RpgProgress {
  constructor(catalog, saved) {
    this.catalog = catalog;
    this.quests = {};
    this.items = {};
    this.companions = [];
    for (const [id, quest] of Object.entries(catalog.quests)) {
      const old = saved?.quests?.[id];
      if (['active', 'ready', 'complete'].includes(old?.state)) {
        const count = old.state === 'active' && Number.isInteger(old.count)
          ? Math.max(0, Math.min(quest.goal.count - 1, old.count)) : old.state === 'active' ? 0 : quest.goal.count;
        this.quests[id] = { state: old.state, count };
      }
    }
    for (const id of Object.keys(catalog.items)) {
      const count = saved?.items?.[id];
      if (Number.isInteger(count) && count > 0) this.items[id] = Math.min(999, count);
    }
    if (Array.isArray(saved?.companions)) {
      this.companions = Object.keys(catalog.actors).filter(id =>
        catalog.actors[id].role === 'companion' && saved.companions.includes(id)).slice(0, 3);
    }
    this.weapon = typeof saved?.weapon === 'string' && this.items[saved.weapon] && catalog.items[saved.weapon]?.kind === 'weapon' ? saved.weapon : null;
  }

  state(id) {
    const quest = this.catalog.quests[id];
    if (!quest) return 'locked';
    return this.quests[id]?.state ?? ((quest.requires ?? []).every(required => this.quests[required]?.state === 'complete')
      ? 'available' : 'locked');
  }

  offer(id) {
    if (this.state(id) !== 'available') return false;
    this.quests[id] = { state: 'active', count: 0 };
    return true;
  }

  record(kind, target) {
    let changed = false;
    for (const [id, state] of Object.entries(this.quests)) {
      if (state.state !== 'active') continue;
      const { goal } = this.catalog.quests[id];
      if (goal.kind !== kind || goal.target !== target) continue;
      state.count++;
      if (state.count === goal.count) state.state = 'ready';
      changed = true;
    }
    return changed;
  }

  complete(id) {
    if (this.state(id) !== 'ready') return false;
    const {item, count} = this.catalog.quests[id].reward;
    const total = (this.items[item] ?? 0) + count;
    if (total > 999) return false;
    this.items[item] = total;
    this.quests[id].state = 'complete';
    return true;
  }

  recruit(id) {
    if (this.catalog.actors[id]?.role !== 'companion' || this.companions.includes(id) || this.companions.length >= 3) return false;
    this.companions.push(id);
    return true;
  }

  equip(id) {
    if (!this.items[id] || this.catalog.items[id]?.kind !== 'weapon') return false;
    this.weapon = this.weapon === id ? null : id;
    return true;
  }

  use(id, heal) {
    const item = this.catalog.items[id];
    if (!this.items[id] || item?.kind !== 'consumable' || !heal(item.heal)) return false;
    if (--this.items[id] === 0) delete this.items[id];
    return true;
  }

  get attackBonus() { return this.weapon ? this.catalog.items[this.weapon].attackBonus : 0; }
  get skills() {
    return Object.entries(this.catalog.skills).filter(([, skill]) => !skill.unlockQuest || this.state(skill.unlockQuest) === 'complete');
  }
  toJSON() { return structuredClone({ quests: this.quests, items: this.items, weapon: this.weapon, companions: this.companions }); }
}
