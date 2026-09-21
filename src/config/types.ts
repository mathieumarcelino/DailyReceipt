/** Profils de codepage supportés pour l'encodage des caractères accentués. */
export type PrinterProfile = "CP437" | "CP858" | "CP1252";

export interface PrinterConfig {
  host: string;
  port: number;
  profile: PrinterProfile;
  /** Nombre de colonnes de texte (42 ou 48 selon l'imprimante 80mm). */
  columns: 42 | 48;
  /** Largeur d'impression en points, utilisée pour rastériser les images/logos (384 = 58mm, 576 = 80mm). */
  printWidthPx: 384 | 576;
}

export interface ScheduleConfig {
  /** Heure locale au format "HH:MM". */
  time: string;
  enabled: boolean;
}

export interface ModuleInstanceConfig {
  id: string;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

export interface LastRunState {
  timestamp: string;
  status: "success" | "error";
  message?: string;
}

export interface NewsCacheEntry {
  summary: string;
  /** ISO8601, horodatage de génération : le cache expire au changement de jour local. */
  cachedAt: string;
}

export interface AppState {
  lastRun?: LastRunState;
  /** Résumés IA du module Actualités, mis en cache par URL de flux jusqu'au lendemain. */
  newsCache?: Record<string, NewsCacheEntry>;
}

export interface AppConfig {
  printer: PrinterConfig;
  schedule: ScheduleConfig;
  modules: ModuleInstanceConfig[];
  state: AppState;
}

export const DEFAULT_CONFIG: AppConfig = {
  printer: {
    host: "192.168.1.50",
    port: 9100,
    profile: "CP858",
    columns: 48,
    printWidthPx: 576,
  },
  schedule: {
    time: "07:30",
    enabled: true,
  },
  modules: [],
  state: {},
};
