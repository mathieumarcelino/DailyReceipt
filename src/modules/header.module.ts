import type { ReceiptModule } from "./types";
import { formatFrenchDate } from "../lib/date-fr";
import { rasterizePng } from "../escpos/image-raster";

interface HeaderConfig {
  title: string;
  /** Data URL "data:image/png;base64,..." d'un logo optionnel, imprimé à la place du titre texte. */
  logo: string;
}

interface HeaderData {
  now: Date;
}

const headerModule: ReceiptModule<HeaderConfig, HeaderData> = {
  id: "header",
  name: "En-tête",
  description: "Titre (texte ou logo) et date du jour formatée en français.",
  configSchema: [
    { key: "title", label: "Titre affiché", type: "text", placeholder: "DAILYRECEIPT", help: "Ignoré si un logo est défini ci-dessous." },
    { key: "logo", label: "Logo (PNG, remplace le titre)", type: "image" },
  ],
  defaultConfig: { title: "DAILYRECEIPT", logo: "" },

  async fetchData() {
    return { now: new Date() };
  },

  renderReceipt(data, ctx, config) {
    if (config.logo) {
      try {
        const base64 = config.logo.split(",")[1] ?? config.logo;
        const raster = rasterizePng(Buffer.from(base64, "base64"), ctx.widthPx);
        ctx.image(raster, { align: "center" });
      } catch {
        // Logo invalide/corrompu : on retombe sur le titre texte plutôt que de bloquer le ticket.
        ctx.text(config.title?.trim() || "DAILYRECEIPT", { align: "center", bold: true, size: "double" });
      }
    } else {
      ctx.text(config.title?.trim() || "DAILYRECEIPT", { align: "center", bold: true, size: "double" });
    }

    ctx.spacer(1);
    ctx.text(formatFrenchDate(data.now), { align: "center" });
    ctx.separator("=");
  },
};

export default headerModule;
