'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'request',
  category: 'access',
  description: 'Request to join a room',
  usage: '.v request <@owner|room-id>',
  aliases: ['req'],
  examples: ['.v request @user'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const input = ctx.args[0];
    if (!input) return ctx.error('Usage: `.v request <@owner|room-id>`');
    const res = await actions.requestPermit(ctx.member, input);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};