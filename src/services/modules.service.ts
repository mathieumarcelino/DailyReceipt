import { configStore } from "../config/store";
import { MODULE_REGISTRY, getModule } from "../modules/registry";
import type { ConfigField } from "../modules/types";
import { ensureTickets } from "./tickets.service";

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

function getTicketModules(cfg: ReturnType<typeof configStore.getConfig>, ticketId: string) {
  return cfg.tickets.find((t) => t.id === ticketId)?.modules;
}

/**
 * Migration ponctuelle : l'ancien module unique "markets" (Bourse + Crypto) a été scindé en
 * deux modules distincts "stocks" et "crypto". On répartit sa config existante par type plutôt
 * que de perdre silencieusement le portefeuille déjà configuré par l'utilisateur.
 */
async function migrateLegacyMarketsModule(ticketId: string): Promise<void> {
  const cfg = configStore.getConfig();
  const modules = getTicketModules(cfg, ticketId);
  const legacy = modules?.find((m) => m.id === "markets");
  if (!legacy) return;

  await configStore.updateConfig((draft) => {
    const draftModules = draft.tickets.find((t) => t.id === ticketId)?.modules;
    if (!draftModules) return;
    const index = draftModules.findIndex((m) => m.id === "markets");
    if (index === -1) return;
    const [removed] = draftModules.splice(index, 1);
    const assets = Array.isArray((removed.config as any)?.assets) ? ((removed.config as any).assets as any[]) : [];

    // Les modules Bourse et Crypto utilisent depuis un widget de recherche un objet candidat
    // (symbole + libellé + marché/rang) plutôt qu'un simple symbole texte : on reconstitue cet
    // objet à partir des données migrées.
    const toStockAsset = (a: any) => ({ stock: { query: a.symbol, symbol: a.symbol, name: a.label || a.symbol, exchange: "" }, label: a.label });
    const toCryptoAsset = (a: any) => ({ crypto: { query: a.symbol, id: a.symbol, name: a.label || a.symbol, symbol: "", rank: null }, label: a.label });
    const stockAssets = assets.filter((a) => a?.type === "stock").map(toStockAsset);
    const cryptoAssets = assets.filter((a) => a?.type === "crypto").map(toCryptoAsset);

    draftModules.push({ id: "stocks", enabled: removed.enabled, order: removed.order, config: { assets: stockAssets } });
    draftModules.push({ id: "crypto", enabled: removed.enabled, order: removed.order + 0.5, config: { assets: cryptoAssets } });
  });
}

/**
 * Migration ponctuelle : les modules Bourse et Crypto ont remplacé leur champ texte "symbol" par un
 * widget de recherche produisant un objet candidat ("stock"/"crypto" avec nom, marché/rang...). On
 * convertit les anciennes entrées à plat plutôt que de les faire disparaître silencieusement du ticket.
 */
async function migrateLegacySearchableAssets(ticketId: string): Promise<void> {
  const isLegacyFlatAsset = (a: any, key: string) => a && typeof a === "object" && typeof a.symbol === "string" && !(key in a);

  const cfg = configStore.getConfig();
  const modules = getTicketModules(cfg, ticketId);
  const stocksAssets = ((modules?.find((m) => m.id === "stocks")?.config as any)?.assets ?? []) as any[];
  const cryptoAssets = ((modules?.find((m) => m.id === "crypto")?.config as any)?.assets ?? []) as any[];
  const needsMigration = stocksAssets.some((a) => isLegacyFlatAsset(a, "stock")) || cryptoAssets.some((a) => isLegacyFlatAsset(a, "crypto"));
  if (!needsMigration) return;

  await configStore.updateConfig((draft) => {
    const draftModules = draft.tickets.find((t) => t.id === ticketId)?.modules;
    if (!draftModules) return;

    const stocksInst = draftModules.find((m) => m.id === "stocks");
    if (stocksInst) {
      const assets = Array.isArray((stocksInst.config as any).assets) ? ((stocksInst.config as any).assets as any[]) : [];
      (stocksInst.config as any).assets = assets.map((a) =>
        isLegacyFlatAsset(a, "stock") ? { stock: { query: a.symbol, symbol: a.symbol, name: a.label || a.symbol, exchange: "" }, label: a.label } : a,
      );
    }

    const cryptoInst = draftModules.find((m) => m.id === "crypto");
    if (cryptoInst) {
      const assets = Array.isArray((cryptoInst.config as any).assets) ? ((cryptoInst.config as any).assets as any[]) : [];
      (cryptoInst.config as any).assets = assets.map((a) =>
        isLegacyFlatAsset(a, "crypto") ? { crypto: { query: a.symbol, id: a.symbol, name: a.label || a.symbol, symbol: "", rank: null }, label: a.label } : a,
      );
    }
  });
}

