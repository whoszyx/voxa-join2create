'use strict';
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'vcinfo',
  category: 'info',
  description: 'Show details about the current room',
  usage: '.v vcinfo',
  aliases: ['voiceinfo', 'vinfo', 'vstats', 'info'],
  examples: ['.v vcinfo'],
  gate: 'A',
  needsRoom: true,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const channelId = ctx.member.voice.channelId;
    const room = db.getChannel(channelId);
    if (!room) return ctx.error('This is not a temporary room.');
    const channel = ctx.guild.channels.cache.get(channelId);
    if (!channel) return ctx.error('Channel not found.');
    return ctx.reply(ui.roomCard({
      channel,
      room,
      prime: db.isPrime(room.owner_id),
      by: ctx.by,
    }));
  },
};