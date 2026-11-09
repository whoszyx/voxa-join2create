'use strict';

const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const config = require('../config');
const db = require('./db');

const drafts = new Map();

function getDraft(userId) {
  const d = drafts.get(userId);
  if (!d) return null;
  if (d.expiresAt < Date.now()) { drafts.delete(userId); return null; }
  return d.draft;
}

function setDraft(userId, draft) {
  drafts.set(userId, { draft, expiresAt: Date.now() + config.setupDraftTtlMs });
}

function updateDraft(userId, patch) {
  const d = getDraft(userId);
  if (!d) return null;
  const merged = { ...d, ...patch };
  setDraft(userId, merged);
  return merged;
}

function clearDraft(userId) { drafts.delete(userId); }

function newDraft() {
  return {
    categoryId: null,
    nameTemplate: config.defaultHub.nameTemplate,
    defaultLimit: config.defaultHub.defaultLimit,
    defaultBitrate: config.defaultHub.defaultBitrate,
    emptyGraceSec: 0,
    lockOnCreate: false,
    hideOnCreate: false,
    camOffOnCreate: false,
    logChannelId: null,
    hubId: null,
    isEdit: false,
  };
}

function draftFromHub(hub, guild) {
  const g = db.getGuild(guild.id);
  return {
    categoryId: hub.category_id,
    nameTemplate: hub.name_template,
    defaultLimit: hub.default_limit,
    defaultBitrate: hub.default_bitrate,
    emptyGraceSec: g?.empty_grace_sec || 0,
    lockOnCreate: !!hub.lock_on_create,
    hideOnCreate: !!hub.hide_on_create,
    camOffOnCreate: !!hub.cam_off_on_create,
    logChannelId: g?.log_channel_id || null,
    hubId: hub.hub_id,
    isEdit: true,
  };
}

/* ═══ HEALTH CHECK ══════════════════════════════════════════════════ */
function healthCheck(guild, botMember) {
  const checks = [];
  const required = [
    ['Manage Channels', P.ManageChannels],
    ['Manage Roles', P.ManageRoles],
    ['Move Members', P.MoveMembers],
    ['View Channels', P.ViewChannel],
    ['Connect', P.Connect],
    ['Send Messages', P.SendMessages],
    ['Manage Messages', P.ManageMessages],
    ['Create Instant Invite', P.CreateInstantInvite],
  ];
  for (const [name, bit] of required) {
    const ok = botMember.permissions.has(bit);
    checks.push({ name, ok, fix: ok ? '' : `Grant **${name}** to the bot role.` });
  }
  try {
    if (typeof P.SetVoiceChannelStatus !== 'undefined') {
      const ok = botMember.permissions.has(P.SetVoiceChannelStatus);
      checks.push({ name: 'Set Voice Channel Status', ok, fix: ok ? '' : 'Grant **Set Voice Channel Status**.' });
    }
  } catch (_) {}
  return checks;
}

/* ═══ QUICK SETUP ═══════════════════════════════════════════════════ */
async function quickSetup(guild) {
  const category = await guild.channels.create({
    name: config.defaultHub.categoryName,
    type: ChannelType.GuildCategory,
    reason: 'Voxa quick setup',
  });
  const hub = await guild.channels.create({
    name: config.defaultHub.hubName,
    type: ChannelType.GuildVoice,
    parent: category.id,
    reason: 'Voxa quick setup',
  });
  db.createHub({
    hub_id: hub.id,
    guild_id: guild.id,
    category_id: category.id,
    name_template: config.defaultHub.nameTemplate,
    default_limit: config.defaultHub.defaultLimit,
    default_bitrate: config.defaultHub.defaultBitrate,
    lock_on_create: config.defaultHub.lockOnCreate,
    hide_on_create: config.defaultHub.hideOnCreate,
    cam_off_on_create: config.defaultHub.camOffOnCreate,
  });
  return { category, hub };
}

