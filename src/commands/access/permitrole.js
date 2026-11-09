'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'permitrole',
  category: 'access',
  description: 'Permit a role',
  usage: '.v permitrole <@role>',
  aliases: ['allowrole', 'grantrole', 'permit-role', 'pr', 'permrole'],
  examples: ['.v permitrole @Members'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const id = String(ctx.args[0] || '').replace(/[<@&>]/g, '');
    if (!/^\d{16,20}$/.test(id)) return ctx.error('Mention a role or give an ID.');
    const res = await actions.permitRole(ctx.member, id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};