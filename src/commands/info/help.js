'use strict';

const ui = require('../../ui');

module.exports = {
  name: 'help',
  category: 'info',
  description: 'List commands or show help for one',
  longDescription: 'The help card is generated from the live command registry.',
  usage: '.v help [command]',
  aliases: ['h'],
  examples: ['.v help', '.v help name', '.v help vip'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const arg = (ctx.args[0] || '').trim();
    if (arg) {
      // lazy require to avoid circular dependency during module load
      const registry = require('../index');
      const cmd = registry.resolveBuiltin(arg);
      if (!cmd) return ctx.error(`No command called **${arg}**.`);
      const disabled = ctx.guild ? require('../../db').isDisabled(ctx.guild.id, cmd.name) : false;
      return ctx.reply(ui.helpDetail({ cmd, disabled, by: ctx.by }));
    }
    const registry = require('../index');
    const categories = registry.listCategories();
    return ctx.reply(ui.help({ categories, by: ctx.by }));
  },
};