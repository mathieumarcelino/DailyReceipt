import type { ReceiptModule } from "./types";
import { randomQuote } from "../lib/quotes";
import { formatFrenchTime } from "../lib/date-fr";

interface FooterConfig {
  showQuote: boolean;
}

interface FooterData {
  quote: string | null;
  printedAt: Date;
}

const footerModule: ReceiptModule<FooterConfig, FooterData> = {
  id: "footer",
  name: "Pied de page",
  description: "Citation aléatoire inspirante et mention de génération.",
  configSchema: [{ key: "showQuote", label: "Afficher une citation", type: "boolean" }],
  defaultConfig: { showQuote: true },

  async fetchData(config) {
    return { quote: config.showQuote ? randomQuote() : null, printedAt: new Date() };
  },

  renderReceipt(data, ctx) {
    if (data.quote) {
      ctx.text(`« ${data.quote} »`, { align: "center" });
    }
    ctx.spacer(1);
    ctx.text(`Généré par DailyReceipt le ${formatFrenchTime(data.printedAt)}`, { align: "center" });
  },
};

export default footerModule;
