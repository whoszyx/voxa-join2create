'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../config');
const db = require('./db');

const C = config.colors;

/* ═══════════════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════════════ */

function footer(by) {
  if (!by) return `-# ${config.botName}`;
  return `-# ${config.botName} · requested by ${by}`;
}

function capacityBar(n, max) {
  if (!max || max <= 0) return '▰▰▰▰▰ ∞';
  const filled = Math.max(0, Math.min(5, Math.ceil((n / max) * 5)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${n}/${max}`;
}

/**
 * Universal card builder.
 *   color    → accent color
 *   head     → "## ✦ Title"
 *   subtitle → "-# something" (second line of header)
 *   thumb    → thumbnail URL (renders as Section accessory)
 *   banner   → banner URL (renders as MediaGallery at top)
 *   body     → array of extra TextDisplay lines
 *   rows     → array of ActionRowBuilders
 *   foot     → string; false to omit; undefined → footer(by)
 *   by       → display name for footer
 */
function card({
  color = C.purple,
  head,
  subtitle,
  thumb,
  banner,
  body = [],
  rows = [],
  foot,
  by,
} = {}) {
  const c = new ContainerBuilder().setAccentColor(color);

  if (banner) {
    try {
      c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(banner)
        )
      );
    } catch (_) {
      /* banner URL invalid — silently skip */
    }
  }

  if (head) {
    const content = subtitle ? `${head}\n${subtitle}` : head;
    if (thumb) {
      const s = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb));
      c.addSectionComponents(s);
    } else {
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
  }

  if (body.length) {
    if (head) c.addSeparatorComponents(new SeparatorBuilder());
    for (const line of body) {
      if (line) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
    }
  }

  if (rows.length) {
    for (const row of rows) c.addActionRowComponents(row);
  }

  if (foot !== false) {
    c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(foot || footer(by)));
  }

  return c;
}

/* ═══════════════════════════════════════════════════════════════════
   RESULT / STATUS PRIMITIVES
   ═══════════════════════════════════════════════════════════════════ */

function result({ ok = true, msg = 'Done.', by } = {}) {
  return card({
    color: ok ? C.green : C.error,
    head: ok ? '## ✦ Done' : '## ✖ Hold on',
    body: [msg],
    by,
  });
}

function error({ msg = 'Something went wrong.', hint, by } = {}) {
  const body = [msg];
  if (hint) body.push(`-# ${hint}`);
  return card({ color: C.error, head: '## ✖ Hold on', body, by });
}

function success({ msg = 'Done.', by } = {}) {
  return card({ color: C.green, head: '## ✦ Done', body: [msg], by });
}

function warn({ msg = 'Heads up.', by } = {}) {
  return card({ color: C.warn, head: '## ⚠ Heads up', body: [msg], by });
}

function working({ msg = 'Working…', by } = {}) {
  return card({ color: C.info, head: '## ⏳ Working', body: [msg], by });
}

function notYours({ by } = {}) {
  return card({
    color: C.error,
    head: '## ✖ Not yours',
    body: ['This control belongs to another request.'],
    by,
  });
}

function eph(container) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

function pub(container) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

function editV2(container) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   UPSELL (Prime)
   ═══════════════════════════════════════════════════════════════════ */

function primePerkLines() {
  const f = config.plans.free;
  const p = config.plans.prime;
  return [
    `📎 **Aliases** · ${f.aliases} → ${p.aliases}`,
    `🤝 **Room managers** · ${f.roomManagers} → ${p.roomManagers}`,
    `🌐 **Global managers** · ${f.globalManagers} → ${p.globalManagers}`,
    `📋 **Whitelist / Blacklist** · ${f.whitelist} → ${p.whitelist}`,
    `👥 **Capacity** · ${f.maxUserLimit} → ${p.maxUserLimit}`,
    `🎚️ **Bitrate control** · ✖ → ✨`,
    `🛡️ **Join protection** · ✖ → ✨`,
    `💾 **Saved profile** · ✖ → ✨`,
    `🎨 **Custom theme color** · ✖ → ✨`,
  ];
}

function upsell(feature, { by } = {}) {
  const rows = [];
  if (config.premiumUrl) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(`✨ Get ${config.premiumName}`)
          .setStyle(ButtonStyle.Link)
          .setURL(config.premiumUrl)
      )
    );
  }
  return card({
    color: C.gold,
    head: `## ✨ ${config.premiumName} feature`,
    subtitle: `-# ${feature}`,
    body: ['Unlock this and more with **' + config.premiumName + '**:', ...primePerkLines()],
    rows,
    by,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   PICKER / MODAL
   ═══════════════════════════════════════════════════════════════════ */

function picker({ action, title, subtitle, placeholder = 'Pick a member', max = 1, by } = {}) {
  const c = card({
    color: C.purple,
    head: `## ✦ ${title}`,
    subtitle,
    body: ['-# Select a member from the menu below.'],
    rows: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`vx:sel:${action}`)
          .setPlaceholder(placeholder)
          .setMinValues(1)
          .setMaxValues(max)
      ),
    ],
    by,
  });
  return c;
}

