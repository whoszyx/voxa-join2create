'use strict';
const { ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'whitelist',
  category: 'access',
  description: 'Manage your global whitelist',
  usage: '.v whitelist [add|remove|list|clear] <@user>',
  aliases: ['wl'],
  examples: ['.v whitelist add @user', '.v whitelist list'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    if (sub === 'add') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.whitelistAdd(ctx.member.id, target.id);
      if (!res.ok) return ctx.error(res.msg);
      return ctx.success(res.msg);
    }
    if (sub === 'remove') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.whitelistRemove(ctx.member.id, target.id);
      return ctx.success(res.msg);
    }
    if (sub === 'clear') {
      db.clearWhitelist(ctx.member.id);
      return ctx.success('Whitelist cleared.');
    }
    const list = db.listWhitelist(ctx.member.id);
    const max = db.isPrime(ctx.member.id) ? config.plans.prime.whitelist : config.plans.free.whitelist;
    const perPage = 6;
    const slice = list.slice(0, perPage);
    const items = slice.map((id) => ({
      text: `👤 <@${id}>`,
      button: new ButtonBuilder()
        .setCustomId(`vx:list:whitelist:rm:${id}`)
        .setLabel('🗑️')
        .setStyle(ButtonStyle.Secondary),
    }));
    const card = ui.listCard({
      title: '## ✦ Whitelist',
      subtitle: `-# ${list.length} / ${max} slots`,
      color: ui.colors.green,
      items,
      page: 1,
      hasMore: list.length > perPage,
      kind: 'whitelist',
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};