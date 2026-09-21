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
