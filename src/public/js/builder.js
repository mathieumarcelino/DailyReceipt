function defaultFieldValue(field) {
  switch (field.type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "select":
      return field.options?.[0]?.value ?? "";
    case "array":
      return [];
    case "team-search":
    case "stock-search":
    case "crypto-search":
      return null;
    case "image":
    case "password":
    default:
      return "";
  }
}

/** État Alpine local (un par ligne du tableau "équipes suivies") pour le flux rechercher -> choisir. */
function teamSearchState(item) {
  return {
    query: item.team?.query || "",
    loading: false,
    results: [],
    error: null,

    async search() {
      const q = this.query.trim();
      if (!q) return;
      this.loading = true;
      this.error = null;
      this.results = [];
      try {
        const data = await api(`/api/sports/search-teams?q=${encodeURIComponent(q)}`);
        if (!data.teams?.length) this.error = "Aucune équipe trouvée pour ce nom.";
        else this.results = data.teams;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    choose(item, candidate) {
      item.team = candidate;
      this.results = [];
    },
  };
}

/** État Alpine local (un par ligne du tableau "actions suivies") pour le flux rechercher -> choisir. */
function stockSearchState(item) {
  return {
    query: item.stock?.query || "",
    loading: false,
    results: [],
    error: null,

    async search() {
      const q = this.query.trim();
      if (!q) return;
      this.loading = true;
      this.error = null;
      this.results = [];
      try {
        const data = await api(`/api/stocks/search?q=${encodeURIComponent(q)}`);
        if (!data.results?.length) this.error = "Aucune action trouvée pour ce nom.";
        else this.results = data.results;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    choose(item, candidate) {
      item.stock = candidate;
      this.results = [];
    },
  };
}

/** État Alpine local (un par ligne du tableau "cryptos suivies") pour le flux rechercher -> choisir. */
function cryptoSearchState(item) {
  return {
    query: item.crypto?.query || "",
    loading: false,
    results: [],
    error: null,

    async search() {
      const q = this.query.trim();
      if (!q) return;
      this.loading = true;
      this.error = null;
      this.results = [];
      try {
        const data = await api(`/api/crypto/search?q=${encodeURIComponent(q)}`);
        if (!data.results?.length) this.error = "Aucune crypto trouvée pour ce nom.";
        else this.results = data.results;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    choose(item, candidate) {
      item.crypto = candidate;
      this.results = [];
    },
  };
}

/** État Alpine local pour le champ "coordinates" : petite carte Leaflet + repère déplaçable. */
function coordinatesPickerState(mod, field) {
  return {
    map: null,
    marker: null,

    init() {
      const lat = mod.config[field.latKey] ?? 0;
      const lng = mod.config[field.lngKey] ?? 0;

      this.map = L.map(this.$refs.mapEl, { attributionControl: false }).setView([lat, lng], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap",
      }).addTo(this.map);

      this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
      this.marker.on("dragend", () => this.applyPosition(this.marker.getLatLng()));
      this.map.on("click", (e) => {
        this.marker.setLatLng(e.latlng);
        this.applyPosition(e.latlng);
      });

      // La carte peut s'initialiser avant que le panneau (repliable) n'ait sa taille finale.
      setTimeout(() => this.map.invalidateSize(), 0);
    },

    applyPosition(latlng) {
      mod.config[field.latKey] = Math.round(latlng.lat * 10000) / 10000;
      mod.config[field.lngKey] = Math.round(latlng.lng * 10000) / 10000;

      if (field.cityKey) this.fillCityName(mod.config[field.latKey], mod.config[field.lngKey]);
    },

    async fillCityName(lat, lng) {
      try {
        const data = await api(`/api/weather/reverse-geocode?lat=${lat}&lng=${lng}`);
        if (data.city) mod.config[field.cityKey] = data.city;
      } catch {
        // Géocodage indisponible : le champ ville reste tel quel, toujours modifiable à la main.
      }
    },

    // Le champ est démonté (template x-if) à chaque repli du panneau : on détruit la carte
    // pour ne pas laisser trainer ses écouteurs d'évènements.
    destroy() {
      if (this.map) this.map.remove();
    },
  };
}

const MAX_IMAGE_BYTES = 500 * 1024;

function builderPage() {
  return {
    modules: [],
    preview: { columns: 48, lines: [] },
    expandedId: null,
    savingId: null,
    loading: true,
    previewLoading: false,

    async init() {
      await this.loadModules();
      await this.loadPreview();
    },

    async loadModules() {
      this.loading = true;
      try {
        this.modules = await api("/api/modules");
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.loading = false;
      }
    },

    async loadPreview() {
      this.previewLoading = true;
      try {
        this.preview = await api("/api/receipt/preview");
      } catch (e) {
        this.$dispatch("toast", { message: `Aperçu indisponible : ${e.message}`, type: "error" });
      } finally {
        this.previewLoading = false;
      }
    },

    toggle(id) {
      this.expandedId = this.expandedId === id ? null : id;
    },

    async setEnabled(mod) {
      try {
        await api(`/api/modules/${mod.id}`, { method: "PUT", body: { enabled: mod.enabled } });
        this.$dispatch("toast", { message: `${mod.name} ${mod.enabled ? "activé" : "désactivé"}.`, type: "success" });
        await this.loadPreview();
      } catch (e) {
        mod.enabled = !mod.enabled;
        this.$dispatch("toast", { message: e.message, type: "error" });
      }
    },

    async saveConfig(mod) {
      this.savingId = mod.id;
      try {
        const updated = await api(`/api/modules/${mod.id}`, { method: "PUT", body: { config: mod.config } });
        Object.assign(mod, updated);
        this.$dispatch("toast", { message: "Configuration enregistrée.", type: "success" });
        this.expandedId = null;
        await this.loadPreview();
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      } finally {
        this.savingId = null;
      }
    },

    async move(index, direction) {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= this.modules.length) return;

      const arr = [...this.modules];
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      this.modules = arr;

      try {
        this.modules = await api("/api/modules/order", { method: "PUT", body: { order: arr.map((m) => m.id) } });
        await this.loadPreview();
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
        await this.loadModules();
      }
    },

    addArrayItem(mod, field) {
      if (!Array.isArray(mod.config[field.key])) mod.config[field.key] = [];
      const item = {};
      for (const sub of field.itemSchema) item[sub.key] = defaultFieldValue(sub);
      mod.config[field.key].push(item);
    },

    removeArrayItem(mod, field, index) {
      mod.config[field.key].splice(index, 1);
    },

    addNewsTopic(mod, field) {
      if (!Array.isArray(mod.config[field.key])) mod.config[field.key] = [];
      mod.config[field.key].push({ label: "", feeds: [{ url: "", maxArticles: 5 }] });
    },

    removeNewsTopic(mod, field, topicIndex) {
      mod.config[field.key].splice(topicIndex, 1);
    },

    addNewsFeed(mod, field, topicIndex) {
      mod.config[field.key][topicIndex].feeds.push({ url: "", maxArticles: 5 });
    },

    removeNewsFeed(mod, field, topicIndex, feedIndex) {
      mod.config[field.key][topicIndex].feeds.splice(feedIndex, 1);
    },

    onImageSelected(mod, field, event) {
      const file = event.target.files?.[0];
      event.target.value = ""; // permet de re-sélectionner le même fichier ensuite
      if (!file) return;

      if (file.type !== "image/png") {
        this.$dispatch("toast", { message: "Seules les images PNG sont acceptées.", type: "error" });
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        this.$dispatch("toast", { message: "Image trop lourde (max 500 Ko).", type: "error" });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        mod.config[field.key] = reader.result;
      };
      reader.onerror = () => {
        this.$dispatch("toast", { message: "Impossible de lire ce fichier.", type: "error" });
      };
      reader.readAsDataURL(file);
    },

    removeImage(mod, field) {
      mod.config[field.key] = "";
    },

    async runModuleAction(endpoint, method) {
      try {
        await api(endpoint, { method });
        this.$dispatch("toast", { message: "Action effectuée.", type: "success" });
      } catch (e) {
        this.$dispatch("toast", { message: e.message, type: "error" });
      }
    },
  };
}
