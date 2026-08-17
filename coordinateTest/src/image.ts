import sharp from "sharp";
import type { Region } from "./types.js";

const MAX_BDA_BYTES = 4_800_000;

export interface CanonicalImage {
  bytes: Buffer;
  dataUrl: string;
  width: number;
  height: number;
  format: "jpeg";
}

export async function canonicalizeImage(input: Buffer): Promise<CanonicalImage> {
  let width = 1800;
  let quality = 84;
  let result: { data: Buffer; info: sharp.OutputInfo };

  do {
    result = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width, height: 1800, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (result.data.byteLength <= MAX_BDA_BYTES) break;
    if (width > 1200) width -= 200;
    else quality -= 8;
  } while (quality >= 52);

  if (result.data.byteLength > MAX_BDA_BYTES) {
    throw new Error("Image is too large after canonicalization. Use a smaller notebook photo.");
  }

  return {
    bytes: result.data,
    dataUrl: `data:image/jpeg;base64,${result.data.toString("base64")}`,
    width: result.info.width,
    height: result.info.height,
    format: "jpeg",
  };
}

export async function cropRegion(image: Buffer, bbox: [number, number, number, number]): Promise<Buffer> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const left = Math.max(0, Math.min(width - 1, Math.floor(bbox[0] * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(bbox[1] * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(bbox[2] * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(bbox[3] * height)));
  const paddingX = Math.max(8, Math.floor((right - left) * 0.25));
  const paddingY = Math.max(8, Math.floor((bottom - top) * 0.5));
  const cropLeft = Math.max(0, left - paddingX);
  const cropTop = Math.max(0, top - paddingY);
  const cropRight = Math.min(width, right + paddingX);
  const cropBottom = Math.min(height, bottom + paddingY);
  return sharp(image)
    .extract({ left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

/** Create the numbered guide image Nova sees alongside the unmodified page. */
export async function createRegionGuideImage(image: Buffer, regions: Region[]): Promise<Buffer> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;
  const visibleRegions = regions
    .filter((region) => region.kind === "line" || region.kind === "word")
    .slice(0, 360);
  const shapes = visibleRegions.map((region) => {
    const [left, top, right, bottom] = region.bbox;
    const x = left * width;
    const y = top * height;
    const boxWidth = Math.max(2, (right - left) * width);
    const boxHeight = Math.max(2, (bottom - top) * height);
    const color = region.kind === "line" ? "#39e6c0" : "#ffc764";
    const fontSize = Math.max(10, Math.min(22, Math.round(Math.min(width, height) / 70)));
    return `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" fill="none" stroke="${color}" stroke-width="2"/><rect x="${x}" y="${Math.max(0, y - fontSize - 2)}" width="${Math.max(boxWidth, region.id.length * fontSize * 0.58 + 8)}" height="${fontSize + 2}" fill="#081018"/><text x="${x + 3}" y="${Math.max(fontSize, y - 3)}" fill="${color}" font-family="sans-serif" font-size="${fontSize}">${region.id}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(image).composite([{ input: svg, blend: "over" }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
