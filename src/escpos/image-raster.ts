import { PNG } from "pngjs";
import type { RasterImage } from "../modules/types";

const MAX_HEIGHT_PX = 900; // garde-fou : évite un logo disproportionné qui gâcherait du papier

/**
 * Convertit un PNG (buffer) en image 1-bit noir/blanc prête pour la commande
 * ESC/POS "GS v 0" (raster bit image), redimensionnée à `targetWidthPx` en
 * conservant les proportions. Le fond transparent est traité comme du blanc.
 */
export function rasterizePng(pngBuffer: Buffer, targetWidthPx: number): RasterImage {
  const src = PNG.sync.read(pngBuffer);

  const widthPx = Math.max(1, Math.round(targetWidthPx));
  const heightPx = Math.min(MAX_HEIGHT_PX, Math.max(1, Math.round((src.height / src.width) * widthPx)));

  const grey = resizeToGreyscale(src, widthPx, heightPx);
  const blackWhite = floydSteinbergDither(grey, widthPx, heightPx);
  const widthBytes = Math.ceil(widthPx / 8);
  const bits = packBits(blackWhite, widthPx, heightPx, widthBytes);
  const previewPngDataUrl = encodePreviewPng(blackWhite, widthPx, heightPx);

  return { widthPx, heightPx, widthBytes, bits, previewPngDataUrl };
}

/** Redimensionne par moyennage de zone (box filter) et convertit en niveaux de gris (0-255), fond blanc pour l'alpha. */
function resizeToGreyscale(src: PNG, destW: number, destH: number): Float64Array {
  const out = new Float64Array(destW * destH);
  const scaleX = src.width / destW;
  const scaleY = src.height / destH;

  for (let dy = 0; dy < destH; dy++) {
    const sy0 = Math.floor(dy * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * scaleY));

    for (let dx = 0; dx < destW; dx++) {
      const sx0 = Math.floor(dx * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * scaleX));

      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1 && sy < src.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.width; sx++) {
          const idx = (src.width * sy + sx) << 2;
          const a = src.data[idx + 3] / 255;
          // Compositing sur fond blanc : transparence -> blanc.
          const r = src.data[idx] * a + 255 * (1 - a);
          const g = src.data[idx + 1] * a + 255 * (1 - a);
          const b = src.data[idx + 2] * a + 255 * (1 - a);
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          count++;
        }
      }
      out[destW * dy + dx] = count > 0 ? sum / count : 255;
    }
  }

  return out;
}

/** Tramage de Floyd-Steinberg : convertit des niveaux de gris en noir(1)/blanc(0). */
function floydSteinbergDither(grey: Float64Array, w: number, h: number): Uint8Array {
  const buf = Float64Array.from(grey); // copie mutable pour la diffusion d'erreur
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = w * y + x;
      const old = buf[i];
      const black = old < 128 ? 1 : 0;
      out[i] = black;
      const error = old - (black ? 0 : 255);

      if (x + 1 < w) buf[i + 1] += (error * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i - 1 + w] += (error * 3) / 16;
        buf[i + w] += (error * 5) / 16;
        if (x + 1 < w) buf[i + 1 + w] += (error * 1) / 16;
      }
    }
  }

  return out;
}

/** Empaquette les pixels noir(1)/blanc(0) en octets MSB-first, une ligne alignée sur `widthBytes` octets. */
function packBits(bw: Uint8Array, w: number, h: number, widthBytes: number): Buffer {
  const out = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bw[w * y + x]) continue;
      const byteIndex = y * widthBytes + (x >> 3);
      out[byteIndex] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Ré-encode le résultat tramé en PNG (aperçu web) : montre le rendu exact qui sera imprimé. */
function encodePreviewPng(bw: Uint8Array, w: number, h: number): string {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const v = bw[i] ? 0 : 255;
    const idx = i << 2;
    png.data[idx] = v;
    png.data[idx + 1] = v;
    png.data[idx + 2] = v;
    png.data[idx + 3] = 255;
  }
  const buffer = PNG.sync.write(png);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
