'use strict';
const db = require('../../db');
const ui = require('../../ui');
const setupMod = require('../../setup');

module.exports = {
  name: 'setup',
  category: 'admin',
  description: 'Configure Join2Create hubs',
  longDescription:
    'First run opens the setup wizard. Once hubs exist, opens the dashboard where you can add, edit, remove, or repair hubs.',
  usage: '.v setup [add|edit|remove|status]',
  aliases: ['voice-setup', 'vsetup'],
  examples: ['.v setup', '.v setup add', '.v setup status'],
  gate: 'G',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const guild = ctx.guild;
    const hubs = db.listHubsByGuild(guild.id);

    if (hubs.length === 0) {
      const me = guild.members.me;
      const perms = setupMod.healthCheck(guild, me);
      return ctx.reply(ui.setupHealth({ perms, by: ctx.by }));
    }

    const data = setupMod.dashboardData(guild);
    return ctx.reply(ui.setupDashboard({ hubs: data, by: ctx.by }));
  },
};