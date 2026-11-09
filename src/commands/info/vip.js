'use strict';
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');
const actions = require('../../actions');

const DURATIONS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 };

module.exports = {
  name: 'vip',
  category: 'info',
  description: 'View or manage Prime subscription',
  longDescription:
    'Owners can grant/revoke Prime. Durations: 30d, 2w, 12h, 1m (30 days), or lifetime. Grants stack; lifetime wins.',
  usage: '.v vip [grant|revoke @user <duration>]',
  aliases: ['subscription', 'sub', 'premium', 'prime'],
  examples: ['.v vip', '.v vip grant @user 30d', '.v vip revoke @user', '.v vip grant @user lifetime'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const sub = (ctx.args[0] || '').toLowerCase();

    if (sub === 'grant' || sub === 'revoke') {
      if (!config.ownerIds.includes(ctx.member.id)) {
        return ctx.error('Only bot owners can grant or revoke Prime.');
      }
      const target = await actions.resolveMember(ctx.guild, ctx.args[1]);
      if (!target) return ctx.error('Mention a user or give an ID.');

      if (sub === 'revoke') {
        db.revokePremium(target.id);
        return ctx.success(`Prime revoked from <@${target.id}>.`);
      }

      const dur = (ctx.args[2] || '').toLowerCase();
      let ms;
      if (dur === 'lifetime') ms = null;
      else {
        const m = dur.match(/^(\d+)([hdwm])$/);
        if (!m) {
          return ctx.error('Duration must look like `30d`, `2w`, `12h`, `1m`, or `lifetime`.');
        }
        const n = parseInt(m[1], 10);
        ms = Math.max(1, Math.floor(n * DURATIONS[m[2]]));
      }
      const res = db.grantPremium(target.id, ms, ctx.member.id);
      const when = res.expires_at === null ? '**lifetime**' : `<t:${Math.floor(res.expires_at / 1000)}:R>`;
      return ctx.success(`Prime granted to <@${target.id}> · ${when}.`);
    }

    const data = db.getPremium(ctx.member.id);
    const isOwner = config.ownerIds.includes(ctx.member.id);
    return ctx.reply(ui.premiumStatus({ data, isOwner, by: ctx.by }));
  },
};