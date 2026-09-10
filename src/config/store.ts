import fs from "node:fs";
import path from "node:path";
import { AppConfig, DEFAULT_CONFIG } from "./types";

const CONFIG_PATH = process.env.CONFIG_PATH ?? "/data/config.json";

/**
 * Petit store JSON persistant, protégé par une file d'attente d'écriture pour
 * éviter toute corruption en cas d'écritures concurrentes (ex: sauvegarde
 * config + mise à jour de l'état "dernière impression" en parallèle).
 */
class ConfigStore {
  private cache: AppConfig;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.cache = this.loadOrCreate();
  }

  private loadOrCreate(): AppConfig {
    const dir = path.dirname(CONFIG_PATH);
    fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(CONFIG_PATH)) {
      const initial = structuredClone(DEFAULT_CONFIG);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }

    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = raw.trim().length > 0 ? JSON.parse(raw) : {};
    return {
      printer: { ...DEFAULT_CONFIG.printer, ...parsed.printer },
      schedule: { ...DEFAULT_CONFIG.schedule, ...parsed.schedule },
      modules: Array.isArray(parsed.modules) ? parsed.modules : [],
      state: { ...DEFAULT_CONFIG.state, ...parsed.state },
    };
  }

  getConfig(): AppConfig {
    return structuredClone(this.cache);
  }

  /**
   * Applique une mutation sur une copie de la config, persiste sur disque,
   * puis met à jour le cache. Les écritures sont sérialisées via writeQueue.
   */
  async updateConfig(mutator: (cfg: AppConfig) => void): Promise<AppConfig> {
    const next = structuredClone(this.cache);
    mutator(next);

    this.writeQueue = this.writeQueue.then(() => fs.promises.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8"));
    await this.writeQueue;

    this.cache = next;
    return structuredClone(this.cache);
  }
}

export const configStore = new ConfigStore();
