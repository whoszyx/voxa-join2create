'use strict';
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'man',
  category: 'access',
  description: 'Manage global managers (auto-added to every room you create)',
  usage: '.v man [add|remove|list|clear] <@user>',
  aliases: ['gman'],
  examples: ['.v man add @user', '.v man list'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    if (sub === 'add') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.globalManagerAdd(ctx.member.id, target.id);
      if (!res.ok) return ctx.error(res.msg);
      return ctx.success(res.msg);
    }
    if (sub === 'remove') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.globalManagerRemove(ctx.member.id, target.id);
      return ctx.success(res.msg);
    }
    if (sub === 'clear') {
      db.clearGlobalManagers(ctx.member.id);
      return ctx.success('Global managers cleared.');
    }
    const list = db.listGlobalManagers(ctx.member.id);
    const max = db.isPrime(ctx.member.id) ? config.plans.prime.globalManagers : config.plans.free.globalManagers;
    const lines = list.length
      ? list.map((id) => `🤝 <@${id}>`)
      : ['-# No global managers yet.'];
    const card = ui.card({
      color: ui.colors.purple,
      head: '## ✦ Global Managers',
      subtitle: `-# ${list.length} / ${max} slots`,
      body: lines,
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};