'use strict';
const { ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../db');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'manager',
  category: 'access',
  description: 'Manage room managers',
  usage: '.v manager [add|remove|list] <@user>',
  aliases: ['mgr', 'copilot'],
  examples: ['.v manager add @user', '.v manager list'],
  gate: 'O',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    if (sub === 'add') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.managerAdd(ctx.member, target.id);
      if (!res.ok) {
        if (res.premium) return ctx.upsell(res.feature);
        return ctx.error(res.msg);
      }
      return ctx.success(res.msg);
    }
    if (sub === 'remove') {
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a member or give an ID.');
      const res = await actions.managerRemove(ctx.member, target.id);
      if (!res.ok) return ctx.error(res.msg);
      return ctx.success(res.msg);
    }
    const channelId = ctx.member.voice.channelId;
    const list = db.listRoomManagers(channelId);
    const items = list.map((id) => ({
      text: `🤝 <@${id}>`,
      button: new ButtonBuilder()
        .setCustomId(`vx:list:manager:rm:${id}`)
        .setLabel('🗑️')
        .setStyle(ButtonStyle.Secondary),
    }));
    const card = ui.listCard({
      title: '## ✦ Managers',
      subtitle: `-# ${list.length} manager${list.length === 1 ? '' : 's'}`,
      color: ui.colors.purple,
      items,
      kind: 'manager',
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};