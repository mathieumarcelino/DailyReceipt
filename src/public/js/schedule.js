function schedulePage() {
  return {
    form: { time: "07:30", enabled: true },
    lastRun: null,
    loading: true,
    saving: false,
    printing: false,

    async init() {
      try {
        const data = await api("/api/schedule");
        this.form = { time: data.time, enabled: data.enabled };
        this.lastRun = data.lastRun;
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.loading = false;
      }
    },

    async save() {
      this.saving = true;
      try {
        const data = await api("/api/schedule", { method: "PUT", body: this.form });
        this.form = { time: data.time, enabled: data.enabled };
        this.lastRun = data.lastRun;
        this.$dispatch("toast", { message: "Planification enregistrée.", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.saving = false;
      }
    },

    async printNow() {
      this.printing = true;
      try {
        await api("/api/print/now", { method: "POST" });
        this.$dispatch("toast", { message: "Ticket du jour envoyé à l'imprimante !", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: `Échec de l'impression : ${e.message}`, type: "error" });
      } finally {
        this.printing = false;
        try {
          const data = await api("/api/schedule");
          this.lastRun = data.lastRun;
        } catch {
          // silencieux : on garde le dernier statut connu
        }
      }
    },

    formatTimestamp(iso) {
      if (!iso) return "";
      return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
    },
  };
}
