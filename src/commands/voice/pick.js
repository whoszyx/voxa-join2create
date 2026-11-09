'use strict';
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'pick',
  category: 'voice',
  description: 'Pick a random member in the room',
  usage: '.v pick',
  aliases: ['pickuser', 'rvc', 'vpick'],
  examples: ['.v pick'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const working = await ctx.working('🎲 Spinning the wheel…');
    if (!working) return;

    // two-frame animation
    for (const emoji of ['🎰', '🎯']) {
      await working.edit(ui.editV2(ui.card({
        color: ui.colors.purple,
        head: `## ${emoji} Picking…`,
        body: ['-# Spinning…'],
        by: ctx.by,
      }))).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
    }

    const res = await actions.pickRandom(ctx.member);
    const c = res.ok
      ? ui.card({ color: ui.colors.purple, head: '## 🎲 Pick', body: [res.msg], by: ctx.by })
      : ui.error({ msg: res.msg, by: ctx.by });
    await working.edit(ui.editV2(c)).catch(() => {});
  },
};