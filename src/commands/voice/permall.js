'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'permall',
  category: 'voice',
  description: 'Permit everyone currently in the room',
  usage: '.v permall',
  aliases: ['permitall', 'permal', 'allperm', 'permissionall', 'allowall'],
  examples: ['.v permall'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.permitAll(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};