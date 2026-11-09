'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'unhide',
  category: 'voice',
  description: 'Show the room again',
  usage: '.v unhide',
  aliases: ['showchannel', 'show'],
  examples: ['.v unhide'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.setHide(ctx.member, false);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};