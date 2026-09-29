/** Shell Alpine partagée par toutes les pages : gère l'affichage des toasts. */
function appShell() {
  return {
    toast: null,
    toastTimer: null,
    onToast({ message, type }) {
      this.toast = { message, type };
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toast = null;
      }, 4000);
    },
  };
}

/** Jours de la semaine (lundi en premier), utilisés par la planification par ticket (voir `Ticket.schedule`). */
const WEEKDAYS = [
  { key: "mon", label: "Lundi", short: "Lun" },
  { key: "tue", label: "Mardi", short: "Mar" },
  { key: "wed", label: "Mercredi", short: "Mer" },
  { key: "thu", label: "Jeudi", short: "Jeu" },
  { key: "fri", label: "Vendredi", short: "Ven" },
  { key: "sat", label: "Samedi", short: "Sam" },
  { key: "sun", label: "Dimanche", short: "Dim" },
];

/** Résume la planification d'un ticket en une phrase courte (jours actifs, heure si uniforme sur ces jours). */
function scheduleSummary(schedule) {
  const enabledDays = WEEKDAYS.filter((d) => schedule[d.key]?.enabled);
  if (enabledDays.length === 0) return "Impression automatique désactivée";

  const times = new Set(enabledDays.map((d) => schedule[d.key].time));
  if (enabledDays.length === 7) {
    return times.size === 1 ? `Tous les jours à ${[...times][0]}` : "Tous les jours à des horaires différents";
  }

  const days = enabledDays.map((d) => d.short).join(", ");
  return times.size === 1 ? `${days} à ${[...times][0]}` : `${days} (horaires différents)`;
}

/** Petit helper fetch JSON qui lève une erreur lisible en cas d'échec. */
async function api(url, options = {}) {
  // Fastify rejette en 400 (FST_ERR_CTP_EMPTY_JSON_BODY) un Content-Type: application/json envoyé
  // avec un corps vide (ex: le bouton d'un champ "action", qui ne transmet aucune donnée) — l'en-tête
  // n'est donc ajouté que lorsqu'un body est effectivement fourni.
  const hasBody = options.body !== undefined;
  const res = await fetch(url, {
    ...options,
    headers: { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // réponse vide, ignoré
  }

  if (!res.ok) {
    throw new Error(json?.error ?? `Erreur HTTP ${res.status}`);
  }
  return json;
}
