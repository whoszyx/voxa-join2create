'use strict';
const ui = require('../../ui');

module.exports = {
  name: 'primeinfo',
  category: 'info',
  description: 'Showcase every Prime feature',
  usage: '.v primeinfo',
  aliases: ['primefeatures'],
  examples: ['.v primeinfo'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 3000,
  async run(ctx) {
    return ctx.reply(ui.vipShowcase({ by: ctx.by }));
  },
};