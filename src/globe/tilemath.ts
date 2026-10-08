// Web-Mercator slippy-tile arithmetic for the NASA GIBS close-zoom layer. Pure.
//
// GIBS "GoogleMapsCompatible_Level8": 256 px tiles, z 0..8, row 0 at the north
// edge. BlueMarble_ShadedRelief_Bathymetry is served at
//   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/<layer>/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg
// (verified against the service's GetCapabilities).
export const TILE_PX = 256;
export const MAX_ZOOM = 8;
export const GIBS_LAYER = 'BlueMarble_ShadedRelief_Bathymetry';
export const GIBS_URL = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/GoogleMapsCompatible_Level8`;

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

export function tileUrl(z: number, x: number, y: number): string {
  return `${GIBS_URL}/${z}/${y}/${x}.jpeg`;
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

/** West edge longitude (degrees) of column x at zoom z; pass x+1 for the east edge. */
export function lonOfX(z: number, x: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude (degrees) of row y at zoom z; y may be fractional, y+1 is the south edge. */
export function latOfY(z: number, y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * R2D;
}

/** Fractional row of a latitude (degrees) at zoom z: the inverse of latOfY. */
export function yOfLat(z: number, lat: number): number {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * D2R);
  return (2 ** z * (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI))) / 2;
}

export function parentOf(z: number, x: number, y: number): [number, number, number] | null {
  return z <= 0 ? null : [z - 1, x >> 1, y >> 1];
}

export function childrenOf(z: number, x: number, y: number): [number, number, number][] {
  return [[z + 1, x * 2, y * 2], [z + 1, x * 2 + 1, y * 2], [z + 1, x * 2, y * 2 + 1], [z + 1, x * 2 + 1, y * 2 + 1]];
}

/**
 * On-screen width in css px of a tile whose centre sits `distToCamera` globe
 * radii from the eye. East–west arc at the tile's latitude: Mercator tiles
 * narrow toward the poles, so far fewer pixels are needed there.
 */
export function tileScreenSize(z: number, latCentre: number, distToCamera: number, focalPx: number): number {
  const arc = (2 * Math.PI * Math.cos(latCentre * D2R)) / 2 ** z;
  return (arc * focalPx) / Math.max(distToCamera, 1e-3);
}

/** Focal length in css px for a vertical field of view over a viewport of `heightPx`. */
export function focalPx(fovDeg: number, heightPx: number): number {
  return heightPx / 2 / Math.tan((fovDeg * D2R) / 2);
}
