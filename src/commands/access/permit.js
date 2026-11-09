'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'permit',
  category: 'access',
  description: 'Permit a member to join the room',
  usage: '.v permit <@user>',
  aliases: ['allow', 'grant', 'perm', 'permi'],
  examples: ['.v permit @user'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.permit(ctx.member, target.id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};