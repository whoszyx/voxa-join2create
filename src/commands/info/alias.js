'use strict';
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');

const FORBIDDEN_TARGETS = new Set(['alias', 'setup', 'commands', 'bannednames', 'resetdata']);

module.exports = {
  name: 'alias',
  category: 'info',
  description: 'Create shortcut commands for yourself',
  longDescription:
    'Aliases resolve only against built-ins, never other aliases, so there are no loops. ' +
    'Updating an existing alias does not use a new slot.',
  usage: '.v alias [add <shortcut> <command + args>|remove <shortcut>|list|clear]',
  aliases: ['aliases'],
  examples: [
    '.v alias add gm name 🎮 Game Night',
    '.v alias add lk lock',
    '.v alias list',
    '.v alias remove gm',
    '.v alias clear',
  ],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 1500,
  async run(ctx) {
    const registry = require('../index');
    const userId = ctx.member.id;
    const sub = (ctx.args[0] || 'list').toLowerCase();
    const max = db.isPrime(userId) ? config.plans.prime.aliases : config.plans.free.aliases;

    if (sub === 'add') {
      const shortcut = (ctx.args[1] || '').toLowerCase();
      const target = ctx.args.slice(2).join(' ').trim();

      if (!shortcut || !target) {
        return ctx.error('Usage: `.v alias add <shortcut> <command + args>`');
      }
      if (!/^[a-z0-9_-]{1,12}$/.test(shortcut)) {
        return ctx.error('Shortcut must be **1–12** chars: `a–z`, `0–9`, `_`, `-`.');
      }
      if (target.length > 100) return ctx.error('Target is too long (max 100 chars).');
      if (registry.resolveBuiltin(shortcut)) {
        return ctx.error(`\`${shortcut}\` collides with a built-in command or alias.`);
      }

      const firstWord = target.split(/\s+/)[0].toLowerCase();
      const resolved = registry.resolveBuiltin(firstWord);
      if (!resolved) return ctx.error(`\`${firstWord}\` is not a built-in command.`);
      if (FORBIDDEN_TARGETS.has(resolved.name)) {
        return ctx.error(`\`${resolved.name}\` cannot be aliased.`);
      }
      if (resolved.name === 'vip') {
        const second = target.split(/\s+/)[1]?.toLowerCase();
        if (second === 'grant' || second === 'revoke') {
          return ctx.error(`\`vip ${second}\` cannot be aliased.`);
        }
      }

      const res = db.addAlias(userId, shortcut, target, max);
      if (!res.ok && res.reason === 'limit') {
        return ctx.upsell(`More aliases (${config.plans.prime.aliases} slots)`);
      }
      return ctx.success(`Alias **${shortcut}** → \`${target}\` ${res.updated ? 'updated' : 'saved'}.`);
    }

    if (sub === 'remove') {
      const shortcut = (ctx.args[1] || '').toLowerCase();
      if (!shortcut) return ctx.error('Usage: `.v alias remove <shortcut>`');
      const ok = db.removeAlias(userId, shortcut);
      return ok ? ctx.success(`Removed **${shortcut}**.`) : ctx.error(`No alias **${shortcut}**.`);
    }

    if (sub === 'clear') {
      const n = db.clearAliases(userId);
      return ctx.success(n ? `Cleared ${n} alias${n === 1 ? '' : 'es'}.` : 'No aliases to clear.');
    }

    const aliases = db.listAliases(userId);
    return ctx.reply(ui.aliasCard({ aliases, max, page: 1, perPage: 6, by: ctx.by }));
  },
};