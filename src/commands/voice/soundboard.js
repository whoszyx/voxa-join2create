'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'soundboard',
  category: 'voice',
  description: 'Toggle soundboard for @everyone',
  usage: '.v soundboard [on|off|managers]',
  aliases: ['sb', 'sbcontrol'],
  examples: ['.v soundboard', '.v sb on', '.v sb managers'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const arg = (ctx.args[0] || '').toLowerCase();
    let mode;
    if (['on', 'off', 'managers'].includes(arg)) mode = arg;
    const res = await actions.toggleSoundboard(ctx.member, mode);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};