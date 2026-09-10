import iconv from "iconv-lite";
import type { ReceiptLine } from "../receipt/context";
import type { PrinterProfile } from "../config/types";
import * as cmd from "./commands";

/**
 * Convertit une liste de ReceiptLine (déjà word-wrappées par ReceiptBuilder)
 * en un buffer de commandes ESC/POS brutes prêt à être envoyé sur le port 9100.
 */
export function encodeReceipt(lines: ReceiptLine[], profile: PrinterProfile): Buffer {
  const encoding = cmd.ICONV_ENCODING[profile] ?? cmd.ICONV_ENCODING.CP858;
  const codepage = cmd.CODEPAGE_TABLE[profile] ?? cmd.CODEPAGE_TABLE.CP858;

  const chunks: Buffer[] = [cmd.INIT, cmd.selectCodepage(codepage)];

  for (const line of lines) {
    if (line.type === "blank") {
      chunks.push(cmd.LF);
      continue;
    }

    if (line.type === "image") {
      if (!line.image) continue;
      chunks.push(cmd.align(line.align));
      chunks.push(cmd.rasterImage(line.image.widthBytes, line.image.heightPx, line.image.bits));
      chunks.push(cmd.LF);
      continue;
    }

    chunks.push(cmd.align(line.align));
    chunks.push(cmd.bold(line.bold));
    chunks.push(cmd.underline(line.underline));
    chunks.push(cmd.textSize(line.size));
    chunks.push(iconv.encode(line.text, encoding));
    chunks.push(cmd.LF);
  }

  // Réinitialise le formatage puis avance/massicote le papier.
  chunks.push(cmd.align("left"), cmd.bold(false), cmd.underline(false), cmd.textSize("normal"));
  chunks.push(cmd.feedAndCut(4));

  return Buffer.concat(chunks);
}
