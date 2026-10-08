// All GLSL for the globe, kept together so the time-visibility formula (also in
// src/data/time.ts) and shared helpers stay identical across passes.

export const TIME_GLSL = /* glsl */ `
uniform float uCursor;
uniform float uTrail;
uniform float uRamp;
uniform float uTimeOn;
float timeVis(float u) {
  float d = uCursor - u;
  float fin = smoothstep(0.0, uRamp, d);
  float fout = 1.0 - smoothstep(uTrail * 0.55, uTrail, d);
  return mix(1.0, fin * fout, uTimeOn);
}
float timeFlare(float u) {
  float d = uCursor - u;
  return uTimeOn * smoothstep(0.0, uRamp * 0.5, d) * exp(-max(d, 0.0) / (uRamp * 2.6));
}
`;

// Emphasis semantics (aRel): 1 normal · 0.07 receded · 1.5 related · 2.4 selected
export const REL_GLSL = /* glsl */ `
float relAlpha(float rel) {
  return mix(0.12, 1.0, smoothstep(0.2, 1.0, rel)) * (1.0 + 0.5 * max(rel - 1.0, 0.0));
}
float relDensity(float rel) {
  return smoothstep(0.28, 1.0, rel) * (1.0 + 0.55 * max(rel - 1.0, 0.0));
}
float relSize(float rel) {
  return mix(0.78, 1.0, smoothstep(0.2, 1.0, rel)) + 0.28 * max(rel - 1.0, 0.0);
}
`;

// ── presences: the live points ───────────────────────────────────────────
// The visual hierarchy of the globe, strictest first:
//   live presence  — sharp luminous core + tight halo: the brightest thing on the disc
//   not-live       — a small hollow, desaturated ring (outside the time window, or
//                    unrelated to the focus): present, but plainly not selectable
//   everything decorative (density field, aura, stars, terrain) stays below the
//   dimmest live presence and has no point-like form.
export const PRESENCE_VERT = /* glsl */ `
attribute vec3 aDir;
attribute vec3 aColor;
attribute vec4 aMeta;   // x: year u, y: seed radius, z: precision (0 place,1 region,2 culture,3 none), w: seed
attribute float aRel;
uniform vec3 uCamDir;
uniform float uCamDist;
uniform vec2 uRes;
uniform float uPx;
uniform float uSizeK;
uniform float uTime;
uniform vec3 uFocusCore;
uniform float uFocusMix;
varying vec2 vC;
varying vec3 vCol;
varying float vA;
varying float vLive;
varying float vPrec;
varying float vHalf;
varying float vPx;
varying float vSel;
${TIME_GLSL}
${REL_GLSL}
void main() {
  float prec = aMeta.z;
  float vis = timeVis(aMeta.x);
  float flare = timeFlare(aMeta.x);
  float horizon = 1.0 / uCamDist;
  float face = smoothstep(horizon - 0.02, horizon + 0.09, dot(aDir, uCamDir));
  // live = inside the time window AND part of what is in focus (same rule as the CPU pick)
  float live = smoothstep(0.35, 0.65, vis) * smoothstep(0.42, 0.78, aRel);
  // not-live ghosts are quieter still when the time window has passed them by
  float ghostA = mix(0.2, 0.32, smoothstep(0.2, 0.8, vis));
  float a = face * mix(ghostA, 1.0, live);
  if (prec > 2.5 || a < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float emph = max(aRel - 1.0, 0.0);
  // quad half-extent in css px: wide enough for the halo and the uncertainty ring
  float liveHalf = (prec < 0.5 ? 17.0 : (prec < 1.5 ? 22.0 : 30.0)) * (1.0 + 0.2 * emph) + 10.0 * flare;
  float hx = mix(8.0, liveHalf, live) * uSizeK;
  vec4 clip = projectionMatrix * viewMatrix * vec4(aDir * 1.003, 1.0);
  clip.xy += position.xy * (2.0 * hx * uPx / uRes) * clip.w;
  gl_Position = clip;
  vC = position.xy;
  vHalf = hx;
  vPx = uPx;
  float luma = dot(aColor, vec3(0.3, 0.59, 0.11));
  float sat = smoothstep(0.2, 0.95, aRel);
  vec3 c = mix(vec3(luma) * 0.7, mix(vec3(luma), aColor, 1.35), sat);
  c = mix(c, uFocusCore, uFocusMix * 0.3 * clamp(aRel - 1.0, 0.0, 1.0));
  vCol = c;
  vA = a * (1.0 + 0.5 * flare);
  vLive = live;
  vPrec = prec;
  vSel = clamp(aRel - 1.6, 0.0, 1.0);
}
`;

