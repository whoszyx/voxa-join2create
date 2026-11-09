'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'tmute',
  category: 'voice',
  description: 'Text-mute a member in the room chat',
  usage: '.v tmute <@user>',
  aliases: ['textmute', 'textemute'],
  examples: ['.v tmute @user'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.textMute(ctx.member, target.id, true);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};