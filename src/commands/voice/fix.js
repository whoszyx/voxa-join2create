'use strict';
const { PermissionFlagsBits } = require('discord.js');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'fix',
  category: 'voice',
  description: 'Repair room state (region, overwrites, panel)',
  usage: '.v fix [all]',
  aliases: ['voicefix', 'fixvoice', 'ddosfix', 'regionfix', 'fixregion', 'vfix', 'fixlag', 'lagfix'],
  examples: ['.v fix', '.v fix all'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const all = (ctx.args[0] || '').toLowerCase() === 'all';
    if (all) {
      if (!ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return ctx.error('Need **Manage Server** for a guild-wide fix.');
      }
      const working = await ctx.working('Repairing every room…');
      const res = await actions.fixVoice(ctx.member, true);
      const c = res.ok ? ui.success({ msg: res.msg, by: ctx.by }) : ui.error({ msg: res.msg, by: ctx.by });
      if (working) await working.edit(ui.editV2(c)).catch(() => {});
      return;
    }
    const res = await actions.fixVoice(ctx.member, false);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};