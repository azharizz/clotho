/* oxlint-disable react/react-compiler, next/no-img-element */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { monthCells, shiftMonth } from '@/lib/calendar';
import {
  buildOutfit,
  buildOutfitBatch,
  buildCustomOutfit,
  describeColor,
  type Category,
  type Occasion,
  type OccasionProfile,
  type Outfit,
  type Palette,
  type Preferences,
  type WardrobeItem,
} from '@/lib/outfit-engine';
import { recolorImage } from '@/lib/recolor';
import { isWeatherCacheFresh, readWeatherCache, weatherDaysFromResponse, writeWeatherCache, type WeatherDay } from '@/lib/weather';
import { buildWeekPlanOptions, daypartLabels, daypartOrder, type CalendarOccasion, type Daypart, type WeekPlanOption } from '@/lib/week-planner';

type PlanEntry = { id: string; date: string; slot: Daypart; occasion: Occasion; outfit: Outfit };
type WearEntry = { id: string; date: string; outfit: Outfit };
type RecolorPreview = { item: WardrobeItem; color: string; src: string };
type ImportMetadata = { category: Category; name: string; color: string; style: string; occasionProfile: OccasionProfile };
type HandoffCrop = { category: Category; label: string; src: string; width: number; height: number; metadata?: ImportMetadata };
type HandoffTransport = 'tmpfiles-url';
type HandoffProbe = { id: string; source: string; contentType: string; bytes: number; width: number; height: number; previewUrl: string; transport: HandoffTransport; includeHeadwear: boolean; remoteUrl?: string; crops?: HandoffCrop[]; committed?: boolean };
type Panel = 'wardrobe' | 'calendar' | 'journal' | 'recolor' | 'batch' | 'week' | 'image-import' | null;

type ModelContextApi = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

declare global {
  interface Document {
    modelContext: ModelContextApi;
  }
}

const defaultPreferences: Preferences = { palette: 'balanced', includeHeadwear: true, avoid: '', note: '' };
const categoryLabels = { all: 'All', tops: 'Tops', bottoms: 'Bottoms', shoes: 'Shoes', headwear: 'Headwear' } as const;
const occasionLabels: Record<Occasion, string> = { work: 'Work', casual: 'Casual day', dinner: 'Dinner', event: 'Special event' };
const outfitOrder: Category[] = ['headwear', 'tops', 'bottoms', 'shoes'];
const outfitSlotLabels: Record<Category, string> = { headwear: 'Headwear', tops: 'Top', bottoms: 'Bottom', shoes: 'Shoes' };
const paletteStops: Array<{ value: Palette; label: string; note: string }> = [
  { value: 'neutral', label: 'Mostly neutral', note: 'soft harmony' },
  { value: 'balanced', label: 'Balanced', note: 'quiet contrast' },
  { value: 'colorful', label: 'More color', note: 'higher contrast' },
];
const defaultOccasionRecolorColors: Record<Category, string> = { headwear: '#7A1F3D', tops: '#7A1F3D', bottoms: '#7A1F3D', shoes: '#7A1F3D' };
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HANDOFF_MAX_BYTES = 8 * 1024 * 1024;
const TMPFILES_HOSTS = new Set(['tmpfiles.org', 'www.tmpfiles.org']);
const handoffGrid = [
  { category: 'headwear' as const, label: 'Headwear', column: 1, row: 1 },
  { category: 'tops' as const, label: 'Top', column: 0, row: 0 },
  { category: 'bottoms' as const, label: 'Bottom', column: 1, row: 0 },
  { category: 'shoes' as const, label: 'Shoes', column: 0, row: 1 },
];

function imagePath(item: WardrobeItem) {
  return item.imageSrc ?? `/items/${item.file}`;
}

function cleanImagePath(item: WardrobeItem) {
  if (item.imageSrc) return item.imageSrc;
  const [category, file] = item.file.split('/');
  return `/items/clean/${category}/${file.replace(/\.png$/i, '.webp')}?v=2`;
}

async function inspectHandoffBlob(blob: Blob, source: string, declaredType = '') {
  if (blob.size > HANDOFF_MAX_BYTES) throw new Error('The image is larger than CLOTHO’s 8 MB feasibility limit.');
  const contentType = (blob.type || declaredType).split(';')[0].toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error('The response was not a browser-decodable image.');
  const previewUrl = URL.createObjectURL(blob);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The response could not be decoded as an image.'));
      image.src = previewUrl;
    });
    return { source, contentType, bytes: blob.size, previewUrl, ...dimensions };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

async function cropHandoffGrid(previewUrl: string, width: number, height: number, includeHeadwear = true): Promise<HandoffCrop[]> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new window.Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error('The received image could not be cropped into a 2×2 grid.'));
    nextImage.src = previewUrl;
  });
  const cropWidth = Math.max(1, Math.floor(width / 2));
  const cropHeight = Math.max(1, Math.floor(height / 2));
  const canvas = document.createElement('canvas');
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a crop preview canvas.');
  return handoffGrid.filter(({ category }) => includeHeadwear || category !== 'headwear').map(({ category, label, column, row }) => {
    context.clearRect(0, 0, cropWidth, cropHeight);
    context.drawImage(image, column * cropWidth, row * cropHeight, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    let src: string;
    try {
      src = canvas.toDataURL('image/webp', 0.86);
    } catch {
      src = canvas.toDataURL('image/png');
    }
    return { category, label, src, width: cropWidth, height: cropHeight };
  });
}

function readSavedVariants(): WardrobeItem[] {
  try {
    const raw = localStorage.getItem('clotho:variants');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((candidate): candidate is WardrobeItem => {
      if (!candidate || typeof candidate !== 'object') return false;
      const item = candidate as Record<string, unknown>;
      return ['tops', 'bottoms', 'shoes', 'headwear'].includes(String(item.category))
        && ['id', 'name', 'color', 'style', 'sourceGrid', 'file', 'variantOf', 'variantColor', 'imageSrc'].every((key) => typeof item[key] === 'string');
    });
  } catch {
    return [];
  }
}

function readSavedImports(): WardrobeItem[] {
  try {
    const raw = localStorage.getItem('clotho:imports');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((candidate): candidate is WardrobeItem => {
      if (!candidate || typeof candidate !== 'object') return false;
      const item = candidate as Record<string, unknown>;
      return String(item.id).startsWith('local-import-')
        && ['tops', 'bottoms', 'shoes', 'headwear'].includes(String(item.category))
        && ['id', 'name', 'color', 'style', 'sourceGrid', 'file', 'imageSrc'].every((key) => typeof item[key] === 'string');
    });
  } catch {
    return [];
  }
}

function makeRecolorVariant(baseItem: WardrobeItem, color: string, imageSrc: string): WardrobeItem {
  const normalizedColor = color.toUpperCase();
  const baseId = baseItem.variantOf ?? baseItem.id;
  return {
    id: `${baseId}--${normalizedColor.slice(1).toLowerCase()}`,
    category: baseItem.category,
    name: `${baseItem.name} · ${normalizedColor}`,
    color: normalizedColor,
    style: `${baseItem.style} · recolored`,
    sourceGrid: baseItem.sourceGrid,
    file: baseItem.file,
    occasionProfile: baseItem.occasionProfile,
    colorMetadata: describeColor(normalizedColor),
    variantOf: baseId,
    variantColor: normalizedColor,
    imageSrc,
  };
}

function weatherKind(code: number) {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  if (code <= 86) return 'snow';
  return 'storm';
}

function weatherLabel(code: number) {
  return { clear: 'Clear', partly: 'Partly cloudy', fog: 'Fog', rain: 'Rain', snow: 'Snow', storm: 'Storm' }[weatherKind(code)];
}

function weatherIcon(code: number) {
  const kind = weatherKind(code);
  const props = { 'aria-hidden': true, className: `weather-icon weather-icon--${kind}`, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' };
  const cloud = <path d="M5.4 16a3.4 3.4 0 0 1 .8-6.7 5.1 5.1 0 0 1 9.8.9 2.8 2.8 0 0 1 .4 5.5H5.4Z" />;
  if (kind === 'clear') return <svg {...props}><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" /><path d="M12 2.2v2.1M12 19.7v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.2 12h2.1M19.7 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" /></svg>;
  if (kind === 'partly') return <svg {...props}><circle cx="8.4" cy="8.1" r="3" /><path d="M8.4 3.1v1.1M8.4 12v1.1M3.4 8.1h1.1M12.3 8.1h1.1M4.9 4.6l.8.8M11.1 10.8l.8.8" />{cloud}</svg>;
  if (kind === 'fog') return <svg {...props}><path d="M4 8.5h16M3 12.5h18M5 16.5h14" /></svg>;
  if (kind === 'rain') return <svg {...props}>{cloud}<path d="m8 18-1 2M12 18l-1 2M16 18l-1 2" /></svg>;
  if (kind === 'snow') return <svg {...props}>{cloud}<path d="M8 18v4M6.3 19l3.4 2M9.7 19l-3.4 2M15 18v4M13.3 19l3.4 2M16.7 19l-3.4 2" /></svg>;
  return <svg {...props}>{cloud}<path d="m13 16-2 3h2l-1 3 4-5h-2l1-1" /></svg>;
}

function recentIds(history: WearEntry[]) {
  return history.slice(0, 4).flatMap((entry) => entry.outfit.items.map((item) => item.id));
}

function asRecord(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be an object.');
  return input as Record<string, unknown>;
}

function validOccasion(value: unknown): Occasion {
  if (!['work', 'casual', 'dinner', 'event'].includes(String(value))) throw new Error('occasion must be work, casual, dinner, or event.');
  return value as Occasion;
}

function validPalette(value: unknown): Palette {
  if (!['balanced', 'neutral', 'colorful'].includes(String(value))) throw new Error('palette must be balanced, neutral, or colorful.');
  return value as Palette;
}

function validDaypart(value: unknown, fallback: Daypart = 'day'): Daypart {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !daypartOrder.includes(value as Daypart)) throw new Error('slot must be morning, day, or evening.');
  return value as Daypart;
}

function validString(value: unknown, field: string, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value;
}

function validBoolean(value: unknown, field: string, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
  return value;
}

