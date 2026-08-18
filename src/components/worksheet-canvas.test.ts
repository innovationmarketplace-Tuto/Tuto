import {
  clampUnit,
  colorWithAlpha,
  normalizedBoundsToRect,
  normalizedBoundsToStyle,
  normalizedPointToPercentage,
  normalizedPolygonToBounds,
  pageAspectRatio,
  regionBounds,
} from './worksheet-canvas-geometry';

type TestCallback = () => void | Promise<void>;
const test = (_name: string, callback: TestCallback): void => {
  void Promise.resolve(callback()).catch((error) => {
    throw error;
  });
};

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(actual)} to equal ${String(expected)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
    }
  },
  close(actual: number, expected: number, tolerance = 1e-9): void {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Expected ${String(actual)} to be within ${String(tolerance)} of ${String(expected)}`);
    }
  },
};

test('normalized bounds map to percentage positions without losing page alignment', () => {
  assert.deepEqual(normalizedBoundsToStyle({ x: 0.14, y: 0.13, width: 0.64, height: 0.12 }), {
    position: 'absolute',
    left: '14%',
    top: '13%',
    width: '64%',
    height: '12%',
  });
});

test('bounds are clipped to the visible page and tolerate reversed edges', () => {
  const reversed = normalizedBoundsToRect({ x: 1.1, y: 0.8, width: -0.4, height: 0.5 });
  assert.close(reversed.x, 0.7);
  assert.close(reversed.y, 0.8);
  assert.close(reversed.width, 0.3);
  assert.close(reversed.height, 0.2);
  const clipped = normalizedBoundsToRect({ x: -0.2, y: -0.1, width: 0.4, height: 0.3 });
  assert.close(clipped.x, 0);
  assert.close(clipped.y, 0);
  assert.close(clipped.width, 0.2);
  assert.close(clipped.height, 0.2);
});

test('polygon bounds provide a safe fallback for malformed persisted bounds', () => {
  const polygon = [
    { x: 0.2, y: 0.4 },
    { x: 0.7, y: 0.4 },
    { x: 0.65, y: 0.8 },
  ];
  const polygonBounds = normalizedPolygonToBounds(polygon);
  if (!polygonBounds) throw new Error('Expected polygon bounds');
  assert.close(polygonBounds.x, 0.2);
  assert.close(polygonBounds.y, 0.4);
  assert.close(polygonBounds.width, 0.5);
  assert.close(polygonBounds.height, 0.4);
  const fallback = regionBounds({
    bounds: { x: Number.NaN, y: 0, width: 0, height: 0 },
    polygon,
  });
  assert.close(fallback.x, 0.2);
  assert.close(fallback.y, 0.4);
  assert.close(fallback.width, 0.5);
  assert.close(fallback.height, 0.4);
});

test('point and page dimensions are clamped to responsive-safe values', () => {
  assert.equal(clampUnit(-2), 0);
  assert.equal(clampUnit(2), 1);
  assert.deepEqual(normalizedPointToPercentage({ x: -0.1, y: 1.2 }), { x: '0%', y: '100%' });
  assert.equal(pageAspectRatio(1240, 1754), 1240 / 1754);
  assert.equal(pageAspectRatio(0, Number.NaN), 1);
});

test('overlay colors always retain an alpha channel for source-text readability', () => {
  assert.equal(colorWithAlpha('#4668F2', 0.12), 'rgba(70, 104, 242, 0.12)');
  assert.equal(colorWithAlpha('#abc', 0.2), 'rgba(170, 187, 204, 0.2)');
  assert.equal(colorWithAlpha('#4668F2', 2), 'rgba(70, 104, 242, 1)');
  assert.equal(colorWithAlpha('not-a-color', 0.2), 'rgba(0, 0, 0, 0)');
});
