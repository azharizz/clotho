import { buildOutfit, type Occasion, type Outfit, type Preferences, type WardrobeItem } from './outfit-engine.ts';
import type { WeatherDay } from './weather.ts';

export type Daypart = 'morning' | 'day' | 'evening';

export const daypartOrder: Daypart[] = ['morning', 'day', 'evening'];
export const daypartLabels: Record<Daypart, string> = { morning: 'Morning', day: 'Day', evening: 'Evening' };

export type CalendarOccasion = { date: string; slot: Daypart; occasion: Occasion };

export type WeekPlanEntry = {
  date: string;
  slot: Daypart;
  occasion: Occasion;
  outfit: Outfit;
  weather?: WeatherDay;
  score: number;
  reasons: string[];
};

export type WeekPlanOption = {
  id: string;
  label: string;
  score: number;
  entries: WeekPlanEntry[];
  conflicts: string[];
  tradeoffs: string[];
};

const optionLabels = ['Repeat-light', 'Color study', 'Weather-first'];

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('startDate must use YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('startDate must be a real calendar date.');
}

function addDays(date: string, amount: number) {
  const current = new Date(`${date}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + amount);
  return current.toISOString().slice(0, 10);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function itemText(item: WardrobeItem | undefined) {
  return item ? `${item.name} ${item.style}`.toLowerCase() : '';
}

function weatherFit(weather: WeatherDay | undefined, outfit: Outfit, slot: Daypart) {
  if (!weather) return { delta: 0, conflicts: [], tradeoffs: ['No cached weather for this date; the look remains weather-neutral.'] };
  const shoe = outfit.items.find((item) => item.category === 'shoes');
  const top = outfit.items.find((item) => item.category === 'tops');
  const shoeText = itemText(shoe);
  const topText = itemText(top);
  const conflicts: string[] = [];
  const tradeoffs: string[] = [];
  let delta = 0;

  if (weather.precipitation >= 50 && /canvas|sandal|espadrille/i.test(shoeText)) {
    conflicts.push(`${daypartLabels[slot]} forecast: ${weather.precipitation}% rain is a risk for ${shoe?.name ?? 'the selected shoes'}.`);
    delta -= 8;
  } else if (weather.precipitation >= 50) {
    tradeoffs.push(`${weather.precipitation}% rain chance favors the covered footwear in this look.`);
  }
  if (weather.low <= 12 && /camisole|t-shirt|linen|short-sleeve/i.test(topText)) {
    conflicts.push(`Cool start (${weather.low}°) may feel light in ${top?.name ?? 'this top'}.`);
    delta -= 5;
  }
  if (weather.high >= 29 && /hoodie|sweater|cardigan|jacket|shacket|overshirt/i.test(topText)) {
    tradeoffs.push(`Warm high (${weather.high}°) makes the layer in ${top?.name ?? 'this top'} less breathable.`);
    delta -= 3;
  }
  return { delta, conflicts, tradeoffs };
}

function weatherReasons(weather: WeatherDay | undefined) {
  return weather ? [`${weather.low}°–${weather.high}° · ${weather.precipitation}% rain`] : ['Weather not cached for this date'];
}

function occasionsByDate(calendarOccasions: CalendarOccasion[]) {
  return calendarOccasions.reduce<Record<string, CalendarOccasion[]>>((result, entry) => {
    (result[entry.date] ??= []).push(entry);
    return result;
  }, {});
}

export function buildWeekPlanOptions(
  items: WardrobeItem[],
  startDate: string,
  days: number,
  dayparts: Daypart[],
  defaultOccasion: Occasion,
  calendarOccasions: CalendarOccasion[],
  preferences: Preferences,
  recentItemIds: string[],
  weatherDays: Record<string, WeatherDay>,
  optionCount: number,
  seed: string,
): WeekPlanOption[] {
  validDate(startDate);
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('days must be an integer from 1 to 7.');
  if (!dayparts.length || dayparts.length > 3 || new Set(dayparts).size !== dayparts.length) throw new Error('dayparts must contain 1 to 3 unique slots.');
  if (!dayparts.every((slot) => daypartOrder.includes(slot))) throw new Error('dayparts must be morning, day, or evening.');
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 3) throw new Error('optionCount must be 2 or 3.');

  const orderedDayparts = daypartOrder.filter((slot) => dayparts.includes(slot));
  const plannedByDate = occasionsByDate(calendarOccasions);
  const options: WeekPlanOption[] = [];

  for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
    const entries: WeekPlanEntry[] = [];
    const conflicts: string[] = [];
    const tradeoffs: string[] = [];
    const usedItemIds = [...recentItemIds];
    const weekItemUse = new Map<string, number>();
    let totalScore = 0;

    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const date = addDays(startDate, dayIndex);
      const dateOccasions = plannedByDate[date] ?? [];
      for (const slot of orderedDayparts) {
        const calendarOccasion = dateOccasions.find((entry) => entry.slot === slot) ?? dateOccasions[0];
        const nextOccasion = calendarOccasion?.occasion ?? defaultOccasion;
        const outfit = buildOutfit(items, nextOccasion, preferences, usedItemIds, `${seed}:option-${optionIndex}:${date}:${slot}`);
        const weather = weatherDays[date];
        const fit = weatherFit(weather, outfit, slot);
        const repeated = outfit.items.filter((item) => (weekItemUse.get(item.id) ?? 0) > 0);
        if (repeated.length) tradeoffs.push(`${date} ${daypartLabels[slot]} repeats ${repeated.map((item) => item.name).join(', ')}.`);
        for (const item of outfit.items) {
          usedItemIds.push(item.id);
          weekItemUse.set(item.id, (weekItemUse.get(item.id) ?? 0) + 1);
        }
        conflicts.push(...fit.conflicts.map((message) => `${date} · ${message}`));
        tradeoffs.push(...fit.tradeoffs.map((message) => `${date} · ${message}`));
        const score = Math.max(0, outfit.score + fit.delta - repeated.length * 2);
        totalScore += score;
        entries.push({
          date,
          slot,
          occasion: nextOccasion,
          outfit,
          weather,
          score,
          reasons: [outfit.reason, ...weatherReasons(weather), ...(calendarOccasion ? ['Existing calendar occasion retained.'] : [])],
        });
      }
    }

    const repeatedItems = [...weekItemUse.values()].filter((count) => count > 1).length;
    if (repeatedItems) tradeoffs.push(`${repeatedItems} wardrobe pieces repeat to keep the plan feasible.`);
    if (calendarOccasions.some((entry) => entries.some((planned) => planned.date === entry.date))) tradeoffs.push('Existing calendar occasions are kept where they overlap this window.');
    options.push({
      id: `week-${optionIndex + 1}-${startDate}`,
      label: `Option ${optionIndex + 1} · ${optionLabels[optionIndex]}`,
      score: Math.round(totalScore / entries.length),
      entries,
      conflicts: unique(conflicts).slice(0, 8),
      tradeoffs: unique(tradeoffs).slice(0, 8),
    });
  }
  return options;
}
