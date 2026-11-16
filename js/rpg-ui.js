const make = (tag, content, id) => {
  const element = document.createElement(tag);
  if (id) element.id = id;
  if (content) element.textContent = content;
  if (tag === 'button') element.type = 'button';
  return element;
};

export function createRpgUI({catalog, world, progress, motor, inventory, onChange, heal, moveTo, queueSkill}) {
  const game = document.querySelector('#game');
  const interact = make('button', '話す', 'rpg-interact');
  const panel = make('section', '', 'rpg-dialog');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'rpg-speaker');
  const name = make('strong', '', 'rpg-speaker'), message = make('p', '', 'rpg-dialog-text');
  const choices = make('div', '', 'rpg-choices'), closeButton = make('button','閉じる');
  panel.append(name, message, choices, closeButton);
  game.append(interact, panel);
  const details = make('div', '', 'rpg-inventory');
  inventory.insertBefore(details, inventory.querySelector('#inventory-close'));
  let target, speaking, canInteract = false;
  interact.hidden = panel.hidden = true;

  function close() { speaking = null; panel.hidden = true; world.setSpeaker(null); }
  closeButton.addEventListener('click', close);

  function renderNode(id) {
    const {actor, actorId} = speaking;
    const dialogue = catalog.dialogues[actor.dialogue], node = dialogue.nodes[id];
    name.textContent = actor.name;
    message.textContent = node.text;
    choices.replaceChildren();
    for (const option of node.choices) {
      if (option.when && progress.state(option.quest) !== option.when) continue;
      if (option.action === 'offer' && progress.state(option.quest) !== 'available') continue;
      if (option.action === 'turn-in' && progress.state(option.quest) !== 'ready') continue;
      if (option.action === 'recruit' && (actor.role !== 'companion' || progress.companions.includes(actorId))) continue;
      const button = make('button', option.label);
      button.addEventListener('click', () => {
        if (!canInteract || speaking?.id !== target?.id) { close(); return; }
        let changed = false;
        if (option.action === 'offer') changed = progress.offer(option.quest);
        if (option.action === 'turn-in') changed = progress.complete(option.quest);
        if (option.action === 'recruit') changed = progress.recruit(actorId);
        if (changed) { onChange(); renderInventory(); }
        if (option.next) renderNode(option.next);
        else close();
      });
      choices.append(button);
    }
  }

  function activate() {
    if (!target || !canInteract) return;
    if (target.exit) { moveTo(target.exit); return; }
    speaking = target;
    world.setSpeaker(target.id);
    panel.hidden = false;
    renderNode(catalog.dialogues[target.actor.dialogue].start);
  }
  interact.addEventListener('click', activate);
  window.addEventListener('keydown', event => {
    if (event.code === 'KeyF' && !event.repeat && canInteract &&
        !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      if (speaking) close();
      else activate();
    }
  });

  function renderInventory() {
    details.replaceChildren();
    const stateNames = { active:'進行中', ready:'報告可能', complete:'完了' };
    const entries = Object.entries(progress.quests);
    if (entries.length) details.append(make('h3', 'クエスト'));
    for (const [id, state] of entries) {
      const quest = catalog.quests[id];
      const line = make('p', quest.name + '　' + stateNames[state.state] + ' ' + state.count + '/' + quest.goal.count);
      line.title = quest.description;
      details.append(line);
    }
    for (const [id, count] of Object.entries(progress.items)) {
      const item = catalog.items[id];
      details.append(make('p', item.name + ' ×' + count));
      if (item.kind === 'keepsake') continue;
      const button = make('button', item.kind === 'consumable' ? '使う' : progress.weapon === id ? '外す' : '装備');
      button.setAttribute('aria-label', item.name + 'を' + button.textContent);
      button.addEventListener('click', () => {
        if (item.kind === 'weapon' ? progress.equip(id) : progress.use(id, heal)) { onChange(); renderInventory(); }
      });
      details.append(button);
    }
    for (const [id, skill] of progress.skills) {
      const button = make('button', skill.name + '（ST ' + skill.stamina + '）');
      button.addEventListener('click', () => queueSkill(id));
      details.append(button);
    }
  }

  return {renderInventory, close,
    update(active) {
      canInteract = active;
      target = active ? world.nearby(motor) : null;
      if (speaking && speaking.id !== target?.id) close();
      interact.hidden = !target || Boolean(speaking);
      if (target) {
        const label = target.exit ? target.exit.name + 'へ移動' : target.actor.name + 'と話す';
        interact.textContent = target.exit ? '移動' : '話す';
        interact.setAttribute('aria-label', label);
      }
    }
  };
}
