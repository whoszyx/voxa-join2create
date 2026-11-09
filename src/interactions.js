'use strict';

const {
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits: P,
} = require('discord.js');
const config = require('../config');
const db = require('./db');
const ui = require('./ui');
const actions = require('./actions');
const setup = require('./setup');

/* ═══ DISPATCH ══════════════════════════════════════════════════════ */
async function handleInteraction(interaction, client) {
  if (!interaction.inGuild()) return;
  const id = interaction.customId;
  if (!id?.startsWith('vx:')) return;
  const parts = id.split(':');
  const family = parts[1];
  const rest = parts.slice(2);
  try {
    switch (family) {
      case 'room': return await routeRoom(interaction, rest);
      case 'sel': return await routeSelect(interaction, rest);
      case 'mod': return await routeModal(interaction, rest);
      case 'req': return await routeRequest(interaction, rest);
      case 'list': return await routeList(interaction, rest);
      case 'top': return await routeTop(interaction, rest);
      case 'help': return await routeHelp(interaction, rest);
      case 'setup': return await routeSetup(interaction, rest);
      case 'act': return await routeAct(interaction, rest);
      case 'confirm': return await routeConfirm(interaction, rest);
      default: return;
    }
  } catch (e) {
    console.error('Interaction error:', e);
    try {
      const c = ui.error({ msg: 'Something went wrong.', by: interaction.member?.displayName });
      if (interaction.deferred) await interaction.editReply(ui.editV2(c));
      else if (interaction.replied) await interaction.followUp(ui.eph(c));
      else await interaction.reply(ui.eph(c));
    } catch (_) {}
  }
}

/* ═══ UTILS ═════════════════════════════════════════════════════════ */
function denyEphemeral(interaction, msg) {
  return interaction.reply(ui.eph(ui.error({ msg, by: interaction.member?.displayName }))).catch(() => {});
}

function inRoom(interaction) {
  return interaction.member?.voice?.channelId === interaction.channelId;
}

async function updateWithPanel(interaction, state = {}) {
  const c = await ui.panel(interaction.channel, state);
  if (!c) return;
  await interaction.update(ui.editV2(c)).catch(() => {});
}

function buildPicker(interaction, action, title, placeholder) {
  return ui.card({
    color: ui.colors.purple,
    head: `## ✦ ${title}`,
    body: ['-# Select a member from the menu below.'],
    rows: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`vx:sel:${action}:${interaction.user.id}`)
          .setPlaceholder(placeholder)
          .setMinValues(1)
          .setMaxValues(1)
      ),
    ],
    by: interaction.member?.displayName,
  });
}

function buildActivityPicker(interaction) {
  const opts = Object.entries(config.activities).slice(0, 25).map(([key, g]) =>
    new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(key).setEmoji(g.emoji || '🎮')
  );
  return ui.card({
    color: ui.colors.purple,
    head: '## ✦ Start Activity',
    body: ['-# Choose a game to launch.'],
    rows: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`vx:act:run:${interaction.user.id}`)
          .setPlaceholder('Pick a game')
          .addOptions(opts)
      ),
    ],
    by: interaction.member?.displayName,
  });
}

function buildResetConfirm(interaction) {
  return ui.card({
    color: ui.colors.warn,
    head: '## ⚠ Reset room?',
    body: ['This restores hub defaults and clears custom overwrites.'],
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vx:confirm:reset').setLabel('✅ Confirm').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('vx:confirm:cancel').setLabel('✖ Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    by: interaction.member?.displayName,
  });
}

function buildManagerList(interaction) {
  const room = db.getChannel(interaction.channelId);
  if (!room) return ui.error({ msg: 'Room not found.' });
  const managers = db.listRoomManagers(interaction.channelId);
  const items = managers.map((id) => ({
    text: `🤝 <@${id}>`,
    button: new ButtonBuilder()
      .setCustomId(`vx:list:manager:rm:${id}`)
      .setLabel('🗑️')
      .setStyle(ButtonStyle.Secondary),
  }));
  return ui.listCard({
    title: '## ✦ Managers',
    subtitle: `-# ${managers.length} manager${managers.length === 1 ? '' : 's'}`,
    color: ui.colors.purple,
    items,
    extraRows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vx:room:manager_add').setLabel('➕ Add manager').setStyle(ButtonStyle.Primary),
      ),
    ],
    kind: 'manager',
    by: interaction.member?.displayName,
  });
}

