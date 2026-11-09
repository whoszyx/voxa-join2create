'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ui = require('../../ui');

module.exports = {
  name: 'resetdata',
  category: 'admin',
  description: 'Purge all Voxa data for this server',
  longDescription:
    'Removes hubs, temporary rooms, banned names, disabled commands, and voice stats. ' +
    'Requires typing `RESET` in a confirmation modal.',
  usage: '.v resetdata',
  aliases: ['resetserver', 'cleardata', 'purgedata', 'resetguild'],
  examples: ['.v resetdata'],
  gate: 'G',
  needsRoom: false,
  premium: false,
  cooldownMs: 5000,
  async run(ctx) {
    const card = ui.card({
      color: ui.colors.error,
      head: '## ⚠ Reset server data',
      body: [
        'This will purge **all** Voxa data for this server:',
        '• Hub configuration and channels',
        '• Temporary rooms',
        '• Banned names and disabled commands',
        '• Voice stats',
        '',
        '**This cannot be undone.**',
      ],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('vx:confirm:resetdata_open')
            .setLabel('🗑️ Open confirmation')
            .setStyle(ButtonStyle.Danger)
        ),
      ],
      by: ctx.by,
    });
    return ctx.reply(card);
  },
};