function validIsoDate(value: unknown, field = 'date') {
  const date = validString(value, field).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${field} must use YYYY-MM-DD.`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`${field} must be a real calendar date.`);
  return date;
}

function validItemIdList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((itemId) => typeof itemId !== 'string' || !itemId.trim())) throw new Error(`${field} must be an array of non-empty item IDs.`);
  return [...new Set(value.map((itemId) => itemId.trim()))];
}

function validImportMetadata(value: unknown, includeHeadwear: boolean): Map<Category, ImportMetadata> {
  const expected = [...(includeHeadwear ? outfitOrder : outfitOrder.filter((category) => category !== 'headwear'))].sort();
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error(`items must contain metadata for exactly ${expected.join(', ')}.`);
  const entries = value.map((candidate, index) => {
    const item = asRecord(candidate);
    const category = validString(item.category, `items[${index}].category`) as Category;
    if (!expected.includes(category)) throw new Error(`items[${index}].category is not expected for this grid.`);
    const name = validString(item.name, `items[${index}].name`).trim();
    const color = validString(item.color, `items[${index}].color`).trim();
    const style = validString(item.style, `items[${index}].style`).trim();
    if (!name || !color || !style) throw new Error(`items[${index}] must include a non-empty name, color, and style.`);
    const profile = asRecord(item.occasionProfile);
    const formality = Number(profile.formality);
    const activity = Number(profile.activity);
    if (!Number.isInteger(formality) || formality < 1 || formality > 5 || !Number.isInteger(activity) || activity < 1 || activity > 5) throw new Error(`items[${index}].occasionProfile formality and activity must be integers from 1 to 5.`);
    const occasions = profile.occasions === undefined ? undefined : profile.occasions;
    if (occasions !== undefined && (!Array.isArray(occasions) || occasions.some((occasion) => !['work', 'casual', 'dinner', 'event'].includes(String(occasion))))) throw new Error(`items[${index}].occasionProfile.occasions must use work, casual, dinner, or event.`);
    return { category, name, color, style, occasionProfile: { formality, activity, ...(occasions ? { occasions: [...new Set(occasions)] as Occasion[] } : {}) } };
  });
  const metadata = new Map(entries.map((item) => [item.category, item]));
  if (metadata.size !== expected.length || expected.some((category) => !metadata.has(category))) throw new Error(`items must contain one metadata record for exactly ${expected.join(', ')}.`);
  return metadata;
}

function monthTitle(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function createHandoffId() {
  return `local-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function validHttpsImageUrl(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) throw new Error('imageUrl must be an HTTPS URL up to 2048 characters.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('imageUrl must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('imageUrl must be a public HTTPS URL without embedded credentials.');
  return parsed.toString();
}

function isTmpFilesUrl(value: string) {
  const parsed = new URL(value);
  return TMPFILES_HOSTS.has(parsed.hostname);
}

async function fetchImageForImport(imageUrl: string) {
  const target = isTmpFilesUrl(imageUrl) ? `/api/tmpfiles-image?url=${encodeURIComponent(imageUrl)}` : imageUrl;
  let response: Response;
  try {
    response = await fetch(target, { cache: 'no-store' });
  } catch {
    throw new Error('The image URL could not be fetched. The host may block browser access (CORS).');
  }
  if (!response.ok) {
    const message = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(message?.error || `The image URL returned HTTP ${response.status}.`);
  }
  const declaredType = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > HANDOFF_MAX_BYTES) throw new Error('The remote image is larger than CLOTHO’s 8 MB feasibility limit.');
  const blob = await response.blob();
  if (blob.size > HANDOFF_MAX_BYTES) throw new Error('The remote image is larger than CLOTHO’s 8 MB feasibility limit.');
  return { blob, contentType: declaredType || blob.type };
}