/* ═══ ROOM PANEL ════════════════════════════════════════════════════ */
async function routeRoom(interaction, rest) {
  const action = rest[0];

  if (action === 'more') {
    if (!interaction.isStringSelectMenu()) return;
    return await handleMore(interaction);
  }
  if (!interaction.isButton()) return;

  if (!inRoom(interaction)) return denyEphemeral(interaction, 'You need to be in the room.');
  const room = db.getChannel(interaction.channelId);
  if (!room) return denyEphemeral(interaction, 'Not a temporary room.');

  switch (action) {
    case 'lock': {
      const res = await actions.setLock(interaction.member);
      if (!res.ok) return denyEphemeral(interaction, res.msg);
      return await updateWithPanel(interaction, res.state);
    }
    case 'hide': {
      const res = await actions.setHide(interaction.member);
      if (!res.ok) return denyEphemeral(interaction, res.msg);
      return await updateWithPanel(interaction, res.state);
    }
    case 'cam': {
      const res = await actions.toggleCam(interaction.member);
      if (!res.ok) return denyEphemeral(interaction, res.msg);
      return await updateWithPanel(interaction, res.state);
    }
    case 'sb': {
      const res = await actions.toggleSoundboard(interaction.member);
      if (!res.ok) return denyEphemeral(interaction, res.msg);
      return await updateWithPanel(interaction, res.state);
    }
    case 'chatlock': {
      const res = await actions.toggleTextLock(interaction.member);
      if (!res.ok) return denyEphemeral(interaction, res.msg);
      return await updateWithPanel(interaction, res.state);
    }
    case 'claim': {
      await actions.claim(interaction.member);
      return await updateWithPanel(interaction, {});
    }
    case 'pick': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const res = await actions.pickRandom(interaction.member);
      const c = res.ok
        ? ui.card({ color: ui.colors.purple, head: '## 🎲 Pick', body: [res.msg], by: interaction.member?.displayName })
        : ui.error({ msg: res.msg });
      return await interaction.editReply(ui.editV2(c)).catch(() => {});
    }
    case 'limit': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.showModal(ui.modal({
        action: 'limit', title: 'Set capacity',
        label: 'Capacity (0 = unlimited)',
        value: String(interaction.channel.userLimit || 0), maxLength: 3,
      })).catch(() => {});
    }
    case 'rename': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.showModal(ui.modal({
        action: 'rename', title: 'Rename room',
        label: 'New name', value: interaction.channel.name, maxLength: 100,
      })).catch(() => {});
    }
    case 'status': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.showModal(ui.modal({
        action: 'status', title: 'Voice status',
        label: 'Status (empty clears)',
        value: room.status_text || '', maxLength: 500,
      })).catch(() => {});
    }
    case 'permit': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.reply(ui.eph(buildPicker(interaction, 'permit', '✅ Permit', 'Pick a member'))).catch(() => {});
    }
    case 'deny': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.reply(ui.eph(buildPicker(interaction, 'deny', '⛔ Deny', 'Pick a member'))).catch(() => {});
    }
    case 'kick': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.reply(ui.eph(buildPicker(interaction, 'kick', '👢 Kick', 'Pick a member'))).catch(() => {});
    }
    case 'transfer': {
      if (!actions.context(interaction.member, 'owner').ok) return denyEphemeral(interaction, 'Owner only.');
      return interaction.reply(ui.eph(buildPicker(interaction, 'transfer', '🤝 Transfer', 'Pick the new owner'))).catch(() => {});
    }
    case 'manager_add': {
      if (!actions.context(interaction.member, 'owner').ok) return denyEphemeral(interaction, 'Owner only.');
      return interaction.reply(ui.eph(buildPicker(interaction, 'manager_add', '🤝 Add manager', 'Pick a member'))).catch(() => {});
    }
    case 'activity': {
      if (!actions.context(interaction.member, 'manager').ok) return denyEphemeral(interaction, 'Managers only.');
      return interaction.reply(ui.eph(buildActivityPicker(interaction))).catch(() => {});
    }
    case 'reset': {
      if (!actions.context(interaction.member, 'owner').ok) return denyEphemeral(interaction, 'Owner only.');
      return interaction.reply(ui.eph(buildResetConfirm(interaction))).catch(() => {});
    }
    case 'reset_yes': {
      const res = await actions.resetRoom(interaction.member);
      const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
      return interaction.update(ui.editV2(c)).catch(() => {});
    }
    case 'reset_no': {
      return interaction.update(ui.editV2(ui.warn({ msg: 'Cancelled.' }))).catch(() => {});
    }
    default: return;
  }
}

