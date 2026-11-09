'use strict';

const {
  PermissionFlagsBits: P,
  InviteTargetType,
  OverwriteType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require('discord.js');
const config = require('../config');
const db = require('./db');
const ui = require('./ui');

/* ═══ LIMITER / CACHE ═══════════════════════════════════════════════ */
const renameHistory = new Map();
const requestCooldowns = new Map();
const panelDebounce = new Map();
const panelLastHash = new Map();

/* ═══ PLAN / CONTEXT ════════════════════════════════════════════════ */
function planFor(userId) {
  const prime = db.isPrime(userId);
  return { prime, plan: prime ? config.plans.prime : config.plans.free };
}

function context(member, mode = 'manager') {
  if (!member?.guild) return { ok: false, msg: 'Use this in a server.' };
  const cid = member.voice?.channelId;
  if (!cid) return { ok: false, msg: 'Join your temporary room first.' };
  const room = db.getChannel(cid);
  if (!room) return { ok: false, msg: 'You are not inside a temporary room.' };
  const channel = member.guild.channels.cache.get(cid);
  if (!channel) return { ok: false, msg: 'This room no longer exists.' };
  const isOwner = room.owner_id === member.id;
  const isManager = isOwner || db.isRoomManager(cid, member.id);
  if (mode === 'owner' && !isOwner) return { ok: false, msg: 'Only the room owner can do that.' };
  if (mode === 'manager' && !isManager) return { ok: false, msg: 'Only the owner or a manager can do that.' };
  const { prime, plan } = planFor(room.owner_id);
  return { ok: true, room, channel, isOwner, isManager, prime, plan };
}

async function resolveMember(guild, input) {
  if (!input) return null;
  const id = String(input).replace(/[<@!>]/g, '');
  if (!/^\d{16,20}$/.test(id)) return null;
  return guild.members.fetch(id).catch(() => null);
}

async function resolveRoom(guild, input) {
  if (!input) return null;
  const id = String(input).replace(/[<#>]/g, '');
  if (!/^\d{16,20}$/.test(id)) return null;
  const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  return ch ? db.getChannel(ch.id) : null;
}

/* ═══ SANITIZATION ══════════════════════════════════════════════════ */
function sanitizeName(guild, text, fallback = 'Room') {
  let s = String(text || '').trim();
  s = s.replace(/@(everyone|here)/gi, '').replace(/<@[!&]?\d+>/g, '');
  s = s.replace(/https?:\/\/discord(?:app)?\.(?:gg|com\/invite)\/\S+/gi, '');
  s = s.replace(/discord(?:app)?\.(?:gg|com\/invite)\/\S+/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = fallback;
  if (db.hasBannedWord(guild.id, s)) return null;
  return s.slice(0, 100);
}

/* ═══ RENAME LIMITER ════════════════════════════════════════════════ */
function checkRenameLimiter(channelId, plan) {
  const now = Date.now();
  const hist = (renameHistory.get(channelId) || []).filter((t) => now - t < config.renameWindowMs);
  renameHistory.set(channelId, hist);
  if (hist.length >= config.renameMaxPerWindow) {
    const wait = Math.ceil((config.renameWindowMs - (now - hist[0])) / 1000);
    return { ok: false, msg: `Discord rate limit — wait **${wait}s**.` };
  }
  if (plan.renameCooldownMs > 0) {
    const last = hist[hist.length - 1] || 0;
    if (now - last < plan.renameCooldownMs) {
      const wait = Math.ceil((plan.renameCooldownMs - (now - last)) / 1000);
      return { ok: false, msg: `Plan cooldown — try again in **${wait}s**.` };
    }
  }
  return { ok: true };
}

function markRename(channelId) {
  const hist = renameHistory.get(channelId) || [];
  hist.push(Date.now());
  renameHistory.set(channelId, hist);
}

/* ═══ ROOM ACTIONS ══════════════════════════════════════════════════ */
async function rename(member, name) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const clean = sanitizeName(member.guild, name, '');
  if (!clean) return { ok: false, msg: 'That name is empty or contains a banned word.' };
  const lim = checkRenameLimiter(ctx.channel.id, ctx.plan);
  if (!lim.ok) return lim;
  try {
    await ctx.channel.setName(clean, 'Voxa rename');
    markRename(ctx.channel.id);
    return { ok: true, msg: `Room renamed to **${clean}**.` };
  } catch (e) {
    return { ok: false, msg: 'Could not rename — check my permissions.' };
  }
}

async function setLimit(member, raw) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return { ok: false, msg: 'Limit must be 0–99.' };
  if (n > ctx.plan.maxUserLimit) {
    return { ok: false, msg: `Your plan caps capacity at **${ctx.plan.maxUserLimit}**.` };
  }
  try {
    await ctx.channel.setUserLimit(n);
    return { ok: true, msg: n === 0 ? 'Capacity set to **∞**.' : `Capacity set to **${n}**.` };
  } catch (_) {
    return { ok: false, msg: 'Could not update the capacity.' };
  }
}

async function setStatus(member, text) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const cleaned = text ? String(text).slice(0, 500) : '';
  if (cleaned && db.hasBannedWord(member.guild.id, cleaned)) {
    return { ok: false, msg: 'That status contains a banned word.' };
  }
  try {
    await member.client.rest.put(`/channels/${ctx.channel.id}/voice-status`, {
      body: { status: cleaned || null },
      reason: 'Voxa status',
    });
    db.setStatusText(ctx.channel.id, cleaned || null);
    return { ok: true, msg: cleaned ? 'Status set.' : 'Status cleared.' };
  } catch (_) {
    return { ok: false, msg: 'Could not update status — missing **Set Voice Channel Status** permission.' };
  }
}

async function toggleCam(member, force) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  const off = !!(ow && ow.deny.has(P.Stream));
  const next = typeof force === 'boolean' ? force : !off;
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { Stream: next ? false : null });
    return { ok: true, msg: next ? '🎥 Cam blocked.' : '🎥 Cam allowed.', state: { camOff: next } };
  } catch (_) {
    return { ok: false, msg: 'Could not toggle cam.' };
  }
}

