function printerPage() {
  return {
    form: { host: "", port: 9100, profile: "CP858", columns: 48, printWidthPx: 576 },
    loading: true,
    saving: false,
    testing: false,

    async init() {
      try {
        this.form = await api("/api/printer");
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.loading = false;
      }
    },

    async save() {
      this.saving = true;
      try {
        this.form = await api("/api/printer", { method: "PUT", body: { ...this.form, port: Number(this.form.port) } });
        this.$dispatch("toast", { message: "Paramètres imprimante enregistrés.", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.saving = false;
      }
    },

    async test() {
      this.testing = true;
      try {
        await api("/api/print/test", { method: "POST", body: { ...this.form, port: Number(this.form.port) } });
        this.$dispatch("toast", { message: "Ticket de test envoyé à l'imprimante !", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: `Échec de l'impression : ${e.message}`, type: "error" });
      } finally {
        this.testing = false;
      }
    },
  };
}