async function handleMore(interaction) {
  if (!inRoom(interaction)) return denyEphemeral(interaction, 'You need to be in the room.');
  const val = interaction.values[0];
  switch (val) {
    case 'protect': {
      const res = await actions.setProtect(interaction.member);
      if (!res.ok) {
        if (res.premium) return interaction.reply(ui.eph(ui.upsell(res.feature, { by: interaction.member?.displayName }))).catch(() => {});
        return denyEphemeral(interaction, res.msg);
      }
      return await updateWithPanel(interaction, {});
    }
    case 'bitrate': {
      const ctx = actions.context(interaction.member, 'manager');
      if (!ctx.ok) return denyEphemeral(interaction, ctx.msg);
      if (!ctx.plan.bitrate) return interaction.reply(ui.eph(ui.upsell('Bitrate control', { by: interaction.member?.displayName }))).catch(() => {});
      return interaction.showModal(ui.modal({
        action: 'bitrate', title: 'Set bitrate', label: 'Bitrate (kbps)',
        value: String(Math.round((interaction.channel.bitrate || 64000) / 1000)), maxLength: 3,
      })).catch(() => {});
    }
    case 'saveprofile': {
      const res = await actions.saveProfile(interaction.member);
      if (!res.ok && res.premium) {
        return interaction.reply(ui.eph(ui.upsell(res.feature, { by: interaction.member?.displayName }))).catch(() => {});
      }
      const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
      return interaction.reply(ui.eph(c)).catch(() => {});
    }
    case 'managers': {
      const ctx = actions.context(interaction.member, 'owner');
      if (!ctx.ok) return denyEphemeral(interaction, ctx.msg);
      return interaction.reply(ui.eph(buildManagerList(interaction))).catch(() => {});
    }
    case 'reset': {
      const ctx = actions.context(interaction.member, 'owner');
      if (!ctx.ok) return denyEphemeral(interaction, ctx.msg);
      return interaction.reply(ui.eph(buildResetConfirm(interaction))).catch(() => {});
    }
    case 'fix': {
      const res = await actions.fixVoice(interaction.member);
      const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
      return interaction.reply(ui.eph(c)).catch(() => {});
    }
    default: return;
  }
}

/* ═══ USER SELECT ═══════════════════════════════════════════════════ */
async function routeSelect(interaction, rest) {
  if (!interaction.isUserSelectMenu()) return;
  const action = rest[0];
  const invokerId = rest[1];
  if (invokerId && invokerId !== interaction.user.id) {
    return interaction.reply(ui.eph(ui.notYours({ by: interaction.member?.displayName }))).catch(() => {});
  }
  if (!inRoom(interaction)) return denyEphemeral(interaction, 'You need to be in the room.');
  const targetId = interaction.values[0];

  await interaction.deferUpdate().catch(() => {});

  let res;
  switch (action) {
    case 'permit': res = await actions.permit(interaction.member, targetId); break;
    case 'deny': res = await actions.deny(interaction.member, targetId); break;
    case 'kick': res = await actions.kick(interaction.member, targetId); break;
    case 'transfer': res = await actions.transfer(interaction.member, targetId); break;
    case 'manager_add': res = await actions.managerAdd(interaction.member, targetId); break;
    case 'manager_rm': res = await actions.managerRemove(interaction.member, targetId); break;
    default: res = { ok: false, msg: 'Unknown action.' };
  }

  if (!res.ok && res.premium) {
    await interaction.editReply(ui.editV2(ui.upsell(res.feature, { by: interaction.member?.displayName }))).catch(() => {});
    return;
  }

  const c = res.ok ? ui.success({ msg: res.msg, by: interaction.member?.displayName }) : ui.error({ msg: res.msg });
  await interaction.editReply(ui.editV2(c)).catch(() => {});
  await actions.refreshPanelNow(interaction.channel).catch(() => {});
}

