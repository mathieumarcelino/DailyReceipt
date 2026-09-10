/** Formate une date en français, ex: "Mardi 9 septembre 2026". */
export function formatFrenchDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** Formate une heure en français, ex: "07:30". */
export function formatFrenchTime(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Retourne la date du jour au format "jj/mm" (pour comparaison avec les anniversaires). */
export function todayDayMonth(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}
