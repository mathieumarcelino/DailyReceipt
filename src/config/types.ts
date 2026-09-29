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

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export interface DaySchedule {
  enabled: boolean;
  /** Heure locale au format "HH:MM". */
  time: string;
}

/** Planification d'un ticket, jour par jour (heure et activation indépendantes par jour de la semaine). */
export type ScheduleConfig = Record<Weekday, DaySchedule>;

/** Même heure/activation répétée sur les 7 jours — point de départ pratique pour un nouveau ticket. */
export function createSchedule(time: string, enabled: boolean): ScheduleConfig {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, { time, enabled }])) as ScheduleConfig;
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

/**
 * Un ticket = une planification + une sélection de modules indépendantes. L'app peut imprimer
 * plusieurs tickets, chacun à sa propre heure (ex: un ticket "Matin" et un ticket "Soir").
 */
export interface Ticket {
  id: string;
  name: string;
  schedule: ScheduleConfig;
  modules: ModuleInstanceConfig[];
  /** Statut de la dernière impression de CE ticket (pas global : chaque ticket a son propre historique). */
  lastRun?: LastRunState;
}

export interface AppState {
  /** Résumés IA du module Actualités, mis en cache par sujet jusqu'au lendemain. Clé : "<ticketId>:<label du sujet>", pour qu'un même libellé de sujet dans deux tickets différents ne partage jamais son cache. */
  newsCache?: Record<string, NewsCacheEntry>;
}

export interface AppConfig {
  /** Imprimante physique : un seul appareil réseau, partagé par tous les tickets. */
  printer: PrinterConfig;
  tickets: Ticket[];
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
  tickets: [],
  state: {},
};
