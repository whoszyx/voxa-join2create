'use strict';
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'commands',
  category: 'admin',
  description: 'Enable or disable commands on this server',
  longDescription: '`setup`, `help`, and `commands` cannot be disabled.',
  usage: '.v commands [list|enable|disable] [command]',
  aliases: ['cmd', 'cmds', 'command', 'togglecmd', 'disablecmd', 'enablecmd'],
  examples: ['.v commands', '.v commands disable kick', '.v commands enable kick'],
  gate: 'G',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const registry = require('../index');
    const sub = (ctx.args[0] || 'list').toLowerCase();

    if (sub === 'list') {
      const disabled = db.listDisabled(ctx.guild.id);
      return ctx.reply(ui.card({
        color: ui.colors.info,
        head: '## ✦ Disabled Commands',
        subtitle: `-# ${disabled.length} disabled`,
        body: disabled.length
          ? disabled.map((c) => `\`${ctx.prefix || '.v'}${c}\``)
          : ['-# No commands disabled.'],
        by: ctx.by,
      }));
    }

    if (sub === 'disable' || sub === 'enable') {
      const target = (ctx.args[1] || '').toLowerCase();
      if (!target) return ctx.error(`Usage: \`.v commands ${sub} <command>\``);

      const resolved = registry.resolveBuiltin(target);
      if (!resolved) return ctx.error(`No command **${target}**.`);

      if (['setup', 'help', 'commands'].includes(resolved.name)) {
        return ctx.error(`\`${resolved.name}\` cannot be disabled.`);
      }

      if (sub === 'disable') {
        db.disableCommand(ctx.guild.id, resolved.name);
        return ctx.success(`\`${resolved.name}\` disabled.`);
      }
      db.enableCommand(ctx.guild.id, resolved.name);
      return ctx.success(`\`${resolved.name}\` enabled.`);
    }

    return ctx.error('Usage: `.v commands [list|enable|disable] [command]`');
  },
};