/* ═══ MODALS ════════════════════════════════════════════════════════ */
async function handleResetdataConfirm(interaction) {
  if (!interaction.member.permissions.has(P.ManageGuild)) {
    return interaction.reply(ui.eph(ui.error({ msg: 'You need **Manage Server**.' }))).catch(() => {});
  }
  const value = interaction.fields.getTextInputValue('value');
  if (value !== 'RESET') {
    return interaction.reply(ui.eph(ui.error({
      msg: 'Typed value did not match `RESET`. Aborted.',
      by: interaction.member?.displayName,
    }))).catch(() => {});
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    db.resetGuildData(interaction.guildId);
    await interaction.editReply(ui.editV2(ui.success({ msg: 'Guild data purged.' }))).catch(() => {});
  } catch (e) {
    console.error('resetdata failed:', e);
    await interaction.editReply(ui.editV2(ui.error({ msg: 'Reset failed.' }))).catch(() => {});
  }
}

async function routeModal(interaction, rest) {
  if (!interaction.isModalSubmit()) return;
  const action = rest[0];
  if (action === 'resetdata_confirm') return handleResetdataConfirm(interaction);

  if (!inRoom(interaction)) return denyEphemeral(interaction, 'You need to be in the room.');
  const value = interaction.fields.getTextInputValue('value');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  let res;
  switch (action) {
    case 'limit': res = await actions.setLimit(interaction.member, value); break;
    case 'rename': res = await actions.rename(interaction.member, value); break;
    case 'status': res = await actions.setStatus(interaction.member, value); break;
    case 'bitrate': res = await actions.setBitrate(interaction.member, value); break;
    default: res = { ok: false, msg: 'Unknown action.' };
  }

  if (!res.ok && res.premium) {
    await interaction.editReply(ui.editV2(ui.upsell(res.feature, { by: interaction.member?.displayName }))).catch(() => {});
    return;
  }

  const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
  await interaction.editReply(ui.editV2(c)).catch(() => {});
  await actions.refreshPanelNow(interaction.channel, res.state || {}).catch(() => {});
}

/* ═══ REQUEST ═══════════════════════════════════════════════════════ */
async function routeRequest(interaction, rest) {
  if (!interaction.isButton()) return;
  const [decision, roomId, requesterId] = rest;
  const room = db.getChannel(roomId);
  if (!room) return interaction.update(ui.editV2(ui.error({ msg: 'Room gone.' }))).catch(() => {});

  const isOwner = room.owner_id === interaction.user.id;
  const isManager = db.isRoomManager(roomId, interaction.user.id);
  if (!isOwner && !isManager) {
    return interaction.reply(ui.eph(ui.notYours({ by: interaction.member?.displayName }))).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});
  const ch = interaction.guild.channels.cache.get(roomId);
  if (!ch) return interaction.editReply(ui.editV2(ui.error({ msg: 'Channel gone.' }))).catch(() => {});

  if (decision === 'ok') {
    await ch.permissionOverwrites.edit(requesterId, { ViewChannel: true, Connect: true }).catch(() => {});
    db.addWhitelist(room.owner_id, requesterId);
    return interaction.editReply(ui.editV2(ui.success({ msg: `✅ Approved · <@${requesterId}>` }))).catch(() => {});
  }
  await ch.permissionOverwrites.edit(requesterId, { ViewChannel: false, Connect: false }).catch(() => {});
  return interaction.editReply(ui.editV2(ui.error({ msg: `❌ Denied · <@${requesterId}>` }))).catch(() => {});
}

/* ═══ LIST (aliases, managers, whitelist, blacklist) ════════════════ */
async function routeList(interaction, rest) {
  if (!interaction.isButton()) return;
  const [kind, op, val] = rest;
  if (op === 'p') return renderListPage(interaction, kind, parseInt(val, 10) || 1);
  if (op === 'rm') return removeFromList(interaction, kind, val);
}

