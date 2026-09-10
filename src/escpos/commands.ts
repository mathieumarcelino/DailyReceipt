/** Constantes de commandes ESC/POS brutes (voir doc Epson ESC/POS). */
export const ESC = 0x1b;
export const GS = 0x1d;

export const INIT = Buffer.from([ESC, 0x40]);

export function selectCodepage(n: number): Buffer {
  return Buffer.from([ESC, 0x74, n]);
}

export function align(mode: "left" | "center" | "right"): Buffer {
  const n = mode === "left" ? 0 : mode === "center" ? 1 : 2;
  return Buffer.from([ESC, 0x61, n]);
}

export function bold(on: boolean): Buffer {
  return Buffer.from([ESC, 0x45, on ? 1 : 0]);
}

export function underline(on: boolean): Buffer {
  return Buffer.from([ESC, 0x2d, on ? 1 : 0]);
}

/** GS ! n — largeur/hauteur multipliées (bits hauts = largeur-1, bits bas = hauteur-1). */
export function textSize(size: "normal" | "wide" | "tall" | "double"): Buffer {
  const map: Record<string, number> = {
    normal: 0x00,
    tall: 0x01, // double hauteur
    wide: 0x10, // double largeur
    double: 0x11, // double largeur + hauteur
  };
  return Buffer.from([GS, 0x21, map[size] ?? 0x00]);
}

/** GS v 0 — image raster 1-bit (m=0, normal). `data` = widthBytes * heightPx octets packés MSB-first. */
export function rasterImage(widthBytes: number, heightPx: number, data: Buffer): Buffer {
  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = heightPx & 0xff;
  const yH = (heightPx >> 8) & 0xff;
  return Buffer.concat([Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]), data]);
}

export const LF = Buffer.from([0x0a]);

/** Avance le papier de `lines` lignes puis massicote (coupe partielle). */
export function feedAndCut(lines = 4): Buffer {
  return Buffer.concat([Buffer.from(Array(lines).fill(0x0a)), Buffer.from([GS, 0x56, 0x42, 0x00])]);
}

/** Codepage ESC/POS (table Epson standard) associé à chaque profil supporté par l'UI. */
export const CODEPAGE_TABLE: Record<string, number> = {
  CP437: 0,
  CP858: 19,
  CP1252: 16,
};

/** Nom d'encodage iconv-lite correspondant à chaque profil. */
export const ICONV_ENCODING: Record<string, string> = {
  CP437: "CP437",
  CP858: "CP858",
  CP1252: "CP1252",
};
