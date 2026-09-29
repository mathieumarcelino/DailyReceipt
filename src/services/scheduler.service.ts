import cron, { ScheduledTask } from "node-cron";
import { configStore } from "../config/store";
import { WEEKDAYS, type Weekday } from "../config/types";
import { printTicket } from "./printer.service";
import { ensureTickets } from "./tickets.service";

const tasks = new Map<string, ScheduledTask>();

/** Numéro de jour cron standard (0 = dimanche ... 6 = samedi), voir le champ "day-of-week" d'une expression cron. */
const CRON_DOW: Record<Weekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function toCronExpression(time: string, weekday: Weekday): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Heure de planification invalide : "${time}"`);
  }
  return `${minute} ${hour} * * ${CRON_DOW[weekday]}`;
}

/**
 * (Re)crée une tâche cron par ticket et par jour activé, à partir de la config actuelle — un ticket
 * peut imprimer à des heures différentes selon le jour, d'où une tâche distincte par jour plutôt
 * qu'une seule tâche par ticket. À appeler au démarrage et après toute création/suppression de ticket
 * ou modification de sa planification.
 */
export async function rescheduleFromConfig(): Promise<void> {
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  // Garantit que `tickets` existe (migration/amorçage) même au tout premier démarrage, avant qu'une
  // requête HTTP n'ait eu l'occasion de le déclencher — sans ça, un serveur jamais ouvert dans le
  // navigateur après une mise à jour ne planifierait silencieusement aucune impression.
  await ensureTickets();

  const { tickets } = configStore.getConfig();
  for (const ticket of tickets) {
    for (const weekday of WEEKDAYS) {
      const day = ticket.schedule[weekday];
      if (!day.enabled) continue;

      const expression = toCronExpression(day.time, weekday);
      const task = cron.schedule(
        expression,
        () => {
          printTicket(ticket.id).catch((err) => {
            console.error(`[scheduler] Échec de l'impression planifiée du ticket "${ticket.name}" :`, err instanceof Error ? err.message : err);
          });
        },
        { timezone: process.env.TZ || undefined },
      );
      tasks.set(`${ticket.id}:${weekday}`, task);
    }
  }
}

/** Déclenche une impression immédiate d'un ticket (bouton "Imprimer maintenant"), en dehors du planning. */
export async function triggerNow(ticketId: string): Promise<void> {
  await printTicket(ticketId);
}