async function renderListPage(interaction, kind, page) {
  const userId = interaction.user.id;
  if (kind === 'alias') {
    const aliases = db.listAliases(userId);
    const max = db.isPrime(userId) ? config.plans.prime.aliases : config.plans.free.aliases;
    const c = ui.aliasCard({ aliases, max, page, perPage: 6, by: interaction.member?.displayName });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }
  if (kind === 'whitelist' || kind === 'blacklist') {
    const list = kind === 'whitelist' ? db.listWhitelist(userId) : db.listBlacklist(userId);
    const perPage = 6;
    const slice = list.slice((page - 1) * perPage, page * perPage);
    const items = slice.map((id) => ({
      text: `👤 <@${id}>`,
      button: new ButtonBuilder()
        .setCustomId(`vx:list:${kind}:rm:${id}`)
        .setLabel('🗑️')
        .setStyle(ButtonStyle.Secondary),
    }));
    const c = ui.listCard({
      title: `## ✦ ${kind === 'whitelist' ? 'Whitelist' : 'Blacklist'}`,
      subtitle: `-# ${list.length} entries`,
      color: kind === 'whitelist' ? ui.colors.green : ui.colors.error,
      items,
      page,
      hasMore: list.length > page * perPage,
      kind,
      by: interaction.member?.displayName,
    });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }
}

async function removeFromList(interaction, kind, val) {
  const userId = interaction.user.id;
  if (kind === 'alias') {
    db.removeAlias(userId, val);
    const max = db.isPrime(userId) ? config.plans.prime.aliases : config.plans.free.aliases;
    const c = ui.aliasCard({ aliases: db.listAliases(userId), max, by: interaction.member?.displayName });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }
  if (kind === 'whitelist') { db.removeWhitelist(userId, val); return renderListPage(interaction, 'whitelist', 1); }
  if (kind === 'blacklist') { db.removeBlacklist(userId, val); return renderListPage(interaction, 'blacklist', 1); }
  if (kind === 'manager') {
    const res = await actions.managerRemove(interaction.member, val);
    const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }
}

/* ═══ TOP LEADERBOARD ═══════════════════════════════════════════════ */
async function routeTop(interaction, rest) {
  if (!interaction.isButton()) return;
  const [kind, dir, pageStr] = rest;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const next = dir === 'next' ? page + 1 : Math.max(1, page - 1);
  const perPage = 10;
  const entries = kind === 'servers'
    ? db.leaderboardGuilds(next, perPage)
    : db.leaderboardUsers(interaction.guildId, next, perPage);
  const c = ui.leaderboard({ kind, entries, page: next, perPage, by: interaction.member?.displayName });
  return interaction.update(ui.editV2(c)).catch(() => {});
}

/* ═══ HELP ══════════════════════════════════════════════════════════ */
async function routeHelp(interaction, rest) {
  if (!interaction.isStringSelectMenu()) return;
  if (rest[0] !== 'cat') return;
  const key = interaction.values[0];
  const registry = require('./commands');
  const cmds = registry.getByCategory(key).filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const meta = registry.listCategories().find((c) => c.key === key);
  const lines = cmds.length
    ? cmds.map((c) => `\`${config.prefix}${c.name}\`${c.premium ? ' · ✨' : ''} — ${c.description}`)
    : ['-# No commands in this category.'];
  const card = ui.card({
    color: ui.colors.purple,
    head: `## ✦ ${meta?.emoji || ''} ${meta?.label || key}`,
    subtitle: `-# ${cmds.length} command${cmds.length === 1 ? '' : 's'}`,
    body: lines,
    by: interaction.member?.displayName,
  });
  return interaction.update(ui.editV2(card)).catch(() => {});
}

