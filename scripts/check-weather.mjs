import assert from 'node:assert/strict';
import { isWeatherCacheFresh, readWeatherCache, weatherDaysFromResponse, writeWeatherCache } from '../lib/weather.ts';

const response = {
  daily: {
    time: ['2026-09-01', '2026-09-02'],
    temperature_2m_max: [28.4, 25.2],
    temperature_2m_min: [20.6, 18.8],
    precipitation_probability_max: [41, 8],
    weather_code: [2, 0],
  },
};
const days = weatherDaysFromResponse(response);
assert.deepEqual(days['2026-09-01'], { date: '2026-09-01', high: 28, low: 21, precipitation: 41, code: 2 });

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const cache = writeWeatherCache(storage, days, 1_000_000);
assert.deepEqual(readWeatherCache(storage), cache);
assert.equal(isWeatherCacheFresh(cache, 1_000_000 + 60_000), true);
assert.equal(isWeatherCacheFresh(cache, 1_000_000 + 7 * 60 * 60 * 1000), false);
console.log('weather ok: daily mapping and six-hour cache');
