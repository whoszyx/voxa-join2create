'use strict';
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'top',
  category: 'info',
  description: 'Voice-time leaderboard (users in this server or all servers)',
  usage: '.v top [users|servers]',
  aliases: ['event', 'vtop'],
  examples: ['.v top', '.v top users', '.v top servers'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 4000,
  async run(ctx) {
    const kind = (ctx.args[0] || 'users').toLowerCase();
    if (!['users', 'servers'].includes(kind)) {
      return ctx.error('Usage: `.v top [users|servers]`');
    }
    const perPage = 10;
    const entries = kind === 'servers'
      ? db.leaderboardGuilds(1, perPage)
      : db.leaderboardUsers(ctx.guild.id, 1, perPage);
    return ctx.reply(ui.leaderboard({ kind, entries, page: 1, perPage, by: ctx.by }));
  },
};