/* ═══ SETUP ═════════════════════════════════════════════════════════ */
async function routeSetup(interaction, rest) {
  const step = rest[0];
  const member = interaction.member;
  const isAdmin = member?.permissions?.has(P.ManageGuild);
  const guild = interaction.guild;
  if (!isAdmin) return denyEphemeral(interaction, 'You need **Manage Server**.');

  if (step === 'quick') {
    if (!interaction.isButton()) return;
    await interaction.deferUpdate().catch(() => {});
    const existing = db.listHubsByGuild(guild.id);
    if (existing.length) {
      return interaction.editReply(ui.editV2(ui.warn({ msg: 'Already configured. Use `.v setup` to view the dashboard.' }))).catch(() => {});
    }
    try {
      const { category, hub } = await setup.quickSetup(guild);
      const c = ui.card({
        color: ui.colors.green,
        head: '## ✦ Setup complete',
        body: [
          `📁 **Category** · <#${category.id}>`,
          `🔊 **Hub** · <#${hub.id}>`,
          '-# Join the hub to create a room.',
        ],
        by: member.displayName,
      });
      return interaction.editReply(ui.editV2(c)).catch(() => {});
    } catch (e) {
      return interaction.editReply(ui.editV2(ui.error({ msg: 'Could not complete setup. Check permissions.' }))).catch(() => {});
    }
  }

  if (step === 'custom') {
    if (!interaction.isButton()) return;
    setup.setDraft(interaction.user.id, setup.newDraft());
    return interaction.update(ui.editV2(buildCustomForm(interaction))).catch(() => {});
  }

  if (step === 'confirm') {
    if (!interaction.isButton()) return;
    const draft = setup.getDraft(interaction.user.id);
    if (!draft) return denyEphemeral(interaction, 'Draft expired.');
    await interaction.deferUpdate().catch(() => {});
    try {
      const { hub } = await setup.applyDraft(guild, draft);
      setup.clearDraft(interaction.user.id);
      const c = ui.card({
        color: ui.colors.green,
        head: '## ✦ Setup complete',
        body: [`🔊 **Hub** · <#${hub.hub_id || hub.id}>`],
        by: member.displayName,
      });
      return interaction.editReply(ui.editV2(c)).catch(() => {});
    } catch (_) {
      return interaction.editReply(ui.editV2(ui.error({ msg: 'Could not apply setup.' }))).catch(() => {});
    }
  }

  if (step === 'cancel') {
    setup.clearDraft(interaction.user.id);
    const c = ui.warn({ msg: 'Setup cancelled.', by: member.displayName });
    if (interaction.isButton()) return interaction.update(ui.editV2(c)).catch(() => {});
    return;
  }

  if (step === 'health') {
    if (!interaction.isButton()) return;
    const me = guild.members.me;
    const perms = setup.healthCheck(guild, me);
    const c = ui.setupHealth({ perms, by: member.displayName });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }

  if (step === 'draft') return handleDraftInteraction(interaction, rest);
  if (step === 'dash') return handleDashboard(interaction, rest);
}

