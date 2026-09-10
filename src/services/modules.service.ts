import { configStore } from "../config/store";
import { MODULE_REGISTRY, getModule } from "../modules/registry";
import type { ConfigField } from "../modules/types";

export interface ModuleView {
  id: string;
  name: string;
  description?: string;
  configSchema: ConfigField[];
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

/** Ajoute en base une entrée pour tout module du registre qui n'y figure pas encore. */
async function ensureInstances(): Promise<void> {
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
