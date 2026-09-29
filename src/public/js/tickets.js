function ticketsPage() {
  return {
    tickets: [],
    loading: true,
    creating: false,
    newTicketName: "",

    async init() {
      await this.loadTickets();
    },

    async loadTickets() {
      this.loading = true;
      try {
        const tickets = await api("/api/tickets");
        this.tickets = tickets.map((t) => ({ ...t, printing: false, confirmingDelete: false }));
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.loading = false;
      }
    },

    async createTicket() {
      const name = this.newTicketName.trim();
      if (!name) return;
      this.creating = true;
      try {
        await api("/api/tickets", { method: "POST", body: { name } });
        this.newTicketName = "";
        this.$dispatch("toast", { message: "Ticket créé.", type: "success" });
        await this.loadTickets();
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.creating = false;
      }
    },

    async printNow(ticket) {
      ticket.printing = true;
      try {
        const data = await api(`/api/tickets/${ticket.id}/print`, { method: "POST" });
        ticket.lastRun = data.lastRun;
        this.$dispatch("toast", { message: `Ticket "${ticket.name}" envoyé à l'imprimante !`, type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: `Échec de l'impression : ${e.message}`, type: "error" });
        try {
          const fresh = await api("/api/tickets");
          const match = fresh.find((t) => t.id === ticket.id);
          if (match) ticket.lastRun = match.lastRun;
        } catch {
          // silencieux : on garde le dernier statut connu
        }
      } finally {
        ticket.printing = false;
      }
    },

    /** Double-clic en ligne plutôt qu'un confirm() natif ou une modale (aucune modale dans ce projet) : un premier clic passe le bouton en "Confirmer ?" quelques secondes, un second clic dans ce délai supprime réellement. */
    confirmDelete(ticket) {
      if (!ticket.confirmingDelete) {
        ticket.confirmingDelete = true;
        clearTimeout(ticket._confirmTimeout);
        ticket._confirmTimeout = setTimeout(() => {
          ticket.confirmingDelete = false;
        }, 3000);
        return;
      }
      clearTimeout(ticket._confirmTimeout);
      this.deleteTicket(ticket);
    },

    async deleteTicket(ticket) {
      try {
        await api(`/api/tickets/${ticket.id}`, { method: "DELETE" });
        this.tickets = this.tickets.filter((t) => t.id !== ticket.id);
        this.$dispatch("toast", { message: "Ticket supprimé.", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      }
    },

    formatTimestamp(iso) {
      if (!iso) return "";
      return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    },

    isActive(ticket) {
      return WEEKDAYS.some((d) => ticket.schedule[d.key]?.enabled);
    },
  };
}
