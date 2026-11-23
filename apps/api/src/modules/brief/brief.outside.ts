import { Injectable, Logger } from '@nestjs/common';
import type { BriefMarkets, BriefPlace, BriefWeather } from '@orvyn/contracts';

/**
 * What the Brief reads from outside ORVYN (spec 0016 B1): the weather (Open-Meteo, free, no key — D-0016-6) and
 * the markets (Yahoo's public chart endpoint, best effort — D-0016-7). Only a place's coordinates go out; nothing
 * about the person. Replaced in tests. Every call has a short timeout; a failure means "leave it out".
 */
@Injectable()
export class BriefOutside {
  private readonly log = new Logger('brief.outside');
  private markets_: { at: number; value: BriefMarkets | null } | null = null;

  private async json<T>(url: string, ms = 8_000): Promise<T | null> {
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (ORVYN Brief)' },
        signal: AbortSignal.timeout(ms),
      });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as T;
    } catch (e) {
      this.log.debug(`${new URL(url).host}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Places by name, for the Brief's settings. */
  async places(q: string): Promise<BriefPlace[]> {
    const r = await this.json<{
      results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
    }>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en`);
    return (r?.results ?? []).map((p) => ({
      name: [p.name, p.admin1, p.country].filter(Boolean).join(', '),
      lat: p.latitude,
      lon: p.longitude,
    }));
  }

  async weather(place: BriefPlace, tz: string): Promise<BriefWeather | null> {
    type R = {
      current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: (number | null)[];
        weather_code?: number[];
        sunrise?: string[];
        sunset?: string[];
      };
      hourly?: { time?: string[]; precipitation_probability?: (number | null)[] };
    };
    const r = await this.json<R>(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
        '&current=temperature_2m,apparent_temperature,weather_code' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset' +
        `&hourly=precipitation_probability&timezone=${encodeURIComponent(tz)}&forecast_days=1`,
    );
    if (!r?.current && !r?.daily) return null;
    return weatherFrom(place.name.split(',')[0]!, r);
  }

  /** Nifty 50 and Sensex: the last price and its change from the previous close (cached for 20 minutes). */
  async markets(): Promise<BriefMarkets | null> {
    if (this.markets_ && Date.now() - this.markets_.at < 20 * 60_000) return this.markets_.value;
    type Chart = {
      chart?: {
        result?: {
          meta?: {
            regularMarketPrice?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            regularMarketTime?: number;
          };
        }[];
      };
    };
    const items: BriefMarkets['items'] = [];
    let at: number | null = null;
    for (const [name, symbol] of [
      ['Nifty 50', '%5ENSEI'],
      ['Sensex', '%5EBSESN'],
    ] as const) {
      const r = await this.json<Chart>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`,
      );
      const m = r?.chart?.result?.[0]?.meta;
      const last = m?.regularMarketPrice;
      const prev = m?.chartPreviousClose ?? m?.previousClose;
      if (typeof last !== 'number' || typeof prev !== 'number' || !prev) continue;
      items.push({
        name,
        last: Math.round(last * 100) / 100,
        changePct: Math.round(((last - prev) / prev) * 10_000) / 100,
      });
      if (m?.regularMarketTime) at = Math.max(at ?? 0, m.regularMarketTime);
    }
    const value = items.length
      ? { kind: 'markets' as const, items, at: at ? new Date(at * 1000).toISOString() : null }
      : null;
    this.markets_ = { at: Date.now(), value };
    return value;
  }
}

/** WMO weather codes in words. */
export function skyOf(code: number | null | undefined): string {
  if (code === null || code === undefined) return '';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 65) return code >= 63 ? 'Rain' : 'Light rain';
  if (code <= 67) return 'Freezing rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return code >= 81 ? 'Heavy showers' : 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

export function weatherFrom(
  place: string,
  r: {
    current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number };
    daily?: {
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: (number | null)[];
      weather_code?: number[];
      sunrise?: string[];
      sunset?: string[];
    };
    hourly?: { time?: string[]; precipitation_probability?: (number | null)[] };
  },
): BriefWeather {
  const d = r.daily ?? {};
  const round = (v: number | undefined | null) => (typeof v === 'number' ? Math.round(v) : null);
  const high = round(d.temperature_2m_max?.[0]);
  const low = round(d.temperature_2m_min?.[0]);
  const rain = d.precipitation_probability_max?.[0] ?? null;
  const code = r.current?.weather_code ?? d.weather_code?.[0] ?? null;
  const hhmm = (iso: string | undefined) => (iso && /T(\d\d:\d\d)/.exec(iso)?.[1]) || null;
  // the first hour from now on with a real chance of rain
  const times = r.hourly?.time ?? [];
  const probs = r.hourly?.precipitation_probability ?? [];
  const wetAt = times.findIndex((t, i) => (probs[i] ?? 0) >= 50 && t.slice(11, 13) >= '06');
  const hour = wetAt >= 0 ? Number(times[wetAt]!.slice(11, 13)) : null;
  const when =
    hour === null
      ? null
      : hour === 0
        ? 'midnight'
        : hour < 12
          ? `${hour} am`
          : hour === 12
            ? 'noon'
            : `${hour - 12} pm`;
  const advice =
    rain !== null && rain >= 50
      ? `Rain likely${when ? ` from ${when}` : ''} — carry an umbrella.`
      : high !== null && high >= 36
        ? `A hot one at ${high}° — keep water close.`
        : low !== null && low <= 12
          ? `A cool ${low}° start — take a layer.`
          : null;
  return {
    kind: 'weather',
    place,
    now: round(r.current?.temperature_2m),
    feels: round(r.current?.apparent_temperature),
    high,
    low,
    rain,
    code,
    sky: skyOf(code),
    sunrise: hhmm(d.sunrise?.[0]),
    sunset: hhmm(d.sunset?.[0]),
    advice,
  };
}

/**
 * Free time between meetings (spec 0016 B1): from `from` to `to`, minus the timed events, in gaps of at least
 * `min` minutes.
 */
export function freeSlots(
  busy: { start: number; end: number }[],
  from: number,
  to: number,
  min = 30,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let at = from;
  for (const b of [...busy].sort((a, b) => a.start - b.start)) {
    if (b.end <= at) continue;
    if (b.start - at >= min * 60_000) out.push({ start: at, end: Math.min(b.start, to) });
    at = Math.max(at, b.end);
    if (at >= to) break;
  }
  if (to - at >= min * 60_000) out.push({ start: at, end: to });
  return out.filter((s) => s.end - s.start >= min * 60_000);
}
