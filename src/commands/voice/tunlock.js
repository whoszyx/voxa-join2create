'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'tunlock',
  category: 'voice',
  description: 'Unlock the room chat',
  usage: '.v tunlock',
  aliases: ['cunlock', 'chatunlock', 'textunlock', 'unlockchat'],
  examples: ['.v tunlock'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.toggleTextLock(ctx.member, false);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};