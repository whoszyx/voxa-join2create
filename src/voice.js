'use strict';

const { ChannelType, PermissionFlagsBits: P, InviteTargetType } = require('discord.js');
const config = require('../config');
const db = require('./db');
const ui = require('./ui');
const actions = require('./actions');

/* ═══ VOICE TIME TRACKING ═══════════════════════════════════════════ */
const voiceStart = new Map();
const pendingStats = new Map();
const createCooldown = new Map();
const creating = new Set();
const emptyGraceTimers = new Map();

function statKey(gid, uid) { return `${gid}:${uid}`; }

function addPending(gid, uid, seconds, rooms) {
  const k = statKey(gid, uid);
  const p = pendingStats.get(k) || { guild_id: gid, user_id: uid, seconds: 0, rooms_created: 0 };
  p.seconds += seconds;
  p.rooms_created += rooms;
  pendingStats.set(k, p);
}

function trackJoin(gid, uid) { voiceStart.set(statKey(gid, uid), Date.now()); }

function trackLeave(gid, uid) {
  const k = statKey(gid, uid);
  const start = voiceStart.get(k);
  if (!start) return;
  const secs = Math.floor((Date.now() - start) / 1000);
  if (secs > 0) addPending(gid, uid, secs, 0);
  voiceStart.delete(k);
}

function flushStats() {
  if (!pendingStats.size) return;
  const entries = [...pendingStats.values()];
  pendingStats.clear();
  try { db.flushVoiceStats(entries); } catch (e) { console.error('Flush failed:', e); }
}

const flushTimer = setInterval(flushStats, config.voiceFlushMs);
if (flushTimer.unref) flushTimer.unref();

/* ═══ PANEL POSTER ══════════════════════════════════════════════════ */
async function postPanel(channel) {
  try {
    const c = await ui.panel(channel, {});
    const msg = await channel.send(ui.pub(c));
    db.setPanelId(channel.id, msg.id);
    return msg;
  } catch (e) {
    console.error('postPanel failed:', e.message);
    return null;
  }
}

/* ═══ LOG HELPER ════════════════════════════════════════════════════ */
async function logGuild(guild, action, channel, extra) {
  if (!guild) return;
  const g = db.getGuild(guild.id);
  if (!g?.log_channel_id) return;
  const ch = guild.channels.cache.get(g.log_channel_id);
  if (!ch) return;
  try {
    const c = ui.logCard({ action, channel, extra });
    await ch.send(ui.pub(c));
  } catch (_) {}
}

/* ═══ HUB JOIN ══════════════════════════════════════════════════════ */
async function onHubJoin(member, hub) {
  const key = statKey(member.guild.id, member.id);
  if (creating.has(key)) return;
  creating.add(key);
  try {
    const now = Date.now();
    const last = createCooldown.get(key) || 0;
    if (now - last < config.createCooldownMs) {
      await member.voice.disconnect().catch(() => {});
      return;
    }
    createCooldown.set(key, now);

    const owned = db.getChannelByOwner(member.guild.id, member.id);
    if (owned) {
      const ch = member.guild.channels.cache.get(owned.channel_id);
      if (ch) { await member.voice.setChannel(ch).catch(() => {}); return; }
      db.deleteChannel(owned.channel_id);
    }

    const prime = db.isPrime(member.id);
    const profile = prime ? db.getProfile(member.id, member.guild.id) : null;

    let name = actions.buildRoomName(hub.name_template, member, hub);
    if (profile?.name) name = profile.name;
    const safe = actions.sanitizeName(member.guild, name, `✦ ${member.user.username}'s Room`);
    if (!safe) {
      await member.voice.disconnect().catch(() => {});
      return;
    }

    const parentId = hub.category_id || null;
    const overwrites = actions.buildRoomOverwrites(member, hub, profile);
    const limit = actions.clampLimit(profile?.user_limit ?? hub.default_limit, prime);
    const bitrate = Math.min(profile?.bitrate || (hub.default_bitrate * 1000), member.guild.maximumBitrate);

    let channel;
    try {
      channel = await member.guild.channels.create({
        name: safe,
        type: ChannelType.GuildVoice,
        parent: parentId,
        userLimit: limit,
        bitrate,
        permissionOverwrites: overwrites,
        reason: `Voxa · ${member.user.tag}`,
      });
    } catch (e) {
      console.error('Channel create failed:', e.message);
      return;
    }

    db.insertChannel({
      channel_id: channel.id,
      guild_id: member.guild.id,
      hub_id: hub.hub_id,
      owner_id: member.id,
      panel_id: null,
      protect: 0,
      status_text: null,
    });

    for (const g of db.listGlobalManagers(member.id)) {
      if (g === member.id) continue;
      db.addRoomManager(channel.id, g);
    }

    try {
      await member.voice.setChannel(channel);
    } catch (_) {
      await channel.delete().catch(() => {});
      db.deleteChannel(channel.id);
      return;
    }

    addPending(member.guild.id, member.id, 0, 1);
    await postPanel(channel);
    logGuild(member.guild, 'Room Created', `<#${channel.id}>`, `👑 **Owner** · <@${member.id}>`);
  } catch (e) {
    console.error('onHubJoin:', e);
  } finally {
    creating.delete(key);
  }
}

