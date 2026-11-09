'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'lock',
  category: 'voice',
  description: 'Lock the room (deny Connect)',
  usage: '.v lock',
  aliases: ['lck', 'loc', 'sed', 'sedd', 'close'],
  examples: ['.v lock'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.setLock(ctx.member, true);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};