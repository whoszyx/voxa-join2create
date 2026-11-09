'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'panel',
  category: 'voice',
  description: 'Re-send the room control panel',
  usage: '.v panel',
  aliases: [],
  examples: ['.v panel'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.reSendPanel(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};