import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOutfit, buildOutfitBatch } from '../lib/outfit-engine.ts';

const manifest = JSON.parse(await readFile(new URL('../public/items/manifest.json', import.meta.url)));
const preferences = { palette: 'balanced', includeHeadwear: true, avoid: '' };
const first = buildOutfit(manifest.items, 'work', preferences, [], '2026-09-02');
const repeated = buildOutfit(manifest.items, 'work', preferences, [], '2026-09-02');
const noHat = buildOutfit(manifest.items, 'casual', { ...preferences, includeHeadwear: false }, [], '2026-09-03');
const historyAware = buildOutfit(manifest.items, 'work', preferences, first.items.map((item) => item.id), '2026-09-02');

assert.equal(first.items.length, 4);
assert.deepEqual(first, repeated, 'same inputs must produce the same outfit');
assert.notDeepEqual(historyAware.items.map((item) => item.id), first.items.map((item) => item.id), 'wear history should lower recently worn items');
assert.equal(noHat.items.length, 3);
assert.deepEqual(noHat.items.map((item) => item.category), ['tops', 'bottoms', 'shoes']);
assert.ok(first.score >= 58 && first.score <= 97);
const batch = buildOutfitBatch(manifest.items, 'dinner', preferences, [], 6, 'batch-demo');
const nextBatch = buildOutfitBatch(manifest.items, 'dinner', preferences, [], 6, 'batch-demo-next');
assert.equal(batch.length, 6);
assert.equal(new Set(batch.map((outfit) => outfit.items.map((item) => item.id).sort().join(':'))).size, 6);
assert.notDeepEqual(nextBatch.map((outfit) => outfit.id), batch.map((outfit) => outfit.id), 'different variation seeds should surface a different batch');
assert.throws(() => buildOutfitBatch(manifest.items, 'work', preferences, [], 13, 'bad'), /1 to 12/);
console.log(`engine ok: ${first.id}, ${first.score}/100, ${batch.length} unique batch looks`);
