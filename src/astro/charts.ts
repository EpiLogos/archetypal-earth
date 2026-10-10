// The charts the Astrology lens knows: Jung's (curated, the first chart) and the visitor's own (this browser only).
// A chart is named by an id in routes ('you', 'jung'); its birth data is looked up here and never put in a URL.
// The list is open: a shared layer would add charts from another source behind `chartSources` without touching the lens.
import { practice, type PracticeRecord } from '../practice/store';
import { meanTimeOffset, type BirthData } from './natal';

export interface ChartRecord {
  id: string;
  label: string;
  birth: BirthData;
  /** where the chart lives: curated in the site, or kept in this browser */
  source: 'curated' | 'local';
  /** a curated chart's own words on where its data comes from */
  line?: string;
}

/** The visitor's chart as stored (practice store, collection 'charts'). One chart, id 'you'. */
export interface StoredChart extends PracticeRecord {
  label: string;
  birth: BirthData;
}

export const YOU = 'you';

export interface CuratedPerson {
  id: string;
  label: string;
  birth: { date: string; time: string | null; place: string; lat: number; lon: number; offset: 'mean-time' | number };
  line: string;
}

export function curatedChart(p: CuratedPerson): ChartRecord {
  const offsetMinutes = p.birth.offset === 'mean-time' ? meanTimeOffset(p.birth.lon) : p.birth.offset;
  return {
    id: p.id, label: p.label, source: 'curated', line: p.line,
    birth: { date: p.birth.date, time: p.birth.time, offsetMinutes, lat: p.birth.lat, lon: p.birth.lon, place: p.birth.place },
  };
}

export function localChart(): ChartRecord | null {
  const c = practice.get<StoredChart>('charts', YOU);
  return c ? { id: YOU, label: c.label || 'You', birth: c.birth, source: 'local' } : null;
}

export function saveLocalChart(label: string, birth: BirthData): ChartRecord {
  practice.put<StoredChart>('charts', { id: YOU, label, birth });
  return localChart()!;
}

export function forgetLocalChart() {
  practice.remove('charts', YOU);
}

/** Every chart known now: the curated ones first (Jung is user zero), then this browser's. */
export function chartSources(curated: CuratedPerson[]): ChartRecord[] {
  const out = curated.map(curatedChart);
  const mine = localChart();
  if (mine) out.push(mine);
  return out;
}