function modal({ action, title, label, value = '', placeholder, maxLength = 100, style = TextInputStyle.Short }) {
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(label)
    .setStyle(style)
    .setRequired(false)
    .setMaxLength(maxLength)
    .setPlaceholder(placeholder || '')
    .setValue(String(value ?? ''));

  return new ModalBuilder()
    .setCustomId(`vx:mod:${action}`)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/* ═══════════════════════════════════════════════════════════════════
   ROOM PANEL
   ═══════════════════════════════════════════════════════════════════ */

function computeRoomState(channel, stateOverrides = {}) {
  const everyone = channel.guild.roles.everyone.id;
  const ow = channel.permissionOverwrites.cache.get(everyone);
  const locked = !!(ow && ow.deny.has(PermissionFlagsBits.Connect));
  const hidden = !!(ow && ow.deny.has(PermissionFlagsBits.ViewChannel));
  const camOff = !!(ow && ow.deny.has(PermissionFlagsBits.Stream));
  const chatLocked = !!(ow && ow.deny.has(PermissionFlagsBits.SendMessages));
  const sbOff = !!(ow && ow.deny.has(PermissionFlagsBits.UseSoundboard));

  return {
    locked: stateOverrides.locked ?? locked,
    hidden: stateOverrides.hidden ?? hidden,
    camOff: stateOverrides.camOff ?? camOff,
    chatLocked: stateOverrides.chatLocked ?? chatLocked,
    sbOff: stateOverrides.sbOff ?? sbOff,
  };
}

async function panel(channel, stateOverrides = {}) {
  const room = db.getChannel(channel.id);
  if (!room) return null;

  const guild = channel.guild;
  const ownerUser =
    (await guild.client.users.fetch(room.owner_id).catch(() => null)) ||
    guild.members.cache.get(room.owner_id)?.user ||
    null;

  const prime = db.isPrime(room.owner_id);
  const state = computeRoomState(channel, stateOverrides);

  const managers = db.listRoomManagers(channel.id);
  const kbps = Math.round((channel.bitrate || 64000) / 1000);
  const cap = channel.userLimit || 0;
  const members = channel.members.filter((m) => !m.user.bot).size;
  const region = (channel.rtcRegion || 'auto').toLowerCase();
  const statusText = room.status_text || '';

  const accent = state.locked
    ? C.error
    : prime
      ? C.gold
      : C.purple;

  const header = `## ✦ Room Control`;
  const subtitle = `-# ${channel.name}${prime ? ' · ✨ ' + config.premiumName.toUpperCase() : ''}`;

  const lineOwner = `👑 **Owner** · <@${room.owner_id}>`;
  const lineState = `${state.locked ? '🔴 **Locked**' : '🟢 **Open**'} · ${state.hidden ? '🙈 **Hidden**' : '👁️ **Visible**'}`;
  const lineCap = `👥 **Capacity** · ${capacityBar(members, cap || (prime ? config.plans.prime.maxUserLimit : config.plans.free.maxUserLimit))}`;

  const lineVoice = [
    `🎚️ **Bitrate** · ${kbps} kbps`,
    `🌍 **Region** · ${region}`,
    state.camOff ? '🎥 **Cam** · blocked' : '🎥 **Cam** · allowed',
    state.sbOff ? '🎵 **Soundboard** · off' : '🎵 **Soundboard** · on',
    state.chatLocked ? '💬 **Chat** · locked' : '💬 **Chat** · open',
  ].join(' · ');

  const body = [lineOwner, lineState, lineCap, lineVoice];
  if (managers.length) {
    body.push(`🤝 **Managers** · ${managers.map((id) => `<@${id}>`).join(', ')}`);
  }
  if (statusText) {
    body.push(`📝 **Status** · ${statusText}`);
  }
  if (room.protect) {
    body.push('🛡️ **Protect** · enabled');
  }

  /* Row 1 */
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vx:room:lock')
      .setLabel(state.locked ? '🔓 Unlock' : '🔒 Lock')
      .setStyle(state.locked ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('vx:room:hide')
      .setLabel(state.hidden ? '👁️ Show' : '🙈 Hide')
      .setStyle(state.hidden ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:limit')
      .setLabel('👥 Limit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:rename')
      .setLabel('✏️ Rename')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:status')
      .setLabel('📝 Status')
      .setStyle(ButtonStyle.Secondary)
  );

  /* Row 2 */
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vx:room:permit')
      .setLabel('✅ Permit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:deny')
      .setLabel('⛔ Deny')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('vx:room:kick')
      .setLabel('👢 Kick')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:transfer')
      .setLabel('🤝 Transfer')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:claim')
      .setLabel('🙋 Claim')
      .setStyle(ButtonStyle.Secondary)
  );

  /* Row 3 */
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vx:room:cam')
      .setLabel(state.camOff ? '🎥 Allow Cam' : '🎥 Block Cam')
      .setStyle(state.camOff ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:sb')
      .setLabel(state.sbOff ? '🎵 SB On' : '🎵 SB Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:chatlock')
      .setLabel(state.chatLocked ? '💬 Unlock Chat' : '💬 Lock Chat')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:pick')
      .setLabel('🎲 Pick')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('vx:room:activity')
      .setLabel('🎮 Activity')
      .setStyle(ButtonStyle.Primary)
  );

  /* Row 4 */
  const moreSelect = new StringSelectMenuBuilder()
    .setCustomId('vx:room:more')
    .setPlaceholder('✨ More actions…')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Protect')
        .setDescription('Block uninvited joiners')
        .setValue('protect')
        .setEmoji('🛡️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Bitrate')
        .setDescription('Change voice bitrate')
        .setValue('bitrate')
        .setEmoji('🎚️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Save profile')
        .setDescription('Save current settings as default')
        .setValue('saveprofile')
        .setEmoji('💾'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Managers')
        .setDescription('Manage co-hosts')
        .setValue('managers')
        .setEmoji('🤝'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Reset')
        .setDescription('Restore hub defaults')
        .setValue('reset')
        .setEmoji('🔄'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Repair')
        .setDescription('Rebuild overwrites and panel')
        .setValue('fix')
        .setEmoji('🔧')
    );

  const row4 = new ActionRowBuilder().addComponents(moreSelect);

  return card({
    color: accent,
    head: header,
    subtitle,
    thumb: ownerUser ? ownerUser.displayAvatarURL({ extension: 'png', size: 128 }) : undefined,
    body,
    rows: [row1, row2, row3, row4],
    foot: `-# ${config.botName} · .v help for prefix commands`,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   HELP
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Main help card. Phase 4 passes the registry in:
 *   categories: [{ key, label, emoji, commands: [{ name, description, premium }] }]
 * Phase 1 can be called with `categories: []` safely.
 */
function help({ categories = [], activeKey, by } = {}) {
  const active =
    categories.find((c) => c.key === activeKey) || categories[0] || null;

  const selectOptions = categories.length
    ? categories.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setValue(c.key)
          .setEmoji(c.emoji)
      )
    : [
        new StringSelectMenuOptionBuilder()
          .setLabel('Loading…')
          .setValue('_empty')
          .setDescription('Commands load once the registry is ready'),
      ];

  const select = new StringSelectMenuBuilder()
    .setCustomId('vx:help:cat')
    .setPlaceholder(active ? `Category: ${active.label}` : 'Pick a category')
    .addOptions(selectOptions);

  const list = active && active.commands.length
    ? active.commands.map((c) => {
        const tag = c.premium ? ' · ✨' : '';
        return `\`${config.prefix}${c.name}\`${tag} — ${c.description}`;
      })
    : ['-# Commands load in Phase 3.'];

  return card({
    color: C.purple,
    head: '## ✦ Voxa Help',
    subtitle: `-# Prefix \`${config.prefix}\` · use \`${config.prefix}help <command>\` for details`,
    banner: config.bannerUrl || undefined,
    body: list,
    rows: [new ActionRowBuilder().addComponents(select)],
    by,
  });
}

function helpDetail({ cmd, by } = {}) {
  if (!cmd) return error({ msg: 'Command not found.', by });
  const body = [
    `📎 **Usage** · \`${config.prefix}${cmd.usage || cmd.name}\``,
    `🧩 **Aliases** · ${(cmd.aliases || []).map((a) => `\`${a}\``).join(', ') || '—'}`,
    `🔓 **Gate** · ${gateLabel(cmd.gate)}`,
    cmd.premium ? `✨ **${config.premiumName} only**` : '✖ Not ' + config.premiumName,
    cmd.description ? `\n${cmd.description}` : '',
  ];
  if (cmd.examples && cmd.examples.length) {
    body.push('**Examples**');
    for (const ex of cmd.examples) body.push(`\`${ex}\``);
  }
  return card({
    color: cmd.premium ? C.gold : C.purple,
    head: `## ✦ ${config.prefix}${cmd.name}`,
    body: body.filter(Boolean),
    by,
  });
}

function gateLabel(g) {
  return (
    {
      E: 'Everyone',
      A: 'Anyone in a room',
      M: 'Owner / manager',
      O: 'Room owner',
      G: 'Manage Server',
      B: 'Bot owner',
    }[g] || g || '—'
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PRIME / VIP
   ═══════════════════════════════════════════════════════════════════ */

function premiumStatus({ data, isOwner, by } = {}) {
  let status;
  if (isOwner) status = `👑 **Bot Owner** · lifetime ${config.premiumName}`;
  else if (!data) status = `🔒 **Free plan**`;
  else if (data.expires_at === null) status = `✨ **${config.premiumName}** · lifetime`;
  else status = `✨ **${config.premiumName}** · expires <t:${Math.floor(data.expires_at / 1000)}:R>`;

  const rows = [];
  if (config.premiumUrl) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(`✨ Get ${config.premiumName}`)
          .setStyle(ButtonStyle.Link)
          .setURL(config.premiumUrl)
      )
    );
  }

  return card({
    color: C.gold,
    head: `## ✨ ${config.premiumName}`,
    subtitle: `-# Your subscription status`,
    banner: config.bannerUrl || undefined,
    body: [status, '**✦ Plan comparison**', ...primePerkLines()],
    rows,
    by,
  });
}

function vipShowcase({ by } = {}) {
  const rows = [];
  if (config.premiumUrl) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(`✨ Get ${config.premiumName}`)
          .setStyle(ButtonStyle.Link)
          .setURL(config.premiumUrl)
      )
    );
  }
  return card({
    color: C.gold,
    head: `## ✨ ${config.premiumName} Showcase`,
    subtitle: `-# Everything you unlock with ${config.premiumName}`,
    banner: config.bannerUrl || undefined,
    body: primePerkLines(),
    rows,
    by,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   SETUP
   ═══════════════════════════════════════════════════════════════════ */

function setupHealth({ perms = [], by } = {}) {
  const allOk = perms.every((p) => p.ok);
  const lines = perms.map((p) => {
    if (p.ok) return `✅ **${p.name}**`;
    return `❌ **${p.name}** · ${p.fix || 'Grant this permission'}`;
  });

  const rows = [];
  if (allOk) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('vx:setup:quick')
          .setLabel('⚡ Quick Setup')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('vx:setup:custom')
          .setLabel('🛠️ Custom Setup')
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return card({
    color: allOk ? C.green : C.warn,
    head: '## ✦ Setup Health',
    subtitle: allOk ? '-# All clear — pick a mode' : '-# Some permissions need attention',
    body: lines,
    rows,
    by,
  });
}

function setupChoice({ by } = {}) {
  return card({
    color: C.purple,
    head: '## ✦ Setup',
    subtitle: `-# Configure your Join2Create hub`,
    body: [
      '**⚡ Quick** · one-click category + hub with sane defaults.',
      '**🛠️ Custom** · pick category, template, defaults, and toggles.',
    ],
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('vx:setup:quick')
          .setLabel('⚡ Quick Setup')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('vx:setup:custom')
          .setLabel('🛠️ Custom Setup')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('vx:setup:cancel')
          .setLabel('✖ Cancel')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    by,
  });
}

function setupPreview({ draft, guild, by } = {}) {
  const cat = draft.categoryId ? `<#${draft.categoryId}>` : '—';
  const log = draft.logChannelId ? `<#${draft.logChannelId}>` : '—';
  const maxKbps = Math.floor((guild?.maximumBitrate || 96000) / 1000);

  const body = [
    `📁 **Category** · ${cat}`,
    `📝 **Template** · \`${draft.nameTemplate}\``,
    `👥 **Default limit** · ${draft.defaultLimit || '∞'}`,
    `🎚️ **Bitrate** · ${Math.min(draft.defaultBitrate, maxKbps)} kbps`,
    `⏳ **Empty grace** · ${draft.emptyGraceSec}s`,
    `🔒 **Lock on create** · ${draft.lockOnCreate ? '✅' : '✖'}`,
    `🙈 **Hide on create** · ${draft.hideOnCreate ? '✅' : '✖'}`,
    `🎥 **Cam off on create** · ${draft.camOffOnCreate ? '✅' : '✖'}`,
    `📋 **Log channel** · ${log}`,
    `\n**Live preview of a room name**\n> ${draft.nameTemplate.replace(/\{user\}/g, 'Alice').replace(/\{username\}/g, 'alice').replace(/\{count\}/g, '1').replace(/\{hub\}/g, 'Voice Lounge')}`,
  ];

  return card({
    color: C.purple,
    head: '## ✦ Custom Setup',
    subtitle: '-# Configure, then Confirm',
    body,
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('vx:setup:confirm')
          .setLabel('✅ Confirm')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('vx:setup:cancel')
          .setLabel('✖ Cancel')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    by,
  });
}

function setupDashboard({ hubs = [], by } = {}) {
  if (!hubs.length) {
    return card({
      color: C.purple,
      head: '## ✦ Setup Dashboard',
      subtitle: '-# No hubs yet',
      body: ['Press **➕ Add Hub** to create your first one.'],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('vx:setup:dash:add')
            .setLabel('➕ Add Hub')
            .setStyle(ButtonStyle.Primary)
        ),
      ],
      by,
    });
  }

  const body = [];
  const rows = [];

  for (const h of hubs) {
    const st = h.missing ? '⚠️ missing' : h.status === 'active' ? '🟢 active' : '⚪ idle';
    body.push(
      `**${h.name}** · ${st}\n-# category ${h.category || '—'} · template \`${h.template || '—'}\` · limit ${h.limit ?? '∞'}`
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vx:setup:dash:add')
        .setLabel('➕ Add Hub')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('vx:setup:dash:repair')
        .setLabel('🔧 Repair all')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  // Buttons per hub — up to 4
  const perHub = hubs.slice(0, 4);
  for (const h of perHub) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vx:setup:dash:edit:${h.id}`)
          .setLabel(`✏️ Edit · ${h.name}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`vx:setup:dash:remove:${h.id}`)
          .setLabel('🗑️ Remove')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return card({
    color: C.purple,
    head: '## ✦ Setup Dashboard',
    subtitle: `-# ${hubs.length} hub${hubs.length === 1 ? '' : 's'}`,
    body,
    rows,
    by,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   INFO CARDS
   ═══════════════════════════════════════════════════════════════════ */

function roomCard({ channel, room, prime, by } = {}) {
  if (!channel || !room) return error({ msg: 'No room to show.', by });
  const kbps = Math.round((channel.bitrate || 64000) / 1000);
  const cap = channel.userLimit || 0;
  const members = channel.members.filter((m) => !m.user.bot).size;
  const created = `<t:${Math.floor(room.created_at / 1000)}:R>`;

  const state = computeRoomState(channel, {});
  const body = [
    `📺 **Channel** · <#${channel.id}>`,
    `👑 **Owner** · <@${room.owner_id}>`,
    `${state.locked ? '🔴 **Locked**' : '🟢 **Open**'} · ${state.hidden ? '🙈 **Hidden**' : '👁️ **Visible**'}`,
    `👥 **Capacity** · ${capacityBar(members, cap)}`,
    `🎚️ **Bitrate** · ${kbps} kbps`,
    `🌍 **Region** · ${(channel.rtcRegion || 'auto').toLowerCase()}`,
    `📅 **Created** · ${created}`,
    prime ? `✨ **${config.premiumName} room**` : '',
  ].filter(Boolean);

  return card({
    color: prime ? C.gold : state.locked ? C.error : C.purple,
    head: '## ✦ Room Info',
    subtitle: `-# ${channel.name}`,
    body,
    by,
  });
}

function userStats({ user, guildName, stats, rank, tier, savedProfile, openTasks, by } = {}) {
  const hours = ((stats?.seconds || 0) / 3600).toFixed(1);
  const body = [
    `🎙️ **Voice time** · ${hours}h`,
    `📁 **Rooms created** · ${stats?.rooms_created || 0}`,
    `🏆 **Rank** · ${rank ? `#${rank}` : '—'}`,
    `💎 **Tier** · ${tier || 'Free'}`,
    savedProfile
      ? `💾 **Saved profile** · \`${savedProfile.name || '—'}\` · ${savedProfile.user_limit || '∞'} · ${Math.round((savedProfile.bitrate || 0) / 1000)} kbps`
      : `💾 **Saved profile** · none`,
    openTasks ? `📋 **Open tasks** · ${openTasks}` : '',
  ].filter(Boolean);

  return card({
    color: tier && tier !== 'Free' ? C.gold : C.purple,
    head: `## ✦ ${user?.displayName || user?.username || 'You'}`,
    subtitle: guildName ? `-# ${guildName}` : '',
    thumb: user ? user.displayAvatarURL({ extension: 'png', size: 128 }) : undefined,
    body,
    by,
  });
}

function leaderboard({ kind = 'users', entries, page, perPage, by } = {}) {
  const total = entries?.length || 0;
  const start = (page - 1) * perPage + 1;
  const medals = ['🥇', '🥈', '🥉'];
  const lines = (entries || []).map((e, i) => {
    const rank = start + i;
    const icon = medals[rank - 1] || `**#${rank}**`;
    const hrs = ((e.seconds || 0) / 3600).toFixed(1);
    return `${icon} <@${e.id}> · ${hrs}h`;
  });

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vx:top:${kind}:prev:${page}`)
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`vx:top:${kind}:next:${page}`)
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(total < perPage)
  );

  return card({
    color: C.purple,
    head: `## ✦ Top ${kind === 'servers' ? 'Servers' : 'Members'}`,
    subtitle: `-# Page ${page}`,
    body: lines.length ? lines : ['-# No data yet.'],
    rows: [nav],
    by,
  });
}

function ownershipCard({ newOwner, oldOwner, by } = {}) {
  return card({
    color: C.purple,
    head: '## ✦ Ownership transferred',
    body: [
      `👑 **New owner** · <@${newOwner}>`,
      oldOwner ? `-# Previous owner · <@${oldOwner}>` : '-# Previous owner left the room.',
    ],
    by,
  });
}

function logCard({ action, channel, extra, by } = {}) {
  return card({
    color: C.info,
    head: `## 📋 ${action}`,
    body: [`📺 **Channel** · ${channel || '—'}`, extra || ''].filter(Boolean),
    by,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   LIST CARD (paginated, per-row remove buttons)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Build a paginated card.
 *   items:    [{ text, button?: ButtonBuilder }]  — up to `perPage`
 *   kind:     string key used in customIds (`alias`, `whitelist`, etc.)
 *   page:     1-based
 *   hasMore:  true if there could be another page
 *   extraRows: array of extra ActionRows (e.g. [➕ Add])
 */
function listCard({
  title,
  subtitle,
  color = C.purple,
  thumb,
  items = [],
  perPage = 6,
  page = 1,
  hasMore = false,
  kind = 'list',
  extraRows = [],
  by,
} = {}) {
  const c = new ContainerBuilder().setAccentColor(color);

  const headContent = subtitle ? `${title}\n${subtitle}` : title;
  if (thumb) {
    const s = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(headContent))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb));
    c.addSectionComponents(s);
  } else {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(headContent));
  }

  if (items.length) {
    c.addSeparatorComponents(new SeparatorBuilder());
    for (const item of items) {
      if (item.button) {
        const s = new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(item.text))
          .setButtonAccessory(item.button);
        c.addSectionComponents(s);
      } else {
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(item.text));
      }
    }
  } else {
    c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Nothing here yet.'));
  }

  // Pagination
  if (page > 1 || hasMore) {
    const nav = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vx:list:${kind}:p:${page - 1}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`vx:list:${kind}:p:${page + 1}`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasMore)
    );
    c.addActionRowComponents(nav);
  }

  for (const r of extraRows) c.addActionRowComponents(r);

  c.addSeparatorComponents(new SeparatorBuilder());
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer(by)));

  return c;
}

