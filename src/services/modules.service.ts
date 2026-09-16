import { configStore } from "../config/store";
import { MODULE_REGISTRY, getModule } from "../modules/registry";
import type { ConfigField } from "../modules/types";

export interface ModuleView {
  id: string;
  name: string;
  description?: string;
  dataSource?: string;
  configSchema: ConfigField[];
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

/**
 * Migration ponctuelle : l'ancien module unique "markets" (Bourse + Crypto) a été scindé en
 * deux modules distincts "stocks" et "crypto". On répartit sa config existante par type plutôt
 * que de perdre silencieusement le portefeuille déjà configuré par l'utilisateur.
 */
async function migrateLegacyMarketsModule(): Promise<void> {
  const cfg = configStore.getConfig();
  const legacy = cfg.modules.find((m) => m.id === "markets");
  if (!legacy) return;

  await configStore.updateConfig((draft) => {
    const index = draft.modules.findIndex((m) => m.id === "markets");
    if (index === -1) return;
    const [removed] = draft.modules.splice(index, 1);
    const assets = Array.isArray((removed.config as any)?.assets) ? ((removed.config as any).assets as any[]) : [];

    // Les modules Bourse et Crypto utilisent depuis un widget de recherche un objet candidat
    // (symbole + libellé + marché/rang) plutôt qu'un simple symbole texte : on reconstitue cet
    // objet à partir des données migrées.
    const toStockAsset = (a: any) => ({ stock: { query: a.symbol, symbol: a.symbol, name: a.label || a.symbol, exchange: "" }, label: a.label });
    const toCryptoAsset = (a: any) => ({ crypto: { query: a.symbol, id: a.symbol, name: a.label || a.symbol, symbol: "", rank: null }, label: a.label });
    const stockAssets = assets.filter((a) => a?.type === "stock").map(toStockAsset);
    const cryptoAssets = assets.filter((a) => a?.type === "crypto").map(toCryptoAsset);

    draft.modules.push({ id: "stocks", enabled: removed.enabled, order: removed.order, config: { assets: stockAssets } });
    draft.modules.push({ id: "crypto", enabled: removed.enabled, order: removed.order + 0.5, config: { assets: cryptoAssets } });
  });
}

/**
 * Migration ponctuelle : les modules Bourse et Crypto ont remplacé leur champ texte "symbol" par un
 * widget de recherche produisant un objet candidat ("stock"/"crypto" avec nom, marché/rang...). On
 * convertit les anciennes entrées à plat plutôt que de les faire disparaître silencieusement du ticket.
 */
async function migrateLegacySearchableAssets(): Promise<void> {
  const isLegacyFlatAsset = (a: any, key: string) => a && typeof a === "object" && typeof a.symbol === "string" && !(key in a);

  const cfg = configStore.getConfig();
  const stocksAssets = ((cfg.modules.find((m) => m.id === "stocks")?.config as any)?.assets ?? []) as any[];
  const cryptoAssets = ((cfg.modules.find((m) => m.id === "crypto")?.config as any)?.assets ?? []) as any[];
  const needsMigration = stocksAssets.some((a) => isLegacyFlatAsset(a, "stock")) || cryptoAssets.some((a) => isLegacyFlatAsset(a, "crypto"));
  if (!needsMigration) return;

  await configStore.updateConfig((draft) => {
    const stocksInst = draft.modules.find((m) => m.id === "stocks");
    if (stocksInst) {
      const assets = Array.isArray((stocksInst.config as any).assets) ? ((stocksInst.config as any).assets as any[]) : [];
      (stocksInst.config as any).assets = assets.map((a) =>
        isLegacyFlatAsset(a, "stock") ? { stock: { query: a.symbol, symbol: a.symbol, name: a.label || a.symbol, exchange: "" }, label: a.label } : a,
      );
    }

    const cryptoInst = draft.modules.find((m) => m.id === "crypto");
    if (cryptoInst) {
      const assets = Array.isArray((cryptoInst.config as any).assets) ? ((cryptoInst.config as any).assets as any[]) : [];
      (cryptoInst.config as any).assets = assets.map((a) =>
        isLegacyFlatAsset(a, "crypto") ? { crypto: { query: a.symbol, id: a.symbol, name: a.label || a.symbol, symbol: "", rank: null }, label: a.label } : a,
      );
    }
  });
}

/** Ajoute en base une entrée pour tout module du registre qui n'y figure pas encore. */
async function ensureInstances(): Promise<void> {
  await migrateLegacyMarketsModule();
  await migrateLegacySearchableAssets();

  const cfg = configStore.getConfig();
  const existingIds = new Set(cfg.modules.map((m) => m.id));
  const missing = MODULE_REGISTRY.filter((m) => !existingIds.has(m.id));
  if (missing.length === 0) return;

  await configStore.updateConfig((draft) => {
    for (const mod of missing) {
      draft.modules.push({
        id: mod.id,
        enabled: true,
        order: draft.modules.length,
        config: structuredClone(mod.defaultConfig),
      });
    }
  });
}

/** Liste les modules connus, triés par ordre, avec leur config fusionnée aux valeurs par défaut. */
export async function listModules(): Promise<ModuleView[]> {
  await ensureInstances();
  const cfg = configStore.getConfig();

  const views: ModuleView[] = [];
  for (const instance of cfg.modules) {
    const mod = getModule(instance.id);
    if (!mod) continue; // module supprimé du registre : on ignore silencieusement
    views.push({
      id: mod.id,
      name: mod.name,
      description: mod.description,
      dataSource: mod.dataSource,
      configSchema: mod.configSchema,
      enabled: instance.enabled,
      order: instance.order,
      config: { ...structuredClone(mod.defaultConfig), ...instance.config },
    });
  }

  return views.sort((a, b) => a.order - b.order);
}

export async function setModuleEnabled(id: string, enabled: boolean): Promise<void> {
  await ensureInstances();
  await configStore.updateConfig((draft) => {
    const inst = draft.modules.find((m) => m.id === id);
    if (inst) inst.enabled = enabled;
  });
}

/** Remplace intégralement la config d'un module (le front envoie l'objet complet issu du schéma). */
export async function setModuleConfig(id: string, config: Record<string, unknown>): Promise<void> {
  await ensureInstances();
  await configStore.updateConfig((draft) => {
    const inst = draft.modules.find((m) => m.id === id);
    if (inst) inst.config = config;
  });
}

/** Réordonne les modules selon la liste d'ids fournie (ordre = index). */
export async function reorderModules(orderedIds: string[]): Promise<void> {
  await ensureInstances();
  await configStore.updateConfig((draft) => {
    orderedIds.forEach((id, index) => {
      const inst = draft.modules.find((m) => m.id === id);
      if (inst) inst.order = index;
    });
  });
}
