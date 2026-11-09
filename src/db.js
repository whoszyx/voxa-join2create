'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

/* ── File & pragmas ───────────────────────────────────────────────── */
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'voxa.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS guilds (
  guild_id        TEXT PRIMARY KEY,
  log_channel_id  TEXT,
  panel_enabled   INTEGER NOT NULL DEFAULT 1,
  empty_grace_sec INTEGER NOT NULL DEFAULT 0,
  theme_color     INTEGER
);

CREATE TABLE IF NOT EXISTS hubs (
  hub_id           TEXT PRIMARY KEY,
  guild_id         TEXT NOT NULL,
  category_id      TEXT,
  name_template    TEXT NOT NULL,
  default_limit    INTEGER NOT NULL DEFAULT 0,
  default_bitrate  INTEGER NOT NULL DEFAULT 64,
  lock_on_create   INTEGER NOT NULL DEFAULT 0,
  hide_on_create   INTEGER NOT NULL DEFAULT 0,
  cam_off_on_create INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id  TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  hub_id      TEXT,
  owner_id    TEXT NOT NULL,
  panel_id    TEXT,
  protect     INTEGER NOT NULL DEFAULT 0,
  status_text TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_managers (
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  name       TEXT,
  user_limit INTEGER,
  bitrate    INTEGER,
  locked     INTEGER,
  hidden     INTEGER,
  cam        INTEGER,
  PRIMARY KEY (user_id, guild_id)
);

CREATE TABLE IF NOT EXISTS whitelist (
  user_id   TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS blacklist (
  user_id   TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS global_managers (
  user_id   TEXT NOT NULL,
  target_id TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);

CREATE TABLE IF NOT EXISTS aliases (
  user_id    TEXT NOT NULL,
  alias      TEXT NOT NULL,
  command    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, alias)
);

CREATE TABLE IF NOT EXISTS premium (
  user_id    TEXT PRIMARY KEY,
  expires_at INTEGER,
  granted_by TEXT,
  granted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_stats (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  seconds       INTEGER NOT NULL DEFAULT 0,
  rooms_created INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS banned_names (
  guild_id TEXT NOT NULL,
  word     TEXT NOT NULL,
  PRIMARY KEY (guild_id, word)
);

CREATE TABLE IF NOT EXISTS disabled_commands (
  guild_id TEXT NOT NULL,
  command  TEXT NOT NULL,
  PRIMARY KEY (guild_id, command)
);

CREATE INDEX IF NOT EXISTS idx_channels_guild_owner ON channels(guild_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_aliases_user         ON aliases(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_guild_seconds  ON voice_stats(guild_id, seconds DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user           ON tasks(user_id);
`);

/* ── In-memory caches (write-through) ─────────────────────────────── */
const guildCache = new Map();
const hubCache = new Map();
const hubsByGuild = new Map();
const channelCache = new Map();
const channelOwner = new Map(); // `${guild}:${owner}` → channel_id
const roomManagersCache = new Map();
const whitelistCache = new Map();
const blacklistCache = new Map();
const globalManagersCache = new Map();
const primeCache = new Map(); // user_id → { prime, at }
const aliasCache = new Map(); // user_id → Map<alias, { command, created_at }>
const disabledCache = new Map();
const bannedCache = new Map();

/* ── Hot-path Sets (O(1) voice lookups) ───────────────────────────── */
const hubIds = new Set();
const tempChannelIds = new Set();

/* ── Prepared statements ──────────────────────────────────────────── */
const stmts = {
  /* guilds */
  getGuild: db.prepare('SELECT * FROM guilds WHERE guild_id = ?'),
  listGuilds: db.prepare('SELECT * FROM guilds'),
  upsertGuild: db.prepare(`
    INSERT INTO guilds (guild_id, log_channel_id, panel_enabled, empty_grace_sec, theme_color)
    VALUES (@guild_id, @log_channel_id, @panel_enabled, @empty_grace_sec, @theme_color)
    ON CONFLICT(guild_id) DO UPDATE SET
      log_channel_id  = excluded.log_channel_id,
      panel_enabled   = excluded.panel_enabled,
      empty_grace_sec = excluded.empty_grace_sec,
      theme_color     = excluded.theme_color
  `),
  deleteGuild: db.prepare('DELETE FROM guilds WHERE guild_id = ?'),

  /* hubs */
  getHub: db.prepare('SELECT * FROM hubs WHERE hub_id = ?'),
  listHubsByGuild: db.prepare('SELECT * FROM hubs WHERE guild_id = ? ORDER BY created_at ASC'),
  listHubs: db.prepare('SELECT * FROM hubs'),
  insertHub: db.prepare(`
    INSERT INTO hubs (hub_id, guild_id, category_id, name_template, default_limit, default_bitrate,
                      lock_on_create, hide_on_create, cam_off_on_create, created_at)
    VALUES (@hub_id, @guild_id, @category_id, @name_template, @default_limit, @default_bitrate,
            @lock_on_create, @hide_on_create, @cam_off_on_create, @created_at)
  `),
  updateHub: db.prepare(`
    UPDATE hubs SET
      category_id       = @category_id,
      name_template     = @name_template,
      default_limit     = @default_limit,
      default_bitrate   = @default_bitrate,
      lock_on_create    = @lock_on_create,
      hide_on_create    = @hide_on_create,
      cam_off_on_create = @cam_off_on_create
    WHERE hub_id = @hub_id
  `),
  deleteHub: db.prepare('DELETE FROM hubs WHERE hub_id = ?'),

  /* channels */
  getChannel: db.prepare('SELECT * FROM channels WHERE channel_id = ?'),
  getChannelByOwner: db.prepare('SELECT * FROM channels WHERE guild_id = ? AND owner_id = ? LIMIT 1'),
  listChannels: db.prepare('SELECT * FROM channels'),
  listChannelsByGuild: db.prepare('SELECT * FROM channels WHERE guild_id = ?'),
  insertChannel: db.prepare(`
    INSERT INTO channels (channel_id, guild_id, hub_id, owner_id, panel_id, protect, status_text, created_at)
    VALUES (@channel_id, @guild_id, @hub_id, @owner_id, @panel_id, @protect, @status_text, @created_at)
  `),
  deleteChannel: db.prepare('DELETE FROM channels WHERE channel_id = ?'),
  setPanelId: db.prepare('UPDATE channels SET panel_id = ? WHERE channel_id = ?'),
  setProtect: db.prepare('UPDATE channels SET protect = ? WHERE channel_id = ?'),
  setStatusText: db.prepare('UPDATE channels SET status_text = ? WHERE channel_id = ?'),
  setOwner: db.prepare('UPDATE channels SET owner_id = ? WHERE channel_id = ?'),

  /* room managers */
  listManagers: db.prepare('SELECT user_id FROM room_managers WHERE channel_id = ?'),
  hasManager: db.prepare('SELECT 1 AS x FROM room_managers WHERE channel_id = ? AND user_id = ?'),
  addManager: db.prepare('INSERT OR IGNORE INTO room_managers (channel_id, user_id) VALUES (?, ?)'),
  removeManager: db.prepare('DELETE FROM room_managers WHERE channel_id = ? AND user_id = ?'),
  clearManagers: db.prepare('DELETE FROM room_managers WHERE channel_id = ?'),

  /* whitelist */
  listWhitelist: db.prepare('SELECT target_id FROM whitelist WHERE user_id = ?'),
  hasWhitelist: db.prepare('SELECT 1 AS x FROM whitelist WHERE user_id = ? AND target_id = ?'),
  addWhitelist: db.prepare('INSERT OR IGNORE INTO whitelist (user_id, target_id) VALUES (?, ?)'),
  removeWhitelist: db.prepare('DELETE FROM whitelist WHERE user_id = ? AND target_id = ?'),
  clearWhitelist: db.prepare('DELETE FROM whitelist WHERE user_id = ?'),

  /* blacklist */
  listBlacklist: db.prepare('SELECT target_id FROM blacklist WHERE user_id = ?'),
  hasBlacklist: db.prepare('SELECT 1 AS x FROM blacklist WHERE user_id = ? AND target_id = ?'),
  addBlacklist: db.prepare('INSERT OR IGNORE INTO blacklist (user_id, target_id) VALUES (?, ?)'),
  removeBlacklist: db.prepare('DELETE FROM blacklist WHERE user_id = ? AND target_id = ?'),
  clearBlacklist: db.prepare('DELETE FROM blacklist WHERE user_id = ?'),

  /* global managers */
  listGlobalManagers: db.prepare('SELECT target_id FROM global_managers WHERE user_id = ?'),
  hasGlobalManager: db.prepare('SELECT 1 AS x FROM global_managers WHERE user_id = ? AND target_id = ?'),
  addGlobalManager: db.prepare('INSERT OR IGNORE INTO global_managers (user_id, target_id) VALUES (?, ?)'),
  removeGlobalManager: db.prepare('DELETE FROM global_managers WHERE user_id = ? AND target_id = ?'),
  clearGlobalManagers: db.prepare('DELETE FROM global_managers WHERE user_id = ?'),

  /* profiles */
  getProfile: db.prepare('SELECT * FROM profiles WHERE user_id = ? AND guild_id = ?'),
  saveProfile: db.prepare(`
    INSERT INTO profiles (user_id, guild_id, name, user_limit, bitrate, locked, hidden, cam)
    VALUES (@user_id, @guild_id, @name, @user_limit, @bitrate, @locked, @hidden, @cam)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET
      name = excluded.name,
      user_limit = excluded.user_limit,
      bitrate = excluded.bitrate,
      locked = excluded.locked,
      hidden = excluded.hidden,
      cam = excluded.cam
  `),
  deleteProfile: db.prepare('DELETE FROM profiles WHERE user_id = ? AND guild_id = ?'),

  /* aliases */
  getAlias: db.prepare('SELECT * FROM aliases WHERE user_id = ? AND alias = ?'),
  listAliases: db.prepare('SELECT * FROM aliases WHERE user_id = ? ORDER BY alias ASC'),
  countAliases: db.prepare('SELECT COUNT(*) AS c FROM aliases WHERE user_id = ?'),
  insertAlias: db.prepare('INSERT INTO aliases (user_id, alias, command, created_at) VALUES (?, ?, ?, ?)'),
  updateAlias: db.prepare('UPDATE aliases SET command = ? WHERE user_id = ? AND alias = ?'),
  removeAlias: db.prepare('DELETE FROM aliases WHERE user_id = ? AND alias = ?'),
  clearAliases: db.prepare('DELETE FROM aliases WHERE user_id = ?'),

  /* premium */
  getPremium: db.prepare('SELECT * FROM premium WHERE user_id = ?'),
  upsertPremium: db.prepare(`
    INSERT INTO premium (user_id, expires_at, granted_by, granted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at
  `),
  deletePremium: db.prepare('DELETE FROM premium WHERE user_id = ?'),

  /* voice stats */
  getUserStats: db.prepare('SELECT * FROM voice_stats WHERE guild_id = ? AND user_id = ?'),
  leaderboardUsers: db.prepare(
    'SELECT user_id AS id, seconds, rooms_created FROM voice_stats WHERE guild_id = ? AND seconds > 0 ORDER BY seconds DESC LIMIT ? OFFSET ?'
  ),
  leaderboardGuilds: db.prepare(
    'SELECT guild_id AS id, SUM(seconds) AS seconds, SUM(rooms_created) AS rooms_created FROM voice_stats GROUP BY guild_id ORDER BY seconds DESC LIMIT ? OFFSET ?'
  ),
  userRankInGuild: db.prepare(
    'SELECT COUNT(*) + 1 AS rank FROM voice_stats WHERE guild_id = ? AND seconds > (SELECT seconds FROM voice_stats WHERE guild_id = ? AND user_id = ?)'
  ),
  flushVoice: db.prepare(`
    INSERT INTO voice_stats (guild_id, user_id, seconds, rooms_created)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      seconds       = seconds + excluded.seconds,
      rooms_created = rooms_created + excluded.rooms_created
  `),

  /* tasks */
  addTask: db.prepare('INSERT INTO tasks (user_id, text, done, created_at) VALUES (?, ?, 0, ?)'),
  completeTask: db.prepare('UPDATE tasks SET done = 1 WHERE id = ? AND user_id = ?'),
  listTasks: db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY done ASC, created_at DESC'),
  countTasks: db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND done = 0'),
  clearTasks: db.prepare('DELETE FROM tasks WHERE user_id = ?'),

  /* banned names */
  listBanned: db.prepare('SELECT word FROM banned_names WHERE guild_id = ?'),
  addBanned: db.prepare('INSERT OR IGNORE INTO banned_names (guild_id, word) VALUES (?, ?)'),
  removeBanned: db.prepare('DELETE FROM banned_names WHERE guild_id = ? AND word = ?'),

  /* disabled commands */
  listDisabled: db.prepare('SELECT command FROM disabled_commands WHERE guild_id = ?'),
  isDisabled: db.prepare('SELECT 1 AS x FROM disabled_commands WHERE guild_id = ? AND command = ?'),
  disableCommand: db.prepare('INSERT OR IGNORE INTO disabled_commands (guild_id, command) VALUES (?, ?)'),
  enableCommand: db.prepare('DELETE FROM disabled_commands WHERE guild_id = ? AND command = ?'),

  /* reset */
  resetGuildHubs: db.prepare('DELETE FROM hubs WHERE guild_id = ?'),
  resetGuildChannels: db.prepare('DELETE FROM channels WHERE guild_id = ?'),
  resetGuildBanned: db.prepare('DELETE FROM banned_names WHERE guild_id = ?'),
  resetGuildDisabled: db.prepare('DELETE FROM disabled_commands WHERE guild_id = ?'),
  resetGuildVoice: db.prepare('DELETE FROM voice_stats WHERE guild_id = ?'),
};

const txn = {
  flushVoice: db.transaction((entries) => {
    for (const e of entries) {
      stmts.flushVoice.run(e.guild_id, e.user_id, e.seconds | 0, e.rooms_created | 0);
    }
  }),
  resetGuild: db.transaction((guild_id) => {
    stmts.resetGuildChannels.run(guild_id);
    stmts.resetGuildHubs.run(guild_id);
    stmts.resetGuildBanned.run(guild_id);
    stmts.resetGuildDisabled.run(guild_id);
    stmts.resetGuildVoice.run(guild_id);
    stmts.deleteGuild.run(guild_id);
  }),
  deleteRoomTxn: db.transaction((channelId) => {
    stmts.deleteChannel.run(channelId);
  }),
};

/* ── Cache invalidators ───────────────────────────────────────────── */
function invalidatePrime(user_id) {
  primeCache.delete(user_id);
}
function invalidateAliases(user_id) {
  aliasCache.delete(user_id);
}
function invalidateManagers(channelId) {
  roomManagersCache.delete(channelId);
}
function invalidateWhitelist(user_id) {
  whitelistCache.delete(user_id);
}
function invalidateBlacklist(user_id) {
  blacklistCache.delete(user_id);
}
function invalidateGlobalManagers(user_id) {
  globalManagersCache.delete(user_id);
}
function invalidateDisabled(guild_id) {
  disabledCache.delete(guild_id);
}
function invalidateBanned(guild_id) {
  bannedCache.delete(guild_id);
}

/* ── Guild API ────────────────────────────────────────────────────── */
function getGuild(guild_id) {
  if (guildCache.has(guild_id)) return guildCache.get(guild_id);
  const row = stmts.getGuild.get(guild_id) || null;
  if (row) guildCache.set(guild_id, row);
  return row;
}

function upsertGuild({ guild_id, log_channel_id = null, panel_enabled = 1, empty_grace_sec = 0, theme_color = null }) {
  stmts.upsertGuild.run({ guild_id, log_channel_id, panel_enabled, empty_grace_sec, theme_color });
  guildCache.delete(guild_id);
  return getGuild(guild_id);
}

function patchGuild(guild_id, patch) {
  const cur = getGuild(guild_id) || {
    guild_id,
    log_channel_id: null,
    panel_enabled: 1,
    empty_grace_sec: 0,
    theme_color: null,
  };
  return upsertGuild({ ...cur, ...patch, guild_id });
}

function deleteGuild(guild_id) {
  stmts.deleteGuild.run(guild_id);
  guildCache.delete(guild_id);
}

function listGuilds() {
  return stmts.listGuilds.all();
}

/* ── Hub API ──────────────────────────────────────────────────────── */
function getHub(hub_id) {
  if (hubCache.has(hub_id)) return hubCache.get(hub_id);
  const row = stmts.getHub.get(hub_id) || null;
  if (row) hubCache.set(hub_id, row);
  return row;
}

function listHubsByGuild(guild_id) {
  if (hubsByGuild.has(guild_id)) {
    return [...hubsByGuild.get(guild_id)].map((id) => getHub(id)).filter(Boolean);
  }
  const rows = stmts.listHubsByGuild.all(guild_id);
  hubsByGuild.set(guild_id, new Set(rows.map((r) => r.hub_id)));
  for (const r of rows) hubCache.set(r.hub_id, r);
  return rows;
}

function createHub(input) {
  const row = {
    hub_id: input.hub_id,
    guild_id: input.guild_id,
    category_id: input.category_id || null,
    name_template: input.name_template || config.defaultHub.nameTemplate,
    default_limit: input.default_limit ?? config.defaultHub.defaultLimit,
    default_bitrate: input.default_bitrate ?? config.defaultHub.defaultBitrate,
    lock_on_create: input.lock_on_create ? 1 : 0,
    hide_on_create: input.hide_on_create ? 1 : 0,
    cam_off_on_create: input.cam_off_on_create ? 1 : 0,
    created_at: Date.now(),
  };
  stmts.insertHub.run(row);
  hubCache.set(row.hub_id, row);
  hubIds.add(row.hub_id);
  if (!hubsByGuild.has(row.guild_id)) hubsByGuild.set(row.guild_id, new Set());
  hubsByGuild.get(row.guild_id).add(row.hub_id);
  return row;
}

function updateHub(hub_id, patch) {
  const cur = getHub(hub_id);
  if (!cur) return null;
  const merged = {
    ...cur,
    ...patch,
    lock_on_create: (patch.lock_on_create ?? cur.lock_on_create) ? 1 : 0,
    hide_on_create: (patch.hide_on_create ?? cur.hide_on_create) ? 1 : 0,
    cam_off_on_create: (patch.cam_off_on_create ?? cur.cam_off_on_create) ? 1 : 0,
    hub_id,
  };
  stmts.updateHub.run(merged);
  hubCache.set(hub_id, { ...merged });
  return hubCache.get(hub_id);
}

function deleteHub(hub_id) {
  const row = getHub(hub_id);
  stmts.deleteHub.run(hub_id);
  hubCache.delete(hub_id);
  hubIds.delete(hub_id);
  if (row) {
    hubsByGuild.get(row.guild_id)?.delete(hub_id);
  }
}

function isHubChannel(id) {
  return hubIds.has(id);
}

/* ── Channel API ──────────────────────────────────────────────────── */
function getChannel(channel_id) {
  if (channelCache.has(channel_id)) return channelCache.get(channel_id);
  const row = stmts.getChannel.get(channel_id) || null;
  if (row) {
    channelCache.set(channel_id, row);
    tempChannelIds.add(channel_id);
    channelOwner.set(`${row.guild_id}:${row.owner_id}`, channel_id);
  }
  return row;
}

function getChannelByOwner(guild_id, owner_id) {
  const id = channelOwner.get(`${guild_id}:${owner_id}`);
  if (id) return getChannel(id);
  const row = stmts.getChannelByOwner.get(guild_id, owner_id) || null;
  if (row) {
    channelCache.set(row.channel_id, row);
    tempChannelIds.add(row.channel_id);
    channelOwner.set(`${row.guild_id}:${row.owner_id}`, row.channel_id);
  }
  return row;
}

function insertChannel(input) {
  const row = {
    channel_id: input.channel_id,
    guild_id: input.guild_id,
    hub_id: input.hub_id || null,
    owner_id: input.owner_id,
    panel_id: input.panel_id || null,
    protect: input.protect ? 1 : 0,
    status_text: input.status_text || null,
    created_at: Date.now(),
  };
  stmts.insertChannel.run(row);
  channelCache.set(row.channel_id, row);
  tempChannelIds.add(row.channel_id);
  channelOwner.set(`${row.guild_id}:${row.owner_id}`, row.channel_id);
  return row;
}

function deleteChannel(channel_id) {
  const row = getChannel(channel_id);
  txn.deleteRoomTxn(channel_id);
  channelCache.delete(channel_id);
  tempChannelIds.delete(channel_id);
  if (row) channelOwner.delete(`${row.guild_id}:${row.owner_id}`);
  roomManagersCache.delete(channel_id);
}

function setPanelId(channel_id, panel_id) {
  stmts.setPanelId.run(panel_id, channel_id);
  const row = getChannel(channel_id);
  if (row) channelCache.set(channel_id, { ...row, panel_id });
}

function setProtect(channel_id, on) {
  stmts.setProtect.run(on ? 1 : 0, channel_id);
  const row = getChannel(channel_id);
  if (row) channelCache.set(channel_id, { ...row, protect: on ? 1 : 0 });
}

function setStatusText(channel_id, text) {
  stmts.setStatusText.run(text || null, channel_id);
  const row = getChannel(channel_id);
  if (row) channelCache.set(channel_id, { ...row, status_text: text || null });
}

function setOwner(channel_id, owner_id) {
  const row = getChannel(channel_id);
  if (!row) return;
  stmts.setOwner.run(owner_id, channel_id);
  channelOwner.delete(`${row.guild_id}:${row.owner_id}`);
  channelOwner.set(`${row.guild_id}:${owner_id}`, channel_id);
  channelCache.set(channel_id, { ...row, owner_id });
}

function listChannels() {
  return stmts.listChannels.all();
}

function listChannelsByGuild(guild_id) {
  return stmts.listChannelsByGuild.all(guild_id);
}

function isTempChannel(id) {
  return tempChannelIds.has(id);
}

function getOwnerRoomId(guild_id, owner_id) {
  return channelOwner.get(`${guild_id}:${owner_id}`) || null;
}

/* ── Room managers ────────────────────────────────────────────────── */
function listRoomManagers(channel_id) {
  if (roomManagersCache.has(channel_id)) return [...roomManagersCache.get(channel_id)];
  const rows = stmts.listManagers.all(channel_id);
  const set = new Set(rows.map((r) => r.user_id));
  roomManagersCache.set(channel_id, set);
  return [...set];
}

function isRoomManager(channel_id, user_id) {
  if (roomManagersCache.has(channel_id)) {
    return roomManagersCache.get(channel_id).has(user_id);
  }
  return !!stmts.hasManager.get(channel_id, user_id);
}

function addRoomManager(channel_id, user_id) {
  stmts.addManager.run(channel_id, user_id);
  roomManagersCache.get(channel_id)?.add(user_id);
  invalidateManagers(channel_id);
}

function removeRoomManager(channel_id, user_id) {
  stmts.removeManager.run(channel_id, user_id);
  roomManagersCache.get(channel_id)?.delete(user_id);
  invalidateManagers(channel_id);
}

function clearRoomManagers(channel_id) {
  stmts.clearManagers.run(channel_id);
  invalidateManagers(channel_id);
}

/* ── Whitelist ────────────────────────────────────────────────────── */
function _loadSimpleList(cache, stmt, user_id) {
  if (cache.has(user_id)) return [...cache.get(user_id)];
  const rows = stmt.all(user_id);
  const set = new Set(rows.map((r) => r.target_id || r.word));
  cache.set(user_id, set);
  return [...set];
}

function listWhitelist(user_id) {
  return _loadSimpleList(whitelistCache, stmts.listWhitelist, user_id);
}
function hasWhitelist(user_id, target_id) {
  if (whitelistCache.has(user_id)) return whitelistCache.get(user_id).has(target_id);
  return !!stmts.hasWhitelist.get(user_id, target_id);
}
function addWhitelist(user_id, target_id) {
  stmts.addWhitelist.run(user_id, target_id);
  invalidateWhitelist(user_id);
}
function removeWhitelist(user_id, target_id) {
  stmts.removeWhitelist.run(user_id, target_id);
  invalidateWhitelist(user_id);
}
function clearWhitelist(user_id) {
  stmts.clearWhitelist.run(user_id);
  invalidateWhitelist(user_id);
}

/* ── Blacklist ────────────────────────────────────────────────────── */
function listBlacklist(user_id) {
  return _loadSimpleList(blacklistCache, stmts.listBlacklist, user_id);
}
function hasBlacklist(user_id, target_id) {
  if (blacklistCache.has(user_id)) return blacklistCache.get(user_id).has(target_id);
  return !!stmts.hasBlacklist.get(user_id, target_id);
}
function addBlacklist(user_id, target_id) {
  stmts.addBlacklist.run(user_id, target_id);
  invalidateBlacklist(user_id);
}
function removeBlacklist(user_id, target_id) {
  stmts.removeBlacklist.run(user_id, target_id);
  invalidateBlacklist(user_id);
}
function clearBlacklist(user_id) {
  stmts.clearBlacklist.run(user_id);
  invalidateBlacklist(user_id);
}

/* ── Global managers ──────────────────────────────────────────────── */
function listGlobalManagers(user_id) {
  return _loadSimpleList(globalManagersCache, stmts.listGlobalManagers, user_id);
}
function hasGlobalManager(user_id, target_id) {
  if (globalManagersCache.has(user_id)) return globalManagersCache.get(user_id).has(target_id);
  return !!stmts.hasGlobalManager.get(user_id, target_id);
}
function addGlobalManager(user_id, target_id) {
  stmts.addGlobalManager.run(user_id, target_id);
  invalidateGlobalManagers(user_id);
}
function removeGlobalManager(user_id, target_id) {
  stmts.removeGlobalManager.run(user_id, target_id);
  invalidateGlobalManagers(user_id);
}
function clearGlobalManagers(user_id) {
  stmts.clearGlobalManagers.run(user_id);
  invalidateGlobalManagers(user_id);
}

/* ── Profiles ─────────────────────────────────────────────────────── */
function getProfile(user_id, guild_id) {
  return stmts.getProfile.get(user_id, guild_id) || null;
}
function saveProfile(p) {
  stmts.saveProfile.run(p);
}
function deleteProfile(user_id, guild_id) {
  stmts.deleteProfile.run(user_id, guild_id);
}

/* ── Aliases ──────────────────────────────────────────────────────── */
function _loadAliases(user_id) {
  if (aliasCache.has(user_id)) return aliasCache.get(user_id);
  const rows = stmts.listAliases.all(user_id);
  const map = new Map(rows.map((r) => [r.alias, { command: r.command, created_at: r.created_at }]));
  aliasCache.set(user_id, map);
  return map;
}

function getAlias(user_id, alias) {
  const map = _loadAliases(user_id);
  const hit = map.get(alias);
  if (hit) return { user_id, alias, command: hit.command, created_at: hit.created_at };
  return stmts.getAlias.get(user_id, alias) || null;
}
function listAliases(user_id) {
  const map = _loadAliases(user_id);
  return [...map.entries()]
    .map(([alias, v]) => ({ user_id, alias, command: v.command, created_at: v.created_at }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
function countAliases(user_id) {
  return _loadAliases(user_id).size;
}
function addAlias(user_id, alias, command, max) {
  const map = _loadAliases(user_id);
  if (map.has(alias)) {
    stmts.updateAlias.run(command, user_id, alias);
    invalidateAliases(user_id);
    return { ok: true, updated: true };
  }
  if (map.size >= max) return { ok: false, reason: 'limit', max };
  stmts.insertAlias.run(user_id, alias, command, Date.now());
  invalidateAliases(user_id);
  return { ok: true, updated: false };
}
function removeAlias(user_id, alias) {
  const res = stmts.removeAlias.run(user_id, alias);
  invalidateAliases(user_id);
  return res.changes > 0;
}
function clearAliases(user_id) {
  const res = stmts.clearAliases.run(user_id);
  invalidateAliases(user_id);
  return res.changes;
}

/* ── Premium ──────────────────────────────────────────────────────── */
function getPremium(user_id) {
  const row = stmts.getPremium.get(user_id);
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= Date.now()) return null;
  return row;
}

function isPrime(user_id) {
  if (config.ownerIds.includes(user_id)) return true;
  const now = Date.now();
  const cached = primeCache.get(user_id);
  if (cached && now - cached.at < config.primeCacheTtlMs) return cached.prime;
  const prime = !!getPremium(user_id);
  if (primeCache.size > 5000) primeCache.clear();
  primeCache.set(user_id, { prime, at: now });
  return prime;
}

function grantPremium(user_id, durationMs, granted_by) {
  const now = Date.now();
  const cur = stmts.getPremium.get(user_id);
  const active = cur && (cur.expires_at === null || cur.expires_at > now);

  if (durationMs === null) {
    stmts.upsertPremium.run(user_id, null, granted_by, now);
    invalidatePrime(user_id);
    return { ok: true, expires_at: null };
  }
  if (active && cur.expires_at === null) {
    invalidatePrime(user_id);
    return { ok: true, expires_at: null };
  }
  const base = active && cur.expires_at > now ? cur.expires_at : now;
  const expires = base + durationMs;
  stmts.upsertPremium.run(user_id, expires, granted_by, now);
  invalidatePrime(user_id);
  return { ok: true, expires_at: expires };
}

function revokePremium(user_id) {
  stmts.deletePremium.run(user_id);
  invalidatePrime(user_id);
}

/* ── Voice stats ──────────────────────────────────────────────────── */
function getUserStats(guild_id, user_id) {
  return stmts.getUserStats.get(guild_id, user_id) || { seconds: 0, rooms_created: 0 };
}
function userRankInGuild(guild_id, user_id) {
  return stmts.userRankInGuild.get(guild_id, guild_id, user_id)?.rank || 0;
}
function leaderboardUsers(guild_id, page, perPage) {
  const offset = (page - 1) * perPage;
  return stmts.leaderboardUsers.all(guild_id, perPage, offset);
}
function leaderboardGuilds(page, perPage) {
  const offset = (page - 1) * perPage;
  return stmts.leaderboardGuilds.all(perPage, offset);
}
function flushVoiceStats(entries) {
  if (!entries || !entries.length) return;
  txn.flushVoice(entries);
}

/* ── Tasks ────────────────────────────────────────────────────────── */
function addTask(user_id, text) {
  stmts.addTask.run(user_id, String(text).slice(0, 200), Date.now());
  return stmts.listTasks.all(user_id)[0]?.id;
}
function completeTask(user_id, id) {
  const res = stmts.completeTask.run(id, user_id);
  return res.changes > 0;
}
function listTasks(user_id) {
  return stmts.listTasks.all(user_id);
}
function countOpenTasks(user_id) {
  return stmts.countTasks.get(user_id).c;
}
function clearTasks(user_id) {
  const res = stmts.clearTasks.run(user_id);
  return res.changes;
}

/* ── Banned names ─────────────────────────────────────────────────── */
function listBannedNames(guild_id) {
  return _loadSimpleList(bannedCache, { all: () => stmts.listBanned.all(guild_id) }, guild_id);
}
function addBannedName(guild_id, word) {
  stmts.addBanned.run(guild_id, String(word).toLowerCase());
  invalidateBanned(guild_id);
}
function removeBannedName(guild_id, word) {
  stmts.removeBanned.run(guild_id, String(word).toLowerCase());
  invalidateBanned(guild_id);
}
function hasBannedWord(guild_id, text) {
  if (!text) return false;
  const words = listBannedNames(guild_id);
  if (!words.length) return false;
  const low = String(text).toLowerCase();
  // block discord invites by default too
  if (/(?:discord\.gg|discordapp\.com\/invite|discord\.com\/invite)\//i.test(low)) return true;
  return words.some((w) => w && low.includes(w));
}

/* ── Disabled commands ────────────────────────────────────────────── */
function listDisabled(guild_id) {
  return _loadSimpleList(disabledCache, { all: () => stmts.listDisabled.all(guild_id) }, guild_id);
}
function isDisabled(guild_id, command) {
  if (disabledCache.has(guild_id)) return disabledCache.get(guild_id).has(command);
  return !!stmts.isDisabled.get(guild_id, command);
}
function disableCommand(guild_id, command) {
  stmts.disableCommand.run(guild_id, command);
  invalidateDisabled(guild_id);
}
function enableCommand(guild_id, command) {
  stmts.enableCommand.run(guild_id, command);
  invalidateDisabled(guild_id);
}

/* ── Guild reset (transactional) ──────────────────────────────────── */
function resetGuildData(guild_id) {
  txn.resetGuild(guild_id);
  guildCache.delete(guild_id);
  hubsByGuild.delete(guild_id);
  invalidateDisabled(guild_id);
  invalidateBanned(guild_id);
  for (const [k, row] of [...channelCache.entries()]) {
    if (row.guild_id === guild_id) {
      channelCache.delete(k);
      tempChannelIds.delete(k);
      channelOwner.delete(`${row.guild_id}:${row.owner_id}`);
      roomManagersCache.delete(k);
    }
  }
  for (const [id, row] of [...hubCache.entries()]) {
    if (row.guild_id === guild_id) {
      hubCache.delete(id);
      hubIds.delete(id);
    }
  }
}

/* ── Warm (startup sweep) ─────────────────────────────────────────── */
function warm() {
  guildCache.clear();
  hubCache.clear();
  hubsByGuild.clear();
  channelCache.clear();
  channelOwner.clear();
  hubIds.clear();
  tempChannelIds.clear();

  for (const g of stmts.listGuilds.all()) guildCache.set(g.guild_id, g);
  for (const h of stmts.listHubs.all()) {
    hubCache.set(h.hub_id, h);
    hubIds.add(h.hub_id);
    if (!hubsByGuild.has(h.guild_id)) hubsByGuild.set(h.guild_id, new Set());
    hubsByGuild.get(h.guild_id).add(h.hub_id);
  }
  for (const c of stmts.listChannels.all()) {
    channelCache.set(c.channel_id, c);
    tempChannelIds.add(c.channel_id);
    channelOwner.set(`${c.guild_id}:${c.owner_id}`, c.channel_id);
  }
}

function stats() {
  return `${guildCache.size} guilds · ${hubCache.size} hubs · ${channelCache.size} temp rooms`;
}

function close() {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  try { db.close(); } catch (_) {}
}

/* ── Exports ──────────────────────────────────────────────────────── */
module.exports = {
  /* guild */
  getGuild, upsertGuild, patchGuild, deleteGuild, listGuilds,
  /* hubs */
  getHub, listHubsByGuild, createHub, updateHub, deleteHub, isHubChannel,
  /* channels */
  getChannel, getChannelByOwner, insertChannel, deleteChannel,
  setPanelId, setProtect, setStatusText, setOwner,
  listChannels, listChannelsByGuild, isTempChannel, getOwnerRoomId,
  /* room managers */
  listRoomManagers, isRoomManager, addRoomManager, removeRoomManager, clearRoomManagers,
  /* whitelist / blacklist */
  listWhitelist, hasWhitelist, addWhitelist, removeWhitelist, clearWhitelist,
  listBlacklist, hasBlacklist, addBlacklist, removeBlacklist, clearBlacklist,
  /* global managers */
  listGlobalManagers, hasGlobalManager, addGlobalManager, removeGlobalManager, clearGlobalManagers,
  /* profiles */
  getProfile, saveProfile, deleteProfile,
  /* aliases */
  getAlias, listAliases, countAliases, addAlias, removeAlias, clearAliases,
  /* premium */
  getPremium, isPrime, grantPremium, revokePremium, invalidatePrime,
  /* voice stats */
  getUserStats, userRankInGuild, leaderboardUsers, leaderboardGuilds, flushVoiceStats,
  /* tasks */
  addTask, completeTask, listTasks, countOpenTasks, clearTasks,
  /* banned names */
  listBannedNames, addBannedName, removeBannedName, hasBannedWord,
  /* disabled commands */
  listDisabled, isDisabled, disableCommand, enableCommand,
  /* reset / lifecycle */
  resetGuildData, warm, stats, close,
  /* raw */
  _db: db,
};