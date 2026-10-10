// The one place personal material is kept (MODES-RFC §8): birth charts, dreams and coincidences, in this browser's
// localStorage and nowhere else. Nothing here touches the network. Every practice lens reads and writes through this
// module, so the promise each lens states in its UI ("stays in this browser") is kept in one place.
//
// The shape is a set of named collections of records with ids. A later shared layer would be a second backend behind the
// same interface (`PracticeBackend`), chosen per collection, so the lenses would not change.

export type Collection = 'charts' | 'dreams' | 'coincidences';

export interface PracticeRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeBackend {
  read(c: Collection): unknown[];
  write(c: Collection, items: unknown[]): void;
  /** whether writes will persist (false in a private window or with storage blocked) */
  readonly persistent: boolean;
}

const PREFIX = 'aae.practice.v1.';

/** localStorage, with an in-memory fallback when storage is unavailable (the lens then says nothing will be kept). */
export class LocalBackend implements PracticeBackend {
  private memory = new Map<Collection, unknown[]>();
  readonly persistent: boolean;

  constructor(private storage: Storage | null = LocalBackend.probe()) {
    this.persistent = !!storage;
  }

  static probe(): Storage | null {
    try {
      const s = globalThis.localStorage;
      const k = `${PREFIX}probe`;
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch {
      return null;
    }
  }

  read(c: Collection): unknown[] {
    if (!this.storage) return this.memory.get(c) ?? [];
    try {
      const raw = this.storage.getItem(PREFIX + c);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  write(c: Collection, items: unknown[]) {
    if (!this.storage) { this.memory.set(c, items); return; }
    this.storage.setItem(PREFIX + c, JSON.stringify(items));
  }
}

const newId = (): string => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

type Listener = (c: Collection) => void;

export class PracticeStore {
  private listeners = new Set<Listener>();

  constructor(readonly backend: PracticeBackend = new LocalBackend()) {}

  get persistent(): boolean {
    return this.backend.persistent;
  }

  list<T extends PracticeRecord>(c: Collection): T[] {
    return this.backend.read(c).filter((x): x is T => !!x && typeof x === 'object' && typeof (x as PracticeRecord).id === 'string');
  }

  get<T extends PracticeRecord>(c: Collection, id: string): T | undefined {
    return this.list<T>(c).find((x) => x.id === id);
  }

  /** Insert or replace by id; a record without an id is given one. Returns the stored record. */
  put<T extends PracticeRecord>(c: Collection, rec: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<PracticeRecord>): T {
    const now = new Date().toISOString();
    const items = this.list<T>(c);
    const id = rec.id ?? newId();
    const at = items.findIndex((x) => x.id === id);
    const stored = { ...rec, id, createdAt: at >= 0 ? items[at].createdAt : (rec.createdAt ?? now), updatedAt: now } as T;
    if (at >= 0) items[at] = stored; else items.push(stored);
    this.backend.write(c, items);
    this.emit(c);
    return stored;
  }

  remove(c: Collection, id: string) {
    this.backend.write(c, this.list(c).filter((x) => x.id !== id));
    this.emit(c);
  }

  /** Delete everything in one collection, or in all of them. */
  wipe(c?: Collection) {
    for (const k of c ? [c] : (['charts', 'dreams', 'coincidences'] as Collection[])) this.backend.write(k, []);
    for (const k of c ? [c] : (['charts', 'dreams', 'coincidences'] as Collection[])) this.emit(k);
  }

  /** Everything, as one JSON document the person can keep. */
  exportAll(): string {
    const out: Record<string, unknown> = { kind: 'archetypal-earth-practice', version: 1, exportedAt: new Date().toISOString() };
    for (const c of ['charts', 'dreams', 'coincidences'] as Collection[]) out[c] = this.list(c);
    return JSON.stringify(out, null, 2);
  }

  /** Read an export back in: records are merged by id (an existing record keeps whichever was updated later). */
  importAll(json: string): { added: number; kept: number } {
    const doc = JSON.parse(json) as Record<string, unknown>;
    if (doc?.kind !== 'archetypal-earth-practice') throw new Error('This file is not an export from this site.');
    let added = 0, kept = 0;
    for (const c of ['charts', 'dreams', 'coincidences'] as Collection[]) {
      const incoming = Array.isArray(doc[c]) ? (doc[c] as PracticeRecord[]) : [];
      const items = this.list(c);
      for (const r of incoming) {
        if (!r || typeof r.id !== 'string') continue;
        const at = items.findIndex((x) => x.id === r.id);
        if (at < 0) { items.push(r); added++; } else if ((r.updatedAt ?? '') > (items[at].updatedAt ?? '')) { items[at] = r; added++; } else kept++;
      }
      this.backend.write(c, items);
      this.emit(c);
    }
    return { added, kept };
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(c: Collection) {
    for (const l of this.listeners) l(c);
  }
}

/** The page's one store. */
export const practice = new PracticeStore();

/** Hand the person a file to save: built in the page, saved by the browser, never uploaded. */
export function saveFile(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
