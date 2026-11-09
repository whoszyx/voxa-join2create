'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'transfer',
  category: 'access',
  description: 'Transfer room ownership',
  usage: '.v transfer <@user>',
  aliases: ['promote', 'owner-set', 'trans', 'tr'],
  examples: ['.v transfer @user'],
  gate: 'O',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.transfer(ctx.member, target.id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};