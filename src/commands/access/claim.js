'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'claim',
  category: 'access',
  description: 'Claim ownership of an abandoned room',
  usage: '.v claim',
  aliases: ['claimchannel'],
  examples: ['.v claim'],
  gate: 'A',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.claim(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};