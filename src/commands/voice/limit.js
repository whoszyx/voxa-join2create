'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'limit',
  category: 'voice',
  description: 'Set room capacity (0 = unlimited)',
  usage: '.v limit <0-99>',
  aliases: ['setlimit', 'userlimit', 'limite'],
  examples: ['.v limit 5', '.v limit 0'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    if (ctx.args[0] === undefined) return ctx.error('Usage: `.v limit <0-99>`');
    const res = await actions.setLimit(ctx.member, ctx.args[0]);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel).catch(() => {});
  },
};