export const PRESENCE_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vCol;
varying float vA;
varying float vLive;
varying float vPrec;
varying float vHalf;
varying float vPx;
varying float vSel;
void main() {
  float rPx = length(vC) * vHalf;           // css px from the centre
  if (rPx > vHalf) discard;
  float aa = 0.7;

  // ── live: a crisp core and a tight halo
  float rc = (vPrec < 0.5 ? 3.3 : (vPrec < 1.5 ? 3.0 : 2.7)) * (1.0 + 0.18 * vSel);
  float core = 1.0 - smoothstep(rc - aa, rc + aa, rPx);
  float halo = exp(-pow(rPx / (rc * 1.9), 2.0)) * 0.24;
  // imprecise places carry a faint ring of uncertainty around the sharp core
  float ur = vPrec < 0.5 ? 0.0 : (vPrec < 1.5 ? 12.0 : 19.0);
  float unc = ur > 0.0 ? exp(-pow((rPx - ur) / 1.15, 2.0)) * 0.2 + (1.0 - smoothstep(0.0, ur, rPx)) * 0.035 : 0.0;
  vec3 hot = mix(vCol, vec3(1.0), 0.6);
  vec3 live = hot * core + vCol * (halo + unc);

  // ── not live: a small hollow ring, drained of colour
  float gr = 4.4;
  float ring = exp(-pow((rPx - gr) / 0.85, 2.0));
  vec3 gcol = mix(vec3(dot(vCol, vec3(0.3, 0.59, 0.11))), vec3(0.62, 0.7, 0.86), 0.5);
  vec3 ghost = gcol * ring * 0.9;

  vec3 rgb = mix(ghost, live, vLive) * vA;
  float edge = 1.0 - smoothstep(0.82, 1.0, length(vC));
  gl_FragColor = vec4(rgb * edge, 1.0);
}
`;

// ── density: equirect splats rendered to a texture the earth samples ─────
export const SPLAT_VERT = /* glsl */ `
attribute vec2 aLL;     // lon, lat radians
attribute vec3 aGlow;
attribute vec4 aMeta;
attribute float aRel;
uniform float uOffset;
varying vec2 vC;
varying vec3 vCol;
varying float vA;
${TIME_GLSL}
${REL_GLSL}
void main() {
  float prec = aMeta.z;
  float a = timeVis(aMeta.x) * relDensity(aRel) * (prec < 0.5 ? 1.0 : (prec < 1.5 ? 0.55 : 0.3));
  if (prec > 2.5 || a < 0.004) {
    gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
    return;
  }
  float radDeg = (prec < 0.5 ? 2.6 : (prec < 1.5 ? 5.4 : 10.0)) * (1.0 + 0.35 * max(aRel - 1.0, 0.0));
  float rx = radDeg / 180.0 / max(cos(aLL.y), 0.22);
  float ry = radDeg / 90.0;
  vec2 centre = vec2(aLL.x / 3.14159265, aLL.y / 1.5707963);
  gl_Position = vec4(centre + position.xy * vec2(rx, ry) + vec2(uOffset, 0.0), 0.0, 1.0);
  vC = position.xy;
  vCol = aGlow;
  vA = a;
}
`;

export const SPLAT_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vCol;
varying float vA;
void main() {
  float r2 = dot(vC, vC);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 4.2) * (1.0 - smoothstep(0.7, 1.0, r2)) * vA;
  gl_FragColor = vec4(vCol, g * 0.34);
}
`;

