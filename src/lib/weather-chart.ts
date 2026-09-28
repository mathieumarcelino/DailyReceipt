import { PNG } from "pngjs";

export interface ChartPoint {
  /** Libellé affiché sous le point (ex: "15H"). */
  label: string;
  /** Valeur arrondie affichée au-dessus du point (température en °C, ou pourcentage de précipitation). */
  value: number;
}

export interface ChartOptions {
  /** Échelle Y fixe [min, max] (ex: [0, 100] pour un pourcentage) ; par défaut, cadrée automatiquement sur les valeurs des points. */
  yRange?: [number, number];
}

type Rgb = [number, number, number];

/**
 * Police bitmap maison 5x7 (chiffres, "H", "-") : aucune bibliothèque de rendu de texte pure-JS
 * suffisamment légère n'est nécessaire pour ce jeu de caractères réduit (valeurs et heures "HH" + "H"),
 * donc plutôt que d'ajouter une dépendance juste pour ça, on la dessine nous-mêmes, pixel par pixel,
 * comme le reste du pipeline ESC/POS (cf. escpos/image-raster.ts).
 */
const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT: Record<string, string[]> = {
  "0": [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  "3": [" ### ", "#   #", "    #", "  ## ", "    #", "#   #", " ### "],
  "4": ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  "6": ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  "8": [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  "9": [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
  "H": ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
};

const INK: Rgb = [20, 20, 20];
/** Gris chaud clair : se tramera proprement en aire pointillée une fois passé au dithering Floyd-Steinberg (voir image-raster.ts). */
const FILL: Rgb = [214, 214, 196];

const FONT_SCALE = 2;
const LABEL_GAP = 3;
const DOT_RADIUS = 2;
const LINE_THICKNESS = 2;
const PLOT_HEIGHT = 64;
const OUTER_MARGIN_Y = 4;

/**
 * Dessine un petit graphique en courbe (ex: température ou précipitations sur ~24h) adapté à
 * l'impression thermique 1-bit : aire sous la courbe en gris clair (tramée en pointillés par le
 * dithering en aval), courbe et points en noir plein, valeurs au-dessus de chaque point et heures en
 * dessous. Rendu directement à la largeur cible (`widthPx`) pour que `rasterizePng()` n'ait plus qu'à
 * tramer, sans redimensionner (texte net).
 */
export function renderLineChart(points: ChartPoint[], widthPx: number, options: ChartOptions = {}): Buffer {
  if (points.length < 2) throw new Error("Au moins deux points sont nécessaires pour tracer un graphique.");

  const labelHeight = FONT_HEIGHT * FONT_SCALE;
  const topPad = OUTER_MARGIN_Y + labelHeight + LABEL_GAP + DOT_RADIUS;
  const plotBottom = topPad + PLOT_HEIGHT;
  const height = plotBottom + DOT_RADIUS + LABEL_GAP + labelHeight + OUTER_MARGIN_Y;

  // Marge horizontale : juste assez pour que le libellé le plus large (heure ou valeur, centré sur son
  // point) ne déborde jamais du canevas sur le premier/dernier point — calculée sur les valeurs réelles
  // plutôt qu'une largeur figée, pour coller au plus près des bords du ticket.
  const widestLabel = Math.max(
    ...points.map((p) => measureText(p.label, FONT_SCALE)),
    ...points.map((p) => measureText(String(p.value), FONT_SCALE)),
  );
  const marginX = Math.ceil(widestLabel / 2) + 2;

  const width = Math.max(marginX * 2 + 1, Math.round(widthPx));
  const plotWidth = width - marginX * 2;
  const xStep = plotWidth / (points.length - 1);
  const xs = points.map((_, i) => Math.round(marginX + i * xStep));

  const values = points.map((p) => p.value);
  const [yMin, yMax] = options.yRange ?? [Math.min(...values), Math.max(...values)];
  const span = yMax - yMin || 1; // toutes les valeurs identiques (ou plage nulle) -> évite une division par zéro
  const ys = values.map((v) => Math.round(plotBottom - ((v - yMin) / span) * PLOT_HEIGHT));

  const png = new PNG({ width, height });
  png.data.fill(255); // fond blanc opaque (RGB=255 + alpha=255 en un seul passage)

  for (let x = xs[0]; x <= xs[xs.length - 1]; x++) {
    const y = interpolateY(xs, ys, x);
    for (let fy = y + 1; fy <= plotBottom; fy++) setPixel(png, x, fy, FILL);
  }

  for (let i = 0; i < xs.length - 1; i++) {
    drawLineSegment(png, xs[i], ys[i], xs[i + 1], ys[i + 1], LINE_THICKNESS, INK);
  }

  points.forEach((point, i) => {
    fillRect(png, xs[i] - DOT_RADIUS, ys[i] - DOT_RADIUS, DOT_RADIUS * 2 + 1, DOT_RADIUS * 2 + 1, INK);
    drawText(png, String(point.value), xs[i], topPad - DOT_RADIUS - LABEL_GAP - labelHeight, FONT_SCALE, INK);
    drawText(png, point.label, xs[i], plotBottom + DOT_RADIUS + LABEL_GAP, FONT_SCALE, INK);
  });

  return PNG.sync.write(png);
}

/** Interpole linéairement la position Y de la courbe à l'abscisse `x` (segments droits entre points). */
function interpolateY(xs: number[], ys: number[], x: number): number {
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = xs[i + 1] === xs[i] ? 0 : (x - xs[i]) / (xs[i + 1] - xs[i]);
      return Math.round(ys[i] + t * (ys[i + 1] - ys[i]));
    }
  }
  return ys[ys.length - 1];
}

/** Segment épais entre deux points, en avançant pixel par pixel sur X (toujours croissant ici) et en tamponnant un carré à chaque pas. */
function drawLineSegment(png: PNG, x0: number, y0: number, x1: number, y1: number, thickness: number, color: Rgb): void {
  const steps = Math.max(Math.abs(x1 - x0), 1);
  const half = Math.floor(thickness / 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(png, x - half, y - half, thickness, thickness, color);
  }
}

function measureText(text: string, scale: number): number {
  return text.length === 0 ? 0 : text.length * (FONT_WIDTH + 1) * scale - scale;
}

/** Dessine `text` centré horizontalement sur `centerX`, en partant de `topY` vers le bas. */
function drawText(png: PNG, text: string, centerX: number, topY: number, scale: number, color: Rgb): void {
  let x = Math.round(centerX - measureText(text, scale) / 2);
  for (const char of text) {
    const glyph = FONT[char];
    if (glyph) {
      for (let row = 0; row < FONT_HEIGHT; row++) {
        for (let col = 0; col < FONT_WIDTH; col++) {
          if (glyph[row][col] === "#") fillRect(png, x + col * scale, topY + row * scale, scale, scale, color);
        }
      }
    }
    x += (FONT_WIDTH + 1) * scale;
  }
}

function fillRect(png: PNG, x: number, y: number, w: number, h: number, color: Rgb): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) setPixel(png, x + dx, y + dy, color);
  }
}

function setPixel(png: PNG, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = 255;
}