/* ═══ ROOM LEAVE ════════════════════════════════════════════════════ */
async function onRoomLeave(member, oldState, room) {
  const guild = member.guild;
  let channel = oldState.channel || guild.channels.cache.get(room.channel_id);
  if (!channel) channel = await guild.channels.fetch(room.channel_id).catch(() => null);
  if (!channel) { db.deleteChannel(room.channel_id); return; }

  const humans = channel.members.filter((m) => !m.user.bot);

  if (humans.size === 0) {
    const graceSec = db.getGuild(guild.id)?.empty_grace_sec || 0;
    const existing = emptyGraceTimers.get(channel.id);
    if (existing) clearTimeout(existing);
    if (graceSec > 0) {
      const t = setTimeout(async () => {
        emptyGraceTimers.delete(channel.id);
        const ch = guild.channels.cache.get(channel.id);
        if (!ch) return;
        const still = ch.members.filter((m) => !m.user.bot).size;
        if (still > 0) return;
        await ch.delete('Voxa · empty').catch(() => {});
        db.deleteChannel(ch.id);
        logGuild(guild, 'Room Deleted', `-# empty · grace`);
      }, graceSec * 1000);
      emptyGraceTimers.set(channel.id, t);
    } else {
      await channel.delete('Voxa · empty').catch(() => {});
      db.deleteChannel(channel.id);
      logGuild(guild, 'Room Deleted', `-# empty`);
    }
    return;
  }

  if (member.id === room.owner_id) {
    const next = humans.first();
    const res = await actions.transferOwnership(channel, next.id).catch(() => ({ ok: false }));
    if (res.ok) {
      try {
        const c = ui.ownershipCard({ newOwner: next.id, oldOwner: member.id });
        await channel.send(ui.pub(c));
      } catch (_) {}
      logGuild(guild, 'Ownership Transferred', `<#${channel.id}>`, `👑 **New owner** · <@${next.id}>`);
    }
  }
}

/* ═══ PROTECT ═══════════════════════════════════════════════════════ */
async function enforceProtect(member, room) {
  if (member.id === room.owner_id) return;
  if (db.isRoomManager(room.channel_id, member.id)) return;
  if (db.hasWhitelist(room.owner_id, member.id)) return;
  try {
    await member.voice.disconnect().catch(() => {});
    const u = await member.client.users.fetch(member.id).catch(() => null);
    if (u) {
      const c = ui.card({
        color: ui.colors.error,
        head: '## ✖ Protected room',
        body: ['That room is protected. Ask the owner for a permit.'],
        by: member.displayName,
      });
      await u.send(ui.eph(c)).catch(() => {});
    }
  } catch (_) {}
}

/* ═══ DISPATCHER ════════════════════════════════════════════════════ */
async function handleVoiceState(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member?.guild || member.user.bot) return;
  const guild = member.guild;

  if (oldState.channelId !== newState.channelId) {
    if (oldState.channelId) trackLeave(guild.id, member.id);
    if (newState.channelId) trackJoin(guild.id, member.id);
  }

  const hub = newState.channelId ? db.getHub(newState.channelId) : null;
  if (hub && oldState.channelId !== newState.channelId) {
    await onHubJoin(member, hub);
    return;
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const room = db.getChannel(oldState.channelId);
    if (room) await onRoomLeave(member, oldState, room);
  }

  if (newState.channelId && oldState.channelId !== newState.channelId) {
    const room = db.getChannel(newState.channelId);
    if (room?.protect) await enforceProtect(member, room);
  }
}

/* ═══ SWEEP ═════════════════════════════════════════════════════════ */
async function sweep(client) {
  const rows = db.listChannels();
  let removed = 0, deleted = 0, repaired = 0;
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) { db.deleteChannel(row.channel_id); removed++; continue; }
    const ch = guild.channels.cache.get(row.channel_id) || await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!ch) { db.deleteChannel(row.channel_id); removed++; continue; }
    const humans = ch.members.filter((m) => !m.user.bot).size;
    if (humans === 0) {
      await ch.delete('Voxa · sweep').catch(() => {});
      db.deleteChannel(row.channel_id);
      deleted++;
    } else {
      if (!row.panel_id) await postPanel(ch).catch(() => {});
      else await actions.refreshPanelNow(ch).catch(() => {});
      repaired++;
    }
  }
  console.log(`✦ Sweep · removed ${removed} stale, deleted ${deleted}, repaired ${repaired}`);
}

/* ═══ CHANNEL DELETE ════════════════════════════════════════════════ */
async function handleChannelDelete(channel) {
  if (!channel.guild) return;
  try {
    if (!db.getHub(channel.id) && !db.getChannel(channel.id)) {
      logGuild(channel.guild, 'Channel Deleted', `-# ${channel.name || channel.id}`);
    }
  } catch (_) {}
}

module.exports = {
  handleVoiceState, sweep, handleChannelDelete,
  postPanel, flushStats, logGuild,
};