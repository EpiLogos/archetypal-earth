import './style/main.css';
import './style/aion.css';
import './style/sky.css';
import './style/redbook.css';
import './style/dynamics.css';
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
    const [history, symbols, corpus, redbook] = await Promise.all([
      loadHistory().catch(error => { console.warn(error); return undefined; }),
      loadSymbols().catch(error => { console.warn(error); return undefined; }),
      loadCorpusIndex(),
      loadRedbook(),
    ]);
    const model = buildModel(field, history ? historyExtent(history) : undefined, symbols);
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
        onSkyPick: (key) => ctl?.onSkyPick(key),
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