async function toggleSoundboard(member, mode) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  const off = !!(ow && ow.deny.has(P.UseSoundboard));
  const next = mode || (off ? 'on' : 'off');
  try {
    if (next === 'on') {
      await ctx.channel.permissionOverwrites.edit(ev, { UseSoundboard: null, UseExternalSounds: null });
      return { ok: true, msg: '🎵 Soundboard · on.', state: { sbOff: false } };
    }
    if (next === 'managers') {
      await ctx.channel.permissionOverwrites.edit(ev, { UseSoundboard: false, UseExternalSounds: false });
      return { ok: true, msg: '🎵 Soundboard · managers only.' };
    }
    await ctx.channel.permissionOverwrites.edit(ev, { UseSoundboard: false, UseExternalSounds: false });
    return { ok: true, msg: '🎵 Soundboard · off.', state: { sbOff: true } };
  } catch (_) {
    return { ok: false, msg: 'Could not toggle soundboard.' };
  }
}

async function reSendPanel(member) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const { channel, room } = ctx;
  if (room.panel_id) {
    const old = await channel.messages.fetch(room.panel_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const c = await ui.panel(channel, {});
  try {
    const msg = await channel.send(ui.pub(c));
    db.setPanelId(channel.id, msg.id);
    return { ok: true, msg: 'Panel refreshed.' };
  } catch (_) {
    return { ok: false, msg: 'Could not post the panel.' };
  }
}

async function resetRoom(member) {
  const ctx = context(member, 'owner');
  if (!ctx.ok) return ctx;
  const hub = ctx.room.hub_id ? db.getHub(ctx.room.hub_id) : null;
  const ev = member.guild.roles.everyone.id;
  const ow = [{ id: ev, type: OverwriteType.Role, allow: [], deny: [] }];
  ow.push({ id: ctx.room.owner_id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream], deny: [] });
  if (hub) {
    if (hub.lock_on_create) ow[0].deny.push(P.Connect);
    if (hub.hide_on_create) ow[0].deny.push(P.ViewChannel);
    if (hub.cam_off_on_create) ow[0].deny.push(P.Stream);
  }
  for (const m of db.listRoomManagers(ctx.channel.id)) {
    ow.push({ id: m, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream], deny: [] });
  }
  for (const u of db.listWhitelist(ctx.room.owner_id)) {
    ow.push({ id: u, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect], deny: [] });
  }
  for (const u of db.listBlacklist(ctx.room.owner_id)) {
    ow.push({ id: u, type: OverwriteType.Member, allow: [], deny: [P.ViewChannel, P.Connect] });
  }
  try {
    await ctx.channel.permissionOverwrites.set(ow);
    const newName = hub ? buildRoomName(hub.name_template, member, hub) : null;
    if (newName) await ctx.channel.setName(sanitizeName(member.guild, newName, 'Room') || 'Room').catch(() => {});
    if (hub) await ctx.channel.setUserLimit(clampLimit(hub.default_limit, ctx.prime)).catch(() => {});
    if (hub) await ctx.channel.setBitrate(Math.min(hub.default_bitrate * 1000, member.guild.maximumBitrate)).catch(() => {});
  } catch (_) {
    return { ok: false, msg: 'Could not reset the room.' };
  }
  await refreshPanel(ctx.channel);
  return { ok: true, msg: 'Room reset to hub defaults.' };
}

