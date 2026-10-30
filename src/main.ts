import './style/main.css';
import './style/aion.css';
import './style/sky.css';
import './style/redbook.css';
import './style/dynamics.css';
import './style/graph.css';
import './style/shell.css';
import './style/touch.css';
import { loadSymbols } from './data/symbols';
import { historyExtent, loadHistory } from './aion/model';
import { loadCorpusIndex } from './data/corpus';
import { loadRedbook } from './redbook/load';
import { Controller } from './app/controller';
import { loadField } from './data/load';
import { buildModel } from './data/model';
import { rgbToHex, type RGBPalette } from './data/palette';
import { GlobeEngine } from './globe/engine';
import { prefersReducedMotion } from './ui/dom';
import { TimeModel } from './state/timeModel';
import { setProviderLabels } from './data/labels';
import type { WorksData } from './types/works';
import type { PeopleData } from './types/people';
import type { WalksData } from './types/walks';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** A published data file the field can do without: absent or malformed, it is reported and the field draws as it did before it. */
async function optional<T>(name: string, ok: (d: T) => boolean): Promise<T | undefined> {
  try {
    const res = await fetch(`${BASE}/data/${name}`);
    if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    if (!ok(data)) throw new Error('unexpected shape');
    return data;
  } catch (error) {
    console.warn(`${name} unavailable:`, error);
    return undefined;
  }
}

function setPaletteVars(p: RGBPalette) {
  const s = document.documentElement.style;
  const set = (k: string, c: [number, number, number]) => {
    s.setProperty(`--${k}`, rgbToHex(c));
    s.setProperty(`--${k}-rgb`, `${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)}`);
  };
  set('core', p.core);
  set('glow', p.glow);
  set('fog', p.fog);
  set('deep', p.deep);
}

async function boot() {
  const globeEl = document.getElementById('globe')!;
  const app = document.getElementById('app')!;
  const loading = document.getElementById('loading')!;
  try {
    const { field } = await loadField();
    // the provider names its corpus in its own words (C2-b8): bound before anything is drawn
    setProviderLabels(field.meta.provider?.labels);
    const [history, symbols, corpus, redbook, works, people, walks] = await Promise.all([
      loadHistory().catch(error => { console.warn(error); return undefined; }),
      loadSymbols().catch(error => { console.warn(error); return undefined; }),
      loadCorpusIndex(),
      loadRedbook(),
      optional<WorksData>('works.json', (d) => Array.isArray(d?.works)),
      optional<PeopleData>('people.json', (d) => Array.isArray(d?.people)),
      optional<WalksData>('walks.json', (d) => Array.isArray(d?.walks)),
    ]);
    const model = buildModel(field, history ? historyExtent(history) : undefined, symbols, { works, people, walks });
    const time = new TimeModel();
    let ctl: Controller | null = null;
    const engine = new GlobeEngine(
      globeEl,
      model,
      time,
      {
        onPick: (i) => ctl?.onPick(i),
        onHover: (i, x, y) => ctl?.onHover(i, x, y),
        onInteract: () => ctl?.onInteract(),
        onGrab: () => ctl?.onGrab(),
        onPalette: setPaletteVars,
        onSkyPick: (key) => ctl?.onCanvasSkyPick(key),
      },
      prefersReducedMotion(),
    );
    ctl = new Controller(model, engine, time, app, history, corpus, redbook ?? undefined);
    await engine.ready;
    ctl.boot();
    requestAnimationFrame(() => loading.classList.add('done'));
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__earth = { engine, ctl, model, time };
  } catch (err) {
    console.error(err);
    loading.classList.add('failed');
    loading.textContent = err instanceof Error && err.message.startsWith('The atlas data') ? err.message : 'This device could not start the globe (WebGL is required).';
  }
}

boot();
