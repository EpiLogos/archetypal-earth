// A just-enough DOM for the builders that make their elements through `el()` (src/ui/dom.ts): createElement,
// className, textContent, attributes, children, listeners and a handful of selectors. No jsdom is installed in this
// project, and these builders touch nothing else. A test that needs layout or events from the engine runs in a
// browser instead (tests/ui/e2e/).

export class FakeNode {
  constructor(public readonly nodeText: string) {}
  get textContent(): string { return this.nodeText; }
}

export class FakeEl {
  tagName: string;
  className = '';
  attrs = new Map<string, string>();
  children: (FakeEl | FakeNode)[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  private own: string | null = null;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get tag(): string { return this.tagName.toLowerCase(); }
  set textContent(v: string) { this.own = String(v); this.children = []; }
  get textContent(): string { return this.own ?? this.children.map((c) => c.textContent).join(''); }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  click() { for (const fn of this.listeners.get('click') ?? []) fn({}); }
  append(...nodes: (FakeEl | FakeNode | string)[]) {
    for (const n of nodes) this.children.push(typeof n === 'string' ? new FakeNode(n) : n);
  }
  replaceChildren(...nodes: (FakeEl | FakeNode | string)[]) { this.children = []; this.own = null; this.append(...nodes); }
  get classes(): string[] { return this.className.split(/\s+/).filter(Boolean); }
  hasClass(c: string) { return this.classes.includes(c); }
  get elements(): FakeEl[] { return this.children.filter((c): c is FakeEl => c instanceof FakeEl); }

  /** Every descendant element (depth-first), this one excluded. */
  all(): FakeEl[] { return this.elements.flatMap((c) => [c, ...c.all()]); }
  /** Descendants matching `tag`, `.class`, `tag.class` or `tag.a.b` (one simple selector). */
  find(sel: string): FakeEl[] {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)$/i.exec(sel);
    if (!m) throw new Error(`fake-dom: unsupported selector ${sel}`);
    const tag = m[1].toLowerCase();
    const cls = m[2].split('.').filter(Boolean);
    return this.all().filter((e) => (!tag || e.tag === tag) && cls.every((c) => e.hasClass(c)));
  }
  first(sel: string): FakeEl | null { return this.find(sel)[0] ?? null; }
  querySelector(sel: string): FakeEl | null { return this.first(sel); }
  querySelectorAll(sel: string): FakeEl[] { return this.find(sel); }
}

/** Install `document.createElement` for the length of a suite; returns the restore. */
export function installFakeDom(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = { createElement: (tag: string) => new FakeEl(tag) };
  return () => { if (before === undefined) delete g.document; else g.document = before; };
}