async function setLock(member, force) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  const cur = !!(ow && ow.deny.has(P.Connect));
  const next = typeof force === 'boolean' ? force : !cur;
  if (next === cur) return { ok: true, msg: cur ? 'Already locked.' : 'Already unlocked.', state: { locked: next } };
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { Connect: next ? false : null });
  } catch (_) {
    return { ok: false, msg: 'Could not toggle lock.' };
  }
  return { ok: true, msg: next ? 'Room **locked**.' : 'Room **unlocked**.', state: { locked: next } };
}

async function setHide(member, force) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  const cur = !!(ow && ow.deny.has(P.ViewChannel));
  const next = typeof force === 'boolean' ? force : !cur;
  if (next === cur) return { ok: true, msg: cur ? 'Already hidden.' : 'Already visible.', state: { hidden: next } };
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { ViewChannel: next ? false : null });
  } catch (_) {
    return { ok: false, msg: 'Could not toggle visibility.' };
  }
  return { ok: true, msg: next ? 'Room **hidden**.' : 'Room **visible**.', state: { hidden: next } };
}

async function setProtect(member, force) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  if (!ctx.plan.protect) return { ok: false, premium: true, feature: 'Join protection', msg: 'Prime required.' };
  const next = typeof force === 'boolean' ? force : !ctx.room.protect;
  db.setProtect(ctx.channel.id, next);
  return { ok: true, msg: next ? '🛡️ Protection enabled.' : '🛡️ Protection disabled.' };
}

async function toggleTextLock(member, force) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  const cur = !!(ow && ow.deny.has(P.SendMessages));
  const next = typeof force === 'boolean' ? force : !cur;
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { SendMessages: next ? false : null });
  } catch (_) {
    return { ok: false, msg: 'Could not toggle chat lock.' };
  }
  return { ok: true, msg: next ? 'Chat **locked**.' : 'Chat **unlocked**.', state: { chatLocked: next } };
}

async function textMute(member, targetId, mute = true) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  if (targetId === ctx.room.owner_id) return { ok: false, msg: 'Cannot mute the owner.' };
  if (db.isRoomManager(ctx.channel.id, targetId)) return { ok: false, msg: 'Cannot mute a manager.' };
  try {
    await ctx.channel.permissionOverwrites.edit(targetId, { SendMessages: mute ? false : null });
    return { ok: true, msg: mute ? `<@${targetId}> text-muted.` : `<@${targetId}> text-unmuted.` };
  } catch (_) {
    return { ok: false, msg: 'Could not update that member.' };
  }
}

async function forceMuteAll(member) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { Speak: false });
    for (const id of [ctx.room.owner_id, ...db.listRoomManagers(ctx.channel.id)]) {
      await ctx.channel.permissionOverwrites.edit(id, { Speak: true }).catch(() => {});
    }
    return { ok: true, msg: '🔇 Everyone muted (you keep Speak).' };
  } catch (_) {
    return { ok: false, msg: 'Could not mute everyone.' };
  }
}

async function forceUnmuteAll(member) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const ev = member.guild.roles.everyone.id;
  try {
    await ctx.channel.permissionOverwrites.edit(ev, { Speak: null });
    return { ok: true, msg: '🔊 Unmuted.' };
  } catch (_) {
    return { ok: false, msg: 'Could not unmute.' };
  }
}

async function permitAll(member) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  let n = 0;
  for (const m of ctx.channel.members.values()) {
    if (m.user.bot) continue;
    if (m.id === ctx.room.owner_id) continue;
    if (db.isRoomManager(ctx.channel.id, m.id)) continue;
    try {
      await ctx.channel.permissionOverwrites.edit(m.id, { ViewChannel: true, Connect: true });
      db.addWhitelist(ctx.room.owner_id, m.id);
      n++;
    } catch (_) {}
  }
  return { ok: true, msg: `Permitted **${n}** member${n === 1 ? '' : 's'}.` };
}

