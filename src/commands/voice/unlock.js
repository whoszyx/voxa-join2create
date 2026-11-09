'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'unlock',
  category: 'voice',
  description: 'Unlock the room',
  usage: '.v unlock',
  aliases: ['unsed', '7el', 'unlok', 'open'],
  examples: ['.v unlock'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.setLock(ctx.member, false);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};