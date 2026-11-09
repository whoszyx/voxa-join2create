'use strict';
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'bannednames',
  category: 'admin',
  description: 'Block words from appearing in room names, templates, and statuses',
  longDescription: 'Discord invite URLs are always blocked by default.',
  usage: '.v bannednames [add|remove|list] <word>',
  aliases: ['filter', 'namefilter'],
  examples: ['.v bannednames add slur', '.v bannednames remove slur', '.v bannednames list'],
  gate: 'G',
  needsRoom: false,
  premium: false,
  cooldownMs: 1500,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    const word = (ctx.args[1] || '').toLowerCase();

    if (sub === 'add') {
      if (!word) return ctx.error('Usage: `.v bannednames add <word>`');
      if (word.length > 40) return ctx.error('Word is too long.');
      db.addBannedName(ctx.guild.id, word);
      return ctx.success(`Added \`${word}\` to the banned list.`);
    }
    if (sub === 'remove') {
      if (!word) return ctx.error('Usage: `.v bannednames remove <word>`');
      db.removeBannedName(ctx.guild.id, word);
      return ctx.success(`Removed \`${word}\`.`);
    }

    const words = db.listBannedNames(ctx.guild.id);
    return ctx.reply(ui.card({
      color: ui.colors.error,
      head: '## ✦ Banned Names',
      subtitle: `-# ${words.length} words · Discord invites always blocked`,
      body: words.length
        ? words.map((w) => `\`${w}\``)
        : ['-# No custom words banned.'],
      by: ctx.by,
    }));
  },
};