async function pickRandom(member) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const humans = ctx.channel.members.filter((m) => !m.user.bot);
  if (humans.size < 2) return { ok: false, msg: 'Need at least 2 humans.' };
  const winner = humans.random();
  return { ok: true, msg: `🎲 Picked · <@${winner.id}>`, winnerId: winner.id };
}

async function startActivity(member, key) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const game = config.activities[String(key || '').toLowerCase()];
  if (!game) return { ok: false, msg: 'Unknown activity.' };
  try {
    const inv = await ctx.channel.createInvite({
      maxAge: 3600,
      maxUses: 0,
      unique: true,
      targetType: InviteTargetType.EmbeddedApplication,
      targetApplication: game.id,
      reason: `Voxa activity · ${game.name}`,
    });
    return { ok: true, msg: `🎮 **${game.name}** · ${inv.url}`, url: inv.url };
  } catch (_) {
    return { ok: false, msg: `Could not start **${game.name}** — missing **Create Instant Invite** or the activity is unavailable.` };
  }
}

async function fixVoice(member, guildWide = false) {
  if (guildWide) {
    if (!member.permissions.has(P.ManageGuild)) return { ok: false, msg: 'Need **Manage Server**.' };
    const rooms = db.listChannelsByGuild(member.guild.id);
    let fixed = 0;
    for (const row of rooms) {
      const ch = member.guild.channels.cache.get(row.channel_id) || (await member.guild.channels.fetch(row.channel_id).catch(() => null));
      if (!ch) { db.deleteChannel(row.channel_id); continue; }
      await rebuildOverwrites(ch, row).catch(() => {});
      await refreshPanelNow(ch).catch(() => {});
      fixed++;
    }
    return { ok: true, msg: `Repaired **${fixed}** rooms.` };
  }
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  try {
    await rebuildOverwrites(ctx.channel, ctx.room);
    await refreshPanelNow(ctx.channel);
    return { ok: true, msg: 'Room repaired.' };
  } catch (_) {
    return { ok: false, msg: 'Could not repair — check permissions.' };
  }
}

async function rebuildOverwrites(channel, room) {
  const guild = channel.guild;
  const ev = guild.roles.everyone.id;
  const ow = [{ id: ev, type: OverwriteType.Role, allow: [], deny: [] }];
  ow.push({ id: room.owner_id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream], deny: [] });
  for (const m of db.listRoomManagers(channel.id)) {
    ow.push({ id: m, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream], deny: [] });
  }
  for (const u of db.listWhitelist(room.owner_id)) {
    ow.push({ id: u, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect], deny: [] });
  }
  for (const u of db.listBlacklist(room.owner_id)) {
    ow.push({ id: u, type: OverwriteType.Member, allow: [], deny: [P.ViewChannel, P.Connect] });
  }
  const cur = channel.permissionOverwrites.cache.get(ev);
  if (cur) {
    if (cur.deny.has(P.Connect)) ow[0].deny.push(P.Connect);
    if (cur.deny.has(P.ViewChannel)) ow[0].deny.push(P.ViewChannel);
    if (cur.deny.has(P.SendMessages)) ow[0].deny.push(P.SendMessages);
    if (cur.deny.has(P.Speak)) ow[0].deny.push(P.Speak);
  }
  await channel.permissionOverwrites.set(ow);
}

async function setBitrate(member, kbps) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  if (!ctx.plan.bitrate) return { ok: false, premium: true, feature: 'Bitrate control', msg: 'Prime required.' };
  const n = parseInt(kbps, 10);
  const max = Math.floor(member.guild.maximumBitrate / 1000);
  if (Number.isNaN(n) || n < 8 || n > max) return { ok: false, msg: `Bitrate must be 8–${max} kbps.` };
  try {
    await ctx.channel.setBitrate(n * 1000);
    return { ok: true, msg: `Bitrate · **${n} kbps**.` };
  } catch (_) {
    return { ok: false, msg: 'Could not set bitrate.' };
  }
}

async function saveProfile(member) {
  const ctx = context(member, 'owner');
  if (!ctx.ok) return ctx;
  if (!ctx.plan.profile) return { ok: false, premium: true, feature: 'Saved profile', msg: 'Prime required.' };
  const ev = member.guild.roles.everyone.id;
  const ow = ctx.channel.permissionOverwrites.cache.get(ev);
  db.saveProfile({
    user_id: ctx.room.owner_id,
    guild_id: member.guild.id,
    name: ctx.channel.name,
    user_limit: ctx.channel.userLimit || 0,
    bitrate: ctx.channel.bitrate || 64000,
    locked: ow && ow.deny.has(P.Connect) ? 1 : 0,
    hidden: ow && ow.deny.has(P.ViewChannel) ? 1 : 0,
    cam: ow && ow.deny.has(P.Stream) ? 1 : 0,
  });
  return { ok: true, msg: 'Profile saved.' };
}

