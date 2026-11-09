'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'status',
  category: 'voice',
  description: 'Set or clear the voice channel status',
  usage: '.v status <text>',
  aliases: ['statuschannel', 'status-voice', 'voicestatus', 'vcstatus'],
  examples: ['.v status 🎮 Playing Valorant', '.v status'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const text = ctx.argsRaw.trim();
    const res = await actions.setStatus(ctx.member, text);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel).catch(() => {});
  },
};