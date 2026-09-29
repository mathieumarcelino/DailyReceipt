import { randomUUID } from "node:crypto";
import { configStore } from "../config/store";
import { createSchedule } from "../config/types";
import type { LastRunState, ScheduleConfig, Ticket } from "../config/types";

export interface TicketSummary {
  id: string;
  name: string;
  schedule: ScheduleConfig;
  lastRun?: LastRunState;
}

/**
 * Migration ponctuelle : avant le support multi-tickets, la config stockait une seule planification
 * (`schedule`) et une seule liste de modules (`modules`) à plat. On les regroupe dans un premier
 * ticket plutôt que de les perdre. Contrairement aux migrations de `modules.service.ts` (qui ne
 * changent que la config imbriquée d'un module), celle-ci change la forme d'`AppConfig` lui-même —
 * `ConfigStore.readOrInit()` laisse volontairement passer `schedule`/`modules` legacy pour qu'elle
 * puisse les consommer ici. Idempotente : no-op si déjà migré.
 */
async function migrateSingleTicketConfig(): Promise<void> {
  const cfg = configStore.getConfig() as any;
  if (cfg.schedule === undefined && cfg.modules === undefined) return;

  await configStore.updateConfig((draft: any) => {
    const legacySchedule = draft.schedule as { time?: string; enabled?: boolean } | undefined;
    const ticket: Ticket = {
      id: randomUUID(),
      name: "Ticket du matin",
      schedule: legacySchedule ? createSchedule(legacySchedule.time ?? "07:30", legacySchedule.enabled ?? false) : createSchedule("07:30", true),
      modules: Array.isArray(draft.modules) ? draft.modules : [],
      lastRun: draft.state?.lastRun,
    };
    draft.tickets = [ticket, ...(draft.tickets ?? [])];
    delete draft.schedule;
    delete draft.modules;
    if (draft.state) delete draft.state.lastRun;
  });
}

/**
 * Migration ponctuelle : avant la planification par jour de la semaine, `Ticket.schedule` était une
 * heure/activation unique (`{ time, enabled }`) appliquée tous les jours. Convertit vers la nouvelle
 * forme par jour en répétant cette même heure/activation sur les 7 jours — comportement identique
 * pour l'utilisateur tant qu'il ne personnalise pas un jour en particulier. Idempotente.
 */
async function migrateLegacyDailySchedule(): Promise<void> {
  const cfg = configStore.getConfig();
  const needsMigration = cfg.tickets.some((t) => isLegacyDailySchedule(t.schedule));
  if (!needsMigration) return;

  await configStore.updateConfig((draft) => {
    for (const ticket of draft.tickets) {
      if (isLegacyDailySchedule(ticket.schedule)) {
        const legacy = ticket.schedule as unknown as { time: string; enabled: boolean };
        ticket.schedule = createSchedule(legacy.time, legacy.enabled);
      }
    }
  });
}

function isLegacyDailySchedule(schedule: ScheduleConfig): boolean {
  return schedule && typeof (schedule as any).time === "string" && typeof (schedule as any).enabled === "boolean";
}

/**
 * À appeler avant toute lecture de `cfg.tickets` : garantit que les migrations ont eu lieu. Un premier
 * ticket est amorcé une seule fois, à la création initiale du fichier de config (`store.ts`) — pas
 * ici, pour qu'un utilisateur qui supprime volontairement son dernier ticket (état vide autorisé, voir
 * `deleteTicket`) n'en voie pas un réapparaître silencieusement au prochain accès.
 */
export async function ensureTickets(): Promise<void> {
  await migrateSingleTicketConfig();
  await migrateLegacyDailySchedule();
}

function toSummary(ticket: Ticket): TicketSummary {
  return { id: ticket.id, name: ticket.name, schedule: ticket.schedule, lastRun: ticket.lastRun };
}

export async function listTickets(): Promise<TicketSummary[]> {
  await ensureTickets();
  return configStore.getConfig().tickets.map(toSummary);
}

export async function getTicket(id: string): Promise<TicketSummary | undefined> {
  await ensureTickets();
  const ticket = configStore.getConfig().tickets.find((t) => t.id === id);
  return ticket ? toSummary(ticket) : undefined;
}

/** Planification désactivée par défaut : le ticket n'imprime rien tant que l'utilisateur n'a pas choisi ses modules et une heure. */
export async function createTicket(name: string): Promise<TicketSummary> {
  await ensureTickets();
  const ticket: Ticket = { id: randomUUID(), name, schedule: createSchedule("07:30", false), modules: [] };
  await configStore.updateConfig((draft) => {
    draft.tickets.push(ticket);
  });
  return toSummary(ticket);
}

export async function renameTicket(id: string, name: string): Promise<TicketSummary | undefined> {
  await ensureTickets();
  const updated = await configStore.updateConfig((draft) => {
    const ticket = draft.tickets.find((t) => t.id === id);
    if (ticket) ticket.name = name;
  });
  const ticket = updated.tickets.find((t) => t.id === id);
  return ticket ? toSummary(ticket) : undefined;
}

export async function updateTicketSchedule(id: string, schedule: ScheduleConfig): Promise<TicketSummary | undefined> {
  await ensureTickets();
  const updated = await configStore.updateConfig((draft) => {
    const ticket = draft.tickets.find((t) => t.id === id);
    if (ticket) ticket.schedule = schedule;
  });
  const ticket = updated.tickets.find((t) => t.id === id);
  return ticket ? toSummary(ticket) : undefined;
}

/** Autorise de supprimer le dernier ticket restant (la page Tickets affiche alors un état vide avec une invitation à en créer un). */
export async function deleteTicket(id: string): Promise<boolean> {
  await ensureTickets();
  const before = configStore.getConfig().tickets.length;
  const updated = await configStore.updateConfig((draft) => {
    draft.tickets = draft.tickets.filter((t) => t.id !== id);
  });
  return updated.tickets.length < before;
}