// ── the earth ────────────────────────────────────────────────────────────
// One grade for every source of imagery. The sphere's base texture and the
// streaming close-zoom tiles are both NASA Blue Marble (colour, relief shading
// and bathymetry baked in); this turns either into the site's world: a deep,
// palette-tinted globe where terrain is quiet and nothing on it is brighter than
// a live presence. Land/water comes from the imagery's own colour so tiles of
// any resolution need no mask.
export const EARTH_COMMON = /* glsl */ `
uniform sampler2D uDensity;
uniform vec3 uLightDir;
// the true Sun, in scene axes, and how much of the light is its own (0 near the surface: exactly the atlas's key light)
uniform vec3 uSunDir;
uniform float uSunMix;
uniform vec3 uFog;
uniform vec3 uGlow;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform float uSpec;

float lumaOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// 0 land · 1 water, from the Blue Marble colour: seas are strongly blue against red (even the
// turquoise shallows), while ice, snow, desert, rock and forest are not
float waterOf(vec3 s) {
  return smoothstep(0.3, 0.56, (s.b - s.r) / (s.b + 0.05));
}

vec3 shadeEarth(vec3 src, vec3 N, vec3 V, vec2 densUv) {
  float l = lumaOf(src);
  float water = waterOf(src);
  vec3 L = normalize(uLightDir);
  float diffuse = 0.5 + 0.5 * dot(N, L);
  float lit = mix(0.46, 1.0, smoothstep(0.1, 1.0, diffuse));
  // pulled back past the Moon, day and night are the real ones: the terminator is where the Sun is on the horizon
  float sd = 0.0;
  if (uSunMix > 0.0) {
    sd = dot(N, normalize(uSunDir));
    float day = smoothstep(-0.07, 0.16, sd);
    float litTrue = mix(0.14, mix(0.8, 1.0, smoothstep(0.0, 1.0, sd)), day);
    lit = mix(lit, litTrue, uSunMix);
  }

  // sea: depth reads from the bathymetry shading, shelves lift toward the fog colour
  float shelf = smoothstep(0.05, 0.3, l);
  vec3 ocean = mix(uDeep * 1.5 + uFog * 0.28, uFog * 0.92 + uGlow * 0.08, shelf);

  // land: a palette ramp carries tone and the baked relief; true chroma, in measure,
  // keeps forest, steppe, desert and rock apart without breaking the palette
  float tone = smoothstep(0.035, 0.5, l);
  vec3 shade = uFog * 0.75 + uDeep * 1.5;
  vec3 mid = uFog * 0.5 + uGlow * 0.3;
  vec3 high = uGlow * 0.2 + uCore * 0.32;
  vec3 ramp = tone < 0.5 ? mix(shade, mid, tone * 2.0) : mix(mid, high, (tone - 0.5) * 2.0);
  ramp += uCore * 0.1 * smoothstep(0.5, 1.0, l); // keeps relief legible across snow and ice
  vec3 chroma = src - vec3(l);
  vec3 land = ramp + chroma * 0.5 * (1.0 - smoothstep(0.55, 0.8, l));

  vec3 col = mix(land, ocean, water) * lit;
  // a hairline of twilight along the terminator, only where the true Sun is in charge
  col += uGlow * 0.07 * exp(-pow(sd / 0.11, 2.0)) * uSunMix * (1.0 - 0.4 * water);

  // a hairline of coast, as thick as the imagery is sharp (no screen derivatives: those band in 2x2 blocks)
  float coast = pow(1.0 - abs(2.0 * water - 1.0), 3.0);
  col += uGlow * coast * 0.1 * lit;

  // the field of archetypal intensity: a soft, low glow underneath the live points
  vec4 d = texture2D(uDensity, densUv);
  float dl = max(d.r, max(d.g, d.b));
  vec3 hue = d.rgb / max(dl, 1e-4);
  float amt = 1.0 - exp(-dl * 0.8);
  // tints and slightly shades what lies beneath instead of adding light, so a dense
  // region never becomes a glowing blob on pale ground
  col = col * (1.0 - 0.3 * amt) + hue * amt * 0.15;

  // inner rim — the planet's own atmosphere seen edge-on
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
  col += mix(uGlow, uCore, 0.2) * fres * 0.36;
  col += mix(uGlow, uCore, 0.5) * pow(fres, 7.0) * 0.24;
  return col;
}
`;

export const EARTH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vN = normal;
  vView = cameraPosition - position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const EARTH_FRAG = /* glsl */ `
uniform sampler2D uBaseLo;
uniform sampler2D uBaseHi;
uniform float uHiMix;
${EARTH_COMMON}
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 src = mix(texture2D(uBaseLo, vUv).rgb, texture2D(uBaseHi, vUv).rgb, uHiMix);
  gl_FragColor = vec4(shadeEarth(src, normalize(vN), normalize(vView), vUv), 1.0);
}
`;

