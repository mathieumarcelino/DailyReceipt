/**
 * Description d'un champ de configuration éditable dans l'UI (page Constructeur).
 * Le formulaire générique côté front (builder.ejs) sait rendre chacun de ces types.
 */
export type ConfigField =
  | { key: string; label: string; type: "text"; placeholder?: string; help?: string }
  | { key: string; label: string; type: "password"; placeholder?: string; help?: string }
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number; help?: string }
  | { key: string; label: string; type: "boolean"; help?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: "image"; help?: string }
  | { key: string; label: string; type: "team-search"; help?: string }
  | {
      key: string;
      label: string;
      type: "array";
      itemLabel: string;
      /** Champs édités pour chaque élément du tableau (une seule profondeur, pas de tableau imbriqué). */
      itemSchema: Exclude<ConfigField, { type: "array" }>[];
      help?: string;
    };

/** Options de mise en forme d'une ligne de texte du ticket. */
export interface TextOptions {
  align?: "left" | "center" | "right";
  bold?: boolean;
  underline?: boolean;
  /** Taille ESC/POS : normal, ou agrandi en largeur/hauteur/les deux. */
  size?: "normal" | "wide" | "tall" | "double";
}

/**
 * Image déjà rastérisée en 1-bit noir/blanc, prête à être envoyée telle quelle
 * en ESC/POS (voir src/escpos/image-raster.ts pour la production de ce format
 * à partir d'un PNG). `previewPngDataUrl` sert uniquement à l'aperçu web et
 * montre le rendu tramé réel (dithering inclus), fidèle à l'impression papier.
 */
export interface RasterImage {
  widthPx: number;
  heightPx: number;
  /** Largeur en octets (widthPx arrondi au multiple de 8 supérieur, / 8). */
  widthBytes: number;
  /** Pixels packés en 1 bit/pixel, MSB en premier, 1 = point noir imprimé. */
  bits: Buffer;
  previewPngDataUrl: string;
}

/**
 * API fournie aux modules pour composer le ticket. Une seule implémentation
 * (voir src/receipt/context.ts) fait à la fois le word-wrap et la mise en page,
 * afin que le rendu ESC/POS et l'aperçu web restent strictement identiques.
 */
export interface ReceiptContext {
  /** Nombre de colonnes de texte disponibles (42 ou 48). */
  readonly width: number;

  /** Largeur d'impression en pixels (384 ou 576 selon l'imprimante), pour le rendu d'images. */
  readonly widthPx: number;

  /** Ajoute un (ou plusieurs, si le texte est trop long) ligne(s) de texte. */
  text(content: string, options?: TextOptions): void;

  /** Ligne séparatrice (ex: "------------------------------------------"). */
  separator(char?: string): void;

  /** Ligne vide, répétée `count` fois. */
  spacer(count?: number): void;

  /** Ligne avec un libellé à gauche et une valeur alignée à droite (ex: "Bitcoin ........... 45 000 €"). */
  row(left: string, right: string, options?: { bold?: boolean }): void;

  /**
   * Ajoute une ligne déjà mise en forme, telle quelle (tronquée à `width` si besoin) : contrairement
   * à `text()`, ne fait ni word-wrap ni normalisation des espaces. Utile pour un alignement précis
   * calculé à la main (ex: colonnes côte à côte) où les espaces de padding doivent être préservés.
   */
  rawLine(content: string, options?: TextOptions): void;

  /** Insère une image déjà rastérisée (voir rasterizePng dans src/escpos/image-raster.ts). */
  image(raster: RasterImage, options?: { align?: "left" | "center" | "right" }): void;
}

/**
 * Contrat que doit implémenter tout module de ticket. Ajouter un nouveau module
 * ne nécessite que la création d'un fichier implémentant cette interface et son
 * enregistrement dans src/modules/registry.ts.
 */
export interface ReceiptModule<TConfig = Record<string, unknown>, TData = unknown> {
  /** Identifiant unique et stable (utilisé comme clé de stockage). */
  id: string;
  /** Libellé affiché dans l'UI. */
  name: string;
  /** Courte description affichée dans le Constructeur. */
  description?: string;
  /** Schéma des paramètres éditables par l'utilisateur. */
  configSchema: ConfigField[];
  /** Valeurs par défaut appliquées à la première activation du module. */
  defaultConfig: TConfig;
  /** Récupère les données nécessaires au rendu (météo, anniversaires, cours...). */
  fetchData(config: TConfig): Promise<TData>;
  /** Écrit les lignes du ticket à partir des données récupérées. */
  renderReceipt(data: TData, ctx: ReceiptContext, config: TConfig): void;
}
