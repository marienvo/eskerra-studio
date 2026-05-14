import type {Image} from '@tauri-apps/api/image';

/**
 * Clipboard images are exposed as RGBA. Re-encode as PNG bytes for vault storage.
 */

/** Exported for unit tests (Happy DOM has no canvas `getContext('2d')`). */
export function rgbaOrRgbToImageDataPixels(
  raw: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixels = width * height;
  const needRgba = pixels * 4;
  const rgbLen = pixels * 3;
  if (raw.length === needRgba) {
    return new Uint8ClampedArray(raw.buffer, raw.byteOffset, needRgba);
  }
  if (raw.length === rgbLen) {
    const out = new Uint8ClampedArray(needRgba);
    let o = 0;
    for (let i = 0; i < rgbLen; i += 3) {
      out[o++] = raw[i];
      out[o++] = raw[i + 1];
      out[o++] = raw[i + 2];
      out[o++] = 255;
    }
    return out;
  }
  if (raw.length > needRgba) {
    return new Uint8ClampedArray(raw.buffer, raw.byteOffset, needRgba);
  }
  throw new Error(
    `Clipboard image buffer size mismatch: got ${raw.length} bytes for ${width}x${height} (expected ${needRgba} RGBA or ${rgbLen} RGB)`,
  );
}

export async function rgbaImageToPngBytes(image: Image): Promise<Uint8Array> {
  const rgba = await image.rgba();
  const {width, height} = await image.size();
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid clipboard image dimensions');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  const clamped = rgbaOrRgbToImageDataPixels(rgba, width, height);
  const imageData = new ImageData(new Uint8ClampedArray(clamped), width, height);
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('canvas.toBlob failed'));
      }
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}