// ── close-zoom tiles: sphere patches graded by the same earth shader ─────
export const TILE_VERT = /* glsl */ `
attribute vec2 aTile;    // position in the tile image, v = 0 at the north edge
attribute vec2 aLL;      // local longitude from the tile's west edge (rad), latitude (rad)
uniform float uLon0;     // the tile's west edge (rad)
varying vec2 vTile;
varying vec2 vDens;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
  vN = normalize(w);
  vView = cameraPosition - w;
  vTile = aTile;
  vDens = vec2((uLon0 + aLL.x) / 6.2831853 + 0.5, aLL.y / 3.14159265 + 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const TILE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uAlpha;
${EARTH_COMMON}
varying vec2 vTile;
varying vec2 vDens;
varying vec3 vN;
varying vec3 vView;
void main() {
  // sample texel centres at the tile border so neighbours meet without a seam
  vec2 uv = (vTile * 255.0 + 0.5) / 256.0;
  vec3 src = texture2D(uMap, uv).rgb;
  gl_FragColor = vec4(shadeEarth(src, normalize(vN), normalize(vView), vDens), uAlpha);
}
`;

// ── atmosphere shell (impact-parameter glow, independent of normals) ─────
export const SHELL_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SHELL_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform vec3 uCore;
uniform float uSpec;
varying vec3 vWorld;
void main() {
  vec3 D = normalize(vWorld - cameraPosition);
  float b = length(cross(cameraPosition, D));
  float over = max(b - 1.0, 0.0);
  // spirit-heavy: clearer, thinner; instinct-heavy: denser, deeper
  float k = mix(6.0, 9.5, uSpec);
  float halo = exp(-over * k);
  float edge = exp(-over * 55.0);
  float cut = 1.0 - smoothstep(1.1, 1.52, b);
  vec3 c = mix(uGlow, uCore, 0.12) * halo * mix(0.4, 0.3, uSpec) + mix(uGlow, uCore, 0.55) * edge * 0.3;
  gl_FragColor = vec4(c * cut, 1.0);
}
`;

// ── particulate aura ─────────────────────────────────────────────────────
export const AURA_VERT = /* glsl */ `
attribute vec4 aSeed; // x radius 0..1, y theta, z phi, w random
uniform float uTime;
uniform float uPx;
uniform float uSpec;
uniform vec3 uGlow;
uniform vec3 uCore;
varying float vA;
varying vec3 vCol;
void main() {
  float keep = mix(1.0, 0.55, uSpec);
  float rad = 1.04 + pow(aSeed.x, 1.7) * 0.9;
  float th = aSeed.y * 6.2831853 + uTime * (0.012 + aSeed.w * 0.02) * mix(0.7, 1.3, uSpec);
  float ph = acos(2.0 * aSeed.z - 1.0);
  vec3 p = rad * vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
  p += 0.012 * vec3(sin(uTime * 0.3 + aSeed.w * 30.0), cos(uTime * 0.27 + aSeed.w * 17.0), sin(uTime * 0.21 + aSeed.w * 9.0));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // particles seen across the planet's disc are fainter so they never veil it
  vec3 D = normalize(p - cameraPosition);
  float b = length(cross(cameraPosition, D));
  // nothing of the aura may read as a point on the planet's disc: it lives only beyond the limb
  float over = smoothstep(1.03, 1.24, b);
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed.w * 1.4) + aSeed.w * 60.0);
  float fall = 1.0 - smoothstep(1.0, 1.95, rad);
  vA = tw * fall * over * step(aSeed.w, keep) * 0.5;
  float size = mix(3.4, 2.4, uSpec) * (0.6 + aSeed.w);
  gl_PointSize = size * uPx * (4.2 / -mv.z);
  vCol = mix(uGlow, uCore, 0.35 + 0.4 * aSeed.w);
}
`;

export const AURA_FRAG = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 2.6);
  gl_FragColor = vec4(vCol, g * vA);
}
`;

