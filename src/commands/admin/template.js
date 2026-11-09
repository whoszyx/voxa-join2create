'use strict';
const config = require('../../../config');
const db = require('../../db');

module.exports = {
  name: 'template',
  category: 'admin',
  description: 'Set the room name template for all hubs',
  longDescription:
    'Tokens: `{user}` (display name), `{username}`, `{count}`, `{hub}`. Banned words are rejected.',
  usage: '.v template <text>',
  aliases: [],
  examples: ['.v template ✦ {user}\'s Room', '.v template 🎮 {user}'],
  gate: 'G',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const text = ctx.argsRaw.trim();
    const hubs = db.listHubsByGuild(ctx.guild.id);

    if (!text) {
      const cur = hubs[0]?.name_template || config.defaultHub.nameTemplate;
      return ctx.success(`Current template: \`${cur}\``);
    }
    if (db.hasBannedWord(ctx.guild.id, text)) {
      return ctx.error('That template contains a banned word.');
    }
    if (!hubs.length) {
      return ctx.error('No hubs configured yet. Run `.v setup` first.');
    }
    const safe = text.slice(0, 100);
    for (const h of hubs) db.updateHub(h.hub_id, { name_template: safe });
    return ctx.success(`Template updated for ${hubs.length} hub${hubs.length === 1 ? '' : 's'}.`);
  },
};