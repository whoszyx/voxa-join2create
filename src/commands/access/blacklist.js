'use strict';
const { ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'blacklist',
  category: 'access',
  description: 'Manage your global blacklist',
  usage: '.v blacklist [add|remove|list|clear] <@user>',
  aliases: ['bl'],
  examples: ['.v blacklist add @user', '.v blacklist list'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    if (sub === 'add') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.blacklistAdd(ctx.member.id, target.id);
      if (!res.ok) return ctx.error(res.msg);
      return ctx.success(res.msg);
    }
    if (sub === 'remove') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.blacklistRemove(ctx.member.id, target.id);
      return ctx.success(res.msg);
    }
    if (sub === 'clear') {
      db.clearBlacklist(ctx.member.id);
      return ctx.success('Blacklist cleared.');
    }
    const list = db.listBlacklist(ctx.member.id);
    const max = db.isPrime(ctx.member.id) ? config.plans.prime.blacklist : config.plans.free.blacklist;
    const perPage = 6;
    const slice = list.slice(0, perPage);
    const items = slice.map((id) => ({
      text: `🚫 <@${id}>`,
      button: new ButtonBuilder()
        .setCustomId(`vx:list:blacklist:rm:${id}`)
        .setLabel('🗑️')
        .setStyle(ButtonStyle.Secondary),
    }));
    const card = ui.listCard({
      title: '## ✦ Blacklist',
      subtitle: `-# ${list.length} / ${max} slots`,
      color: ui.colors.error,
      items,
      page: 1,
      hasMore: list.length > perPage,
      kind: 'blacklist',
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};