function buildCustomForm(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;
  const draft = setup.getDraft(interaction.user.id) || setup.newDraft();
  const maxKbps = Math.floor(guild.maximumBitrate / 1000);

  const catSelect = new ChannelSelectMenuBuilder()
    .setCustomId('vx:setup:draft:category')
    .setPlaceholder('📁 Category')
    .setChannelTypes([ChannelType.GuildCategory])
    .setMinValues(1)
    .setMaxValues(1);

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId('vx:setup:draft:log')
    .setPlaceholder('📋 Log channel (optional)')
    .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
    .setMinValues(0)
    .setMaxValues(1);

  const templates = [
    { label: "✦ {user}'s Room", value: "✦ {user}'s Room" },
    { label: "🎮 {user}'s Place", value: "🎮 {user}'s Place" },
    { label: '🔊 {user}', value: '🔊 {user}' },
    { label: "{user}'s lounge", value: "{user}'s lounge" },
    { label: 'Room #{count}', value: 'Room #{count}' },
  ];
  const tmplSelect = new StringSelectMenuBuilder()
    .setCustomId('vx:setup:draft:template')
    .setPlaceholder('📝 Name template')
    .addOptions(templates.map((t) => new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.value)));

  const limits = [0, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 99];
  const limitSelect = new StringSelectMenuBuilder()
    .setCustomId('vx:setup:draft:limit')
    .setPlaceholder('👥 Default limit')
    .addOptions(limits.map((n) => new StringSelectMenuOptionBuilder().setLabel(n === 0 ? '∞ (unlimited)' : String(n)).setValue(String(n))));

  const bitrates = [32, 48, 64, 80, 96, 128, 192, 256].filter((n) => n <= maxKbps);
  const bitrateSelect = new StringSelectMenuBuilder()
    .setCustomId('vx:setup:draft:bitrate')
    .setPlaceholder('🎚️ Default bitrate')
    .addOptions(bitrates.map((n) => new StringSelectMenuOptionBuilder().setLabel(`${n} kbps`).setValue(String(n))));

  const graceSelect = new StringSelectMenuBuilder()
    .setCustomId('vx:setup:draft:grace')
    .setPlaceholder('⏳ Empty grace')
    .addOptions(
      [0, 10, 30, 60].map((n) => new StringSelectMenuOptionBuilder().setLabel(n === 0 ? 'Immediate' : `${n}s`).setValue(String(n)))
    );

  const toggles = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vx:setup:draft:toggle:lock')
      .setLabel(`🔒 Lock · ${draft.lockOnCreate ? 'on' : 'off'}`)
      .setStyle(draft.lockOnCreate ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:setup:draft:toggle:hide')
      .setLabel(`🙈 Hide · ${draft.hideOnCreate ? 'on' : 'off'}`)
      .setStyle(draft.hideOnCreate ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:setup:draft:toggle:cam')
      .setLabel(`🎥 Cam off · ${draft.camOffOnCreate ? 'on' : 'off'}`)
      .setStyle(draft.camOffOnCreate ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('vx:setup:confirm').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('vx:setup:cancel').setLabel('✖ Cancel').setStyle(ButtonStyle.Secondary),
  );

  return ui.card({
    color: ui.colors.purple,
    head: '## ✦ Custom Setup',
    subtitle: '-# Adjust and confirm',
    body: [
      `📁 **Category** · ${draft.categoryId ? `<#${draft.categoryId}>` : '—'}`,
      `📝 **Template** · \`${draft.nameTemplate}\``,
      `👥 **Limit** · ${draft.defaultLimit || '∞'}`,
      `🎚️ **Bitrate** · ${Math.min(draft.defaultBitrate, maxKbps)} kbps`,
      `⏳ **Grace** · ${draft.emptyGraceSec}s`,
      `📋 **Log** · ${draft.logChannelId ? `<#${draft.logChannelId}>` : '—'}`,
    ],
    rows: [
      new ActionRowBuilder().addComponents(catSelect),
      new ActionRowBuilder().addComponents(tmplSelect),
      new ActionRowBuilder().addComponents(limitSelect),
      new ActionRowBuilder().addComponents(bitrateSelect),
      new ActionRowBuilder().addComponents(graceSelect),
      new ActionRowBuilder().addComponents(logSelect),
      toggles,
    ],
    by: member.displayName,
  });
}

async function handleDraftInteraction(interaction, rest) {
  const field = rest[1];
  const userId = interaction.user.id;

  if (field === 'toggle') {
    if (!interaction.isButton()) return;
    const key = rest[2];
    const draft = setup.getDraft(userId);
    if (!draft) return denyEphemeral(interaction, 'Draft expired.');
    const patch = {};
    if (key === 'lock') patch.lockOnCreate = !draft.lockOnCreate;
    if (key === 'hide') patch.hideOnCreate = !draft.hideOnCreate;
    if (key === 'cam') patch.camOffOnCreate = !draft.camOffOnCreate;
    setup.updateDraft(userId, patch);
    return interaction.update(ui.editV2(buildCustomForm(interaction))).catch(() => {});
  }

  const val = interaction.values?.[0];
  if (!val) return;
  if (field === 'category') setup.updateDraft(userId, { categoryId: val });
  if (field === 'template') setup.updateDraft(userId, { nameTemplate: val });
  if (field === 'limit') setup.updateDraft(userId, { defaultLimit: parseInt(val, 10) });
  if (field === 'bitrate') setup.updateDraft(userId, { defaultBitrate: parseInt(val, 10) });
  if (field === 'grace') setup.updateDraft(userId, { emptyGraceSec: parseInt(val, 10) });
  if (field === 'log') setup.updateDraft(userId, { logChannelId: val });
  return interaction.update(ui.editV2(buildCustomForm(interaction))).catch(() => {});
}

async function handleDashboard(interaction, rest) {
  const sub = rest[1];
  const guild = interaction.guild;
  const member = interaction.member;

  if (sub === 'add') {
    if (!interaction.isButton()) return;
    setup.setDraft(interaction.user.id, setup.newDraft());
    return interaction.update(ui.editV2(buildCustomForm(interaction))).catch(() => {});
  }
  if (sub === 'repair') {
    if (!interaction.isButton()) return;
    await interaction.deferUpdate().catch(() => {});
    const { repaired } = await setup.repairAllHubs(guild).catch(() => ({ repaired: 0 }));
    return interaction.editReply(ui.editV2(ui.success({ msg: `Repaired **${repaired}** hubs.` }))).catch(() => {});
  }
  if (sub === 'edit') {
    const hubId = rest[2];
    const hub = db.getHub(hubId);
    if (!hub) return denyEphemeral(interaction, 'Hub not found.');
    setup.setDraft(interaction.user.id, setup.draftFromHub(hub, guild));
    return interaction.update(ui.editV2(buildCustomForm(interaction))).catch(() => {});
  }
  if (sub === 'remove') {
    const hubId = rest[2];
    if (rest[3] === 'yes') {
      await setup.removeHub(guild, hubId).catch(() => {});
      const hubs = setup.dashboardData(guild);
      return interaction.update(ui.editV2(ui.setupDashboard({ hubs, by: member.displayName }))).catch(() => {});
    }
    return interaction.update(ui.editV2(ui.card({
      color: ui.colors.warn,
      head: '## ⚠ Remove hub?',
      body: ['This deletes the hub channel and its DB row.'],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`vx:setup:dash:remove:${hubId}:yes`).setLabel('✅ Confirm').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('vx:setup:dash:cancel').setLabel('✖ Cancel').setStyle(ButtonStyle.Secondary),
        ),
      ],
      by: member.displayName,
    }))).catch(() => {});
  }
  if (sub === 'cancel') {
    const hubs = setup.dashboardData(guild);
    return interaction.update(ui.editV2(ui.setupDashboard({ hubs, by: member.displayName }))).catch(() => {});
  }
}

