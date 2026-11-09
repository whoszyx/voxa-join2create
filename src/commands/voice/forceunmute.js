'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'forceunmute',
  category: 'voice',
  description: 'Undo force-mute for everyone',
  usage: '.v forceunmute',
  aliases: ['fum', 'funm', 'funmute'],
  examples: ['.v forceunmute'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.forceUnmuteAll(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};