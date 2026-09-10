import cron, { ScheduledTask } from "node-cron";
import { configStore } from "../config/store";
import { printDailyReceipt } from "./printer.service";

let currentTask: ScheduledTask | null = null;

function toCronExpression(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Heure de planification invalide : "${time}"`);
  }
  return `${minute} ${hour} * * *`;
}

/** (Re)crée la tâche cron à partir de la config actuelle. À appeler au démarrage et après chaque sauvegarde de planification. */
export function rescheduleFromConfig(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  const { schedule } = configStore.getConfig();
  if (!schedule.enabled) return;

  const expression = toCronExpression(schedule.time);
  currentTask = cron.schedule(
    expression,
    () => {
      printDailyReceipt().catch((err) => {
        console.error("[scheduler] Échec de l'impression planifiée :", err instanceof Error ? err.message : err);
      });
    },
    { timezone: process.env.TZ || undefined },
  );
}

/** Déclenche une impression immédiate (bouton "Imprimer maintenant"), en dehors du planning. */
export async function triggerNow(): Promise<void> {
  await printDailyReceipt();
}
