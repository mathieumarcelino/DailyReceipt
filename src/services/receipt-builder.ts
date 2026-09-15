import { ReceiptBuilder, ReceiptLine } from "../receipt/context";
import { getModule } from "../modules/registry";
import { listModules } from "./modules.service";

/**
 * Construit la liste des lignes du ticket du jour en exécutant chaque module
 * actif dans l'ordre configuré. Une erreur d'un module (API météo down, etc.)
 * n'interrompt pas les autres : elle est affichée comme une ligne d'avertissement.
 *
 * Les séparateurs entre modules sont gérés ici plutôt que par chaque module
 * individuellement : "=" entre l'en-tête et le corps ainsi qu'entre le corps
 * et le pied de page, "-" entre les autres modules, et aucun après le dernier
 * module actif.
 */
export async function buildReceiptLines(columns: number, widthPx: number): Promise<ReceiptLine[]> {
  const modules = await listModules();
  const enabled = modules.filter((m) => m.enabled).sort((a, b) => a.order - b.order);

  const ctx = new ReceiptBuilder(columns, widthPx);

  for (let i = 0; i < enabled.length; i++) {
    const view = enabled[i];
    const mod = getModule(view.id);
    if (!mod) continue;

    ctx.currentModuleId = view.id;
    try {
      const data = await mod.fetchData(view.config);
      mod.renderReceipt(data, ctx, view.config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.text(`${mod.name.toUpperCase()}`, { bold: true, underline: true });
      ctx.text(`Module indisponible (${message})`);
    }

    const next = enabled[i + 1];
    if (next) {
      const isMajorBoundary = view.id === "header" || next.id === "footer";
      ctx.separator(isMajorBoundary ? "=" : "-");
    }
  }

  return ctx.getLines();
}