function aliasCard({ aliases, max, page = 1, perPage = 6, by } = {}) {
  const used = aliases.length;
  const filled = Math.min(5, Math.round((used / max) * 5));
  const slotsBar = `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${used}/${max}`;

  const slice = aliases.slice((page - 1) * perPage, page * perPage);
  const items = slice.map((a) => ({
    text: `\`${a.alias}\` → \`${a.command}\``,
    button: new ButtonBuilder()
      .setCustomId(`vx:list:alias:rm:${a.alias}`)
      .setLabel('🗑️')
      .setStyle(ButtonStyle.Secondary),
  }));

  return listCard({
    title: '## ✦ Your Aliases',
    subtitle: `-# Slots · ${slotsBar}`,
    color: C.purple,
    items,
    page,
    hasMore: aliases.length > page * perPage,
    kind: 'alias',
    by,
  });
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  /* constants */
  colors: C,

  /* primitives */
  card,
  footer,
  capacityBar,

  /* results */
  result,
  error,
  success,
  warn,
  working,
  notYours,
  upsell,

  /* wrappers */
  eph,
  pub,
  editV2,

  /* forms */
  picker,
  modal,

  /* room */
  panel,
  computeRoomState,

  /* help */
  help,
  helpDetail,
  gateLabel,

  /* prime */
  premiumStatus,
  vipShowcase,

  /* setup */
  setupHealth,
  setupChoice,
  setupPreview,
  setupDashboard,

  /* info */
  roomCard,
  userStats,
  leaderboard,
  ownershipCard,
  logCard,

  /* lists */
  listCard,
  aliasCard,
};