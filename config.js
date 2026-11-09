'use strict';

const OWNER_IDS = (process.env.OWNER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  /* ── Brand ─────────────────────────────────────────────────────── */
  botName: 'Voxa',
  prefix: '.v',
  premiumName: 'Prime',

  bannerUrl: (process.env.BANNER_URL || '').trim(),
  premiumUrl: (process.env.PREMIUM_URL || '').trim(),

  ownerIds: OWNER_IDS,

  /* ── Palette ──────────────────────────────────────────────────── */
  colors: {
    purple: 0x9b8cff,
    green: 0x57f2a7,
    error: 0xff6b81,
    warn: 0xffb86b,
    gold: 0xffc857,
    info: 0x6ec6ff,
  },

  /* ── Timings ──────────────────────────────────────────────────── */
  createCooldownMs: 4000,
  voiceFlushMs: 60_000,
  panelDebounceMs: 1500,
  renameWindowMs: 10 * 60 * 1000,
  renameMaxPerWindow: 2,
  primeCacheTtlMs: 60_000,
  setupDraftTtlMs: 10 * 60 * 1000,

  /* ── Plan limits (enforced server-side) ───────────────────────── */
  plans: {
    free: {
      aliases: 3,
      roomManagers: 2,
      globalManagers: 2,
      whitelist: 5,
      blacklist: 5,
      tasks: 5,
      clearMax: 10,
      maxUserLimit: 25,
      renameCooldownMs: 300_000,
      bitrate: false,
      protect: false,
      profile: false,
      theme: false,
    },
    prime: {
      aliases: 25,
      roomManagers: 8,
      globalManagers: 10,
      whitelist: 50,
      blacklist: 50,
      tasks: 25,
      clearMax: 100,
      maxUserLimit: 99,
      renameCooldownMs: 0,
      bitrate: true,
      protect: true,
      profile: true,
      theme: true,
    },
  },

  /* ── Setup defaults ───────────────────────────────────────────── */
  defaultHub: {
    categoryName: '✦ Voice Lounge',
    hubName: '➕ Join to Create',
    nameTemplate: "✦ {user}'s Room",
    defaultLimit: 0,
    defaultBitrate: 64,
    lockOnCreate: false,
    hideOnCreate: false,
    camOffOnCreate: false,
  },

  /* ── Discord Embedded Applications ────────────────────────────── */
  // https://discord.com/developers/docs/activities/building-an-activity
  // Verify IDs against current docs; failures fall back gracefully.
  activities: {
    'watch together': { id: '880218394199220334', name: 'YouTube Together', emoji: '📺' },
    poker: { id: '755827207812677713', name: 'Poker Night', emoji: '🃏' },
    chess: { id: '832012774040141894', name: 'Chess in the Park', emoji: '♟️' },
    checkers: { id: '832013003968348200', name: 'Checkers in the Park', emoji: '⭕' },
    sketch: { id: '902271654783242291', name: 'Sketch Heads', emoji: '🎨' },
    spellcast: { id: '852509694341283871', name: 'SpellCast', emoji: '🪄' },
    'word snacks': { id: '879863976006127627', name: 'Word Snacks', emoji: '🍬' },
    'letter league': { id: '879863686565621790', name: 'Letter League', emoji: '🔤' },
    'putt party': { id: '945133702979371018', name: 'Putt Party', emoji: '⛳' },
    fishington: { id: '814288819477020702', name: 'Fishington.io', emoji: '🎣' },
    betrayal: { id: '773336526917861400', name: 'Betrayal.io', emoji: '🔪' },
    'land-io': { id: '903769130790969345', name: 'Land-io', emoji: '🌱' },
    awkword: { id: '879863881349087252', name: 'Awkword', emoji: '🤔' },
    'know what i meme': { id: '950505774892683304', name: 'Know What I Meme', emoji: '🖼️' },
    'ask away': { id: '945637998274519111', name: 'Ask Away', emoji: '❓' },
    bobble: { id: '947957217959759964', name: 'Bobble League', emoji: '⚽' },
  },
};