async function clearMessages(member, amount) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const cap = ctx.plan.clearMax;
  const n = Math.min(Math.max(1, parseInt(amount, 10) || cap), cap);
  try {
    const msgs = await ctx.channel.messages.fetch({ limit: n });
    await ctx.channel.bulkDelete(msgs, true);
    return { ok: true, msg: `Cleared **${msgs.size}** message${msgs.size === 1 ? '' : 's'}.` };
  } catch (_) {
    return { ok: false, msg: 'Could not clear — need **Manage Messages** and messages under 14 days.' };
  }
}

/* ═══ ACCESS ACTIONS ════════════════════════════════════════════════ */
async function permit(member, targetId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const t = ctx.channel.members.get(targetId);
  if (!t) return { ok: false, msg: 'That member is not in this room.' };
  try {
    await ctx.channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true });
    if (member.id !== targetId) db.addWhitelist(ctx.room.owner_id, targetId);
  } catch (_) {
    return { ok: false, msg: 'Could not permit that member.' };
  }
  return { ok: true, msg: `<@${targetId}> permitted.` };
}

async function deny(member, targetId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  if (targetId === ctx.room.owner_id) return { ok: false, msg: 'Cannot deny the owner.' };
  if (db.isRoomManager(ctx.channel.id, targetId)) return { ok: false, msg: 'Cannot deny a manager.' };
  try {
    await ctx.channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false });
    const m = ctx.channel.members.get(targetId);
    if (m) await m.voice.disconnect().catch(() => {});
    db.addBlacklist(ctx.room.owner_id, targetId);
    db.removeWhitelist(ctx.room.owner_id, targetId);
  } catch (_) {
    return { ok: false, msg: 'Could not deny that member.' };
  }
  return { ok: true, msg: `<@${targetId}> denied.` };
}

async function undeny(member, targetId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  try {
    await ctx.channel.permissionOverwrites.delete(targetId);
    db.removeBlacklist(ctx.room.owner_id, targetId);
  } catch (_) {}
  return { ok: true, msg: `<@${targetId}> no longer denied.` };
}

async function permitRole(member, roleId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  try {
    await ctx.channel.permissionOverwrites.edit(roleId, { ViewChannel: true, Connect: true });
    return { ok: true, msg: `<@&${roleId}> permitted.` };
  } catch (_) {
    return { ok: false, msg: 'Could not permit that role.' };
  }
}

async function rejectRole(member, roleId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  try {
    await ctx.channel.permissionOverwrites.edit(roleId, { ViewChannel: false, Connect: false });
    return { ok: true, msg: `<@&${roleId}> rejected.` };
  } catch (_) {
    return { ok: false, msg: 'Could not reject that role.' };
  }
}

async function kick(member, targetId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  if (targetId === ctx.room.owner_id) return { ok: false, msg: 'Cannot kick the owner.' };
  if (db.isRoomManager(ctx.channel.id, targetId)) return { ok: false, msg: 'Cannot kick a manager.' };
  const t = ctx.channel.members.get(targetId);
  if (!t) return { ok: false, msg: 'Not in the room.' };
  if (t.user.bot) return { ok: false, msg: 'Cannot kick bots.' };
  try {
    await t.voice.disconnect().catch(() => {});
  } catch (_) {
    return { ok: false, msg: 'Could not kick.' };
  }
  return { ok: true, msg: `<@${targetId}> kicked.` };
}

async function kickRole(member, roleId) {
  const ctx = context(member, 'manager');
  if (!ctx.ok) return ctx;
  const role = member.guild.roles.cache.get(roleId);
  if (!role) return { ok: false, msg: 'Role not found.' };
  const targets = ctx.channel.members.filter((m) => !m.user.bot && m.roles.cache.has(roleId));
  let n = 0;
  for (const m of targets.values()) {
    if (m.id === ctx.room.owner_id) continue;
    if (db.isRoomManager(ctx.channel.id, m.id)) continue;
    await m.voice.disconnect().catch(() => {});
    n++;
  }
  return { ok: true, msg: `Kicked **${n}** member${n === 1 ? '' : 's'}.` };
}

