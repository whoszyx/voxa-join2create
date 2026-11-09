'use strict';
const {
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const config = require('../../../config');
const ui = require('../../ui');
const actions = require('../../actions');

module.exports = {
  name: 'activity',
  category: 'voice',
  description: 'Start a Discord Activity in the room',
  usage: '.v activity [game]',
  aliases: ['act', 'activities'],
  examples: ['.v activity', '.v activity poker', '.v activity sketch'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const arg = (ctx.args[0] || '').toLowerCase();
    if (!arg) {
      const opts = Object.entries(config.activities).slice(0, 25).map(([key, g]) =>
        new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(key).setEmoji(g.emoji || '🎮')
      );
      const card = ui.card({
        color: ui.colors.purple,
        head: '## ✦ Start Activity',
        body: ['-# Choose a game to launch.'],
        rows: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`vx:act:run:${ctx.member.id}`)
            .setPlaceholder('Pick a game')
            .addOptions(opts)
        )],
        by: ctx.by,
      });
      return ctx.reply(card);
    }
    const res = await actions.startActivity(ctx.member, arg);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.card({ color: ui.colors.green, head: '## 🎮 Activity', body: [res.msg] });
  },
};