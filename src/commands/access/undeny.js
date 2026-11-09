'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'undeny',
  category: 'access',
  description: 'Reverse a deny',
  usage: '.v undeny <@user>',
  aliases: ['unreject', 'unban'],
  examples: ['.v undeny @user'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.undeny(ctx.member, target.id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};