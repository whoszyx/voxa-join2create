'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'protect',
  category: 'voice',
  description: 'Block uninvited joiners (Prime)',
  usage: '.v protect [on|off]',
  aliases: [],
  examples: ['.v protect', '.v protect on', '.v protect off'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const arg = (ctx.args[0] || '').toLowerCase();
    let force;
    if (arg === 'on') force = true;
    else if (arg === 'off') force = false;
    const res = await actions.setProtect(ctx.member, force);
    if (!res.ok) {
      if (res.premium) return ctx.upsell(res.feature);
      return ctx.error(res.msg);
    }
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel).catch(() => {});
  },
};