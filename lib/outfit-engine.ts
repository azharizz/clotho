export type Category = 'tops' | 'bottoms' | 'shoes' | 'headwear';

export type WardrobeItem = {
  id: string;
  category: Category;
  name: string;
  color: string;
  style: string;
  sourceGrid: string;
  file: string;
};

export type Occasion = 'work' | 'casual' | 'dinner' | 'event';
export type Palette = 'balanced' | 'neutral' | 'colorful';

export type Preferences = {
  palette: Palette;
  includeHeadwear: boolean;
  avoid: string;
  note: string;
};

export type Outfit = {
  id: string;
  title: string;
  occasion: Occasion;
  score: number;
  reason: string;
  items: WardrobeItem[];
};

const neutralWords = ['black', 'white', 'ivory', 'cream', 'gray', 'charcoal', 'navy', 'beige', 'stone', 'tan', 'silver'];
const warmWords = ['red', 'burgundy', 'orange', 'rust', 'coral', 'yellow', 'mustard', 'brown', 'pink', 'terracotta', 'plum'];
const coolWords = ['blue', 'green', 'teal', 'lavender', 'purple', 'olive', 'forest', 'emerald', 'cobalt'];

const occasionSignals: Record<Occasion, { good: string[]; bad: string[] }> = {
  work: {
    good: ['tailored', 'shirt', 'blouse', 'trouser', 'loafer', 'flat', 'cardigan', 'polo', 'skirt'],
    bad: ['hoodie', 'jogger', 'running', 'hiking', 'shorts', 'baseball'],
  },
  casual: {
    good: ['denim', 'sneaker', 'hoodie', 'shorts', 'canvas', 'cap', 'jogger', 'knit'],
    bad: [],
  },
  dinner: {
    good: ['satin', 'blouse', 'knit', 'trouser', 'skirt', 'loafer', 'boot', 'flat', 'beret'],
    bad: ['running', 'hiking', 'jogger'],
  },
  event: {
    good: ['satin', 'wrap', 'blouse', 'pleated', 'skirt', 'trouser', 'boot', 'flat', 'loafer', 'fedora'],
    bad: ['running', 'hiking', 'jogger', 'hoodie'],
  },
};

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function colorFamily(color: string) {
  const value = color.toLowerCase();
  if (neutralWords.some((word) => value.includes(word))) return 'neutral';
  if (warmWords.some((word) => value.includes(word))) return 'warm';
  if (coolWords.some((word) => value.includes(word))) return 'cool';
  return 'other';
}

function phrase(item: WardrobeItem) {
  return `${item.name} ${item.color} ${item.style}`.toLowerCase();
}

