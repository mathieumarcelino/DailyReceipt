import type { ReceiptContext, RasterImage, TextOptions } from "../modules/types";

export interface ReceiptLine {
  type: "line" | "blank" | "image";
  text: string;
  align: "left" | "center" | "right";
  bold: boolean;
  underline: boolean;
  size: "normal" | "wide" | "tall" | "double";
  /** Présent uniquement si type === "image". */
  image?: RasterImage;
  /** id du module ayant produit la ligne, utile pour l'aperçu web. */
  moduleId?: string;
}

/**
 * Implémentation concrète de ReceiptContext. Fait tout le travail de mise en
 * forme (word-wrap, alignement, colonnes) une seule fois : le rendu ESC/POS
 * et l'aperçu web se contentent ensuite d'itérer sur les lignes déjà calculées,
 * garantissant qu'ils restent visuellement identiques.
 */
export class ReceiptBuilder implements ReceiptContext {
  readonly width: number;
  readonly widthPx: number;
  private lines: ReceiptLine[] = [];
  /** Positionné par le service d'orchestration avant chaque appel de module. */
  currentModuleId?: string;

  constructor(width: number, widthPx: number) {
    this.width = width;
    this.widthPx = widthPx;
  }

  text(content: string, options: TextOptions = {}): void {
    const align = options.align ?? "left";
    const bold = options.bold ?? false;
    const underline = options.underline ?? false;
    const size = options.size ?? "normal";
    const effectiveWidth = size === "wide" || size === "double" ? Math.max(1, Math.floor(this.width / 2)) : this.width;

    for (const paragraph of content.split("\n")) {
      const wrapped = wrapText(paragraph, effectiveWidth);
      for (const line of wrapped) {
        this.pushLine(line, align, bold, underline, size);
      }
    }
  }

  rawLine(content: string, options: TextOptions = {}): void {
    const align = options.align ?? "left";
    const bold = options.bold ?? false;
    const underline = options.underline ?? false;
    const size = options.size ?? "normal";
    this.pushLine(content.slice(0, this.width), align, bold, underline, size);
  }

  separator(char = "-"): void {
    this.pushLine(char.repeat(this.width), "left", false, false, "normal");
  }

  spacer(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.lines.push({ type: "blank", text: "", align: "left", bold: false, underline: false, size: "normal", moduleId: this.currentModuleId });
    }
  }

  row(left: string, right: string, options: { bold?: boolean } = {}): void {
    const bold = options.bold ?? false;
    const maxLeftWidth = this.width - right.length - 1;

    if (maxLeftWidth < 1) {
      // Pas assez de place pour tenir sur une ligne : on retombe sur deux lignes.
      this.text(left, { bold });
      this.text(right, { align: "right", bold });
      return;
    }

    let leftText = left;
    if (leftText.length > maxLeftWidth) {
      leftText = maxLeftWidth <= 1 ? leftText.slice(0, maxLeftWidth) : leftText.slice(0, maxLeftWidth - 1) + "…";
    }

    const gap = Math.max(1, this.width - leftText.length - right.length);
    const line = (leftText + " ".repeat(gap) + right).slice(0, this.width);
    this.pushLine(line, "left", bold, false, "normal");
  }

  image(raster: RasterImage, options: { align?: "left" | "center" | "right" } = {}): void {
    this.lines.push({
      type: "image",
      text: "",
      align: options.align ?? "center",
      bold: false,
      underline: false,
      size: "normal",
      image: raster,
      moduleId: this.currentModuleId,
    });
  }

  private pushLine(text: string, align: "left" | "center" | "right", bold: boolean, underline: boolean, size: "normal" | "wide" | "tall" | "double"): void {
    this.lines.push({ type: "line", text, align, bold, underline, size, moduleId: this.currentModuleId });
  }

  getLines(): ReceiptLine[] {
    return this.lines;
  }
}

/** Découpage glouton d'un paragraphe en lignes de `width` caractères max. */
function wrapText(paragraph: string, width: number): string[] {
  if (paragraph.length === 0) return [""];

  const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
      current = "";
    }

    // Le mot seul dépasse déjà la largeur : on le coupe brutalement.
    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
