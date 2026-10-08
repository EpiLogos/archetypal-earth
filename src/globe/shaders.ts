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
  return uTimeOn * step(0.0, d) * exp(-d / (uRamp * 2.6));
}
`;

// Emphasis semantics (aRel): 1 normal · 0.2 receded · 1.5 related · 2.3 selected
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

// ── presences: glowing billboards seated on the sphere ───────────────────
export const PRESENCE_VERT = /* glsl */ `
attribute vec3 aDir;
attribute vec3 aColor;
attribute vec4 aMeta;   // x: year u, y: radius px, z: precision (0 place,1 region,2 culture,3 none), w: seed
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
varying float vCore;
${TIME_GLSL}
${REL_GLSL}
void main() {
  float prec = aMeta.z;
  float vis = timeVis(aMeta.x);
  float flare = timeFlare(aMeta.x);
  float horizon = 1.0 / uCamDist;
  float face = smoothstep(horizon - 0.02, horizon + 0.09, dot(aDir, uCamDir));
  float sPrec = prec < 0.5 ? 1.0 : (prec < 1.5 ? 1.75 : 3.0);
  float aPrec = prec < 0.5 ? 1.0 : (prec < 1.5 ? 0.5 : 0.26);
  float a = vis * face * relAlpha(aRel) * aPrec * (1.0 + flare * 1.6);
  float size = aMeta.y * uPx * uSizeK * sPrec * relSize(aRel) * (1.0 + flare * 0.9) * (1.0 + 0.07 * sin(uTime * 0.7 + aMeta.w * 40.0));
  if (prec > 2.5 || a < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 clip = projectionMatrix * viewMatrix * vec4(aDir * 1.003, 1.0);
  clip.xy += position.xy * (2.0 * size / uRes) * clip.w;
  gl_Position = clip;
  vC = position.xy;
  float luma = dot(aColor, vec3(0.3, 0.59, 0.11));
  float sat = smoothstep(0.2, 0.95, aRel);
  vec3 c = mix(vec3(luma) * 0.7, mix(vec3(luma), aColor, 1.3), sat);
  c = mix(c, uFocusCore, uFocusMix * 0.35 * clamp(aRel - 1.0, 0.0, 1.0));
  vCol = c;
  vA = a;
  vCore = prec < 0.5 ? 1.0 : (prec < 1.5 ? 0.5 : 0.0);
}
`;

export const PRESENCE_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vCol;
varying float vA;
varying float vCore;
void main() {
  float r2 = dot(vC, vC);
  if (r2 > 1.0) discard;
  float body = exp(-r2 * 5.2);
  float core = exp(-r2 * 46.0) * vCore;
  vec3 c = mix(vCol, vec3(1.0), core * 0.3);
  float alpha = vA * (body * 0.36 + core * 0.62) * (1.0 - smoothstep(0.82, 1.0, r2));
  // premultiplied: drawn with screen blending so overlaps keep their hue
  gl_FragColor = vec4(c * alpha, alpha);
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
  float a = timeVis(aMeta.x) * relDensity(aRel) * (prec < 0.5 ? 1.0 : (prec < 1.5 ? 0.7 : 0.5));
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
  gl_FragColor = vec4(vCol, g * 0.42);
}
`;

// ── the earth ────────────────────────────────────────────────────────────
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
uniform sampler2D uBase;
uniform sampler2D uWater;
uniform sampler2D uTopo;
uniform sampler2D uDensity;
uniform vec3 uLightDir;
uniform vec3 uFog;
uniform vec3 uGlow;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform float uSpec;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  float water = texture2D(uWater, vUv).r;
  float land = 1.0 - water;
  float bathy = texture2D(uBase, vUv).r;
  float h = texture2D(uTopo, vUv).r;
  float hx = texture2D(uTopo, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uTopo, vUv - vec2(uTexel.x, 0.0)).r;
  float hy = texture2D(uTopo, vUv + vec2(0.0, uTexel.y)).r - texture2D(uTopo, vUv - vec2(0.0, uTexel.y)).r;
  float hill = clamp((hy - hx) * 2.4, -1.0, 1.0);

  // coast: how near land and water meet
  float w1 = texture2D(uWater, vUv + vec2(uTexel.x * 2.5, 0.0)).r + texture2D(uWater, vUv - vec2(uTexel.x * 2.5, 0.0)).r
           + texture2D(uWater, vUv + vec2(0.0, uTexel.y * 2.5)).r + texture2D(uWater, vUv - vec2(0.0, uTexel.y * 2.5)).r;
  float coast = clamp(abs(w1 - 4.0 * water) * 0.45, 0.0, 1.0);

  float diffuse = 0.5 + 0.5 * dot(N, normalize(uLightDir));
  float lit = mix(0.42, 1.0, smoothstep(0.1, 1.0, diffuse));

  vec3 oceanCol = mix(uDeep * 1.3 + uFog * 0.2, uFog * 0.62 + uGlow * 0.04, smoothstep(0.0, 0.2, bathy));
  vec3 landCol = mix(uFog * 0.95 + uGlow * 0.08, uGlow * 0.26 + uCore * 0.08, clamp(h * 1.5, 0.0, 1.0));
  landCol *= 0.96 + 0.16 * hill;
  vec3 col = mix(oceanCol, landCol, land) * lit;

  col += uGlow * coast * 0.2 * lit;

  // density glow: regions of archetypal intensity
  vec4 d = texture2D(uDensity, vUv);
  float dl = max(d.r, max(d.g, d.b));
  vec3 hue = d.rgb / max(dl, 1e-4);
  float amt = 1.0 - exp(-dl * 1.25);
  col += hue * amt * (0.5 + 0.12 * land);

  // inner rim — the planet's own atmosphere seen edge-on
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
  col += mix(uGlow, uCore, 0.2) * fres * 0.4;
  col += mix(uGlow, uCore, 0.5) * pow(fres, 7.0) * 0.28;

  gl_FragColor = vec4(col, 1.0);
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
  float over = smoothstep(0.96, 1.18, b);
  float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed.w * 1.4) + aSeed.w * 60.0);
  float fall = 1.0 - smoothstep(1.0, 1.95, rad);
  vA = tw * fall * mix(0.2, 1.0, over) * step(aSeed.w, keep) * 0.8;
  float size = mix(2.4, 1.5, uSpec) * (0.6 + aSeed.w);
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
  float g = exp(-r2 * 3.5);
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
  col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.93, 0.85), hash21(floor(sp * 38.0))) * s * starMask * 0.9;

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

// ── ring markers ─────────────────────────────────────────────────────────
export const MARKER_VERT = /* glsl */ `
uniform vec3 uDir;
uniform vec2 uRes;
uniform float uSize;
varying vec2 vC;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(uDir * 1.004, 1.0);
  clip.xy += position.xy * (2.0 * uSize / uRes) * clip.w;
  gl_Position = clip;
  vC = position.xy;
}
`;

export const MARKER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vC;
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float pulse = 0.5 + 0.5 * sin(uTime * 1.6);
  float ringR = 0.62 + 0.05 * pulse;
  float ring = exp(-pow((r - ringR) * 14.0, 2.0));
  float halo = exp(-r * r * 6.0) * 0.35;
  float a = (ring * 0.95 + halo) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4), a);
}
`;
