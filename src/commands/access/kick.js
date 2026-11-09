'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'kick',
  category: 'access',
  description: 'Kick a member or role from the room',
  usage: '.v kick <@user|@role>',
  aliases: [],
  examples: ['.v kick @user', '.v kick @Trolls'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const input = String(ctx.args[0] || '');
    if (!input) return ctx.error('Mention a member or role.');
    // Role?
    if (input.startsWith('<@&')) {
      const id = input.replace(/[<>@&]/g, '');
      const res = await actions.kickRole(ctx.member, id);
      if (!res.ok) return ctx.error(res.msg);
      return ctx.success(res.msg);
    }
    const target = await actions.resolveMember(ctx.guild, input);
    if (!target) return ctx.error('Mention a member or role.');
    const res = await actions.kick(ctx.member, target.id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};