/* ═══ ACTIVITY SELECT ═══════════════════════════════════════════════ */
async function routeAct(interaction, rest) {
  if (!interaction.isStringSelectMenu()) return;
  if (rest[0] !== 'run') return;
  const invokerId = rest[1];
  if (invokerId && invokerId !== interaction.user.id) {
    return interaction.reply(ui.eph(ui.notYours({ by: interaction.member?.displayName }))).catch(() => {});
  }
  if (!inRoom(interaction)) return denyEphemeral(interaction, 'You need to be in the room.');
  const gameKey = interaction.values[0];
  await interaction.deferUpdate().catch(() => {});
  const res = await actions.startActivity(interaction.member, gameKey);
  const c = res.ok ? ui.success({ msg: res.msg, by: interaction.member?.displayName }) : ui.error({ msg: res.msg });
  return interaction.editReply(ui.editV2(c)).catch(() => {});
}

/* ═══ CONFIRM ═══════════════════════════════════════════════════════ */
async function routeConfirm(interaction, rest) {
  if (!interaction.isButton()) return;
  const kind = rest[0];

  if (kind === 'resetdata_open') {
    if (!interaction.member.permissions.has(P.ManageGuild)) {
      return denyEphemeral(interaction, 'You need **Manage Server**.');
    }
    const modal = new ModalBuilder()
      .setCustomId('vx:mod:resetdata_confirm')
      .setTitle('Confirm server reset')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Type RESET to confirm')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(5)
            .setPlaceholder('RESET')
        )
      );
    return interaction.showModal(modal).catch(() => {});
  }

  if (kind === 'reset') {
    const res = await actions.resetRoom(interaction.member);
    const c = res.ok ? ui.success({ msg: res.msg }) : ui.error({ msg: res.msg });
    return interaction.update(ui.editV2(c)).catch(() => {});
  }

  if (kind === 'cancel') {
    return interaction.update(ui.editV2(ui.warn({ msg: 'Cancelled.' }))).catch(() => {});
  }
}

module.exports = { handleInteraction };