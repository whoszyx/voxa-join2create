'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'hide',
  category: 'voice',
  description: 'Hide the room from the channel list',
  usage: '.v hide',
  aliases: ['hidechannel', 'ghost'],
  examples: ['.v hide'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.setHide(ctx.member, true);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};