/* ═══ WHITELIST / BLACKLIST ═════════════════════════════════════════ */
async function whitelistAdd(userId, targetId) {
  const { plan } = planFor(userId);
  const cur = db.listWhitelist(userId);
  if (cur.includes(targetId)) return { ok: false, msg: 'Already on the whitelist.' };
  if (cur.length >= plan.whitelist) return { ok: false, msg: `Whitelist full (**${plan.whitelist}** max).` };
  db.addWhitelist(userId, targetId);
  return { ok: true, msg: `<@${targetId}> whitelisted.` };
}

async function whitelistRemove(userId, targetId) {
  db.removeWhitelist(userId, targetId);
  return { ok: true, msg: `<@${targetId}> removed from whitelist.` };
}

async function blacklistAdd(userId, targetId) {
  const { plan } = planFor(userId);
  const cur = db.listBlacklist(userId);
  if (cur.includes(targetId)) return { ok: false, msg: 'Already blacklisted.' };
  if (cur.length >= plan.blacklist) return { ok: false, msg: `Blacklist full (**${plan.blacklist}** max).` };
  db.addBlacklist(userId, targetId);
  db.removeWhitelist(userId, targetId);
  return { ok: true, msg: `<@${targetId}> blacklisted.` };
}

async function blacklistRemove(userId, targetId) {
  db.removeBlacklist(userId, targetId);
  return { ok: true, msg: `<@${targetId}> removed from blacklist.` };
}

/* ═══ REQUEST ═══════════════════════════════════════════════════════ */
async function requestPermit(member, input) {
  const now = Date.now();
  const last = requestCooldowns.get(member.id) || 0;
  if (now - last < 60000) {
    return { ok: false, msg: `Request cooldown — try in **${Math.ceil((60000 - (now - last)) / 1000)}s**.` };
  }
  let room = await resolveRoom(member.guild, input);
  if (!room) {
    const target = await resolveMember(member.guild, input);
    if (target) {
      const rid = db.getOwnerRoomId(member.guild.id, target.id);
      if (rid) room = db.getChannel(rid);
    }
  }
  if (!room) return { ok: false, msg: 'That room could not be found.' };
  if (room.owner_id === member.id) return { ok: false, msg: 'That is your own room.' };
  const ch = member.guild.channels.cache.get(room.channel_id);
  if (!ch) return { ok: false, msg: 'That room no longer exists.' };

  const c = ui.card({
    color: ui.colors.info,
    head: '## ✦ Join Request',
    subtitle: `-# <@${member.id}> would like to join`,
    body: [`👤 **Requester** · <@${member.id}>`, `👑 **Owner** · <@${room.owner_id}>`],
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vx:req:ok:${room.channel_id}:${member.id}`)
          .setLabel('✅ Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`vx:req:no:${room.channel_id}:${member.id}`)
          .setLabel('❌ Deny')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
    by: member.displayName,
  });

  try {
    await ch.send(ui.pub(c));
    requestCooldowns.set(member.id, now);
    return { ok: true, msg: `Request sent to <#${ch.id}>.` };
  } catch (_) {
    return { ok: false, msg: 'Could not post the request.' };
  }
}

/* ═══ CLAIM / TRANSFER ══════════════════════════════════════════════ */
async function claim(member) {
  const ctx = context(member, 'any');
  if (!ctx.ok) return ctx;
  if (ctx.room.owner_id === member.id) return { ok: false, msg: 'You already own this room.' };
  const ownerIn = ctx.channel.members.has(ctx.room.owner_id);
  if (ownerIn) return { ok: false, msg: 'The owner is still here.' };
  return transferOwnership(ctx.channel, member.id);
}

async function transfer(member, targetId) {
  const ctx = context(member, 'owner');
  if (!ctx.ok) return ctx;
  if (targetId === member.id) return { ok: false, msg: 'You already own this room.' };
  if (!ctx.channel.members.has(targetId)) return { ok: false, msg: 'That member is not in this room.' };
  return transferOwnership(ctx.channel, targetId);
}

async function transferOwnership(channel, newOwnerId) {
  const room = db.getChannel(channel.id);
  if (!room) return { ok: false, msg: 'Room not found.' };
  if (room.owner_id === newOwnerId) return { ok: true, msg: 'Already owner.' };
  try {
    await channel.permissionOverwrites.delete(room.owner_id).catch(() => {});
    await channel.permissionOverwrites.edit(newOwnerId, {
      ViewChannel: true, Connect: true, Speak: true, Stream: true,
    });
  } catch (_) {
    return { ok: false, msg: 'Could not update permissions.' };
  }
  db.removeRoomManager(channel.id, newOwnerId);
  db.setOwner(channel.id, newOwnerId);
  await refreshPanel(channel).catch(() => {});
  return { ok: true, msg: `Ownership → <@${newOwnerId}>.` };
}

/* ═══ MANAGERS ══════════════════════════════════════════════════════ */
async function managerAdd(member, targetId) {
  const ctx = context(member, 'owner');
  if (!ctx.ok) return ctx;
  if (!ctx.plan.roomManagers) {
    return { ok: false, premium: true, feature: 'Room managers', msg: 'Prime required.' };
  }
  const cur = db.listRoomManagers(ctx.channel.id);
  if (cur.includes(targetId)) return { ok: false, msg: 'Already a manager.' };
  if (cur.length >= ctx.plan.roomManagers) return { ok: false, msg: `Manager slots full (**${ctx.plan.roomManagers}** max).` };
  if (targetId === ctx.room.owner_id) return { ok: false, msg: 'Owner is already in charge.' };
  try {
    await ctx.channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true, Connect: true, Speak: true, Stream: true,
    });
  } catch (_) {
    return { ok: false, msg: 'Could not add manager.' };
  }
  db.addRoomManager(ctx.channel.id, targetId);
  await refreshPanel(ctx.channel);
  return { ok: true, msg: `<@${targetId}> is now a manager.` };
}

