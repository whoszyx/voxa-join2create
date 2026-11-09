'use strict';

const path = require('path');
const fs = require('fs');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../../config');
const db = require('../db');
const ui = require('../ui');

const registry = new Map();
const aliasMap = new Map();
const byCategory = new Map();
const cooldowns = new Map();

/* ═══ REGISTRY ══════════════════════════════════════════════════════ */
function register(cmd) {
  if (!cmd || !cmd.name) return;
  if (registry.has(cmd.name)) {
    console.error(`✖ Duplicate command name: ${cmd.name} (first wins)`);
    return;
  }
  if (aliasMap.has(cmd.name)) {
    console.error(`✖ Command name collides with alias: ${cmd.name}`);
    return;
  }
  registry.set(cmd.name, cmd);
  if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
  byCategory.get(cmd.category).push(cmd);
  for (const a of cmd.aliases || []) {
    const key = String(a).toLowerCase();
    if (registry.has(key) || aliasMap.has(key)) {
      console.error(`✖ Duplicate alias: ${key} on ${cmd.name} (first wins)`);
      continue;
    }
    aliasMap.set(key, cmd.name);
  }
}

function loadAll() {
  const base = __dirname;
  let dirs;
  try {
    dirs = fs.readdirSync(base).filter((d) => {
      try { return fs.statSync(path.join(base, d)).isDirectory(); } catch (_) { return false; }
    });
  } catch (_) { return; }
  for (const cat of dirs) {
    const dir = path.join(base, cat);
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { continue; }
    for (const file of files) {
      if (!file.endsWith('.js') || file.startsWith('_')) continue;
      try {
        const cmd = require(path.join(dir, file));
        if (cmd && cmd.name) register(cmd);
      } catch (e) {
        console.error(`✖ Load failed: ${cat}/${file}`, e.message);
      }
    }
  }
  console.log(`✦ Loaded ${registry.size} commands · ${aliasMap.size} aliases`);
}

function resolveBuiltin(word) {
  const w = String(word || '').toLowerCase();
  if (!w) return null;
  if (registry.has(w)) return registry.get(w);
  const mapped = aliasMap.get(w);
  if (mapped) return registry.get(mapped);
  return null;
}

function resolveCustomAlias(userId, word) {
  const a = db.getAlias(userId, word);
  if (!a) return null;
  return a.command;
}

function listCategories() {
  const labels = {
    voice: { label: 'Voice', emoji: '🎙️' },
    access: { label: 'Access', emoji: '🔐' },
    info: { label: 'Info', emoji: '📊' },
    profile: { label: 'Profile', emoji: '👤' },
    admin: { label: 'Admin', emoji: '🛠️' },
  };
  return [...byCategory.entries()].map(([key, cmds]) => ({
    key,
    label: labels[key]?.label || key,
    emoji: labels[key]?.emoji || '📁',
    commands: cmds
      .filter((c) => !c.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ name: c.name, description: c.description, premium: !!c.premium })),
  }));
}

function getByCategory(key) { return byCategory.get(key) || []; }
function allCommands() { return [...registry.values()]; }

/* ═══ CTX ═══════════════════════════════════════════════════════════ */
function buildCtx(message, cmd, args, client) {
  const member = message.member;
  const by = member?.displayName || message.author.username;
  const replyCard = (container) => message.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  }).catch(() => null);
  return {
    message, cmd, args, argsRaw: args.join(' '), client,
    member, guild: message.guild, channel: message.channel, by,
    reply: replyCard,
    error: (msg, hint) => replyCard(ui.error({ msg, hint, by })),
    success: (msg) => replyCard(ui.success({ msg, by })),
    warn: (msg) => replyCard(ui.warn({ msg, by })),
    working: (msg) => replyCard(ui.working({ msg, by })),
    upsell: (feature) => replyCard(ui.upsell(feature, { by })),
    card: (opts) => replyCard(ui.card({ ...opts, by })),
  };
}

