export type Category = 'tops' | 'bottoms' | 'shoes' | 'headwear';
export type ColorFamily = 'neutral' | 'warm' | 'cool' | 'mixed' | 'other';
export type OccasionProfile = { formality: number; activity: number; occasions?: Occasion[] };

export type WardrobeItem = {
  id: string;
  category: Category;
  name: string;
  color: string;
  style: string;
  sourceGrid: string;
  file: string;
  occasionProfile?: OccasionProfile;
  variantOf?: string;
  variantColor?: string;
  imageSrc?: string;
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

type BaseColorFamily = Exclude<ColorFamily, 'mixed' | 'other'>;
type ColorComponent = { family: BaseColorFamily; hue: number | null; lightness: number; chroma: number };
export type ColorProfile = { family: ColorFamily; hue: number | null; lightness: number; chroma: number; components: ColorComponent[] };

const namedColorHexes: Record<string, string> = {
  black: '#171717', white: '#ffffff', ivory: '#fffff0', cream: '#f2e8d3', gray: '#8b8b8b', charcoal: '#36454f', navy: '#24324a', beige: '#dfc7a1', stone: '#b8ab99', tan: '#c2a477', silver: '#bfc1c2',
  red: '#cc3344', burgundy: '#7a1f3d', orange: '#ed7d31', rust: '#b7410e', coral: '#ff7f50', yellow: '#e7c24a', mustard: '#c89b2d', brown: '#8b5a3c', pink: '#e792a7', terracotta: '#b85f46', plum: '#75415a',
  blue: '#3e74c9', green: '#4f9d69', teal: '#2f8f8f', lavender: '#ad9bd6', purple: '#7455b8', olive: '#7b8450', forest: '#286a43', emerald: '#2d9a76', cobalt: '#315db4',
  'pale blue': '#9eb6d0', 'mid-wash blue': '#6e93bd', 'forest green': '#286a43', 'olive green': '#7b8450', 'natural tan': '#d3b98a', 'light beige': '#e4d2b7', 'medium brown': '#9a6a4f', 'deep burgundy': '#622037', 'plum purple': '#775073', 'natural straw': '#d9c79e', 'white straw': '#f4edcf',
};

const neutralColorNames = new Set(['black', 'white', 'ivory', 'cream', 'gray', 'charcoal', 'navy', 'beige', 'stone', 'tan', 'silver', 'light beige', 'natural tan', 'natural straw', 'white straw']);

const occasionTargets: Record<Occasion, { formality: number; activity: number }> = {
  work: { formality: 4, activity: 2 },
  casual: { formality: 2, activity: 3 },
  dinner: { formality: 4, activity: 1 },
  event: { formality: 5, activity: 1 },
};

// ponytail: RGB-derived color profiles stay dependency-free; move to OKLCH only if tests or feedback expose perceptual mis-rankings.
function componentFromHex(value: string): ColorComponent | null {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const chroma = maximum - minimum;
  if (!chroma) return { family: 'neutral', hue: null, lightness, chroma };
  let hue = 0;
  if (maximum === red) hue = ((green - blue) / chroma) % 6;
  else if (maximum === green) hue = (blue - red) / chroma + 2;
  else hue = (red - green) / chroma + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  const family: BaseColorFamily = chroma < 0.12 || lightness < 0.18 || lightness > 0.88 ? 'neutral' : hue < 70 || hue >= 330 ? 'warm' : 'cool';
  return { family, hue, lightness, chroma };
}

const namedColorEntries = Object.entries(namedColorHexes).sort(([left], [right]) => right.length - left.length);

function namedColorComponents(value: string) {
  const normalized = value.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const used: Array<[number, number]> = [];
  const matches: Array<{ index: number; end: number; name: string }> = [];
  for (const [name] of namedColorEntries) {
    let from = 0;
    while (from < normalized.length) {
      const index = normalized.indexOf(name, from);
      if (index < 0) break;
      const end = index + name.length;
      const startsClean = index === 0 || !/[a-z]/.test(normalized[index - 1]);
      const endsClean = end === normalized.length || !/[a-z]/.test(normalized[end]);
      if (startsClean && endsClean && !used.some(([start, finish]) => index < finish && end > start)) {
        matches.push({ index, end, name });
        used.push([index, end]);
      }
      from = index + name.length;
    }
  }
  return matches.sort((left, right) => left.index - right.index).map(({ name }) => {
    const component = componentFromHex(namedColorHexes[name]);
    return component && neutralColorNames.has(name) ? { ...component, family: 'neutral' as const } : component;
  }).filter((component): component is ColorComponent => Boolean(component));
}

function averageHue(components: ColorComponent[]) {
  const colored = components.filter((component) => component.hue !== null);
  if (!colored.length) return null;
  const vector = colored.reduce((result, component) => {
    const weight = Math.max(component.chroma, 0.05);
    const radians = (component.hue! * Math.PI) / 180;
    return { x: result.x + Math.cos(radians) * weight, y: result.y + Math.sin(radians) * weight };
  }, { x: 0, y: 0 });
  if (Math.hypot(vector.x, vector.y) < 0.0001) return null;
  const hue = (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
  return hue < 0 ? hue + 360 : hue;
}

export function analyzeColor(color: string): ColorProfile {
  const value = String(color ?? '').toLowerCase();
  const hexes = value.match(/#[0-9a-f]{6}\b/gi) ?? [];
  const components = hexes.length
    ? hexes.map((hex) => componentFromHex(hex)).filter((component): component is ColorComponent => Boolean(component))
    : namedColorComponents(value);
  if (!components.length) return { family: 'other', hue: null, lightness: 0.5, chroma: 0, components: [] };
  const coloredFamilies = new Set(components.filter((component) => component.family !== 'neutral').map((component) => component.family));
  const family: ColorFamily = coloredFamilies.size === 0 ? 'neutral' : coloredFamilies.size === 1 && components.every((component) => component.family !== 'neutral') ? [...coloredFamilies][0] : 'mixed';
  return {
    family,
    hue: averageHue(components),
    lightness: components.reduce((total, component) => total + component.lightness, 0) / components.length,
    chroma: components.reduce((total, component) => total + component.chroma, 0) / components.length,
    components,
  };
}

function colorFamily(color: string) {
  return analyzeColor(color).family;
}

function hueDistance(left: number, right: number) {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
}

function componentCompatibility(left: ColorComponent, right: ColorComponent) {
  const lightnessGap = Math.abs(left.lightness - right.lightness);
  if (left.family === 'neutral' && right.family === 'neutral') return lightnessGap > 0.35 ? 3 : 2;
  if (left.family === 'neutral' || right.family === 'neutral') return lightnessGap > 0.45 ? 3 : 2;
  if (left.hue === null || right.hue === null) return 0;
  const distance = hueDistance(left.hue, right.hue);
  let score = distance <= 35 ? 3 : distance <= 75 ? 2 : distance >= 150 ? 2 : distance >= 105 ? 1 : -1;
  if (lightnessGap > 0.45) score += 1;
  if (lightnessGap < 0.08 && left.chroma > 0.35 && right.chroma > 0.35) score -= 1;
  return Math.max(-2, Math.min(3, score));
}

export function colorCompatibility(left: ColorProfile, right: ColorProfile) {
  const pairs = left.components.flatMap((leftComponent) => right.components.map((rightComponent) => componentCompatibility(leftComponent, rightComponent)));
  return pairs.length ? Math.round(pairs.reduce((total, score) => total + score, 0) / pairs.length) : 0;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function phrase(item: WardrobeItem) {
  return `${item.name} ${item.color} ${item.style}`.toLowerCase();
}

// ponytail: two explicit dimensions keep metadata small; add season or venue only when the catalog needs them.
export function occasionFit(item: WardrobeItem, occasion: Occasion) {
  const profile = item.occasionProfile;
  if (!profile) throw new Error(`Item ${item.id} is missing its occasion profile.`);
  const target = occasionTargets[occasion];
  const formality = Math.max(1, Math.min(5, Number(profile.formality) || 3));
  const activity = Math.max(1, Math.min(5, Number(profile.activity) || 3));
  const distance = Math.abs(formality - target.formality) + Math.abs(activity - target.activity);
  const occasions = Array.isArray(profile.occasions) ? profile.occasions : [];
  let score = 4 - distance;
  if (occasions.includes(occasion)) score += 2;
  else if (occasions.length) score -= 1;
  return Math.max(-5, Math.min(6, score));
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
  let score = occasionFit(item, occasion);
  if (recentItemIds.includes(item.id)) score -= 4;

  const avoid = preferences.avoid.trim().toLowerCase();
  if (avoid && text.includes(avoid)) score -= 100;

  const noteTerms = (preferences.note ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (noteTerms.length) {
    const noteMatches = noteTerms.filter((word) => text.includes(word)).length;
    score += Math.min(6, noteMatches * 2);
  }

  const profile = analyzeColor(item.color);
  const isColorful = profile.components.some((component) => component.family !== 'neutral');
  if (preferences.palette === 'neutral' && profile.family === 'neutral') score += 4;
  if (preferences.palette === 'colorful' && isColorful) score += 3;

  for (const chosen of selected) {
    score += colorCompatibility(profile, analyzeColor(chosen.color));
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
