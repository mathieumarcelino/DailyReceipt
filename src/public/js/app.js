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
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
