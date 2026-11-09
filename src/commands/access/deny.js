'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'deny',
  category: 'access',
  description: 'Deny a member and disconnect them',
  usage: '.v deny <@user>',
  aliases: ['reject', 'ban'],
  examples: ['.v deny @user'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.deny(ctx.member, target.id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};