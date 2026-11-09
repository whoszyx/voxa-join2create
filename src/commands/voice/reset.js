'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');

module.exports = {
  name: 'reset',
  category: 'voice',
  description: 'Reset the room to hub defaults',
  usage: '.v reset',
  aliases: ['resetvoice', 'resetvc', 'defaultvc', 'vreset'],
  examples: ['.v reset'],
  gate: 'O',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const card = ui.card({
      color: ui.colors.warn,
      head: '## ⚠ Reset room?',
      body: ['This restores hub defaults and clears custom overwrites.'],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('vx:confirm:reset')
            .setLabel('✅ Confirm')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('vx:confirm:cancel')
            .setLabel('✖ Cancel')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      by: ctx.by,
    });
    await ctx.reply(card);
  },
};