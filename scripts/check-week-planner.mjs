import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWeekPlanOptions } from '../lib/week-planner.ts';

const manifest = JSON.parse(await readFile(new URL('../public/items/manifest.json', import.meta.url)));
const preferences = { palette: 'balanced', includeHeadwear: true, avoid: '' };
const weatherDays = {
  '2026-09-02': { date: '2026-09-02', low: 18, high: 24, precipitation: 20, code: 2 },
  '2026-09-03': { date: '2026-09-03', low: 17, high: 23, precipitation: 70, code: 63 },
};
const options = buildWeekPlanOptions(
  manifest.items,
  '2026-09-02',
  5,
  ['day'],
  'work',
  [{ date: '2026-09-03', slot: 'day', occasion: 'dinner' }],
  preferences,
  [],
  weatherDays,
  3,
  'check-week',
);
const threeMomentOptions = buildWeekPlanOptions(manifest.items, '2026-09-02', 5, ['morning', 'day', 'evening'], 'work', [], preferences, [], weatherDays, 2, 'check-three');
const constrainedOptions = buildWeekPlanOptions(manifest.items, '2026-09-02', 5, ['day'], 'casual', [], preferences, [], weatherDays, 2, 'check-constraints', { requiredItemIds: ['bottom-01'], excludedItemIds: ['shoes-00'] });

assert.equal(options.length, 3);
assert.equal(options.every((option) => option.entries.length === 5), true);
assert.equal(new Set(options.map((option) => option.entries.map((entry) => entry.outfit.id).join(':'))).size, 3);
assert.equal(options.every((option) => option.entries.some((entry) => entry.date === '2026-09-03' && entry.occasion === 'dinner')), true);
assert.equal(options.every((option) => option.entries.every((entry) => entry.slot === 'day')), true);
assert.equal(options.every((option) => option.conflicts.length + option.tradeoffs.length > 0), true);
assert.equal(threeMomentOptions.every((option) => option.entries.length === 15), true);
assert.equal(threeMomentOptions.every((option) => new Set(option.entries.map((entry) => entry.date)).size === 5), true);
assert.equal(threeMomentOptions.every((option) => [...new Set(option.entries.map((entry) => entry.date))].every((date) => option.entries.filter((entry) => entry.date === date).length <= 3)), true);
assert.equal(constrainedOptions.every((option) => option.entries.every((entry) => entry.outfit.items.some((item) => item.id === 'bottom-01'))), true, 'required items should appear in every weekly entry');
assert.equal(constrainedOptions.every((option) => option.entries.every((entry) => !entry.outfit.items.some((item) => item.id === 'shoes-00'))), true, 'excluded items should stay out of every weekly entry');
assert.throws(() => buildWeekPlanOptions(manifest.items, '2026-09-02', 5, ['day', 'day'], 'work', [], preferences, [], weatherDays, 3, 'bad'), /unique slots/);
assert.throws(() => buildWeekPlanOptions(manifest.items, '2026-09-02', 5, ['day'], 'work', [], preferences, [], weatherDays, 1, 'bad'), /2 or 3/);
console.log(`week planner ok: ${options.length} options, ${options[0].entries.length} entries each`);
