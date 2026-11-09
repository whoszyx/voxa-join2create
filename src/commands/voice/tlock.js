'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'tlock',
  category: 'voice',
  description: 'Lock the room chat',
  usage: '.v tlock',
  aliases: ['clock', 'chatlock', 'textlock', 'lockchat'],
  examples: ['.v tlock'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.toggleTextLock(ctx.member, true);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};