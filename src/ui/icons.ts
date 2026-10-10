// One small icon family for every button: 16×16 box, 1.2 stroke, round caps — the search glyph's own hand.
// Icons are decorative (aria-hidden); the button that holds one carries the accessible name.

const S = 'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  search: `<circle cx="6.8" cy="6.8" r="4.6" ${S}/><path d="M10.4 10.4L14 14" ${S}/>`,
  menu: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" ${S}/>`,
  close: `<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" ${S}/>`,
  chevron: `<path d="M4.5 6.2L8 9.7l3.5-3.5" ${S}/>`,
  back: `<path d="M9.8 3.5L5.3 8l4.5 4.5" ${S}/>`,
  next: `<path d="M6.2 3.5L10.7 8l-4.5 4.5" ${S}/>`,
  // the field: a globe
  field: `<circle cx="8" cy="8" r="5.6" ${S}/><ellipse cx="8" cy="8" rx="2.5" ry="5.6" ${S}/><path d="M2.6 6.4h10.8M2.6 9.6h10.8" ${S}/>`,
  graph: `<path d="M8 8L3.4 4.6M8 8l4.8-3.2M8 8l-1.1 5M8 8l4.2 3.8" ${S}/><circle cx="8" cy="8" r="1.7" ${S}/><circle cx="3.2" cy="4.4" r="1.2" ${S}/><circle cx="13" cy="4.6" r="1.2" ${S}/><circle cx="6.8" cy="13.2" r="1.2" ${S}/><circle cx="12.4" cy="12" r="1.2" ${S}/>`,
  // the Self: a circle round its centre
  self: `<circle cx="8" cy="8" r="5.6" ${S}/><circle cx="8" cy="8" r="1.4" ${S}/>`,
  // theory: two opposites and the third that holds them
  theory: `<circle cx="5.6" cy="8" r="3.4" ${S}/><circle cx="10.4" cy="8" r="3.4" ${S}/><path d="M8 2v12" ${S}/>`,
  // Aion: the zodiac ring with the spring point moving
  aion: `<circle cx="8" cy="8" r="5.6" ${S}/><path d="M8 2.4v1.6M8 12v1.6M2.4 8H4M12 8h1.6" ${S}/><path d="M8 8l2.6-2.6" ${S}/>`,
  // the Red Book: a bound book
  redbook: `<path d="M3 3.2c1.8-.6 3.6-.4 5 .8 1.4-1.2 3.2-1.4 5-.8v9.6c-1.8-.6-3.6-.4-5 .8-1.4-1.2-3.2-1.4-5-.8z" ${S}/><path d="M8 4v9.6" ${S}/>`,
  // astrology: a planet on its orbit round the sun
  astrology: `<circle cx="8" cy="8" r="1.8" ${S}/><ellipse cx="8" cy="8" rx="6" ry="3.4" transform="rotate(-24 8 8)" ${S}/><circle cx="13" cy="5.3" r="1" ${S}/>`,
  // dreams: the crescent
  dreams: `<path d="M10.8 2.8a5.6 5.6 0 1 0 2.4 8.6 4.6 4.6 0 0 1-2.4-8.6z" ${S}/>`,
  // symbols: the uroboros, a circle that closes on itself
  symbols: `<path d="M12.9 6.3A5.2 5.2 0 1 0 13 9.6" ${S}/><path d="M11.6 4.9l1.4 1.5 1.5-1.3" ${S}/>`,
  // coincidences: two rings that meet
  coincidences: `<circle cx="6" cy="8" r="3.6" ${S}/><circle cx="10" cy="8" r="3.6" ${S}/>`,
  // number: the quaternio, four points round one
  number: `<circle cx="8" cy="8" r="1.2" ${S}/><circle cx="8" cy="3" r="1.2" ${S}/><circle cx="13" cy="8" r="1.2" ${S}/><circle cx="8" cy="13" r="1.2" ${S}/><circle cx="3" cy="8" r="1.2" ${S}/>`,
  filter: `<path d="M2.5 4h11M4.5 8h7M6.5 12h3" ${S}/>`,
  download: `<path d="M8 2.5v8M4.8 7.4L8 10.6l3.2-3.2M3 13.5h10" ${S}/>`,
  issue: `<circle cx="8" cy="8" r="5.6" ${S}/><path d="M8 4.8v3.8M8 11.1v.1" ${S}/>`,
  info: `<circle cx="8" cy="8" r="5.6" ${S}/><path d="M8 7.2v4M8 4.9v.1" ${S}/>`,
  plus: `<path d="M8 3v10M3 8h10" ${S}/>`,
  trash: `<path d="M3 4.5h10M6.2 4.5V3h3.6v1.5M4.4 4.5l.7 8.5h5.8l.7-8.5" ${S}/>`,
  export: `<path d="M8 10V2.5M4.8 5.6L8 2.4l3.2 3.2M3 9.5v4h10v-4" ${S}/>`,
  lock: `<rect x="3.5" y="7" width="9" height="6.5" rx="1" ${S}/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" ${S}/>`,
  play: `<path d="M5 3.2v9.6L12.6 8z" ${S}/>`,
  pause: `<path d="M5.5 3.5v9M10.5 3.5v9" ${S}/>`,
  github: `<path d="M8 1.6a6.4 6.4 0 0 0-2 12.5c.3 0 .4-.1.4-.3v-1.2c-1.8.4-2.2-.8-2.2-.8-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.6 0 1 .7 1 .7.6 1 1.5.7 1.9.5 0-.4.2-.7.4-.9-1.4-.2-2.9-.7-2.9-3.2 0-.7.2-1.3.7-1.7-.1-.2-.3-.8.1-1.7 0 0 .5-.2 1.8.7a6 6 0 0 1 3.2 0c1.2-.8 1.8-.7 1.8-.7.3.9.1 1.5.1 1.7.4.4.7 1 .7 1.7 0 2.5-1.5 3-2.9 3.2.2.2.4.6.4 1.2v1.8c0 .2.1.4.4.3A6.4 6.4 0 0 0 8 1.6z" ${S}/>`,
} as const;

export type IconName = keyof typeof PATHS;

/** The icon's SVG markup at `size` px. */
export function iconSvg(name: IconName, size = 16): string {
  return `<svg class="ico ico-${name}" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** The icon as an element, ready to append. */
export function icon(name: IconName, size = 16): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, size);
  return t.content.firstElementChild as SVGElement;
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