async function managerRemove(member, targetId) {
  const ctx = context(member, 'owner');
  if (!ctx.ok) return ctx;
  db.removeRoomManager(ctx.channel.id, targetId);
  await refreshPanel(ctx.channel);
  return { ok: true, msg: `<@${targetId}> is no longer a manager.` };
}

async function globalManagerAdd(userId, targetId) {
  const { plan } = planFor(userId);
  const cur = db.listGlobalManagers(userId);
  if (cur.includes(targetId)) return { ok: false, msg: 'Already a global manager.' };
  if (cur.length >= plan.globalManagers) return { ok: false, msg: `Global manager slots full (**${plan.globalManagers}** max).` };
  db.addGlobalManager(userId, targetId);
  return { ok: true, msg: `<@${targetId}> added as global manager.` };
}

async function globalManagerRemove(userId, targetId) {
  db.removeGlobalManager(userId, targetId);
  return { ok: true, msg: `<@${targetId}> removed.` };
}

/* ═══ INFO ══════════════════════════════════════════════════════════ */
async function vcinfo(member) {
  const ctx = context(member, 'any');
  if (!ctx.ok) return ctx;
  const ch = ctx.channel;
  const state = ui.computeRoomState(ch, {});
  const humans = ch.members.filter((m) => !m.user.bot).size;
  return {
    ok: true,
    data: {
      name: ch.name,
      bitrate: Math.round((ch.bitrate || 64000) / 1000),
      region: (ch.rtcRegion || 'auto').toLowerCase(),
      limit: ch.userLimit || 0,
      humans,
      state,
      created_at: ctx.room.created_at,
      owner_id: ctx.room.owner_id,
    },
    msg: 'Room info.',
  };
}

async function ownerInfo(member) {
  const ctx = context(member, 'any');
  if (!ctx.ok) return ctx;
  return {
    ok: true,
    data: {
      owner_id: ctx.room.owner_id,
      managers: db.listRoomManagers(ctx.channel.id),
      created_at: ctx.room.created_at,
    },
    msg: 'Owner info.',
  };
}

/* ═══ PANEL ═════════════════════════════════════════════════════════ */
function panelHash(channel, state) {
  return JSON.stringify({
    name: channel.name,
    cap: channel.userLimit,
    kbps: channel.bitrate,
    members: channel.members.size,
    locked: state.locked, hidden: state.hidden, camOff: state.camOff,
    chatLocked: state.chatLocked, sbOff: state.sbOff,
  });
}

async function runPanelRefresh(channel, overrides = {}) {
  const room = db.getChannel(channel.id);
  if (!room || !room.panel_id) return;
  const state = ui.computeRoomState(channel, overrides);
  const hash = panelHash(channel, state);
  if (panelLastHash.get(channel.id) === hash) return;
  try {
    const msg = await channel.messages.fetch(room.panel_id).catch(() => null);
    if (!msg) return;
    const c = await ui.panel(channel, state);
    await msg.edit(ui.editV2(c));
    panelLastHash.set(channel.id, hash);
  } catch (_) { /* silent */ }
}

