'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'cam',
  category: 'voice',
  description: 'Toggle video/stream for @everyone',
  usage: '.v cam [on|off]',
  aliases: ['cam-toggle', 'stream-toggle', 'stream'],
  examples: ['.v cam', '.v cam on', '.v cam off'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const arg = (ctx.args[0] || '').toLowerCase();
    let force;
    if (arg === 'on' || arg === 'allow') force = false;
    else if (arg === 'off' || arg === 'block') force = true;
    const res = await actions.toggleCam(ctx.member, force);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
    await actions.refreshPanelNow(ctx.channel, res.state).catch(() => {});
  },
};