function scoreItem(
  item: WardrobeItem,
  selected: WardrobeItem[],
  occasion: Occasion,
  preferences: Preferences,
  recentItemIds: string[],
  seed: string,
) {
  const text = phrase(item);
  const signal = occasionSignals[occasion];
  let score = signal.good.some((word) => text.includes(word)) ? 4 : 1;
  if (signal.bad.some((word) => text.includes(word))) score -= 5;
  if (recentItemIds.includes(item.id)) score -= 4;

  const avoid = preferences.avoid.trim().toLowerCase();
  if (avoid && text.includes(avoid)) score -= 100;

  const noteTerms = (preferences.note ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (noteTerms.length) {
    const noteMatches = noteTerms.filter((word) => text.includes(word)).length;
    score += Math.min(6, noteMatches * 2);
  }

  const family = colorFamily(item.color);
  if (preferences.palette === 'neutral' && family === 'neutral') score += 4;
  if (preferences.palette === 'colorful' && family !== 'neutral') score += 3;

  for (const chosen of selected) {
    const chosenFamily = colorFamily(chosen.color);
    if (family === 'neutral' || chosenFamily === 'neutral') score += 3;
    else if (family === chosenFamily) score += 2;
    else score -= 1;
  }

  return score + (hash(`${seed}:${item.id}`) % 100) / 100;
}

function pickBest(
  candidates: WardrobeItem[],
  selected: WardrobeItem[],
  occasion: Occasion,
  preferences: Preferences,
  recentItemIds: string[],
  seed: string,
) {
  return [...candidates].sort(
    (a, b) =>
      scoreItem(b, selected, occasion, preferences, recentItemIds, seed) -
      scoreItem(a, selected, occasion, preferences, recentItemIds, seed),
  )[0];
}

export function buildOutfit(
  items: WardrobeItem[],
  occasion: Occasion,
  preferences: Preferences,
  recentItemIds: string[],
  seed: string,
): Outfit {
  const selected: WardrobeItem[] = [];
  const categories: Category[] = preferences.includeHeadwear
    ? ['tops', 'bottoms', 'shoes', 'headwear']
    : ['tops', 'bottoms', 'shoes'];

  for (const category of categories) {
    const candidates = items.filter((item) => item.category === category);
    const best = pickBest(candidates, selected, occasion, preferences, recentItemIds, `${seed}:${category}`);
    if (best) selected.push(best);
  }

  const neutralCount = selected.filter((item) => colorFamily(item.color) === 'neutral').length;
  const harmony = selected.reduce(
    (total, item) => total + scoreItem(item, selected.filter((other) => other.id !== item.id), occasion, preferences, recentItemIds, seed),
    0,
  );
  const score = Math.max(58, Math.min(97, Math.round(70 + harmony / 5)));
  const tone = neutralCount >= 2 ? 'quiet contrast' : 'confident color';
  const title = `${occasion[0].toUpperCase()}${occasion.slice(1)}, with ${tone}`;

  return {
    id: `look-${hash(`${seed}:${selected.map((item) => item.id).join(':')}`).toString(36)}`,
    title,
    occasion,
    score,
    reason: `${tone}; favors ${occasion} pieces and items outside recent wear history`,
    items: selected,
  };
}

export function buildCustomOutfit(
  items: WardrobeItem[],
  selectedIds: Partial<Record<Category, string>>,
  occasion: Occasion,
  preferences: Preferences,
  recentItemIds: string[],
  seed: string,
): Outfit {
  const selected = (['headwear', 'tops', 'bottoms', 'shoes'] as Category[])
    .map((category) => items.find((item) => item.category === category && item.id === selectedIds[category]))
    .filter((item): item is WardrobeItem => Boolean(item));
  const neutralCount = selected.filter((item) => colorFamily(item.color) === 'neutral').length;
  const harmony = selected.reduce(
    (total, item) => total + scoreItem(item, selected.filter((other) => other.id !== item.id), occasion, preferences, recentItemIds, seed),
    0,
  );
  const score = Math.max(0, Math.min(97, Math.round(70 + harmony / 5)));
  const tone = neutralCount >= 2 ? 'quiet contrast' : 'confident color';

  return {
    id: `look-${hash(`${seed}:${selected.map((item) => item.id).join(':')}`).toString(36)}`,
    title: `${occasion[0].toUpperCase()}${occasion.slice(1)}, curated by you`,
    occasion,
    score,
    reason: `${tone}; hand-selected pieces scored for ${occasion}`,
    items: selected,
  };
}

export function buildOutfitBatch(
  items: WardrobeItem[],
  occasion: Occasion,
  preferences: Preferences,
  recentItemIds: string[],
  count: number,
  seed: string,
) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('count must be an integer from 1 to 12.');
  const results: Outfit[] = [];
  const combinations = new Set<string>();
  for (let attempt = 0; results.length < count && attempt < count * 20; attempt += 1) {
    const outfit = buildOutfit(items, occasion, preferences, recentItemIds, `${seed}:${attempt}`);
    const combination = outfit.items.map((item) => item.id).sort().join(':');
    if (combinations.has(combination)) continue;
    combinations.add(combination);
    results.push(outfit);
  }
  return results;
}