/**
 * Migration ponctuelle : le module Actualités groupait initialement un flux RSS par entrée (un
 * "sujet" = un flux), obligeant à retaper le même libellé pour lier plusieurs flux à un même sujet.
 * La config passe à une liste de sujets contenant chacun plusieurs flux ; on regroupe les anciennes
 * entrées plates par libellé identique plutôt que de perdre silencieusement les flux déjà configurés.
 */
async function migrateLegacyNewsFeeds(ticketId: string): Promise<void> {
  const cfg = configStore.getConfig();
  const modules = getTicketModules(cfg, ticketId);
  const legacyFeeds = (modules?.find((m) => m.id === "news")?.config as any)?.feeds;
  if (!Array.isArray(legacyFeeds)) return; // pas de config Actualités, ou déjà migrée

  await configStore.updateConfig((draft) => {
    const draftModules = draft.tickets.find((t) => t.id === ticketId)?.modules;
    const inst = draftModules?.find((m) => m.id === "news");
    if (!inst) return;
    const feeds = Array.isArray((inst.config as any).feeds) ? ((inst.config as any).feeds as any[]) : [];

    type MigratedTopic = { label: string; feeds: { url: string; maxArticles: number }[] };
    const topics = new Map<string, MigratedTopic>();
    for (const feed of feeds) {
      const label = feed?.label ?? "";
      const topic: MigratedTopic = topics.get(label) ?? { label, feeds: [] };
      topic.feeds.push({ url: feed?.url ?? "", maxArticles: feed?.maxArticles ?? 5 });
      topics.set(label, topic);
    }

    delete (inst.config as any).feeds;
    (inst.config as any).topics = [...topics.values()];
  });
}

/** Ajoute, pour ce ticket, une entrée pour tout module du registre qui n'y figure pas encore. */
async function ensureModuleInstances(ticketId: string): Promise<void> {
  await ensureTickets();
  await migrateLegacyMarketsModule(ticketId);
  await migrateLegacySearchableAssets(ticketId);
  await migrateLegacyNewsFeeds(ticketId);

  const cfg = configStore.getConfig();
  const modules = getTicketModules(cfg, ticketId) ?? [];
  const existingIds = new Set(modules.map((m) => m.id));
  const missing = MODULE_REGISTRY.filter((m) => !existingIds.has(m.id));
  if (missing.length === 0) return;

  await configStore.updateConfig((draft) => {
    const draftModules = draft.tickets.find((t) => t.id === ticketId)?.modules;
    if (!draftModules) return;
    for (const mod of missing) {
      draftModules.push({
        id: mod.id,
        enabled: true,
        order: draftModules.length,
        config: structuredClone(mod.defaultConfig),
      });
    }
  });
}

/** Liste les modules connus d'un ticket, triés par ordre, avec leur config fusionnée aux valeurs par défaut. */
export async function listModules(ticketId: string): Promise<ModuleView[]> {
  await ensureModuleInstances(ticketId);
  const cfg = configStore.getConfig();
  const modules = getTicketModules(cfg, ticketId) ?? [];

  const views: ModuleView[] = [];
  for (const instance of modules) {
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

export async function setModuleEnabled(ticketId: string, id: string, enabled: boolean): Promise<void> {
  await ensureModuleInstances(ticketId);
  await configStore.updateConfig((draft) => {
    const inst = draft.tickets.find((t) => t.id === ticketId)?.modules.find((m) => m.id === id);
    if (inst) inst.enabled = enabled;
  });
}

/** Remplace intégralement la config d'un module (le front envoie l'objet complet issu du schéma). */
export async function setModuleConfig(ticketId: string, id: string, config: Record<string, unknown>): Promise<void> {
  await ensureModuleInstances(ticketId);
  await configStore.updateConfig((draft) => {
    const inst = draft.tickets.find((t) => t.id === ticketId)?.modules.find((m) => m.id === id);
    if (inst) inst.config = config;
  });
}

/** Réordonne les modules d'un ticket selon la liste d'ids fournie (ordre = index). */
export async function reorderModules(ticketId: string, orderedIds: string[]): Promise<void> {
  await ensureModuleInstances(ticketId);
  await configStore.updateConfig((draft) => {
    const modules = draft.tickets.find((t) => t.id === ticketId)?.modules;
    if (!modules) return;
    orderedIds.forEach((id, index) => {
      const inst = modules.find((m) => m.id === id);
      if (inst) inst.order = index;
    });
  });
}
