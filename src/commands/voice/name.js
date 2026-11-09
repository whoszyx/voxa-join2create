'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'name',
  category: 'voice',
  description: 'Rename your room',
  longDescription: 'Changes the voice channel name. Discord rate limits renames to ~2 per 10 minutes.',
  usage: '.v name <text>',
  aliases: ['rename', 'newname', 'nam'],
  examples: ['.v name 🎮 Game Night', '.v rename Chill Zone'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const text = ctx.argsRaw.trim();
    if (!text) return ctx.error('Usage: `.v name <text>`');
    const res = await actions.rename(ctx.member, text);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel).catch(() => {});
  },
};