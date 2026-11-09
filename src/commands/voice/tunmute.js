'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'tunmute',
  category: 'voice',
  description: 'Undo a text-mute',
  usage: '.v tunmute <@user>',
  aliases: ['textunmute', 'texteunmute'],
  examples: ['.v tunmute @user'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const target = await actions.resolveMember(ctx.guild, ctx.args[0]);
    if (!target) return ctx.error('Mention a member or give an ID.');
    const res = await actions.textMute(ctx.member, target.id, false);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};