/* ═══ COOLDOWN ══════════════════════════════════════════════════════ */
function checkCooldown(userId, cmd) {
  if (!cmd.cooldownMs) return true;
  if (cooldowns.size > 5000) {
    const cutoff = Date.now() - 60_000;
    for (const [k, ts] of cooldowns) if (ts < cutoff) cooldowns.delete(k);
  }
  const key = `${userId}:${cmd.name}`;
  const last = cooldowns.get(key) || 0;
  if (Date.now() - last < cmd.cooldownMs) return false;
  cooldowns.set(key, Date.now());
  return true;
}

/* ═══ GATE ══════════════════════════════════════════════════════════ */
function checkGate(member, cmd) {
  if (config.ownerIds.includes(member.id)) return { ok: true, bypass: true };
  const g = cmd.gate;
  if (!g || g === 'E') return { ok: true };
  if (g === 'G') {
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return { ok: false, msg: 'You need **Manage Server** for that.' };
    }
    return { ok: true };
  }
  if (g === 'B') return { ok: false, msg: 'Bot-owner only.' };
  const channelId = member.voice?.channelId;
  if (!channelId) return { ok: false, msg: 'Join your temporary room first.' };
  const room = db.getChannel(channelId);
  if (!room) return { ok: false, msg: 'Join your temporary room first.' };
  if (g === 'A') return { ok: true, room };
  if (g === 'M') {
    if (room.owner_id === member.id) return { ok: true, room };
    if (db.isRoomManager(channelId, member.id)) return { ok: true, room };
    return { ok: false, msg: 'Only the owner or a manager can do that.' };
  }
  if (g === 'O') {
    if (room.owner_id === member.id) return { ok: true, room };
    return { ok: false, msg: 'Only the room owner can do that.' };
  }
  return { ok: true };
}

/* ═══ MAIN ENTRYPOINT ═══════════════════════════════════════════════ */
async function handleMessage(message, client) {
  if (!message || !message.guild || message.author.bot) return;
  const prefix = config.prefix;
  if (!message.content.startsWith(prefix)) return;
  const after = message.content.slice(prefix.length);
  if (after.length > 0 && !/^\s/.test(after)) return;

  const parts = after.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;

  const firstWord = parts[0].toLowerCase();
  let extraArgs = parts.slice(1);
  let cmd = null;

  // 1. Custom alias (per-user)
  const customCmd = resolveCustomAlias(message.author.id, firstWord);
  if (customCmd) {
    const tparts = String(customCmd).split(/\s+/).filter(Boolean);
    const builtin = resolveBuiltin(tparts[0] || '');
    if (builtin) {
      cmd = builtin;
      extraArgs = [...tparts.slice(1), ...extraArgs];
    }
  }

  // 2. Built-in
  if (!cmd) cmd = resolveBuiltin(firstWord);

  if (!cmd) {
    const c = ui.error({
      msg: `Unknown command **${firstWord}**. Try \`${prefix}help\`.`,
      by: message.member?.displayName,
    });
    return message.reply({
      components: [c],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], repliedUser: false },
    }).catch(() => {});
  }

  // Disabled?
  if (db.isDisabled(message.guild.id, cmd.name) && !['help', 'commands', 'setup'].includes(cmd.name)) {
    return message.reply({
      components: [ui.warn({ msg: `\`${cmd.name}\` is disabled on this server.`, by: message.member?.displayName })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  // Gate
  const gate = checkGate(message.member, cmd);
  if (!gate.ok) {
    return message.reply({
      components: [ui.error({ msg: gate.msg, by: message.member?.displayName })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  // Cooldown
  if (!checkCooldown(message.author.id, cmd)) {
    return message.reply({
      components: [ui.warn({ msg: 'Slow down — you\'re on cooldown.', by: message.member?.displayName })],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  const ctx = buildCtx(message, cmd, extraArgs, client);
  try {
    await cmd.run(ctx);
  } catch (e) {
    console.error(`Command ${cmd.name} failed:`, e);
    await ctx.error('Something went wrong. Please try again.', 'If it persists, contact the bot owner.');
  }
}

loadAll();

module.exports = {
  handleMessage,
  resolveBuiltin,
  listCategories,
  getByCategory,
  allCommands,
  registry,
  aliasMap,
};