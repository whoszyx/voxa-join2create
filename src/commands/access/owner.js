'use strict';
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'owner',
  category: 'access',
  description: 'Show who owns the room',
  usage: '.v owner',
  aliases: ['voowner', 'channelowner', 'getowner', 'vcowner'],
  examples: ['.v owner'],
  gate: 'A',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.ownerInfo(ctx.member);
    if (!res.ok) return ctx.error(res.msg);
    const d = res.data;
    const managers = d.managers.length ? d.managers.map((id) => `<@${id}>`).join(', ') : '—';
    const created = `<t:${Math.floor(d.created_at / 1000)}:R>`;
    const card = ui.card({
      color: ui.colors.purple,
      head: '## ✦ Room Owner',
      body: [
        `👑 **Owner** · <@${d.owner_id}>`,
        `🤝 **Managers** · ${managers}`,
        `📅 **Created** · ${created}`,
      ],
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};