import type { ReceiptModule } from "./types";
import { todayDayMonth } from "../lib/date-fr";

interface Person {
  name: string;
  date: string; // jj/mm
}

interface BirthdaysConfig {
  people: Person[];
}

interface BirthdaysData {
  todayNames: string[];
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})$/;

const birthdaysModule: ReceiptModule<BirthdaysConfig, BirthdaysData> = {
  id: "birthdays",
  name: "Anniversaires du jour",
  description: "Liste locale de personnes (jj/mm), mise en avant si c'est leur jour.",
  configSchema: [
    {
      key: "people",
      label: "Personnes",
      type: "array",
      itemLabel: "Personne",
      itemSchema: [
        { key: "name", label: "Nom", type: "text", placeholder: "Marie Dupont" },
        { key: "date", label: "Date (jj/mm)", type: "text", placeholder: "25/12" },
      ],
    },
  ],
  defaultConfig: { people: [] },

  async fetchData(config) {
    const today = todayDayMonth();
    const todayNames = (config.people ?? [])
      .filter((p) => p?.date && DATE_RE.test(p.date.trim()) && normalizeDayMonth(p.date) === today)
      .map((p) => p.name?.trim())
      .filter((name): name is string => Boolean(name));

    return { todayNames };
  },

  renderReceipt(data, ctx) {
    ctx.text("ANNIVERSAIRES", { bold: true, underline: true });
    if (data.todayNames.length === 0) {
      ctx.text("Aucun anniversaire aujourd'hui.");
    } else {
      for (const name of data.todayNames) {
        ctx.text(`* Joyeux anniversaire ${name} ! *`, { align: "center", bold: true });
      }
    }
  },
};

function normalizeDayMonth(value: string): string {
  const match = DATE_RE.exec(value.trim());
  if (!match) return value.trim();
  const [, dd, mm] = match;
  return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}`;
}

export default birthdaysModule;
