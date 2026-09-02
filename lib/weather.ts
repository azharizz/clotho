export type WeatherDay = {
  date: string;
  high: number;
  low: number;
  precipitation: number;
  code: number;
};

export type WeatherCache = {
  fetchedAt: number;
  days: Record<string, WeatherDay>;
};

export const WEATHER_CACHE_KEY = 'clotho:weather:nyc:v1';
export const WEATHER_CACHE_TTL = 6 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function weatherDaysFromResponse(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Weather response must be an object.');
  const daily = (input as { daily?: Record<string, unknown> }).daily;
  const time = daily?.time;
  const highs = daily?.temperature_2m_max;
  const lows = daily?.temperature_2m_min;
  const rain = daily?.precipitation_probability_max;
  const codes = daily?.weather_code;
  if (![time, highs, lows, rain, codes].every(Array.isArray)) throw new Error('Weather response is missing daily arrays.');

  return (time as string[]).reduce<Record<string, WeatherDay>>((days, date, index) => {
    days[date] = {
      date,
      high: Math.round(Number((highs as number[])[index])),
      low: Math.round(Number((lows as number[])[index])),
      precipitation: Math.round(Number((rain as number[])[index] ?? 0)),
      code: Number((codes as number[])[index]),
    };
    return days;
  }, {});
}

export function readWeatherCache(storage: StorageLike): WeatherCache | null {
  try {
    const parsed = JSON.parse(storage.getItem(WEATHER_CACHE_KEY) ?? 'null') as WeatherCache | null;
    return parsed && Number.isFinite(parsed.fetchedAt) && parsed.days && typeof parsed.days === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeWeatherCache(storage: StorageLike, days: Record<string, WeatherDay>, fetchedAt = Date.now()) {
  const cache = { fetchedAt, days };
  storage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
  return cache;
}

export function isWeatherCacheFresh(cache: WeatherCache, now = Date.now()) {
  return now - cache.fetchedAt < WEATHER_CACHE_TTL;
}
