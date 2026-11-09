'use strict';
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'mystats',
  category: 'info',
  description: 'Show your voice stats, rank and saved profile',
  usage: '.v mystats',
  aliases: ['myinfo', 'me', 'profile', 'statsme', 'userstats'],
  examples: ['.v mystats'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 3000,
  async run(ctx) {
    const stats = db.getUserStats(ctx.guild.id, ctx.member.id);
    const rank = db.userRankInGuild(ctx.guild.id, ctx.member.id);
    const tier = db.isPrime(ctx.member.id) ? 'Prime' : 'Free';
    const savedProfile = db.getProfile(ctx.member.id, ctx.guild.id);
    const openTasks = db.countOpenTasks(ctx.member.id);
    return ctx.reply(ui.userStats({
      user: ctx.member,
      guildName: ctx.guild.name,
      stats,
      rank,
      tier,
      savedProfile,
      openTasks,
      by: ctx.by,
    }));
  },
};