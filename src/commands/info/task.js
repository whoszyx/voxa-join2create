'use strict';
const config = require('../../../config');
const db = require('../../db');
const ui = require('../../ui');

module.exports = {
  name: 'task',
  category: 'info',
  description: 'Manage your personal focus tasks',
  usage: '.v task [add <text>|done <id>|list|clear]',
  aliases: [],
  examples: ['.v task add Study for exams', '.v task list', '.v task done 3', '.v task clear'],
  gate: 'E',
  needsRoom: false,
  premium: false,
  cooldownMs: 2000,
  async run(ctx) {
    const sub = (ctx.args[0] || 'list').toLowerCase();
    const userId = ctx.member.id;
    const max = db.isPrime(userId) ? config.plans.prime.tasks : config.plans.free.tasks;

    if (sub === 'add') {
      const text = ctx.args.slice(1).join(' ').trim();
      if (!text) return ctx.error('Usage: `.v task add <text>`');
      if (text.length > 200) return ctx.error('Task is too long (max 200 chars).');
      if (db.countOpenTasks(userId) >= max) {
        return ctx.upsell(`More tasks (${config.plans.prime.tasks} slots)`);
      }
      const id = db.addTask(userId, text);
      return ctx.success(`Task **#${id}** added.`);
    }

    if (sub === 'done') {
      const id = parseInt(ctx.args[1], 10);
      if (!id) return ctx.error('Usage: `.v task done <id>`');
      const ok = db.completeTask(userId, id);
      return ok ? ctx.success(`Task **#${id}** done.`) : ctx.error(`No task **#${id}**.`);
    }

    if (sub === 'clear') {
      const n = db.clearTasks(userId);
      return ctx.success(n ? `Cleared ${n} task${n === 1 ? '' : 's'}.` : 'No tasks to clear.');
    }

    const tasks = db.listTasks(userId);
    const open = tasks.filter((t) => !t.done).length;
    const lines = tasks.length
      ? tasks.slice(0, 20).map((t) => `${t.done ? '✅' : '⬜'} **#${t.id}** · ${t.text}`)
      : ['-# No tasks yet. Add one with `.v task add <text>`.'];
    return ctx.reply(ui.card({
      color: ui.colors.purple,
      head: '## ✦ Focus Tasks',
      subtitle: `-# ${open} / ${max} open`,
      body: lines,
      by: ctx.by,
    }));
  },
};