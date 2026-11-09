'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'clear',
  category: 'voice',
  description: 'Bulk delete messages in the room chat',
  usage: '.v clear [amount]',
  aliases: ['purge'],
  examples: ['.v clear', '.v clear 20'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.clearMessages(ctx.member, ctx.args[0]);
    if (!res.ok) return ctx.error(res.msg);
    const msg = await ctx.success(res.msg);
    if (msg) setTimeout(() => msg.delete().catch(() => {}), 3000);
  },
};