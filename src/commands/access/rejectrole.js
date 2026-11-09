'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'rejectrole',
  category: 'access',
  description: 'Reject a role',
  usage: '.v rejectrole <@role>',
  aliases: ['denyrole', 'blockrole', 'reject-role', 'rr', 'rc', 'rrole'],
  examples: ['.v rejectrole @Muted'],
  gate: 'M',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const id = String(ctx.args[0] || '').replace(/[<@&>]/g, '');
    if (!/^\d{16,20}$/.test(id)) return ctx.error('Mention a role or give an ID.');
    const res = await actions.rejectRole(ctx.member, id);
    if (!res.ok) return ctx.error(res.msg);
    await ctx.success(res.msg);
  },
};