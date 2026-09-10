import { ReceiptBuilder, ReceiptLine } from "../receipt/context";
import { getModule } from "../modules/registry";
import { listModules } from "./modules.service";

/**
 * Construit la liste des lignes du ticket du jour en exécutant chaque module
 * actif dans l'ordre configuré. Une erreur d'un module (API météo down, etc.)
 * n'interrompt pas les autres : elle est affichée comme une ligne d'avertissement.
 */
export async function buildReceiptLines(columns: number, widthPx: number): Promise<ReceiptLine[]> {
  const modules = await listModules();
  const enabled = modules.filter((m) => m.enabled).sort((a, b) => a.order - b.order);

  const ctx = new ReceiptBuilder(columns, widthPx);

  for (const view of enabled) {
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
      ctx.separator();
    }
  }

  return ctx.getLines();
}
