// The zodiacal ring's own drawing: a holographic band (an annulus in the ecliptic whose colour turns with longitude and
// with the angle it is seen from, like a diffraction foil) and the twelve canonical sign glyphs, drawn as strokes so they
// read the same on every device (a symbol font is not on every phone, and emoji presentation would replace them).
// Colour here carries no meaning: the hue runs round the ring evenly, so no sign is singled out.
import * as THREE from 'three';

/**
 * The twelve glyphs, Aries to Pisces, as stroke paths in a 100 × 100 box (round caps and joins, no fill). Drawn after the
 * canonical forms: the ram's horns, the bull's head, the twins' pillars, the crab's claws, the lion's mane, the maiden's
 * sheaf, the balance, the scorpion's sting, the archer's arrow, the sea-goat, the water-bearer's waves, the two fishes.
 */
export const GLYPHS: readonly string[] = [
  // Aries
  'M50 90 V48 M50 48 C50 22 36 12 24 16 C12 20 12 40 26 42 M50 48 C50 22 64 12 76 16 C88 20 88 40 74 42',
  // Taurus
  'M14 14 C20 40 80 40 86 14 M74 64 A24 24 0 1 1 26 64 A24 24 0 1 1 74 64',
  // Gemini
  'M18 14 C40 24 60 24 82 14 M18 86 C40 76 60 76 82 86 M37 21 V79 M63 21 V79',
  // Cancer
  'M84 36 C74 16 30 14 16 34 M38 36 A10 10 0 1 1 18 36 A10 10 0 1 1 38 36 M16 64 C26 84 70 86 84 66 M82 64 A10 10 0 1 1 62 64 A10 10 0 1 1 82 64',
  // Leo
  'M40 70 A12 12 0 1 1 16 70 A12 12 0 1 1 40 70 M40 70 C42 44 34 32 42 20 C52 6 78 12 76 32 C74 50 62 60 68 76 C72 88 84 90 90 80',
  // Virgo
  'M12 24 V80 M12 34 C12 18 32 18 32 34 V80 M32 34 C32 18 52 18 52 34 V74 C52 88 64 90 72 80 M52 56 C60 42 82 42 82 58 C82 74 66 82 54 90',
  // Libra
  'M12 84 H88 M12 66 H32 C24 56 24 34 50 30 C76 34 76 56 68 66 H88',
  // Scorpio
  'M12 24 V80 M12 34 C12 18 32 18 32 34 V80 M32 34 C32 18 52 18 52 34 V70 C52 84 62 86 84 78 M74 68 L86 78 L76 90',
  // Sagittarius
  'M16 86 L84 18 M54 18 H84 V48 M30 46 L56 72',
  // Capricorn
  'M10 22 L24 78 L36 30 C40 16 54 18 54 34 V68 C54 88 86 88 86 70 C86 54 66 52 58 66',
  // Aquarius
  'M10 42 L26 30 L42 42 L58 30 L74 42 L90 30 M10 72 L26 60 L42 72 L58 60 L74 72 L90 60',
  // Pisces
  'M22 12 C46 34 46 66 22 88 M78 12 C54 34 54 66 78 88 M26 50 H74',
];

/** The field family each sign stands for, Aries 0 … Pisces 11 (the same order as GLYPHS). */
export const SIGN_FAMILY_IDS: readonly string[] = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

/** A sign's family id, or undefined outside the twelve. The family may still be absent from the field: the caller checks. */
export function signFamilyId(signIndex: number): string | undefined {
  return Number.isInteger(signIndex) ? SIGN_FAMILY_IDS[signIndex] : undefined;
}

/** The ring's colour at a share `h` of the way round (0..1): a pale spectral foil, the shader's own formula. */
export function holo(h: number): [number, number, number] {
  const c = (o: number) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (h + o));
  return [c(0), c(0.33), c(0.67)].map((v) => v * 0.6 + 0.4) as [number, number, number];
}