export default function Home() {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [look, setLook] = useState<Outfit | null>(null);
  const [occasion, setOccasion] = useState<Occasion>('work');
  const [date, setDate] = useState('2026-09-02');
  const [calendarMonth, setCalendarMonth] = useState('2026-09');
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [history, setHistory] = useState<WearEntry[]>([]);
  const [category, setCategory] = useState<keyof typeof categoryLabels>('all');
  const [seed, setSeed] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState('Loading the wardrobe…');
  const [recolorItemId, setRecolorItemId] = useState('top-02');
  const [recolorColor, setRecolorColor] = useState('#7A1F3D');
  const [recolorPreview, setRecolorPreview] = useState<RecolorPreview | null>(null);
  const [recolorBusy, setRecolorBusy] = useState(false);
  const [occasionRecolorCategory, setOccasionRecolorCategory] = useState<Category>('tops');
  const [occasionRecolorColors, setOccasionRecolorColors] = useState(defaultOccasionRecolorColors);
  const [occasionRecolorBusy, setOccasionRecolorBusy] = useState<Category | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [zoomedLook, setZoomedLook] = useState<Outfit | null>(null);
  const [zoomedLabel, setZoomedLabel] = useState('Outfit overview');
  const [weatherDays, setWeatherDays] = useState<Record<string, WeatherDay>>({});
  const [weatherStatus, setWeatherStatus] = useState('Reading forecast…');
  const [batchCount, setBatchCount] = useState(6);
  const [batchLooks, setBatchLooks] = useState<Outfit[]>([]);
  const batchRevision = useRef(0);
  const [daypart, setDaypart] = useState<Daypart>('day');
  const [calendarItemIds, setCalendarItemIds] = useState<Partial<Record<Category, string>>>({});
  const [weekStartDate, setWeekStartDate] = useState(date);
  const [weekDays, setWeekDays] = useState(5);
  const [weekDaypartsMode, setWeekDaypartsMode] = useState<'day' | 'all'>('day');
  const [weekOptionCount, setWeekOptionCount] = useState<2 | 3>(3);
  const [weekOptions, setWeekOptions] = useState<WeekPlanOption[]>([]);
  const [selectedWeekOption, setSelectedWeekOption] = useState(0);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const [handoffResult, setHandoffResult] = useState<HandoffProbe | null>(null);
  const [remoteImageUrl, setRemoteImageUrl] = useState('');
  const [handoffIncludeHeadwear, setHandoffIncludeHeadwear] = useState(true);
  const handoffPreviewRef = useRef<string | null>(null);
  const live = useRef({ items, look, occasion, date, preferences, history, plans, seed, weatherDays, weekOptions, handoffResult });
  live.current = { items, look, occasion, date, preferences, history, plans, seed, weatherDays, weekOptions, handoffResult };

  useEffect(() => {
    try {
      const savedPreferences = localStorage.getItem('clotho:preferences');
      const savedPlans = localStorage.getItem('clotho:plans');
      const savedHistory = localStorage.getItem('clotho:history');
      ['mixmatch:preferences', 'mixmatch:plans', 'mixmatch:history'].forEach((key) => localStorage.removeItem(key));
      if (savedPreferences) setPreferences({ ...defaultPreferences, ...JSON.parse(savedPreferences) });
      if (savedPlans) {
        const parsedPlans = JSON.parse(savedPlans);
        if (Array.isArray(parsedPlans)) setPlans(parsedPlans.map((plan) => ({ ...plan, slot: plan.slot ?? 'day' })));
      }
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    } catch {
      setStatus('Saved browser data was unreadable; defaults are active.');
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetch('/items/manifest.json')
      .then((response) => {
        if (!response.ok) throw new Error('Wardrobe manifest could not be loaded.');
        return response.json() as Promise<{ items: WardrobeItem[] }>;
      })
      .then((manifest) => {
        const baseProfiles = new Map(manifest.items.map((item) => [item.id, item.occasionProfile]));
        // ponytail: migrate older variants from their base profile; no keyword-scoring fallback remains.
        const variants = readSavedVariants().map((variant) => ({
          ...variant,
          occasionProfile: variant.occasionProfile ?? baseProfiles.get(variant.variantOf ?? variant.id),
          colorMetadata: variant.colorMetadata ?? describeColor(variant.color),
        })).filter((variant) => Boolean(variant.occasionProfile));
        const imports = readSavedImports().map((item) => ({
          ...item,
          occasionProfile: item.occasionProfile ?? { formality: 3, activity: 3 },
          colorMetadata: item.colorMetadata ?? describeColor(item.color),
        }));
        setItems([...manifest.items, ...variants, ...imports]);
        setStatus(`${manifest.items.length} wardrobe items, ${variants.length} saved variants, and ${imports.length} imported pieces ready.`);
      })
      .catch((error: Error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    const cached = readWeatherCache(localStorage);
    if (cached) {
      setWeatherDays(cached.days);
      setWeatherStatus(`Cached NYC forecast · ${Object.keys(cached.days).length} days`);
    }
    if (cached && isWeatherCacheFresh(cached)) return;
    const controller = new AbortController();
    fetch('https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=America%2FNew_York&past_days=7&forecast_days=16', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('NYC weather unavailable');
        return response.json();
      })
      .then((data) => {
        const days = weatherDaysFromResponse(data);
        setWeatherDays(days);
        writeWeatherCache(localStorage, days);
        setWeatherStatus(`NYC · ${Object.keys(days).length} days · cached 6h`);
      })
      .catch(() => setWeatherStatus(cached ? 'NYC · showing cached forecast' : 'NYC forecast unavailable'));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activePanel && !zoomedLook) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setActivePanel(null); setZoomedLook(null); } };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activePanel, zoomedLook]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem('clotho:preferences', JSON.stringify(preferences));
      localStorage.setItem('clotho:plans', JSON.stringify(plans));
      localStorage.setItem('clotho:history', JSON.stringify(history));
    } catch {
      setStatus('Browser storage is full; recent changes remain available for this session.');
    }
  }, [history, hydrated, plans, preferences]);

  useEffect(() => {
    if (!hydrated || !items.length) return;
    try {
      // ponytail: localStorage keeps variants dependency-free; use IndexedDB if image volume outgrows browser quota.
      localStorage.setItem('clotho:variants', JSON.stringify(items.filter((item) => item.variantOf && item.variantColor && item.imageSrc)));
      // ponytail: File/Blob objects and blob URLs are ephemeral; persist only serialized crop previews.
      localStorage.setItem('clotho:imports', JSON.stringify(items.filter((item) => item.id.startsWith('local-import-') && item.imageSrc)));
    } catch {
      setStatus('The preview is ready, but browser storage is full; remove saved data before saving another.');
    }
  }, [hydrated, items]);

  const makeLook = useCallback(
    (nextOccasion = occasion, nextPreferences = preferences, nextSeed = seed) => {
      if (!items.length) return null;
      const result = buildOutfit(items, nextOccasion, nextPreferences, recentIds(history), `${date}:${nextSeed}`);
      setLook(result);
      setStatus(`${result.title}. Compatibility ${result.score} out of 100.`);
      return result;
    },
    [date, history, items, occasion, preferences, seed],
  );

  useEffect(() => {
    if (items.length && !look) makeLook();
  }, [items, look, makeLook]);

  useEffect(() => {
    if (!look) return;
    setCalendarItemIds(Object.fromEntries(look.items.map((item) => [item.category, item.id])) as Partial<Record<Category, string>>);
  }, [look]);

  function anotherLook() {
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    makeLook(occasion, preferences, nextSeed);
  }

  function generateBatch(nextOccasion = occasion, nextPreferences = preferences, count = batchCount, batchSeed?: string) {
    if (!items.length) return [];
    const resolvedSeed = batchSeed ?? `${date}:batch:${batchRevision.current++}`;
    const results = buildOutfitBatch(items, nextOccasion, nextPreferences, recentIds(history), count, resolvedSeed);
    setOccasion(nextOccasion);
    setPreferences(nextPreferences);
    setBatchCount(count);
    setBatchLooks(results);
    setActivePanel('batch');
    setStatus(`${results.length} distinct ${occasionLabels[nextOccasion].toLowerCase()} looks ready.`);
    return results;
  }

  function openLookPreview(nextLook: Outfit, label = 'Outfit overview') {
    setZoomedLook(nextLook);
    setZoomedLabel(label);
  }

  function closeLookPreview() {
    setZoomedLook(null);
  }

  function selectBatchLook(outfit: Outfit) {
    setLook(outfit);
    setActivePanel(null);
    setStatus(`${outfit.title} moved to the main view.`);
  }

  function planLook(nextLook = look, nextDate = date, nextOccasion = occasion, updateMain = true) {
    if (!nextLook) return;
    const entry = { id: `plan-${nextDate}-${daypart}`, date: nextDate, slot: daypart, occasion: nextOccasion, outfit: nextLook };
    if (updateMain) {
      setLook(nextLook);
      setOccasion(nextOccasion);
    }
    setPlans((current) => [entry, ...current.filter((plan) => plan.date !== nextDate || plan.slot !== daypart)].sort((a, b) => a.date.localeCompare(b.date) || daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot)));
    setCalendarMonth(nextDate.slice(0, 7));
    setStatus(`${nextLook.title} planned for ${daypartLabels[daypart].toLowerCase()} on ${nextDate}.`);
  }

  const commitLookVariants = useCallback((nextLook: Outfit) => {
    const additions: WardrobeItem[] = [];
    const committedItems = nextLook.items.map((item) => {
      if (!item.imageSrc || !item.variantOf || !item.variantColor) return item;
      const color = item.variantColor.toUpperCase();
      const existing = items.find((candidate) => candidate.variantOf === item.variantOf && candidate.variantColor?.toUpperCase() === color);
      if (existing) return existing;
      const variant = makeRecolorVariant(items.find((candidate) => candidate.id === item.variantOf) ?? item, color, item.imageSrc);
      if (!additions.some((candidate) => candidate.id === variant.id)) additions.push(variant);
      return variant;
    });
    if (additions.length) setItems((current) => [...current, ...additions.filter((addition) => !current.some((candidate) => candidate.id === addition.id))]);
    return { outfit: { ...nextLook, items: committedItems }, savedCount: additions.length };
  }, [items]);

  function selectOccasionPiece(category: Category) {
    const item = look?.items.find((candidate) => candidate.category === category);
    if (!item) return;
    setOccasionRecolorCategory(category);
    if (item.variantColor) setOccasionRecolorColors((current) => ({ ...current, [category]: item.variantColor!.toUpperCase() }));
    setStatus(`${outfitSlotLabels[category]} selected. Choose a color to preview.`);
  }

  function updatePreferences(nextPreferences: Preferences) {
    const nextSeed = seed + 1;
    setPreferences(nextPreferences);
    setSeed(nextSeed);
    makeLook(occasion, nextPreferences, nextSeed);
    setStatus('Taste updated. The visible look was reranked.');
  }

  function editPlan(plan: PlanEntry) {
    setDate(plan.date);
    setCalendarMonth(plan.date.slice(0, 7));
    setDaypart(plan.slot);
    setOccasion(plan.occasion);
    setCalendarItemIds(plan.outfit.items.reduce<Partial<Record<Category, string>>>((current, item) => ({ ...current, [item.category]: item.id }), {}));
    setActivePanel('calendar');
    window.requestAnimationFrame(() => document.getElementById('calendar-add')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setStatus(`Editing ${daypartLabels[plan.slot].toLowerCase()} on ${plan.date} in Add a moment.`);
  }

  function removePlan(plan: PlanEntry) {
    setPlans((current) => current.filter((candidate) => candidate.id !== plan.id));
    setStatus(`Removed ${daypartLabels[plan.slot].toLowerCase()} plan from ${plan.date}.`);
  }

  function reuseHistoryLook(entry: WearEntry) {
    setLook(entry.outfit);
    setOccasion(entry.outfit.occasion);
    setDate(entry.date);
    setCalendarMonth(entry.date.slice(0, 7));
    setActivePanel(null);
    setStatus(`${entry.outfit.title} moved to the main view.`);
  }

  function calendarOccasions(sourcePlans = plans): CalendarOccasion[] {
    return sourcePlans.map((plan) => ({ date: plan.date, slot: plan.slot, occasion: plan.occasion }));
  }

  function generateWeekPlan(
    nextStartDate = weekStartDate,
    nextDays = weekDays,
    nextDayparts: Daypart[] = weekDaypartsMode === 'all' ? daypartOrder : ['day'],
    nextOptionCount = weekOptionCount,
    planSeed = `${nextStartDate}:week`,
  ) {
    if (!items.length) return [];
    const results = buildWeekPlanOptions(items, nextStartDate, nextDays, nextDayparts, occasion, calendarOccasions(), preferences, recentIds(history), weatherDays, nextOptionCount, planSeed);
    setWeekStartDate(nextStartDate);
    setWeekDays(nextDays);
    setWeekOptions(results);
    setSelectedWeekOption(0);
    setActivePanel('week');
    setStatus(`${results.length} weekly outfit options ready.`);
    return results;
  }

  function applyWeekPlan(option = weekOptions[selectedWeekOption]) {
    if (!option) return;
    setPlans((current) => {
      const generated = new Map(option.entries.map((entry) => [`${entry.date}:${entry.slot}`, { id: `plan-${entry.date}-${entry.slot}`, date: entry.date, slot: entry.slot, occasion: entry.occasion, outfit: entry.outfit }]));
      const kept = current.filter((plan) => !generated.has(`${plan.date}:${plan.slot}`));
      return [...kept, ...generated.values()].sort((a, b) => a.date.localeCompare(b.date) || daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot));
    });
    const firstEntry = option.entries[0];
    setDate(firstEntry?.date ?? date);
    setDaypart(firstEntry?.slot ?? 'day');
    setOccasion(firstEntry?.occasion ?? occasion);
    setLook(firstEntry?.outfit ?? look);
    setCalendarMonth((firstEntry?.date ?? date).slice(0, 7));
    setActivePanel(null);
    setStatus(`${option.label} added to the calendar.`);
  }

  async function applyRecolor(nextItemId = recolorItemId, nextColor = recolorColor) {
    const item = items.find((candidate) => candidate.id === nextItemId);
    if (!item) {
      setStatus('Choose a wardrobe item before recoloring.');
      return null;
    }
    setRecolorBusy(true);
    try {
      const src = await recolorImage(cleanImagePath(item), nextColor);
      setRecolorItemId(nextItemId);
      setRecolorColor(nextColor);
      setRecolorPreview({ item, color: nextColor, src });
      setStatus(`${item.name} recolored to ${nextColor}.`);
      return { itemId: item.id, color: nextColor, status: 'rendered' };
    } finally {
      setRecolorBusy(false);
    }
  }

  async function recolorOccasionPiece(category: Category) {
    const item = look?.items.find((candidate) => candidate.category === category);
    if (!item) {
      setStatus(`There is no ${outfitSlotLabels[category].toLowerCase()} in this look.`);
      return null;
    }
    const color = (occasionRecolorColors[category] ?? defaultOccasionRecolorColors[category]).toUpperCase();
    setOccasionRecolorCategory(category);
    setOccasionRecolorBusy(category);
    try {
      const baseItem = items.find((candidate) => candidate.id === (item.variantOf ?? item.id)) ?? item;
      const src = await recolorImage(cleanImagePath(baseItem), color);
      const previewItem = makeRecolorVariant(baseItem, color, src);
      setLook((current) => current ? { ...current, items: current.items.map((candidate) => candidate.category === category ? previewItem : candidate) } : current);
      setStatus(`${outfitSlotLabels[category]} recolored to ${color}. “I wore this” will save it to the wardrobe.`);
      return previewItem;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `The ${outfitSlotLabels[category].toLowerCase()} recolor failed.`);
      return null;
    } finally {
      setOccasionRecolorBusy(null);
    }
  }

  function saveRecolorVariant() {
    if (!recolorPreview) {
      setStatus('Preview a color before saving a wardrobe variant.');
      return null;
    }
    const source = recolorPreview.item;
    const baseId = source.variantOf ?? source.id;
    const baseItem = items.find((item) => item.id === baseId) ?? source;
    const color = recolorPreview.color.toUpperCase();
    const existing = items.find((item) => item.variantOf === baseId && item.variantColor?.toUpperCase() === color);
    if (existing) {
      setRecolorItemId(existing.id);
      setRecolorPreview({ item: existing, color, src: existing.imageSrc ?? recolorPreview.src });
      setStatus(`${existing.name} is already saved in the wardrobe.`);
      return existing;
    }
    const variant = makeRecolorVariant(baseItem, color, recolorPreview.src);
    setItems((current) => [...current, variant]);
    setRecolorItemId(variant.id);
    setRecolorColor(color);
    setRecolorPreview({ item: variant, color, src: recolorPreview.src });
    setStatus(`${variant.name} saved as a wardrobe variant.`);
    return variant;
  }

  const importImageUrl = useCallback(async (nextImageUrl: string, includeHeadwear = handoffIncludeHeadwear, metadata?: Map<Category, ImportMetadata>) => {
    const imageUrl = validHttpsImageUrl(nextImageUrl);
    setHandoffIncludeHeadwear(includeHeadwear);
    setRemoteImageUrl(imageUrl);
    setHandoffBusy(true);
    setHandoffError('');
    setHandoffResult(null);
    live.current.handoffResult = null;
    setActivePanel('image-import');
    try {
      const remote = await fetchImageForImport(imageUrl);
      const result = await inspectHandoffBlob(remote.blob, imageUrl, remote.contentType);
      const crops = (await cropHandoffGrid(result.previewUrl, result.width, result.height, includeHeadwear)).map((crop) => ({ ...crop, metadata: metadata?.get(crop.category) }));
      const handoffId = createHandoffId();
      const nextResult: HandoffProbe = { ...result, id: handoffId, transport: 'tmpfiles-url', includeHeadwear, remoteUrl: imageUrl, crops, committed: false };
      live.current.handoffResult = nextResult;
      setHandoffResult(nextResult);
      setStatus('Temporary HTTPS image imported. Review the selected pieces before saving.');
      return {
        handoffId,
        imageUrl,
        source: result.source,
        contentType: result.contentType,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        layout: '2x2',
        transport: 'tmpfiles-url',
        requiresConfirmation: true,
        includeHeadwear,
        pieces: crops.map(({ category, label, width: cropWidth, height: cropHeight, metadata: itemMetadata }) => ({ category, label, width: cropWidth, height: cropHeight, metadata: itemMetadata ?? null })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The HTTPS image could not be imported.';
      setHandoffError(message);
      setStatus(`Temporary image import failed. ${message}`);
      throw error;
    } finally {
      setHandoffBusy(false);
    }
  }, [handoffIncludeHeadwear]);

  const commitHandoff = useCallback((nextHandoffId: string) => {
    const current = live.current.handoffResult;
    if (!current || current.id !== nextHandoffId) throw new Error('Import a 2×2 image first, then confirm that handoff ID.');
    if (!current.crops?.length) throw new Error('Prepare an image first, then confirm its reviewable pieces.');
    if (current.committed) return { handoffId: current.id, savedCount: 0, itemIds: current.crops.map((crop) => `${current.id}-${crop.category}`), alreadyCommitted: true };
    const additions: WardrobeItem[] = current.crops.map((crop) => ({
      id: `${current.id}-${crop.category}`,
      category: crop.category,
      name: crop.metadata?.name ?? `Imported ${crop.label.toLowerCase()}`,
      color: crop.metadata?.color ?? 'unlabeled',
      style: crop.metadata?.style ?? '2×2 wardrobe import',
      sourceGrid: current.source,
      file: `imports/${current.id}-${crop.category}.webp`,
      occasionProfile: crop.metadata?.occasionProfile ?? { formality: 3, activity: 3 },
      colorMetadata: describeColor(crop.metadata?.color ?? 'unlabeled'),
      imageSrc: crop.src,
    }));
    const savedImports = [...live.current.items.filter((item) => item.id.startsWith('local-import-') && item.imageSrc), ...additions]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
    try {
      localStorage.setItem('clotho:imports', JSON.stringify(savedImports));
    } catch {
      throw new Error('Browser storage is full; CLOTHO could not save these imported pieces.');
    }
    setItems((itemsNow) => [...itemsNow, ...additions.filter((addition) => !itemsNow.some((item) => item.id === addition.id))]);
    const committed = { ...current, committed: true };
    live.current.handoffResult = committed;
    setHandoffResult(committed);
    setStatus(`${additions.length} imported pieces accepted into the wardrobe. Review their labels before using them in recommendations.`);
    return { handoffId: current.id, savedCount: additions.length, itemIds: additions.map((item) => item.id), alreadyCommitted: false };
  }, []);

  const removeImportedItem = useCallback((itemId: string) => {
    const remainingItems = live.current.items.filter((item) => item.id !== itemId);
    try {
      localStorage.setItem('clotho:imports', JSON.stringify(remainingItems.filter((item) => item.id.startsWith('local-import-') && item.imageSrc)));
    } catch {
      setStatus('Browser storage could not update this imported item.');
      return;
    }
    setItems(remainingItems);
    setStatus('Imported wardrobe item removed.');
  }, []);

  useEffect(() => {
    const previousUrl = handoffPreviewRef.current;
    const nextUrl = handoffResult?.previewUrl ?? null;
    if (previousUrl && previousUrl !== nextUrl) URL.revokeObjectURL(previousUrl);
    handoffPreviewRef.current = nextUrl;
  }, [handoffResult?.previewUrl]);

  useEffect(() => () => {
    if (handoffPreviewRef.current) URL.revokeObjectURL(handoffPreviewRef.current);
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContextApi['registerTool']>[0]) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
      } catch {
        // WebMCP is optional; unsupported registration must not break CLOTHO.
      }
    };

    // Requirement example: keep the direct registerTool shape visible; the remaining CLOTHO tools use the shared wrapper below.
    try {
      void Promise.resolve(document.modelContext.registerTool({
      name: 'search_products',
      title: 'Search the wardrobe catalog',
      description: 'Search the wardrobe product catalog by item name, color, style, or category without changing the interface.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string', enum: ['tops', 'bottoms', 'shoes', 'headwear'] },
          limit: { type: 'integer', minimum: 1, maximum: 44 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async (input) => {
        const values = asRecord(input);
        const query = validString(values.query, 'query').trim().toLowerCase();
        const category = values.category === undefined ? undefined : validString(values.category, 'category');
        if (category && !['tops', 'bottoms', 'shoes', 'headwear'].includes(category)) throw new Error('category must be tops, bottoms, shoes, or headwear.');
        const limit = values.limit === undefined ? 12 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 44) throw new Error('limit must be an integer from 1 to 44.');
        const terms = query.split(/\s+/).filter(Boolean);
        const results = live.current.items
          .filter((item) => {
            if (category && item.category !== category) return false;
            const text = `${item.id} ${item.category} ${item.name} ${item.color} ${item.style}`.toLowerCase();
            return terms.every((term) => text.includes(term));
          })
          .slice(0, limit);
        return {
          query,
          category: category ?? null,
          count: results.length,
          items: results.map(({ id, category: itemCategory, name, color, style, file, variantOf, variantColor }) => ({ id, category: itemCategory, name, color, style, file, variantOf: variantOf ?? null, variantColor: variantColor ?? null })),
        };
      }, }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      // WebMCP is optional; unsupported registration must not break CLOTHO.
    }

    register({
      name: 'commit_wardrobe_items',
      title: 'Save imported wardrobe pieces',
      description: 'Commit one previously reviewed image result as local wardrobe items. Requires the handoffId returned by import_image_url; this is the confirmation step and persists image crops in this browser only.',
      inputSchema: {
        type: 'object',
        properties: { handoffId: { type: 'string', description: 'The handoffId returned by import_image_url after the user reviews the crop previews.' } },
        required: ['handoffId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const values = asRecord(input);
        const handoffId = validString(values.handoffId, 'handoffId').trim();
        if (!handoffId) throw new Error('handoffId is required.');
        return commitHandoff(handoffId);
      },
    });

    register({
      name: 'import_image_url',
      title: 'Import an image URL for the wardrobe',
      description: 'Import a wardrobe grid from a client-provided temporary HTTPS URL. First, the AI agent must turn an outfit photo into one clean 2×2 catalog image: Top in the top-left, Bottom in the top-right, Shoes in the bottom-left, and Headwear in the bottom-right when present (otherwise leave that cell empty and set includeHeadwear false). Upload that grid to temporary hosting such as TmpFiles, then pass its returned https://tmpfiles.org/{id}/{name} upload-page URL here. Include one complete metadata record per extracted crop: name, color, style, and occasion profile. CLOTHO cannot read a ChatGPT attachment or local filesystem path directly. Set autoAccept true only when the user has asked to save the extracted pieces without manual review; otherwise CLOTHO shows the crop preview and waits.',
      inputSchema: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', format: 'uri', description: 'The temporary HTTPS upload-page URL for the already-prepared 2×2 wardrobe grid, preferably returned by TmpFiles.' },
          includeHeadwear: { type: 'boolean', description: 'Keep the bottom-right cell as Headwear (true for 4 pieces, false for Top/Bottom/Shoes only).' },
          items: {
            type: 'array',
            description: 'One complete wardrobe metadata record for each extracted category. Use Top, Bottom, Shoes, and Headwear when includeHeadwear is true; otherwise omit Headwear.',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', enum: ['tops', 'bottoms', 'shoes', 'headwear'] },
                name: { type: 'string' },
                color: { type: 'string', description: 'A recognized color name or #RRGGBB value used for color matching.' },
                style: { type: 'string' },
                occasionProfile: {
                  type: 'object',
                  properties: {
                    formality: { type: 'integer', minimum: 1, maximum: 5 },
                    activity: { type: 'integer', minimum: 1, maximum: 5 },
                    occasions: { type: 'array', items: { type: 'string', enum: ['work', 'casual', 'dinner', 'event'] } },
                  },
                  required: ['formality', 'activity'],
                  additionalProperties: false,
                },
              },
              required: ['category', 'name', 'color', 'style', 'occasionProfile'],
              additionalProperties: false,
            },
          },
          autoAccept: { type: 'boolean', description: 'When true, immediately save the extracted 3 or 4 pieces into this browser’s wardrobe after a successful import. Use only with the user’s explicit save instruction.' },
        },
        required: ['imageUrl', 'includeHeadwear', 'items'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const values = asRecord(input);
        const includeHeadwear = validBoolean(values.includeHeadwear, 'includeHeadwear', false);
        const metadata = validImportMetadata(values.items, includeHeadwear);
        const imported = await importImageUrl(validString(values.imageUrl, 'imageUrl'), includeHeadwear, metadata);
        const autoAccept = validBoolean(values.autoAccept, 'autoAccept', false);
        if (!autoAccept) return imported;
        return { ...imported, accepted: commitHandoff(imported.handoffId) };
      },
    });

    register({
      name: 'suggest_outfit',
      title: 'Suggest an outfit',
      description: 'Select and visibly display one deterministic outfit from this wardrobe for an occasion, date, preferences, and optional required or excluded item IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          occasion: { type: 'string', enum: ['work', 'casual', 'dinner', 'event'] },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          palette: { type: 'string', enum: ['balanced', 'neutral', 'colorful'] },
          includeHeadwear: { type: 'boolean' },
          avoid: { type: 'string' },
          note: { type: 'string' },
          seed: { type: 'string' },
          requiredItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 4 },
          excludedItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        required: ['occasion'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const nextOccasion = validOccasion(values.occasion);
        const nextDate = values.date === undefined ? state.date : validIsoDate(values.date);
        const requiredItemIds = validItemIdList(values.requiredItemIds, 'requiredItemIds');
        const excludedItemIds = validItemIdList(values.excludedItemIds, 'excludedItemIds');
        const nextPreferences = {
          palette: values.palette === undefined ? state.preferences.palette : validPalette(values.palette),
          includeHeadwear: values.includeHeadwear === undefined ? state.preferences.includeHeadwear : Boolean(values.includeHeadwear),
          avoid: validString(values.avoid, 'avoid', state.preferences.avoid),
          note: validString(values.note, 'note', state.preferences.note),
        };
        const result = buildOutfit(state.items, nextOccasion, nextPreferences, recentIds(state.history), validString(values.seed, 'seed', `${nextDate}:${state.seed + 1}`), { requiredItemIds, excludedItemIds });
        setDate(nextDate);
        setCalendarMonth(nextDate.slice(0, 7));
        setOccasion(nextOccasion);
        setPreferences(nextPreferences);
        setLook(result);
        setSeed((current) => current + 1);
        setStatus(`${result.title}. Compatibility ${result.score} out of 100.`);
        return { outfitId: result.id, date: nextDate, title: result.title, score: result.score, itemIds: result.items.map((item) => item.id), requiredItemIds, excludedItemIds };
      },
    });

    register({
      name: 'schedule_outfit',
      title: 'Schedule an outfit',
      description: 'Create or replace one of up to three outfit plans for a date and time of day, save it locally, and show it in the month calendar.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          occasion: { type: 'string', enum: ['work', 'casual', 'dinner', 'event'] },
          slot: { type: 'string', enum: ['morning', 'day', 'evening'] },
          includeHeadwear: { type: 'boolean' },
        },
        required: ['date', 'occasion'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const nextDate = validString(values.date, 'date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) throw new Error('date must use YYYY-MM-DD.');
        const nextOccasion = validOccasion(values.occasion);
        const nextSlot = validDaypart(values.slot);
        const nextPreferences = {
          ...state.preferences,
          includeHeadwear: values.includeHeadwear === undefined ? state.preferences.includeHeadwear : Boolean(values.includeHeadwear),
        };
        const result = buildOutfit(state.items, nextOccasion, nextPreferences, recentIds(state.history), `${nextDate}:${nextOccasion}`);
        const entry = { id: `plan-${nextDate}-${nextSlot}`, date: nextDate, slot: nextSlot, occasion: nextOccasion, outfit: result };
        setDate(nextDate);
        setCalendarMonth(nextDate.slice(0, 7));
        setOccasion(nextOccasion);
        setPreferences(nextPreferences);
        setLook(result);
        setDaypart(nextSlot);
        setPlans((current) => [entry, ...current.filter((plan) => plan.date !== nextDate || plan.slot !== nextSlot)].sort((a, b) => a.date.localeCompare(b.date) || daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot)));
        setStatus(`${result.title} planned for ${daypartLabels[nextSlot].toLowerCase()} on ${nextDate}.`);
        return { planId: entry.id, date: nextDate, slot: nextSlot, outfitId: result.id, itemIds: result.items.map((item) => item.id) };
      },
    });

    register({
      name: 'remove_calendar_plan',
      title: 'Remove a calendar plan',
      description: 'Remove one locally saved outfit plan for a date and time of day. Schedule the same date and slot again to edit it.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          slot: { type: 'string', enum: ['morning', 'day', 'evening'] },
        },
        required: ['date'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const values = asRecord(input);
        const nextDate = validString(values.date, 'date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) throw new Error('date must use YYYY-MM-DD.');
        const nextSlot = validDaypart(values.slot);
        const removed = live.current.plans.some((plan) => plan.date === nextDate && plan.slot === nextSlot);
        setPlans((current) => current.filter((plan) => plan.date !== nextDate || plan.slot !== nextSlot));
        setStatus(removed ? `Removed ${daypartLabels[nextSlot].toLowerCase()} plan from ${nextDate}.` : `No ${daypartLabels[nextSlot].toLowerCase()} plan found on ${nextDate}.`);
        return { date: nextDate, slot: nextSlot, removed };
      },
    });

    register({
      name: 'list_calendar_plans',
      title: 'List calendar plans',
      description: 'Read locally saved outfit plans and cached daily weather for one YYYY-MM month without changing the interface.',
      inputSchema: {
        type: 'object',
        properties: { month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } },
        required: ['month'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const values = asRecord(input);
        const month = validString(values.month, 'month');
        if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must use YYYY-MM.');
        return {
          month,
          plans: live.current.plans
            .filter((plan) => plan.date.startsWith(month))
            .map((plan) => ({ date: plan.date, slot: plan.slot, occasion: plan.occasion, outfitId: plan.outfit.id, itemIds: plan.outfit.items.map((item) => item.id) })),
          weather: Object.values(live.current.weatherDays)
            .filter((day) => day.date.startsWith(month))
            .map((day) => ({ date: day.date, low: day.low, high: day.high, precipitation: day.precipitation, code: day.code })),
        };
      },
    });

    register({
      name: 'record_wear',
      title: 'Record this outfit as worn',
      description: 'Add the currently visible outfit to wear history for a date and accept any inline recolor previews into the wardrobe.',
      inputSchema: {
        type: 'object',
        properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        required: ['date'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        if (!state.look) throw new Error('Generate an outfit before recording wear.');
        const values = asRecord(input);
        const nextDate = validString(values.date, 'date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) throw new Error('date must use YYYY-MM-DD.');
        const committed = commitLookVariants(state.look);
        const entry = { id: `wear-${Date.now()}`, date: nextDate, outfit: committed.outfit };
        setHistory((current) => [entry, ...current]);
        setLook(committed.outfit);
        setStatus(committed.savedCount ? `Saved ${committed.savedCount} recolored ${committed.savedCount === 1 ? 'piece' : 'pieces'} and recorded ${state.look.title} as worn on ${nextDate}.` : `Recorded ${state.look.title} as worn on ${nextDate}.`);
        return { historyId: entry.id, date: nextDate, outfitId: committed.outfit.id, savedVariantIds: committed.outfit.items.filter((item) => item.variantOf && item.imageSrc).map((item) => item.id) };
      },
    });

    register({
      name: 'set_preferences',
      title: 'Set outfit preferences',
      description: 'Update visible outfit preferences and regenerate the current suggestion.',
      inputSchema: {
        type: 'object',
        properties: {
          palette: { type: 'string', enum: ['balanced', 'neutral', 'colorful'] },
          includeHeadwear: { type: 'boolean' },
          avoid: { type: 'string' },
          note: { type: 'string' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const nextPreferences = {
          palette: values.palette === undefined ? state.preferences.palette : validPalette(values.palette),
          includeHeadwear: values.includeHeadwear === undefined ? state.preferences.includeHeadwear : Boolean(values.includeHeadwear),
          avoid: validString(values.avoid, 'avoid', state.preferences.avoid),
          note: validString(values.note, 'note', state.preferences.note),
        };
        const result = buildOutfit(state.items, state.occasion, nextPreferences, recentIds(state.history), `${state.date}:preferences`);
        setPreferences(nextPreferences);
        setLook(result);
        setStatus(`Preferences updated. ${result.title} is now visible.`);
        return { preferences: nextPreferences, outfitId: result.id };
      },
    });

    register({
      name: 'generate_outfit_batch',
      title: 'Generate an outfit batch',
      description: 'Generate and visibly display 1 to 12 distinct wardrobe outfits for one dated request without image generation. Required item IDs appear in every result; excluded IDs never appear.',
      inputSchema: {
        type: 'object',
        properties: {
          occasion: { type: 'string', enum: ['work', 'casual', 'dinner', 'event'] },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          count: { type: 'integer', minimum: 1, maximum: 12 },
          palette: { type: 'string', enum: ['balanced', 'neutral', 'colorful'] },
          includeHeadwear: { type: 'boolean' },
          avoid: { type: 'string' },
          note: { type: 'string' },
          seed: { type: 'string' },
          requiredItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 4 },
          excludedItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        required: ['occasion', 'count'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const nextOccasion = validOccasion(values.occasion);
        const nextDate = values.date === undefined ? state.date : validIsoDate(values.date);
        const count = Number(values.count);
        if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('count must be an integer from 1 to 12.');
        const requiredItemIds = validItemIdList(values.requiredItemIds, 'requiredItemIds');
        const excludedItemIds = validItemIdList(values.excludedItemIds, 'excludedItemIds');
        const nextPreferences = {
          palette: values.palette === undefined ? state.preferences.palette : validPalette(values.palette),
          includeHeadwear: values.includeHeadwear === undefined ? state.preferences.includeHeadwear : Boolean(values.includeHeadwear),
          avoid: validString(values.avoid, 'avoid', state.preferences.avoid),
          note: validString(values.note, 'note', state.preferences.note),
        };
        const resolvedSeed = values.seed === undefined ? `${nextDate}:batch:${batchRevision.current++}` : validString(values.seed, 'seed');
        const results = buildOutfitBatch(state.items, nextOccasion, nextPreferences, recentIds(state.history), count, resolvedSeed, { requiredItemIds, excludedItemIds });
        setDate(nextDate);
        setCalendarMonth(nextDate.slice(0, 7));
        setOccasion(nextOccasion);
        setPreferences(nextPreferences);
        setBatchCount(count);
        setBatchLooks(results);
        setActivePanel('batch');
        setStatus(`${results.length} distinct ${occasionLabels[nextOccasion].toLowerCase()} looks ready.`);
        return {
          count: results.length,
          date: nextDate,
          requiredItemIds,
          excludedItemIds,
          outfits: results.map((outfit) => ({ outfitId: outfit.id, title: outfit.title, score: outfit.score, itemIds: outfit.items.map((item) => item.id) })),
        };
      },
    });

    register({
      name: 'plan_outfit_week',
      title: 'Plan an outfit week',
      description: 'Build 2 or 3 weekly outfit options from cached weather, calendar occasions, preferences, and wear history. Required item IDs appear in every generated entry; excluded IDs never appear.',
      inputSchema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          days: { type: 'integer', minimum: 1, maximum: 7 },
          optionCount: { type: 'integer', minimum: 2, maximum: 3 },
          dayparts: { type: 'array', items: { type: 'string', enum: ['morning', 'day', 'evening'] }, minItems: 1, maxItems: 3, uniqueItems: true },
          occasion: { type: 'string', enum: ['work', 'casual', 'dinner', 'event'] },
          palette: { type: 'string', enum: ['balanced', 'neutral', 'colorful'] },
          includeHeadwear: { type: 'boolean' },
          avoid: { type: 'string' },
          note: { type: 'string' },
          seed: { type: 'string' },
          requiredItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 4 },
          excludedItemIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        required: ['startDate'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const startDate = validIsoDate(values.startDate, 'startDate');
        const days = values.days === undefined ? 5 : Number(values.days);
        const optionCount = values.optionCount === undefined ? 3 : Number(values.optionCount);
        if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('days must be an integer from 1 to 7.');
        if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 3) throw new Error('optionCount must be 2 or 3.');
        const rawDayparts = values.dayparts === undefined ? ['day'] : values.dayparts;
        if (!Array.isArray(rawDayparts)) throw new Error('dayparts must be an array.');
        const nextDayparts = rawDayparts.map((slot) => validDaypart(slot));
        if (new Set(nextDayparts).size !== nextDayparts.length) throw new Error('dayparts must contain unique slots.');
        const nextOccasion = values.occasion === undefined ? state.occasion : validOccasion(values.occasion);
        const requiredItemIds = validItemIdList(values.requiredItemIds, 'requiredItemIds');
        const excludedItemIds = validItemIdList(values.excludedItemIds, 'excludedItemIds');
        const nextPreferences = {
          palette: values.palette === undefined ? state.preferences.palette : validPalette(values.palette),
          includeHeadwear: values.includeHeadwear === undefined ? state.preferences.includeHeadwear : Boolean(values.includeHeadwear),
          avoid: validString(values.avoid, 'avoid', state.preferences.avoid),
          note: validString(values.note, 'note', state.preferences.note),
        };
        const results = buildWeekPlanOptions(
          state.items,
          startDate,
          days,
          nextDayparts,
          nextOccasion,
          state.plans.map((plan) => ({ date: plan.date, slot: plan.slot, occasion: plan.occasion })),
          nextPreferences,
          recentIds(state.history),
          state.weatherDays,
          optionCount,
          validString(values.seed, 'seed', `${startDate}:week`),
          { requiredItemIds, excludedItemIds },
        );
        setWeekStartDate(startDate);
        setDate(startDate);
        setCalendarMonth(startDate.slice(0, 7));
        setWeekDays(days);
        setWeekDaypartsMode(nextDayparts.length === 1 && nextDayparts[0] === 'day' ? 'day' : 'all');
        setWeekOptionCount(optionCount as 2 | 3);
        setPreferences(nextPreferences);
        setOccasion(nextOccasion);
        setWeekOptions(results);
        setSelectedWeekOption(0);
        setActivePanel('week');
        setStatus(`${results.length} weekly outfit options ready for review.`);
        return {
          startDate,
          days,
          dayparts: nextDayparts,
          requiredItemIds,
          excludedItemIds,
          requiresSelection: true,
          options: results.map((option) => ({
            optionId: option.id,
            label: option.label,
            score: option.score,
            conflicts: option.conflicts,
            tradeoffs: option.tradeoffs,
            entries: option.entries.map((entry) => ({ date: entry.date, slot: entry.slot, occasion: entry.occasion, score: entry.score, itemIds: entry.outfit.items.map((item) => item.id), reasons: entry.reasons, weather: entry.weather ? { low: entry.weather.low, high: entry.weather.high, precipitation: entry.weather.precipitation, code: entry.weather.code } : null })),
          })),
        };
      },
    });

    register({
      name: 'apply_week_plan',
      title: 'Apply a weekly outfit plan',
      description: 'Schedule one previously reviewed weekly option into the local calendar, preserving the three-slots-per-day limit.',
      inputSchema: {
        type: 'object',
        properties: { optionId: { type: 'string' } },
        required: ['optionId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const state = live.current;
        const values = asRecord(input);
        const optionId = validString(values.optionId, 'optionId');
        const option = state.weekOptions.find((candidate) => candidate.id === optionId);
        if (!option) throw new Error('Generate a weekly plan first, then apply one of its option IDs.');
        const generated = new Map(option.entries.map((entry) => [`${entry.date}:${entry.slot}`, { id: `plan-${entry.date}-${entry.slot}`, date: entry.date, slot: entry.slot, occasion: entry.occasion, outfit: entry.outfit }]));
        setPlans((current) => [...current.filter((plan) => !generated.has(`${plan.date}:${plan.slot}`)), ...generated.values()].sort((a, b) => a.date.localeCompare(b.date) || daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot)));
        const firstEntry = option.entries[0];
        setDate(firstEntry?.date ?? state.date);
        setDaypart(firstEntry?.slot ?? 'day');
        setOccasion(firstEntry?.occasion ?? state.occasion);
        setLook(firstEntry?.outfit ?? state.look);
        setCalendarMonth((firstEntry?.date ?? state.date).slice(0, 7));
        setActivePanel(null);
        setStatus(`${option.label} added to the calendar.`);
        return { optionId, added: option.entries.length, dates: [...new Set(option.entries.map((entry) => entry.date))] };
      },
    });

    register({
      name: 'recolor_item',
      title: 'Recolor a wardrobe item',
      description: 'Recolor one catalog item in a low-resolution browser canvas and display a preview in the CLOTHO recolor lab; saving it as a wardrobe variant requires the explicit Save as wardrobe variant action.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        },
        required: ['itemId', 'color'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const values = asRecord(input);
        const itemId = validString(values.itemId, 'itemId');
        const color = validString(values.color, 'color');
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('color must be a six-digit hex value such as #7A1F3D.');
        const item = live.current.items.find((candidate) => candidate.id === itemId);
        if (!item) throw new Error(`Unknown wardrobe item: ${itemId}.`);
        const src = await recolorImage(cleanImagePath(item), color);
        setRecolorItemId(itemId);
        setRecolorColor(color);
        setRecolorPreview({ item, color, src });
        setActivePanel('recolor');
        setStatus(`${item.name} recolored to ${color}.`);
        return { itemId, color, status: 'rendered' };
      },
    });

    return () => lifecycle.abort();
  }, [commitHandoff, commitLookVariants, handoffIncludeHeadwear, importImageUrl, items.length, weatherDays]);

  const shownItems = useMemo(() => {
    const matchingItems = category === 'all' ? items : items.filter((item) => item.category === category);
    return [...matchingItems].sort((left, right) => Number(right.id.startsWith('local-import-')) - Number(left.id.startsWith('local-import-')));
  }, [category, items]);
  const cells = useMemo(() => monthCells(calendarMonth), [calendarMonth]);
  const selectedDatePlans = useMemo(
    () => plans.filter((plan) => plan.date === date).sort((a, b) => daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot)),
    [date, plans],
  );
  const wornItems = useMemo(() => {
    const counts = new Map<string, { item: WardrobeItem; count: number }>();
    history.forEach((entry) => entry.outfit.items.forEach((item) => {
      const existing = counts.get(item.id);
      counts.set(item.id, { item, count: (existing?.count ?? 0) + 1 });
    }));
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  }, [history]);
  const rememberedItemCount = useMemo(() => new Set(history.flatMap((entry) => entry.outfit.items.map((item) => item.id))).size, [history]);
  const slots = useMemo(() => outfitOrder.map((slot) => ({ slot, item: look?.items.find((item) => item.category === slot) })), [look]);
  const calendarDraft = useMemo(() => {
    if (!items.length || !calendarItemIds.tops || !calendarItemIds.bottoms || !calendarItemIds.shoes) return null;
    return buildCustomOutfit(items, calendarItemIds, occasion, preferences, recentIds(history), `${date}:calendar-draft`);
  }, [calendarItemIds, date, history, items, occasion, preferences]);
  const selectedRecolorItem = items.find((item) => item.id === recolorItemId);
  const displayPath = useCallback((item: WardrobeItem, clean = false) => {
    if (recolorPreview?.item.id === item.id) return recolorPreview.src;
    return clean ? cleanImagePath(item) : imagePath(item);
  }, [recolorPreview]);
  const paletteSliderIndex = Math.max(0, paletteStops.findIndex(({ value }) => value === preferences.palette));

  return (
    <main className="min-h-screen bg-[#fcfbf8] text-[#171715]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/10 bg-[#fcfbf8]/95 px-5 py-4 backdrop-blur-md md:px-10 lg:px-16">
        <a className="flex shrink-0 items-baseline gap-3" href="#top">
          <img
            alt="CLOTHO · Classy Looks for Occasion, Taste, History & Outfits"
            className="clotho-logo"
            decoding="async"
            height="195"
            src="/branding/clotho-logo.png"
            width="1283"
          />
          <span className="hidden text-[8px] uppercase tracking-[.12em] text-black/40 xl:inline">Classy Looks for Occasion, Taste, History &amp; Outfits</span>
        </a>
        <nav className="top-nav flex min-w-0 gap-4 overflow-x-auto text-[10px] uppercase tracking-[0.14em] text-black/55 md:gap-8 md:text-[11px]" aria-label="Open CLOTHO panels">
          <button className="nav-link" onClick={() => setActivePanel('wardrobe')} type="button">Wardrobe</button>
          <button className="nav-link" onClick={() => setActivePanel('calendar')} type="button">Calendar</button>
          <button className="nav-link" onClick={() => setActivePanel('batch')} type="button">Batch</button>
          <button className="nav-link" onClick={() => setActivePanel('week')} type="button">Week plan</button>
          <button className="nav-link" onClick={() => setActivePanel('journal')} type="button">History + taste</button>
          <button className="nav-link hidden sm:inline" onClick={() => setActivePanel('recolor')} type="button">Recolor</button>
          <button className="nav-link" onClick={() => setActivePanel('image-import')} type="button">Image import</button>
        </nav>
      </header>

      <section id="top" className="mx-auto grid min-h-[calc(100vh-69px)] max-w-[1500px] grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,.7fr)]">
        <div className="border-black/10 px-5 py-8 md:px-10 lg:border-r lg:px-16 lg:py-10">
          <div className="mb-7 flex items-end justify-between gap-6">
            <div className="blur-in"><p className="mb-1 font-serif text-[clamp(2.2rem,5vw,5.4rem)] leading-[.9] tracking-[-.06em]">Today’s look</p><p className="script-note -rotate-2 text-[#972d3f]">seen as one silhouette</p></div>
            <p className="hidden max-w-52 text-right text-xs leading-5 text-black/48 md:block">Existing images stacked into one standing look. No composite generation.</p>
          </div>

          <button
            aria-label="Current outfit ordered from headwear to shoes. Click a piece to select it for recoloring, or click the open space to enlarge."
            className="outfit-composition"
            disabled={!look}
            onClick={(event) => {
              const piece = (event.target as HTMLElement).closest<HTMLElement>('[data-piece-select]');
              if (piece?.dataset.pieceSelect) {
                event.preventDefault();
                selectOccasionPiece(piece.dataset.pieceSelect as Category);
                return;
              }
              if (look) openLookPreview(look);
            }}
            type="button"
          >
            {slots.map(({ slot, item }) => (
              <figure
                aria-label={item ? `Select ${outfitSlotLabels[slot].toLowerCase()} to recolor` : `${outfitSlotLabels[slot]} is not in this look`}
                className={`outfit-piece outfit-piece--${slot} ${item && occasionRecolorCategory === slot ? 'is-recolor-target' : ''}`}
                data-piece-select={item ? slot : undefined}
                key={slot}
              >
                <figcaption>{outfitSlotLabels[slot]}</figcaption>
                {item ? <img src={displayPath(item, true)} alt={`${item.name}, ${item.color}`} /> : <span className="outfit-empty">none</span>}
              </figure>
            ))}
          </button>

          <div className="mt-5 flex items-end justify-between gap-5">
            <div><p className="font-serif text-2xl tracking-[-.03em]">{look?.title ?? 'Reading the wardrobe'}</p><p className="mt-1 text-xs text-black/45">{look ? `${look.score}/100 compatibility · ordered headwear, top, bottom, shoes` : status}</p></div>
            <button className="text-link shrink-0" onClick={anotherLook} type="button">Another look ↗</button>
          </div>
        </div>

        <aside id="plan" className="flex flex-col justify-between px-5 py-8 md:px-10 lg:px-12 lg:py-10">
          <div>
            <p className="eyebrow">Occasion lens</p>
            <h1 className="mt-4 max-w-md font-serif text-[clamp(2.3rem,4vw,4.6rem)] leading-[.96] tracking-[-.055em]">Dress for what is actually happening.</h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-black/55">The date, occasion, preferences, and recent wear all affect the same deterministic score.</p>
            <label className="field-line mt-12"><span>Date</span><input value={date} onChange={(event) => { setDate(event.target.value); setCalendarMonth(event.target.value.slice(0, 7)); }} type="date" /></label>
            <label className="field-line"><span>Occasion</span><select value={occasion} onChange={(event) => { const nextOccasion = event.target.value as Occasion; setOccasion(nextOccasion); makeLook(nextOccasion, preferences, seed + 1); }}>{Object.entries(occasionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field-line"><span>Time</span><select value={daypart} onChange={(event) => setDaypart(event.target.value as Daypart)}>{daypartOrder.map((slot) => <option key={slot} value={slot}>{daypartLabels[slot]}</option>)}</select></label>
            <div className="occasion-recolor">
              <div className="occasion-recolor-heading"><p className="eyebrow">Recolor this look</p><span>Four pieces, one decision at a time</span></div>
              <div className="occasion-recolor-rows">
                {outfitOrder.map((slot) => {
                  const item = look?.items.find((candidate) => candidate.category === slot);
                  const color = occasionRecolorColors[slot] ?? defaultOccasionRecolorColors[slot];
                  const busy = occasionRecolorBusy === slot;
                  return <div className={`occasion-recolor-row ${occasionRecolorCategory === slot ? 'is-active' : ''}`} key={slot}>
                    <button aria-label={item ? `Select ${outfitSlotLabels[slot].toLowerCase()} to recolor` : `${outfitSlotLabels[slot]} is not in this look`} className="occasion-piece-select" disabled={!item} onClick={() => selectOccasionPiece(slot)} type="button"><span className="occasion-piece-label">{outfitSlotLabels[slot]}</span><span className="occasion-piece-name">{item?.name ?? 'Not in this look'}</span></button>
                    <label className="occasion-color-control"><span className="sr-only">Color for {outfitSlotLabels[slot].toLowerCase()}</span><input aria-label={`Color for ${outfitSlotLabels[slot].toLowerCase()}`} disabled={Boolean(occasionRecolorBusy) || !item} type="color" value={color} onChange={(event) => setOccasionRecolorColors((current) => ({ ...current, [slot]: event.target.value.toUpperCase() }))} /></label>
                    <code>{color}</code>
                    <button className="text-link" disabled={Boolean(occasionRecolorBusy) || !item} onClick={() => void recolorOccasionPiece(slot)} type="button">{busy ? 'Recoloring…' : 'Recolor →'}</button>
                  </div>;
                })}
              </div>
              <p className="occasion-recolor-note">Select a row or click a piece in the silhouette. Recolor stays a preview; “I wore this” accepts every inline recolor into the wardrobe.</p>
            </div>
          </div>
          <div className="mt-12 border-t border-black/10 pt-5">
            <button className="text-link text-base" onClick={() => planLook()} type="button">Place look on calendar →</button>
            <p className="mt-3 text-[11px] leading-5 text-black/40">Up to three moments per day: morning, day, and evening. Browser-local, WebMCP-readable.</p>
          </div>
        </aside>
      </section>

      {activePanel === 'wardrobe' && <section id="wardrobe" className="panel-sheet">
        <div className="mx-auto max-w-[1372px]">
          <div className="section-heading"><div><p className="eyebrow">Wardrobe</p><h2>Everything already owned.</h2></div><p>{items.length} wardrobe pieces, including {items.filter((item) => item.variantOf).length} saved color variants. CLOTHO combines these references instead of paying to generate each outfit.</p></div>
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 border-b border-black/10 pb-4">{Object.entries(categoryLabels).map(([value, label]) => <button className={`filter-link ${category === value ? 'is-active' : ''}`} key={value} onClick={() => setCategory(value as keyof typeof categoryLabels)} type="button">{value === 'all' ? `${label} ${items.length}` : label}</button>)}</div>
          <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{shownItems.map((item) => <figure key={item.id}><div className="aspect-square overflow-hidden bg-white"><img className="h-full w-full object-contain p-[7%]" src={displayPath(item)} alt={`${item.name}, ${item.color}`} loading="lazy" /></div><figcaption className="mt-3"><p className="font-serif text-base leading-tight">{item.name}</p><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-black/42">{item.id} · {item.color}</p>{item.id.startsWith('local-import-') && <button className="text-link mt-2 text-[11px] text-[#972d3f]" onClick={() => removeImportedItem(item.id)} type="button">Remove</button>}</figcaption></figure>)}</div>
        </div>
      </section>}

      {activePanel === 'image-import' && <section id="image-import" className="panel-sheet">
        <div className="mx-auto max-w-[1372px]">
          <div className="image-import-minimal"><p className="eyebrow">Wardrobe import</p><h2>Add an image to your wardrobe.</h2></div>
          <div className="image-import-url">
            <label className="field-line"><span>Image URL</span><input aria-label="Image URL" type="url" placeholder="https://..." value={remoteImageUrl} onChange={(event) => { setRemoteImageUrl(event.target.value); setHandoffError(''); }} /></label>
            <button className="text-link" disabled={!remoteImageUrl.trim() || handoffBusy} onClick={() => void importImageUrl(remoteImageUrl.trim(), handoffIncludeHeadwear).catch((error) => setHandoffError(error instanceof Error ? error.message : 'The image URL could not be imported.'))} type="button">Preview image →</button>
          </div>
          <label className="field-line image-import-layout"><span>Grid includes</span><select aria-label="Grid includes" value={handoffIncludeHeadwear ? 'headwear' : 'no-headwear'} onChange={(event) => { const includeHeadwear = event.target.value === 'headwear'; setHandoffIncludeHeadwear(includeHeadwear); setHandoffResult(null); live.current.handoffResult = null; setHandoffError(''); }}><option value="headwear">Headwear · 4 pieces</option><option value="no-headwear">No headwear · 3 pieces</option></select></label>
          {handoffBusy && <output className="handoff-message">Preparing…</output>}
          {handoffError && <p className="handoff-minimal-error" role="alert">{handoffError}</p>}
          {handoffResult && <figure className="handoff-result">
            <div className="handoff-result-media">
              <div className="handoff-preview"><img src={handoffResult.previewUrl} alt="Imported wardrobe preview" /></div>
              {handoffResult.crops && <div className="handoff-crops" aria-label="Selected wardrobe crop previews">{handoffResult.crops.map((crop) => <figure className="handoff-crop" key={crop.category}><div><img src={crop.src} alt={`${crop.label} crop preview`} /></div><figcaption>{crop.label}</figcaption></figure>)}</div>}
            </div>
            <figcaption className="handoff-result-caption"><div><p className="eyebrow">{handoffResult.remoteUrl ? 'Image URL' : 'Local image'}</p>{handoffResult.remoteUrl ? <a className="local-image-source" href={handoffResult.remoteUrl} rel="noreferrer" target="_blank">{handoffResult.remoteUrl} ↗</a> : <code className="local-image-source">{handoffResult.source}</code>}{handoffResult.committed ? <p className="handoff-confirmed">Saved locally.</p> : <button className="text-link" onClick={() => { try { commitHandoff(handoffResult.id); } catch (error) { setHandoffError(error instanceof Error ? error.message : 'The wardrobe import could not be saved.'); } }} type="button">Accept {handoffResult.crops?.length ?? 0} pieces →</button>}</div></figcaption>
          </figure>}
        </div>
      </section>}

      {activePanel === 'calendar' && <section id="calendar" className="panel-sheet">
        <div className="mx-auto max-w-[1372px]">
          <div className="section-heading"><div><p className="eyebrow">Calendar</p><h2>Decide once. Wear later.</h2></div><p>A real seven-column month view. Each date holds up to three moments: morning, day, and evening.</p></div>
          <div className="weather-strip"><span className="eyebrow">Weather · New York City</span><span>{weatherStatus}</span></div>
          <div className="calendar-toolbar mt-6"><button aria-label="Previous month" onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))} type="button">←</button><p>{monthTitle(calendarMonth)}</p><button aria-label="Next month" onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))} type="button">→</button></div>
          <div className="calendar-scroll">
            <div className="calendar-grid" aria-label={monthTitle(calendarMonth)}>
              {weekdays.map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
              {cells.map((cell) => {
                const dayPlans = plans.filter((entry) => entry.date === cell.date).sort((a, b) => daypartOrder.indexOf(a.slot) - daypartOrder.indexOf(b.slot)).slice(0, 3);
                const dayWeather = weatherDays[cell.date];
                return <button aria-label={`Select ${cell.date}${dayWeather ? `, ${weatherLabel(dayWeather.code)}, ${dayWeather.low} to ${dayWeather.high} degrees` : ''}${dayPlans.length ? `, ${dayPlans.length} outfit${dayPlans.length === 1 ? '' : 's'} planned` : ''}`} className={`calendar-day ${!cell.inMonth ? 'is-outside' : ''} ${cell.date === date ? 'is-selected' : ''}`} key={cell.date} onClick={() => { setDate(cell.date); setCalendarMonth(cell.date.slice(0, 7)); }} type="button"><span className="calendar-day-top"><time dateTime={cell.date}>{cell.day}</time>{dayWeather && <span className="calendar-weather" title={`${weatherLabel(dayWeather.code)} · ${dayWeather.precipitation}% rain`}><b>{weatherIcon(dayWeather.code)}</b><small>{dayWeather.low}°/{dayWeather.high}°</small></span>}</span>{dayPlans.map((plan) => <span className={`calendar-event calendar-event--${plan.occasion}`} key={plan.id}><span>{daypartLabels[plan.slot]} · {occasionLabels[plan.occasion]}</span><small>{plan.outfit.items.length} pieces</small></span>)}</button>;
              })}
            </div>
          </div>
          <div className="calendar-editor">
            <div className="calendar-editor-heading">
              <div><p className="eyebrow">Selected date · {date}</p><h3>{selectedDatePlans.length ? `${selectedDatePlans.length} planned moment${selectedDatePlans.length === 1 ? '' : 's'}` : 'No planned moments yet'}</h3></div>
              <button className="text-link" onClick={() => setActivePanel(null)} type="button">Back to planner ↗</button>
            </div>
            {selectedDatePlans.length ? <div className="calendar-edit-list">{selectedDatePlans.map((plan) => <article className="calendar-edit-row" key={plan.id}>
              <button aria-label={`Preview ${plan.outfit.title} for ${daypartLabels[plan.slot].toLowerCase()}`} className="calendar-plan-preview-trigger" onClick={() => openLookPreview(plan.outfit, `${daypartLabels[plan.slot]} · ${plan.date}`)} type="button">
                <div aria-label={`${plan.outfit.title} preview`} className="calendar-outfit-preview">{outfitOrder.map((slot) => { const item = plan.outfit.items.find((candidate) => candidate.category === slot); return item ? <img className={`calendar-preview-piece calendar-preview-piece--${slot}`} key={slot} src={displayPath(item, true)} alt="" /> : null; })}</div>
                <div><p className="eyebrow">{daypartLabels[plan.slot]} · {occasionLabels[plan.occasion]}</p><p className="mt-1 font-serif text-xl">{plan.outfit.title}</p><p className="mt-1 text-[11px] text-black/45">{plan.outfit.items.map((item) => item.name).join(' · ')}</p></div>
              </button>
              <div className="calendar-edit-actions"><button className="text-link" onClick={() => editPlan(plan)} type="button">Edit</button><button className="text-link text-[#972d3f]" onClick={() => removePlan(plan)} type="button">Remove</button></div>
            </article>)}</div> : <p className="calendar-empty">Select a moment in the planner, then place a look here.</p>}
            <div className="calendar-add" id="calendar-add">
              <div className="calendar-editor-heading"><div><p className="eyebrow">Add a moment · {date}</p><h3>Select each piece.</h3></div>{calendarDraft && <span>{calendarDraft.score}/100 fit</span>}</div>
              <label className="field-line calendar-add-occasion"><span>Moment</span><select value={daypart} onChange={(event) => setDaypart(event.target.value as Daypart)}>{daypartOrder.map((slot) => <option key={slot} value={slot}>{daypartLabels[slot]}</option>)}</select></label>
              <label className="field-line calendar-add-occasion"><span>Occasion</span><select value={occasion} onChange={(event) => { const nextOccasion = event.target.value as Occasion; setOccasion(nextOccasion); makeLook(nextOccasion, preferences, seed + 1); }}>{Object.entries(occasionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <div className="calendar-item-grid">
                {outfitOrder.map((slot) => {
                  const options = items.filter((item) => item.category === slot);
                  return <label className="field-line" key={slot}><span>{outfitSlotLabels[slot]}</span><select aria-label={`Select ${outfitSlotLabels[slot].toLowerCase()}`} value={calendarItemIds[slot] ?? ''} onChange={(event) => setCalendarItemIds((current) => ({ ...current, [slot]: event.target.value || undefined }))}>{slot === 'headwear' && <option value="">No headwear</option>}{options.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>;
                })}
              </div>
              <div className="calendar-add-actions">
                {calendarDraft && <button aria-label="Preview the selected calendar combination" className="calendar-draft" onClick={() => openLookPreview(calendarDraft, `Draft preview · ${date}`)} type="button"><div aria-label={`${calendarDraft.title} preview`} className="calendar-outfit-preview">{outfitOrder.map((slot) => { const item = calendarDraft.items.find((candidate) => candidate.category === slot); return item ? <img className={`calendar-preview-piece calendar-preview-piece--${slot}`} key={slot} src={displayPath(item, true)} alt="" /> : null; })}</div><div><p className="eyebrow">Curated combination</p><p className="mt-1 text-[11px] text-black/45">{calendarDraft.items.map((item) => item.name).join(' · ')}</p></div></button>}
                <button className="text-link" disabled={!calendarDraft} onClick={() => { if (calendarDraft) planLook(calendarDraft, date, occasion, false); }} type="button">Add selected pieces →</button>
              </div>
            </div>
            <p className="calendar-editor-note">Choose each piece independently; headwear can be omitted. Adding the same moment again replaces that date and slot.</p>
          </div>
        </div>
      </section>}

      {activePanel === 'journal' && <section id="journal" className="panel-sheet history-sheet">
        <div className="history-hero">
          <div><p className="eyebrow">Memory + taste</p><h2 className="editorial-title mt-4">Dress with a memory.</h2><p className="mt-5 max-w-xl text-sm leading-6 text-black/55">Wear history lowers repetition. Taste reshapes the same wardrobe score. Every change below updates the visible look and persists in this browser.</p></div>
          <div className="history-metrics"><div><strong>{history.length}</strong><span>logged wears</span></div><div><strong>{rememberedItemCount}</strong><span>pieces remembered</span></div><div><strong>{preferences.includeHeadwear ? 'On' : 'Off'}</strong><span>headwear</span></div></div>
        </div>
        <div className="history-layout">
          <div className="history-column">
            <div className="history-column-heading"><div><p className="eyebrow">Wear history</p><h3>Recent rotation</h3></div><span>{history.length ? `Latest ${history[0].date}` : 'No entries yet'}</span></div>
            <div className="history-timeline">{history.length ? history.slice(0, 8).map((entry) => <article className="history-entry" key={entry.id}>
              <div className="history-entry-rule" />
              <div className="history-entry-body"><div className="history-entry-main">
                <button aria-label={`Preview ${entry.outfit.title} worn ${entry.date}`} className="calendar-outfit-preview history-outfit-preview" onClick={() => openLookPreview(entry.outfit, `Worn · ${entry.date}`)} type="button">{outfitOrder.map((slot) => { const item = entry.outfit.items.find((candidate) => candidate.category === slot); return item ? <img className={`calendar-preview-piece calendar-preview-piece--${slot}`} key={slot} src={displayPath(item)} alt="" /> : null; })}</button>
                <div className="history-entry-copy"><div className="history-entry-header"><div><p className="history-entry-title">{entry.outfit.title}</p><p className="history-entry-meta">Worn {entry.date} · {entry.outfit.score}/100</p></div><button className="text-link history-entry-use" onClick={() => reuseHistoryLook(entry)} type="button">Use look ↗</button></div><div className="history-item-list">{entry.outfit.items.map((item) => <span key={item.id}>{item.name}</span>)}</div></div>
              </div></div>
            </article>) : <p className="history-empty">Your first wear will appear here. Use “I wore this” from the planner.</p>}</div>
            {wornItems.length > 0 && <div className="worn-items"><p className="eyebrow">Most repeated pieces</p><div className="worn-item-list">{wornItems.map(({ item, count }) => <span key={item.id}>{item.name} <b>×{count}</b></span>)}</div></div>}
          </div>
          <div id="preferences" className="taste-column">
            <div className="history-column-heading"><div><p className="eyebrow">Taste</p><h3>Make the rules yours.</h3></div><span>Live ranking</span></div>
            <p className="taste-intro">These are constraints, not a generator. CLOTHO still chooses only from your saved wardrobe references.</p>
            <div className="taste-field"><div className="taste-field-heading"><p className="eyebrow">Palette direction</p><span className="taste-slider-current">{paletteStops[paletteSliderIndex].label}</span></div>
              <div className="taste-slider">
                <div aria-hidden="true" className="taste-slider-track"><span className="taste-slider-progress" style={{ width: `${paletteSliderIndex * 50}%` }} /></div>
                <input aria-label="Palette direction" aria-valuetext={`${paletteStops[paletteSliderIndex].label}: ${paletteStops[paletteSliderIndex].note}`} className="taste-slider-input" max={paletteStops.length - 1} min="0" onChange={(event) => { const nextPalette = paletteStops[Number(event.target.value)]?.value; if (nextPalette) updatePreferences({ ...preferences, palette: nextPalette }); }} step="1" type="range" value={paletteSliderIndex} />
                <div aria-hidden="true" className="taste-slider-stops">{paletteStops.map((stop) => <span key={stop.value}>{stop.label}</span>)}</div>
              </div>
              <p className="taste-slider-caption">Drag from soft harmony to higher contrast. This is the same palette value used by recommendations and WebMCP.</p>
            </div>
            <label className="taste-field taste-avoid"><span className="eyebrow">Avoid a color or style</span><input aria-label="Color or style to avoid" placeholder="e.g. orange" type="text" value={preferences.avoid} onChange={(event) => setPreferences({ ...preferences, avoid: event.target.value })} onBlur={(event) => updatePreferences({ ...preferences, avoid: event.currentTarget.value })} /><small>Applied when you leave the field; matching pieces drop out of the next score.</small></label>
            <label className="taste-field taste-avoid"><span className="eyebrow">Personal taste note</span><input aria-label="Personal taste note" placeholder="e.g. relaxed tailoring, quiet layers" type="text" value={preferences.note} onChange={(event) => setPreferences({ ...preferences, note: event.target.value })} onBlur={(event) => updatePreferences({ ...preferences, note: event.currentTarget.value })} /><small>Saved for WebMCP context; matching words gently influence the next ranking.</small></label>
            <label aria-label="Include headwear" className="taste-toggle"><span><span className="eyebrow">Headwear</span><small>Keep a fourth piece in the silhouette.</small></span><input checked={preferences.includeHeadwear} className="h-4 w-4 accent-[#972d3f]" onChange={(event) => updatePreferences({ ...preferences, includeHeadwear: event.target.checked })} type="checkbox" /></label>
            <p className="taste-note">Change a rule, then watch the current look change. Record a wear and the same pieces are gently deprioritized next time.</p>
          </div>
        </div>
      </section>}

      {activePanel === 'batch' && <section id="batch" className="panel-sheet">
        <div className="mx-auto max-w-[1372px]">
          <div className="section-heading"><div><p className="eyebrow">Batch studio</p><h2>One request. Several ways to dress.</h2></div><p>Each click advances a variation seed, so the same request can surface new combinations without generated images or per-look API cost.</p></div>
          <div className="mt-8 grid gap-x-10 md:grid-cols-2">
            <label className="field-line"><span>Occasion</span><select value={occasion} onChange={(event) => setOccasion(event.target.value as Occasion)}>{Object.entries(occasionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field-line"><span>Outputs</span><select value={batchCount} onChange={(event) => setBatchCount(Number(event.target.value))}>{[3, 6, 9, 12].map((count) => <option key={count} value={count}>{count} looks</option>)}</select></label>
          </div>
          <button className="text-link mt-7" onClick={() => generateBatch()} type="button">Generate fitting batch →</button>
          {batchLooks.length ? <div className="batch-grid mt-10">{batchLooks.map((outfit, index) => <article className="batch-card" key={outfit.id}>
            <div className="batch-look" aria-label={`${outfit.title}, batch result ${index + 1}`}>{outfitOrder.map((slot) => { const item = outfit.items.find((candidate) => candidate.category === slot); return item ? <img className={`batch-piece batch-piece--${slot}`} key={slot} src={displayPath(item, true)} alt={`${item.name}, ${item.color}`} /> : null; })}</div>
            <div className="flex items-end justify-between gap-4 border-t border-black/10 pt-4"><div><p className="eyebrow">Look {String(index + 1).padStart(2, '0')}</p><p className="mt-1 font-serif text-lg">{outfit.score}/100</p></div><button className="text-link" onClick={() => selectBatchLook(outfit)} type="button">Use look</button></div>
          </article>)}</div> : <p className="mt-12 border-t border-black/10 py-8 font-serif text-xl text-black/38">Choose a request and generate the first batch.</p>}
        </div>
      </section>}

      {activePanel === 'week' && <section id="week-plan" className="panel-sheet">
        <div className="mx-auto max-w-[1372px]">
          <div className="section-heading"><div><p className="eyebrow">Week planner</p><h2>Plan around the week, not one morning.</h2></div><p>Weather, existing calendar occasions, taste, and recent wear become constraints. Review several options before anything is scheduled.</p></div>
          <div className="mt-8 grid gap-x-10 md:grid-cols-2 lg:grid-cols-4">
            <label className="field-line"><span>Starts</span><input value={weekStartDate} onChange={(event) => setWeekStartDate(event.target.value)} type="date" /></label>
            <label className="field-line"><span>Window</span><select value={weekDays} onChange={(event) => setWeekDays(Number(event.target.value))}><option value={5}>5 days</option><option value={7}>7 days</option></select></label>
            <label className="field-line"><span>Moments</span><select value={weekDaypartsMode} onChange={(event) => setWeekDaypartsMode(event.target.value as 'day' | 'all')}><option value="day">One daytime look</option><option value="all">Morning · day · evening</option></select></label>
            <label className="field-line"><span>Options</span><select value={weekOptionCount} onChange={(event) => setWeekOptionCount(Number(event.target.value) as 2 | 3)}><option value={2}>2 options</option><option value={3}>3 options</option></select></label>
          </div>
          <button className="text-link mt-7" onClick={() => generateWeekPlan()} type="button">Build weekly options →</button>
          {weekOptions.length ? <div className="week-options mt-10">{weekOptions.map((option, index) => <article className={`week-option ${selectedWeekOption === index ? 'is-selected' : ''}`} key={option.id}>
            <div className="flex items-start justify-between gap-5"><div><p className="eyebrow">{option.label}</p><p className="mt-2 font-serif text-2xl">{option.score}/100 average fit</p></div><button className="text-link" onClick={() => setSelectedWeekOption(index)} type="button">{selectedWeekOption === index ? 'Selected' : 'Review option'}</button></div>
            <div className="week-schedule-scroll mt-6">
              <div aria-label={`${option.label} daily outfit previews`} className="week-schedule">{option.entries.map((entry) => <div className="week-entry" key={`${entry.date}-${entry.slot}`}>
                <div className="week-entry-header"><div><p className="eyebrow">{entry.date}</p><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-black/45">{daypartLabels[entry.slot]}</p></div><span className="week-entry-weather">{entry.weather ? <><span>{weatherIcon(entry.weather.code)}</span><small>{entry.weather.low}°/{entry.weather.high}° · {entry.weather.precipitation}% rain</small></> : <small>No forecast</small>}</span></div>
                <p className="mt-3 font-serif text-base">{occasionLabels[entry.occasion]} · {entry.score}/100</p>
                <button aria-label={`Preview ${occasionLabels[entry.occasion]} outfit for ${entry.date} ${daypartLabels[entry.slot].toLowerCase()}`} className="week-entry-preview" onClick={() => openLookPreview(entry.outfit, `${daypartLabels[entry.slot]} · ${entry.date}`)} type="button">
                  <div aria-hidden="true" className="week-look">{outfitOrder.map((slot) => { const item = entry.outfit.items.find((candidate) => candidate.category === slot); return item ? <img className={`week-look-piece week-look-piece--${slot}`} key={slot} src={displayPath(item, true)} alt="" /> : null; })}</div>
                </button>
                <p className="week-entry-items">{entry.outfit.items.map((item) => item.name).join(' · ')}</p>
              </div>)}</div>
            </div>
            <div className="week-notes mt-6 grid gap-5 border-t border-black/10 pt-5 md:grid-cols-2"><div><p className="eyebrow">Conflicts</p><p className="mt-2 text-xs leading-5 text-black/55">{option.conflicts.length ? option.conflicts.join(' ') : 'None detected in the cached forecast.'}</p></div><div><p className="eyebrow">Trade-offs</p><p className="mt-2 text-xs leading-5 text-black/55">{option.tradeoffs.length ? option.tradeoffs.join(' ') : 'No meaningful trade-offs detected.'}</p></div></div>
            <button className="text-link mt-7" onClick={() => applyWeekPlan(option)} type="button">Apply this option to calendar →</button>
          </article>)}</div> : <p className="mt-12 border-t border-black/10 py-8 font-serif text-xl text-black/38">Build options to see the week’s constraints and choices.</p>}
        </div>
      </section>}

      {activePanel === 'recolor' && <section id="recolor" className="panel-sheet bg-white">
        <div className="mx-auto grid max-w-[1372px] gap-12 lg:grid-cols-[.7fr_1.3fr] lg:items-center">
          <div>
            <p className="eyebrow">Recolor lab</p><h2 className="editorial-title mt-4">Useful now, not theoretical.</h2><p className="mt-5 max-w-md text-sm leading-6 text-black/55">CLOTHO isolates the garment before recoloring it in a 512px browser canvas, keeping the product shadow out of the color mask. The visible control and WebMCP tool run the same operation.</p>
            <label className="field-line mt-8"><span>Item</span><select aria-label="Item to recolor" value={recolorItemId} onChange={(event) => setRecolorItemId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>
            <label className="field-line"><span>Color</span><span className="flex items-center justify-end gap-3"><input aria-label="Recolor value" className="h-8 max-w-14 cursor-pointer" type="color" value={recolorColor} onChange={(event) => setRecolorColor(event.target.value.toUpperCase())} /><code className="text-xs text-black/55">{recolorColor}</code></span></label>
            <button className="text-link mt-7" disabled={recolorBusy || !items.length} onClick={() => void applyRecolor()} type="button">{recolorBusy ? 'Recoloring…' : 'Recolor selected item →'}</button>
            <button className="text-link mt-5" disabled={recolorBusy || !recolorPreview} onClick={() => saveRecolorVariant()} type="button">Save as wardrobe variant →</button>
            <p className="mt-3 max-w-md text-[11px] leading-5 text-black/42">Preview first. Save this color only when you want it available to future looks, calendar plans, batches, and wear history.</p>
          </div>
          <figure className="grid grid-cols-2 gap-px overflow-hidden border border-black/10 bg-black/10">
            <div className="relative bg-[#fcfbf8]"><img className="aspect-square w-full object-contain" src={selectedRecolorItem ? imagePath(selectedRecolorItem) : '/recolor/before.png'} alt="Original wardrobe item" /><span className="image-label">Original</span></div>
            <div className="relative bg-[#fcfbf8]"><img className="aspect-square w-full object-contain" src={recolorPreview?.src ?? '/recolor/after-burgundy.png'} alt="Recolored wardrobe item" /><span className="image-label">{recolorPreview?.color ?? 'Example'}</span></div>
          </figure>
        </div>
      </section>}

      {zoomedLook && <>
        <button aria-label="Close enlarged outfit overview" className="look-lightbox-backdrop" onClick={closeLookPreview} type="button" />
        <dialog aria-labelledby="look-lightbox-title" aria-modal="true" className="look-lightbox" open>
          <div className="look-lightbox-header"><div><p className="eyebrow">{zoomedLabel}</p><h2 id="look-lightbox-title">{zoomedLook.title}</h2><p>{zoomedLook.score}/100 compatibility · {occasionLabels[zoomedLook.occasion]}</p></div><button className="text-link" onClick={closeLookPreview} type="button">Close overview ↘</button></div>
          <div className="outfit-composition outfit-composition--zoomed" aria-label="Enlarged outfit ordered from headwear to shoes">
            {outfitOrder.map((slot) => {
              const item = zoomedLook.items.find((candidate) => candidate.category === slot);
              return (
              <figure className={`outfit-piece outfit-piece--${slot}`} key={slot}>
                <figcaption>{outfitSlotLabels[slot]}</figcaption>
                {item ? <img src={displayPath(item, true)} alt={`${item.name}, ${item.color}`} /> : <span className="outfit-empty">none</span>}
              </figure>
              );
            })}
          </div>
        </dialog>
      </>}

      {activePanel && <button className="panel-close text-link" onClick={() => setActivePanel(null)} type="button">Close panel ↘</button>}
      {activePanel && <button aria-label="Close by clicking outside the panel" className="panel-backdrop" onClick={() => setActivePanel(null)} type="button" />}

      <footer className="border-t border-black/10 px-5 py-10 md:px-10 lg:px-16"><div className="mx-auto flex max-w-[1372px] flex-col justify-between gap-6 text-[10px] uppercase tracking-[.13em] text-black/45 sm:flex-row"><p>CLOTHO · Classy Looks for Occasion, Taste, History &amp; Outfits</p><p>WebMCP: search · suggest · batch · week · apply · schedule · remove · weather · record · prefer · recolor · import · commit</p></div></footer>
      <output aria-live="polite" className="sr-only">{status}</output>
    </main>
  );
}
