'use strict';
const actions = require('../../actions');

module.exports = {
  name: 'save',
  category: 'voice',
  description: 'Save the current room settings as your profile (Prime)',
  usage: '.v save',
  aliases: ['saveprofile'],
  examples: ['.v save'],
  gate: 'O',
  needsRoom: true,
  premium: false,
  cooldownMs: 0,
  async run(ctx) {
    const res = await actions.saveProfile(ctx.member);
    if (!res.ok) {
      if (res.premium) return ctx.upsell(res.feature);
      return ctx.error(res.msg);
    }
    await ctx.success(res.msg);
  },
};