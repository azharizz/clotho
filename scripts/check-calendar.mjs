import assert from 'node:assert/strict';
import { monthCells, shiftMonth } from '../lib/calendar.ts';

const cells = monthCells('2026-09');
assert.equal(cells.length, 42);
assert.equal(cells[0].date, '2026-08-30');
assert.equal(cells[2].date, '2026-09-01');
assert.equal(cells.at(-1).date, '2026-10-10');
assert.equal(cells.filter((cell) => cell.inMonth).length, 30);
assert.equal(shiftMonth('2026-01', -1), '2025-12');
assert.equal(shiftMonth('2026-12', 1), '2027-01');
console.log('calendar ok: September 2026 has 42 visible cells and 30 active days');
