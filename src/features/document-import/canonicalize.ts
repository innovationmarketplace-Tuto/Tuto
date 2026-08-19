import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Cap on the longest edge sent for analysis; keeps uploads under the BDA sync limit. */
const MAX_DIMENSION = 1800;

export type CanonicalizedLocalImage = {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
};

/**
 * Normalize a picked page photo before it is uploaded anywhere.
 *
 * BDA's OCR reads raw pixel orientation, not EXIF tags. A phone camera photo
 * taken in portrait is commonly stored with an EXIF rotation tag rather than
 * pre-rotated pixels, so it displays upright everywhere but looks sideways to
 * BDA, which silently returns no text geometry for the page. Running the
 * photo through the manipulator's decode/resize/re-encode pipeline bakes the
 * source orientation into the output pixels, so every downstream consumer
 * (display and analysis) agrees on what "upright" means for this page.
 */
export async function canonicalizeLocalImage(asset: {
  uri: string;
  width: number;
  height: number;
}): Promise<CanonicalizedLocalImage> {
  // The zero-degree rotate is a no-op on the visible result, but it forces a
  // real decode/re-encode pass unconditionally, which is what bakes the
  // source orientation into pixel data regardless of whether a resize below
  // also runs.
  const context = ImageManipulator.manipulate(asset.uri).rotate(0);
  // Picker-reported dimensions are occasionally unreliable (e.g. 0 on some
  // web sources), so only resize when they look usable.
  const longestSide = Math.max(asset.width, asset.height);
  if (Number.isFinite(longestSide) && longestSide > MAX_DIMENSION) {
    // Omit `height` rather than passing `null`: expo-image-manipulator's web
    // resize action only treats `undefined` as "auto-calculate from ratio" —
    // an explicit `null` is rounded to 0, which makes the canvas polyfill
    // call `createImageData(width, 0)` and throw.
    const targetWidth = Math.max(1, Math.round(asset.width * (MAX_DIMENSION / longestSide)));
    context.resize({ width: targetWidth });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.84 });
  return { uri: result.uri, width: result.width, height: result.height, mimeType: "image/jpeg" };
}