async function refreshPanel(channel, overrides = {}) {
  if (!channel) return;
  const cur = panelDebounce.get(channel.id);
  if (cur) {
    cur.overrides = { ...cur.overrides, ...overrides };
    return;
  }
  const timer = setTimeout(() => {
    const e = panelDebounce.get(channel.id);
    panelDebounce.delete(channel.id);
    runPanelRefresh(channel, e?.overrides || {}).catch(() => {});
  }, config.panelDebounceMs);
  panelDebounce.set(channel.id, { timer, overrides: { ...overrides } });
  await runPanelRefresh(channel, overrides).catch(() => {});
}

async function refreshPanelNow(channel, overrides = {}) {
  if (!channel) return;
  await runPanelRefresh(channel, overrides).catch(() => {});
}

/* ═══ VOICE HELPERS (shared with voice.js) ══════════════════════════ */
function clampLimit(n, prime) {
  const max = prime ? config.plans.prime.maxUserLimit : config.plans.free.maxUserLimit;
  const val = parseInt(n, 10) || 0;
  return Math.min(Math.max(0, val), max);
}

function buildRoomName(template, member, hub) {
  let t = template || config.defaultHub.nameTemplate;
  const display = member.displayName || member.user.username || 'Guest';
  const fallback = db.hasBannedWord(member.guild.id, display) ? 'Guest' : display;
  t = t.replace(/\{user\}/g, fallback);
  t = t.replace(/\{username\}/g, member.user.username || 'Guest');
  t = t.replace(/\{count\}/g, String(db.listChannelsByGuild(member.guild.id).length + 1));
  t = t.replace(/\{hub\}/g, hub?.name_template ? 'Hub' : 'Hub');
  return t.slice(0, 100);
}

function buildRoomOverwrites(member, hub, profile) {
  const guild = member.guild;
  const ev = guild.roles.everyone.id;
  const map = new Map();
  const put = (id, type, allow, deny) => {
    const prev = map.get(id);
    map.set(id, {
      id, type,
      allow: [...(prev?.allow || []), ...(allow || [])],
      deny: [...(prev?.deny || []), ...(deny || [])],
    });
  };

  const evDeny = [];
  if (profile?.locked) evDeny.push(P.Connect);
  else if (hub.lock_on_create) evDeny.push(P.Connect);
  if (profile?.hidden) evDeny.push(P.ViewChannel);
  else if (hub.hide_on_create) evDeny.push(P.ViewChannel);
  if (profile?.cam) evDeny.push(P.Stream);
  else if (hub.cam_off_on_create) evDeny.push(P.Stream);
  put(ev, OverwriteType.Role, [], evDeny);

  put(member.id, OverwriteType.Member, [P.ViewChannel, P.Connect, P.Speak, P.Stream], []);

  for (const u of db.listWhitelist(member.id)) {
    put(u, OverwriteType.Member, [P.ViewChannel, P.Connect], []);
  }
  for (const u of db.listBlacklist(member.id)) {
    map.set(u, { id: u, type: OverwriteType.Member, allow: [], deny: [P.ViewChannel, P.Connect] });
  }
  for (const g of db.listGlobalManagers(member.id)) {
    if (g === member.id) continue;
    put(g, OverwriteType.Member, [P.ViewChannel, P.Connect, P.Speak, P.Stream], []);
  }
  return [...map.values()];
}

module.exports = {
  planFor, context, resolveMember, resolveRoom, sanitizeName,
  rename, setLimit, setStatus, toggleCam, toggleSoundboard,
  reSendPanel, resetRoom, setLock, setHide, setProtect,
  toggleTextLock, textMute, forceMuteAll, forceUnmuteAll, permitAll,
  pickRandom, startActivity, fixVoice, setBitrate, saveProfile, clearMessages,
  permit, deny, undeny, permitRole, rejectRole, kick, kickRole,
  whitelistAdd, whitelistRemove, blacklistAdd, blacklistRemove,
  requestPermit,
  claim, transfer, transferOwnership,
  managerAdd, managerRemove, globalManagerAdd, globalManagerRemove,
  vcinfo, ownerInfo,
  refreshPanel, refreshPanelNow, runPanelRefresh,
  clampLimit, buildRoomName, buildRoomOverwrites,
  rebuildOverwrites,
};