/** A CSS colour for a sign's glyph: the band's hue at the sign's middle. */
export function holoCss(signIndex: number, alpha = 1): string {
  const [r, g, b] = holo((signIndex * 30 + 15) / 360);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;
}

/** A CSS colour for the band's hue at an ecliptic longitude (degrees): where a card hangs on a wheel, in the ring's own colour. */
export function holoCssAt(lonDeg: number, alpha = 1): string {
  const [r, g, b] = holo((((lonDeg % 360) + 360) % 360) / 360);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;
}

/** An inline SVG for a glyph; its stroke comes from CSS (`currentColor`). */
export function glyphSvg(signIndex: number, title?: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'zg');
  if (title) { const t = document.createElementNS(NS, 'title'); t.textContent = title; svg.append(t); }
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', GLYPHS[signIndex]);
  svg.append(p);
  return svg;
}

/** The band: inner and outer radii as shares of the ring radius. */
export const BAND = { inner: 0.93, outer: 1.07 } as const;

/**
 * The holographic band's material. The colour turns with longitude and, like a foil, with how obliquely the band is
 * seen; bright rims, sign dividers every 30°, ticks every 5° and 1° along the inner edge, all edge-smoothed by the pixel's
 * own footprint so they stay fine at every distance. Additive, no depth write: it lies over the sky, never hides it.
 */
export function bandMaterial(radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uR0: { value: radius * BAND.inner },
      uR1: { value: radius * BAND.outer },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying float vFacing;
      void main() {
        vP = position.xy;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vec3 view = normalize(cameraPosition - world.xyz);
        vFacing = abs(dot(n, view));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      uniform float uTime;
      uniform float uR0;
      uniform float uR1;
      varying vec2 vP;
      varying float vFacing;
      const float TAU = 6.28318530718;
      vec3 holo(float h) { return (0.5 + 0.5 * cos(TAU * (h + vec3(0.0, 0.33, 0.67)))) * 0.6 + 0.4; }
      // a line of width w (in the pixel's units) at distance d, smoothed by the footprint fw
      float line(float d, float w, float fw) { return 1.0 - smoothstep(w, w + fw * 1.5, d); }
      void main() {
        float r = length(vP);
        float t = (r - uR0) / (uR1 - uR0);
        if (t < -0.05 || t > 1.05) discard;
        float lon = mod(degrees(atan(vP.y, vP.x)) + 360.0, 360.0);
        float fr = fwidth(r);
        float fl = min(fwidth(lon), 1.0); // (the 360°→0° seam would otherwise blur one divider)
        // the foil: hue by longitude, turned by the viewing angle and a slow drift
        float grazing = 1.0 - vFacing;
        vec3 col = holo(lon / 360.0 + 0.22 * grazing + 0.03 * sin(uTime * 0.15));
        // a soft field across the band, brighter at its middle
        float across = smoothstep(0.0, 0.18, t) * smoothstep(1.0, 0.82, t);
        // rims, inner and outer
        float rims = line(abs(r - uR0), 0.0, fr) + line(abs(r - uR1), 0.0, fr) * 0.8;
        // the twelve dividers
        float dSign = abs(mod(lon + 15.0, 30.0) - 15.0);
        float dividers = line(dSign, 0.06, fl) * step(0.0, t) * step(t, 1.0);
        // degree ticks along the inner edge: every 5° longer, every 1° short
        float d5 = abs(mod(lon + 2.5, 5.0) - 2.5);
        float d1 = abs(mod(lon + 0.5, 1.0) - 0.5);
        float ticks = line(d5, 0.03, fl) * step(t, 0.26) + line(d1, 0.02, fl) * step(t, 0.12) * 0.6;
        ticks *= step(0.0, t);
        // a quiet shimmer running round the foil
        float shimmer = 0.85 + 0.15 * sin(lon * 0.35 - uTime * 0.6 + r * 0.004);
        float a = (0.10 * across * shimmer + 0.85 * rims + 0.55 * dividers + 0.45 * ticks) * uAlpha;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}