/* ═══ APPLY DRAFT ═══════════════════════════════════════════════════ */
async function applyDraft(guild, draft) {
  let categoryId = draft.categoryId;
  if (!categoryId || !guild.channels.cache.get(categoryId)) {
    const cat = await guild.channels.create({
      name: config.defaultHub.categoryName,
      type: ChannelType.GuildCategory,
      reason: 'Voxa setup',
    });
    categoryId = cat.id;
  }

  let hub;
  if (draft.isEdit && draft.hubId) {
    db.updateHub(draft.hubId, {
      category_id: categoryId,
      name_template: draft.nameTemplate,
      default_limit: draft.defaultLimit,
      default_bitrate: draft.defaultBitrate,
      lock_on_create: draft.lockOnCreate,
      hide_on_create: draft.hideOnCreate,
      cam_off_on_create: draft.camOffOnCreate,
    });
    hub = db.getHub(draft.hubId);
  } else {
    hub = await guild.channels.create({
      name: config.defaultHub.hubName,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      reason: 'Voxa setup',
    });
    db.createHub({
      hub_id: hub.id,
      guild_id: guild.id,
      category_id: categoryId,
      name_template: draft.nameTemplate,
      default_limit: draft.defaultLimit,
      default_bitrate: draft.defaultBitrate,
      lock_on_create: draft.lockOnCreate,
      hide_on_create: draft.hideOnCreate,
      cam_off_on_create: draft.camOffOnCreate,
    });
  }

  db.patchGuild(guild.id, {
    log_channel_id: draft.logChannelId || null,
    empty_grace_sec: draft.emptyGraceSec || 0,
  });

  return { categoryId, hub };
}

/* ═══ DASHBOARD DATA ════════════════════════════════════════════════ */
function dashboardData(guild) {
  const hubs = db.listHubsByGuild(guild.id);
  return hubs.map((h, i) => {
    const ch = guild.channels.cache.get(h.hub_id);
    const cat = guild.channels.cache.get(h.category_id);
    return {
      id: h.hub_id,
      name: ch?.name || `Hub ${i + 1}`,
      category: cat ? cat.name : '—',
      template: h.name_template,
      limit: h.default_limit,
      status: ch ? 'active' : 'missing',
      missing: !ch,
    };
  });
}

/* ═══ REMOVE / REPAIR ═══════════════════════════════════════════════ */
async function removeHub(guild, hubId) {
  const hub = db.getHub(hubId);
  if (!hub) return { ok: false, msg: 'Hub not found.' };
  const ch = guild.channels.cache.get(hubId);
  if (ch) await ch.delete().catch(() => {});
  db.deleteHub(hubId);
  return { ok: true };
}

async function repairHub(guild, hubId) {
  const hub = db.getHub(hubId);
  if (!hub) return { ok: false, msg: 'Hub not found.' };
  const ch = guild.channels.cache.get(hubId);
  if (ch) return { ok: true };
  const newCh = await guild.channels.create({
    name: config.defaultHub.hubName,
    type: ChannelType.GuildVoice,
    parent: hub.category_id || null,
    reason: 'Voxa repair',
  }).catch(() => null);
  if (!newCh) return { ok: false, msg: 'Could not recreate the hub.' };
  db.deleteHub(hubId);
  db.createHub({
    hub_id: newCh.id,
    guild_id: guild.id,
    category_id: hub.category_id,
    name_template: hub.name_template,
    default_limit: hub.default_limit,
    default_bitrate: hub.default_bitrate,
    lock_on_create: hub.lock_on_create,
    hide_on_create: hub.hide_on_create,
    cam_off_on_create: hub.cam_off_on_create,
  });
  return { ok: true };
}

async function repairAllHubs(guild) {
  const hubs = db.listHubsByGuild(guild.id);
  let repaired = 0;
  for (const h of hubs) {
    const r = await repairHub(guild, h.hub_id).catch(() => ({ ok: false }));
    if (r.ok) repaired++;
  }
  return { repaired };
}

module.exports = {
  getDraft, setDraft, updateDraft, clearDraft, newDraft, draftFromHub,
  healthCheck, quickSetup, applyDraft,
  dashboardData, removeHub, repairHub, repairAllHubs,
};