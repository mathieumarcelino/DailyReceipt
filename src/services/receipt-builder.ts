import { ReceiptBuilder, ReceiptLine } from "../receipt/context";
import { getModule } from "../modules/registry";
import { listModules } from "./modules.service";

/**
 * Construit la liste des lignes du ticket du jour en exécutant chaque module
 * actif dans l'ordre configuré. Une erreur d'un module (API météo down, etc.)
 * n'interrompt pas les autres : elle est affichée comme une ligne d'avertissement.
 *
 * Chaque module est d'abord rendu dans son propre buffer isolé : cela permet de
 * détecter s'il n'a produit aucune ligne (ex: Sports sans aucun match) et de ne
 * jamais lui accoler de séparateur dans ce cas. Les séparateurs entre modules
 * sont ensuite insérés ici plutôt que par chaque module individuellement : "="
 * entre l'en-tête et le corps ainsi qu'entre le corps et le pied de page, "-"
 * entre les autres modules, et aucun après le dernier module non vide.
 */
export async function buildReceiptLines(columns: number, widthPx: number): Promise<ReceiptLine[]> {
  const modules = await listModules();
  const enabled = modules.filter((m) => m.enabled).sort((a, b) => a.order - b.order);

  const segments: { id: string; lines: ReceiptLine[] }[] = [];

  for (const view of enabled) {
    const mod = getModule(view.id);
    if (!mod) continue;

    const moduleCtx = new ReceiptBuilder(columns, widthPx);
    moduleCtx.currentModuleId = view.id;
    try {
      const data = await mod.fetchData(view.config);
      mod.renderReceipt(data, moduleCtx, view.config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      moduleCtx.text(`${mod.name.toUpperCase()}`, { bold: true, underline: true });
      moduleCtx.text(`Module indisponible (${message})`);
    }

    const lines = moduleCtx.getLines();
    if (lines.length > 0) segments.push({ id: view.id, lines });
  }

  const result: ReceiptLine[] = [];
  segments.forEach((segment, index) => {
    result.push(...segment.lines);
    const next = segments[index + 1];
    if (next) {
      const isMajorBoundary = segment.id === "header" || next.id === "footer";
      result.push(separatorLine(columns, isMajorBoundary ? "=" : "-", segment.id));
    }
  });

  return result;
}

function separatorLine(width: number, char: string, moduleId: string): ReceiptLine {
  return { type: "line", text: char.repeat(width), align: "left", bold: false, underline: false, size: "normal", moduleId };
}
