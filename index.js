'use strict';

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Options,
  MessageFlags,
} = require('discord.js');

const config = require('./config');
const db = require('./src/db');
const ui = require('./src/ui');

if (!process.env.TOKEN) {
  console.error('✖ Missing TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message],
  makeCache: Options.cacheWithLimits({
    MessageManager: 50,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    UserManager: 200,
    GuildMemberManager: 200,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    GuildStickerManager: 10,
    GuildScheduledEventManager: 0,
    StageInstanceManager: 0,
    ThreadMemberManager: 0,
    ApplicationCommandManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 300, lifetime: 1800 },
    users: {
      interval: 3600,
      filter: () => (u) => u.bot && u.id !== client.user?.id,
    },
  },
});

/* ── Ready ────────────────────────────────────────────────────────── */
client.once(Events.ClientReady, async () => {
  console.log(`✦ ${config.botName} online as ${client.user.tag}`);
  try {
    db.warm();
    console.log(`✦ DB warmed · ${db.stats()}`);
  } catch (e) {
    console.error('Warm failed:', e);
  }
  try {
    // Lazy-loaded later phases call voice.sweep here.
    const voice = safeRequire('./src/voice');
    if (voice && typeof voice.sweep === 'function') await voice.sweep(client);
  } catch (_) {
    /* phase 2 */
  }
});

/* ── Message command router (lazy, phase 3+) ──────────────────────── */
client.on(Events.MessageCreate, (message) => {
  const mod = safeRequire('./src/commands');
  if (mod && typeof mod.handleMessage === 'function') {
    mod.handleMessage(message, client).catch((e) => console.error('Message:', e));
  }
});

/* ── Voice state router (lazy, phase 2+) ──────────────────────────── */
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.channelId === newState.channelId) return;
  const mod = safeRequire('./src/voice');
  if (mod && typeof mod.handleVoiceState === 'function') {
    mod.handleVoiceState(oldState, newState).catch((e) => console.error('Voice:', e));
  }
});

/* ── Channel delete router (lazy, phase 2+) ───────────────────────── */
client.on(Events.ChannelDelete, (channel) => {
  try {
    db.deleteChannel(channel.id);
    if (db.isHubChannel(channel.id)) {
      const row = db.getHub(channel.id);
      if (row) db.deleteHub(channel.id);
    }
    const voice = safeRequire('./src/voice');
    if (voice && typeof voice.handleChannelDelete === 'function') {
      Promise.resolve(voice.handleChannelDelete(channel)).catch(() => {});
    }
  } catch (e) {
    console.error('Channel delete:', e);
  }
});

/* ── Interaction router (lazy, phase 2+) ──────────────────────────── */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    const mod = safeRequire('./src/interactions');
    if (mod && typeof mod.handleInteraction === 'function') {
      await mod.handleInteraction(interaction, client);
      return;
    }
    if (interaction.isRepliable()) {
      const c = ui.error({ msg: 'Interactions aren’t wired up yet.', by: 'System' });
      await interaction.reply(ui.eph(c)).catch(() => {});
    }
  } catch (err) {
    console.error('Interaction:', err);
    try {
      if (!interaction.isRepliable()) return;
      const by = interaction.member?.displayName || interaction.user?.username || 'System';
      const c = ui.error({
        msg: 'Something went wrong on my side. Please try again.',
        hint: 'If it keeps happening, ping the bot owner.',
        by,
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      } else {
        await interaction.reply(ui.eph(c));
      }
    } catch (_) {
      /* swallow */
    }
  }
});

/* ── Safe shutdown ────────────────────────────────────────────────── */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`✦ ${signal} — flushing and closing…`);
  try {
    const voice = safeRequire('./src/voice');
    if (voice && typeof voice.flushStats === 'function') voice.flushStats();
  } catch (e) {
    console.error('Flush:', e);
  }
  try {
    db.close();
  } catch (e) {
    console.error('DB close:', e);
  }
  try {
    client.destroy();
  } catch (_) {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* ── Loose error trapping ─────────────────────────────────────────── */
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));

/* ── Lazy require helper ──────────────────────────────────────────── */
const lazyCache = new Map();
function safeRequire(path) {
  if (lazyCache.has(path)) return lazyCache.get(path);
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path);
    lazyCache.set(path, mod);
    return mod;
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(path)) {
      lazyCache.set(path, null);
      return null;
    }
    throw e;
  }
}

client.login(process.env.TOKEN).catch((e) => {
  console.error('Login failed:', e);
  process.exit(1);
});