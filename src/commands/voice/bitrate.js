'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'bitrate',
  category: 'voice',
  description: 'Set the room bitrate (Prime)',
  usage: '.v bitrate <8-256>',
  aliases: [],
  examples: ['.v bitrate 96', '.v bitrate 128'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    if (!ctx.args[0]) return ctx.error('Usage: `.v bitrate <8-256>`');
    const res = await actions.setBitrate(ctx.member, ctx.args[0]);
    if (!res.ok) {
      if (res.premium) return ctx.upsell(res.feature);
      return ctx.error(res.msg);
    }
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel).catch(() => {});
  },
};