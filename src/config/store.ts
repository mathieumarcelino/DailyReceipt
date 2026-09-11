import fs from "node:fs";
import path from "node:path";
import { AppConfig, DEFAULT_CONFIG } from "./types";

const DEFAULT_CONFIG_PATH = "/data/config.json";
const LOCAL_FALLBACK_PATH = path.join(process.cwd(), "data", "config.json");

/**
 * Petit store JSON persistant, protégé par une file d'attente d'écriture pour
 * éviter toute corruption en cas d'écritures concurrentes (ex: sauvegarde
 * config + mise à jour de l'état "dernière impression" en parallèle).
 */
class ConfigStore {
  private configPath: string;
  private cache: AppConfig;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.configPath = process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
    this.cache = this.loadOrCreate();
  }

  private loadOrCreate(): AppConfig {
    try {
      return this.readOrInit(this.configPath);
    } catch (err) {
      // En dehors de Docker (où /data est créé et accessible en écriture), le
      // chemin par défaut "/data/config.json" n'est en général pas accessible
      // sans droits root. Si l'utilisateur n'a pas explicitement choisi un
      // chemin via CONFIG_PATH, on bascule silencieusement sur un dossier
      // local plutôt que de planter au démarrage.
      const isPermissionIssue = err instanceof Error && "code" in err && (err.code === "EACCES" || err.code === "EPERM");
      if (!process.env.CONFIG_PATH && isPermissionIssue) {
        console.warn(
          `[config] "${this.configPath}" inaccessible (droits insuffisants) — utilisation de "${LOCAL_FALLBACK_PATH}" à la place. ` +
            `Définissez la variable d'environnement CONFIG_PATH pour choisir un autre emplacement.`,
        );
        this.configPath = LOCAL_FALLBACK_PATH;
        return this.readOrInit(this.configPath);
      }
      throw err;
    }
  }

  private readOrInit(configPath: string): AppConfig {
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(configPath)) {
      const initial = structuredClone(DEFAULT_CONFIG);
      fs.writeFileSync(configPath, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }

    const raw = fs.readFileSync(configPath, "utf-8");
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

    this.writeQueue = this.writeQueue.then(() => fs.promises.writeFile(this.configPath, JSON.stringify(next, null, 2), "utf-8"));
    await this.writeQueue;

    this.cache = next;
    return structuredClone(this.cache);
  }
}

export const configStore = new ConfigStore();
