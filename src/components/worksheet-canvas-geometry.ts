import type { NormalizedBounds, NormalizedPoint, PageRegion } from '../domain/regions';

/** A CSS/RN percentage value produced from canonical page coordinates. */
export type Percentage = `${number}%`;

/** A normalized rectangle expressed as percentages for an absolutely-positioned view. */
export type CanvasRectStyle = {
  position: 'absolute';
  left: Percentage;
  top: Percentage;
  width: Percentage;
  height: Percentage;
};

const UNIT_MIN = 0;
const UNIT_MAX = 1;

/** Keep provider geometry inside the visible page. */
export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return UNIT_MIN;
  return Math.min(UNIT_MAX, Math.max(UNIT_MIN, value));
}

/**
 * Turn a solid theme color into an alpha color suitable for an image overlay.
 *
 * Worksheet text is part of the immutable page image, so an overlay must not
 * use a solid fill over it. Keeping this conversion here makes that contract
 * explicit and gives native and web the same CSS/RN-compatible color value.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  const safeAlpha = clampUnit(alpha);
  const value = color.trim().replace(/^#/, '');
  const hex = value.length === 3
    ? value.split('').map((digit) => `${digit}${digit}`).join('')
    : value;

  if (/^[\da-f]{6}$/i.test(hex)) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`;
  }

  // Theme colors are hex values. If a malformed value reaches this boundary,
  // fail closed to a transparent overlay instead of covering worksheet text.
  return `rgba(0, 0, 0, 0)`;
}

/**
 * Convert normalized bounds into a safe rectangle. The normalizer also handles
 * an accidentally negative width/height and bounds that run past an image edge.
 */
export function normalizedBoundsToRect(bounds: NormalizedBounds): NormalizedBounds {
  const x = finiteOrZero(bounds.x);
  const y = finiteOrZero(bounds.y);
  const right = x + finiteOrZero(bounds.width);
  const bottom = y + finiteOrZero(bounds.height);

  return {
    x: clampUnit(Math.min(x, right)),
    y: clampUnit(Math.min(y, bottom)),
    width: Math.max(0, clampUnit(Math.max(x, right)) - clampUnit(Math.min(x, right))),
    height: Math.max(0, clampUnit(Math.max(y, bottom)) - clampUnit(Math.min(y, bottom))),
  };
}

/** Convert canonical normalized bounds to a style safe on native and web. */
export function normalizedBoundsToStyle(bounds: NormalizedBounds): CanvasRectStyle {
  const rect = normalizedBoundsToRect(bounds);
  return {
    position: 'absolute',
    left: toPercentage(rect.x),
    top: toPercentage(rect.y),
    width: toPercentage(rect.width),
    height: toPercentage(rect.height),
  };
}

/** Convert a normalized point to percentages for labels, arrows, and guides. */
export function normalizedPointToPercentage(point: NormalizedPoint): { x: Percentage; y: Percentage } {
  return { x: toPercentage(clampUnit(point.x)), y: toPercentage(clampUnit(point.y)) };
}

/** Derive bounds when a caller only has a polygon or when provider bounds are malformed. */
export function normalizedPolygonToBounds(polygon: readonly NormalizedPoint[]): NormalizedBounds | null {
  const points = polygon.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * PageRegion.bounds is canonical, but this fallback keeps rendering resilient
 * when an older persisted revision only contains polygon geometry.
 */
export function regionBounds(region: Pick<PageRegion, 'bounds' | 'polygon'>): NormalizedBounds {
  const bounds = region.bounds;
  if (isFiniteBounds(bounds)) return bounds;
  return normalizedPolygonToBounds(region.polygon) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Return a stable, positive aspect ratio for React Native's responsive layout. */
export function pageAspectRatio(naturalWidth: number, naturalHeight: number): number {
  const width = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 1;
  const height = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : 1;
  return width / height;
}

function isFiniteBounds(bounds: NormalizedBounds): boolean {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function toPercentage(value: number): Percentage {
  // Keep a compact and deterministic string so snapshots remain readable.
  return `${Number((clampUnit(value) * 100).toFixed(4))}%`;
}