// ── backdrop: deep field, coloured haze, stars ───────────────────────────
export const BACKDROP_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const BACKDROP_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uFog;
uniform vec3 uGlow;
uniform vec3 uDeep;
uniform float uTime;
uniform float uSpec;
uniform vec2 uParallax;
varying vec2 vNdc;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
float stars(vec2 p, float scale, float thresh, float seed) {
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id + seed);
  if (h < thresh) return 0.0;
  vec2 off = vec2(hash21(id + 3.1 + seed), hash21(id + 7.7 + seed)) - 0.5;
  float d = length(f - off * 0.7);
  float size = 0.035 + 0.05 * hash21(id + 1.3);
  float tw = 0.7 + 0.3 * sin(uTime * (0.4 + h * 2.0) + h * 80.0);
  return smoothstep(size, 0.0, d) * tw * (0.35 + 0.65 * (h - thresh) / (1.0 - thresh));
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 q = (vNdc - uCenter) * vec2(aspect, 1.0) / uRadius;   // in globe radii
  float r = length(q);

  vec3 col = uDeep;
  // wide halo of fog around the world
  float halo = exp(-max(r - 1.0, 0.0) * mix(1.15, 1.7, uSpec));
  col += uFog * (0.5 * halo + 0.18 * exp(-r * 0.25));
  // slow drifting haze
  vec2 hp = q * 0.55 + uParallax * 0.4 + vec2(uTime * 0.006, -uTime * 0.004);
  float n = fbm(hp) * 0.75 + fbm(hp * 2.3 + 5.0) * 0.25;
  float hazeMask = exp(-pow(max(r - 0.9, 0.0), 1.0) * 0.55);
  col += mix(uGlow, uFog, 0.5) * (n - 0.28) * 0.5 * hazeMask * mix(1.25, 0.8, uSpec);
  col += uGlow * 0.07 * exp(-pow(max(r - 1.0, 0.0), 2.0) * 3.0);

  // stars, faded where the haze is thick and behind the world
  vec2 sp = vNdc * vec2(aspect, 1.0);
  float s = stars(sp + uParallax * 0.08, 38.0, 0.935, 1.0) + 0.8 * stars(sp + uParallax * 0.15, 21.0, 0.955, 9.0) + 0.6 * stars(sp + uParallax * 0.3, 11.0, 0.965, 17.0);
  float starMask = (1.0 - 0.7 * exp(-max(r - 1.0, 0.0) * 1.1)) * smoothstep(0.98, 1.06, r);
  col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.93, 0.85), hash21(floor(sp * 38.0))) * s * starMask * 0.4;

  // vignette
  float vg = smoothstep(1.55, 0.35, length(vNdc * vec2(0.9, 1.0)));
  col *= mix(0.55, 1.0, vg);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── thread arcs ──────────────────────────────────────────────────────────
export const ARC_VERT = /* glsl */ `
attribute float aStep;  // position along the thread in step units
attribute float aDist;  // cumulative path length (radians)
varying float vStep;
varying float vDist;
void main() {
  vStep = aStep;
  vDist = aDist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ARC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uDraw;
uniform float uHead;
uniform float uTour;
uniform float uFade;
varying float vStep;
varying float vDist;
void main() {
  float drawn = 1.0 - smoothstep(uDraw - 0.12, uDraw, vStep);
  if (drawn < 0.002) discard;
  float dash = fract(vDist * 5.5 - uTime * 0.22);
  float flow = smoothstep(0.0, 0.5, dash) * smoothstep(1.0, 0.5, dash);
  float bright = mix(1.0, mix(0.28, 1.0, 1.0 - smoothstep(uHead - 0.05, uHead + 0.05, vStep)), uTour);
  float a = (0.28 + 0.72 * flow * flow) * bright * drawn * uFade;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.12 + 0.3 * flow), clamp(a * 0.85, 0.0, 1.0));
}
`;

// ── ring markers: decals draped on the surface ───────────────────────────
// A polar patch of the sphere around the point (not a screen quad), so the ring
// lies in the surface, foreshortens toward the limb and goes behind the horizon
// with the terrain. Sized in screen terms by the CPU each frame (uWorld).
export const MARKER_VERT = /* glsl */ `
uniform vec3 uDir;
uniform vec3 uE;
uniform vec3 uN;
uniform float uWorld;   // disc radius in globe radii
uniform float uLift;
varying vec2 vC;
varying float vFacing;
void main() {
  vec3 off = (uE * position.x + uN * position.y) * uWorld;
  vec3 p = normalize(uDir + off);
  vec3 w = p * uLift;
  vFacing = dot(p, normalize(cameraPosition - w));
  vC = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const MARKER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vC;
varying float vFacing;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float pulse = 0.5 + 0.5 * sin(uTime * 1.6);
  float ringR = 0.62 + 0.04 * pulse;
  // a line about 1.6 px wide wherever the surface is turned
  float fw = length(vec2(dFdx(r), dFdy(r)));
  float ring = exp(-pow((r - ringR) / max(fw * 1.2, 0.012), 2.0));
  float halo = exp(-r * r * 5.0) * 0.22;
  float horizon = smoothstep(0.03, 0.3, vFacing);
  float a = (ring * 0.95 + halo) * uAlpha * horizon * (1.0 - smoothstep(0.9, 1.0, r));
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4), a);
}
`;
