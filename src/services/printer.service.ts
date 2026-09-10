import { ReceiptBuilder } from "../receipt/context";
import { encodeReceipt } from "../escpos/builder";
import { sendToPrinter } from "../escpos/network-printer";
import { configStore } from "../config/store";
import type { PrinterConfig } from "../config/types";
import { buildReceiptLines } from "./receipt-builder";
import { formatFrenchDate, formatFrenchTime } from "../lib/date-fr";

/** Génère et envoie un court ticket de diagnostic (page Paramètres imprimante). */
export async function printTestTicket(target: PrinterConfig): Promise<void> {
  const ctx = new ReceiptBuilder(target.columns, target.printWidthPx);

  ctx.text("DAILYRECEIPT", { align: "center", bold: true, size: "double" });
  ctx.text("Ticket de test", { align: "center" });
  ctx.separator("=");
  ctx.row("Adresse IP", target.host);
  ctx.row("Port", String(target.port));
  ctx.row("Profil", target.profile);
  ctx.row("Colonnes", String(target.columns));
  ctx.separator();
  ctx.text("Texte normal");
  ctx.text("Texte gras", { bold: true });
  ctx.text("Texte souligné", { underline: true });
  ctx.text("Aligné à gauche", { align: "left" });
  ctx.text("Centré", { align: "center" });
  ctx.text("Aligné à droite", { align: "right" });
  ctx.separator();
  ctx.text("Impression réussie !", { align: "center", bold: true });
  ctx.spacer(1);
  const now = new Date();
  ctx.text(`${formatFrenchDate(now)} — ${formatFrenchTime(now)}`, { align: "center" });

  const buffer = encodeReceipt(ctx.getLines(), target.profile);
  await sendToPrinter(buffer, { host: target.host, port: target.port });
}

/** Construit le ticket complet du jour à partir des modules actifs et l'imprime. */
export async function printDailyReceipt(): Promise<void> {
  const cfg = configStore.getConfig();

  try {
    const lines = await buildReceiptLines(cfg.printer.columns, cfg.printer.printWidthPx);
    const buffer = encodeReceipt(lines, cfg.printer.profile);
    await sendToPrinter(buffer, { host: cfg.printer.host, port: cfg.printer.port });

    await configStore.updateConfig((draft) => {
      draft.state.lastRun = { timestamp: new Date().toISOString(), status: "success" };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await configStore.updateConfig((draft) => {
      draft.state.lastRun = { timestamp: new Date().toISOString(), status: "error", message };
    });
    throw err;
  }
}
