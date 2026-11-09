'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'fm',
  category: 'voice',
  description: 'Mute everyone except owner/managers',
  usage: '.v fm',
  aliases: ['silenceall', 'muteall'],
  examples: ['.v fm'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.forceMuteAll(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};