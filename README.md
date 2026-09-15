# DailyReceipt

Application web légère et auto-hébergeable qui génère et imprime chaque matin, sur une imprimante thermique réseau (ESC/POS, port 9100), un ticket de caisse récapitulatif : météo, anniversaires du jour, cours de bourse/crypto, citation du jour...

Conçue pour tourner en Docker sur un NAS (TrueNAS SCALE, Synology, Unraid...).

## Stack technique

- **Backend** : Node.js + TypeScript + [Fastify](https://fastify.dev)
- **Frontend** : rendu serveur (EJS) + [Alpine.js](https://alpinejs.dev) (vendorisé, aucun CDN externe requis à l'exécution) + Tailwind CSS (compilé, pas de CDN)
- **Persistance** : simple fichier JSON (`/data/config.json`), monté en volume Docker
- **Ordonnancement** : `node-cron`
- **Impression** : moteur ESC/POS maison (aucune dépendance native), envoi en raw TCP sur le port 9100

Choix volontairement minimaliste : pas de base de données, pas de build frontend lourd (React/Vite), pas de dépendances natives (donc portable sur NAS ARM ou x86 sans souci de compilation croisée).

## Arborescence

```
dailyreceipt/
├── Dockerfile
├── docker-compose.yml
├── package.json / tsconfig.json / tailwind.config.js
├── scripts/
│   ├── copy-vendor.js      # copie Alpine.js dans src/public (postinstall)
│   └── copy-assets.js      # copie views + public dans dist/ (build)
├── docs/modules/           # une fiche détaillée par module (voir plus bas)
├── data/                   # config.json (persisté via volume Docker)
└── src/
    ├── server.ts           # bootstrap Fastify
    ├── config/
    │   ├── types.ts        # types de la config app
    │   └── store.ts        # store JSON persistant (lecture/écriture sérialisée)
    ├── modules/             # ★ modules de ticket (voir plus bas)
    │   ├── types.ts         # interface ReceiptModule / ConfigField / ReceiptContext
    │   ├── registry.ts      # registre central des modules
    │   ├── header.module.ts
    │   ├── weather.module.ts
    │   ├── birthdays.module.ts
    │   ├── stocks.module.ts
    │   ├── crypto.module.ts
    │   ├── sports.module.ts
    │   └── footer.module.ts
    ├── receipt/
    │   └── context.ts       # ReceiptBuilder : word-wrap + mise en page (partagé ESC/POS + aperçu web)
    ├── escpos/
    │   ├── commands.ts      # constantes de commandes ESC/POS brutes
    │   ├── builder.ts       # ReceiptLine[] -> Buffer ESC/POS (encodage iconv-lite)
    │   └── network-printer.ts # envoi TCP brut (port 9100)
    ├── services/
    │   ├── modules.service.ts    # fusion registre + config utilisateur
    │   ├── receipt-builder.ts    # orchestration des modules -> lignes du ticket
    │   ├── printer.service.ts    # ticket de test / impression du jour
    │   └── scheduler.service.ts  # planification cron
    ├── routes/               # endpoints Fastify (pages + API JSON)
    ├── views/                 # pages EJS (Imprimante / Planification / Constructeur)
    └── public/                 # CSS compilé, JS Alpine, Alpine.js vendorisé
```

## Architecture modulaire du ticket

Chaque module implémente l'interface `ReceiptModule` ([src/modules/types.ts](src/modules/types.ts)) :

```ts
interface ReceiptModule<TConfig, TData> {
  id: string;
  name: string;
  configSchema: ConfigField[];        // décrit le formulaire généré automatiquement dans l'UI
  defaultConfig: TConfig;
  fetchData(config: TConfig): Promise<TData>;
  renderReceipt(data: TData, ctx: ReceiptContext, config: TConfig): void;
}
```

`ReceiptContext` (implémenté par `ReceiptBuilder`) expose une API simple (`text()`, `row()`, `separator()`, `spacer()`, `image()`) qui fait le word-wrap et la mise en page **une seule fois** : le rendu ESC/POS réel et l'aperçu web utilisent exactement les mêmes lignes, donc l'aperçu est toujours fidèle au papier.

**Pour ajouter un module** : créer `src/modules/mon-module.module.ts` implémentant `ReceiptModule`, puis l'ajouter au tableau `MODULE_REGISTRY` dans [src/modules/registry.ts](src/modules/registry.ts). Rien d'autre à modifier : l'UI (toggle, ordre, formulaire de config) et l'aperçu s'adaptent automatiquement.

Le type de champ `configSchema: { type: 'array', itemSchema: [...] }` permet de gérer des listes (utilisé par les anniversaires, les valeurs boursières et les équipes suivies) via un formulaire générique, sans code UI dédié. Le type `{ type: 'image' }` permet l'upload d'un PNG (stocké en data URL directement dans la config du module) — utilisé par le module En-tête pour un logo optionnel, via la primitive `ctx.image()`. Le type `{ type: 'team-search' }` est un widget dédié (rechercher → choisir dans une liste de résultats) plutôt qu'un simple champ texte — utilisé par le module Sports, voir sa documentation pour le détail.

### Documentation par module

Chaque module a sa propre fiche détaillée (rendu exact sur le ticket, champs de configuration, source de données, particularités) :

- [En-tête](docs/modules/header.md)
- [Météo](docs/modules/weather.md)
- [Anniversaires du jour](docs/modules/birthdays.md)
- [Bourse](docs/modules/stocks.md)
- [Crypto](docs/modules/crypto.md)
- [Sports](docs/modules/sports.md)
- [Pied de page](docs/modules/footer.md)

## Lancer en local

Prérequis : Node.js ≥ 20.

```bash
npm install        # installe les dépendances + vendorise Alpine.js
npm run dev         # lance le serveur (tsx watch) + Tailwind en mode watch
```

L'application est disponible sur http://localhost:3000. La configuration est écrite dans `./data/config.json` (chemin par défaut en dev si `CONFIG_PATH` n'est pas défini — sinon `/data/config.json`, à définir via variable d'environnement en local si besoin, ex. `CONFIG_PATH=./data/config.json npm run dev`).

Build de production (sans Docker) :

```bash
npm run build
npm start
```

## Lancer avec Docker

```bash
docker compose up -d --build
```

L'application sera disponible sur http://<IP-du-NAS>:3000. La configuration est persistée dans le volume nommé `dailyreceipt-data` (mappé sur `/data` dans le conteneur), donc conservée entre les mises à jour de l'image.

Pour la déployer sur **TrueNAS SCALE** : le fichier `docker-compose.yml` fourni est directement utilisable soit via "Custom App" (Dockerfile/image) soit via l'import Docker Compose des versions récentes de TrueNAS SCALE (Apps → Discover Apps → Custom App, ou l'onglet Compose selon la version). Pensez à adapter le mapping de volume vers un dataset ZFS dédié si vous préférez un bind-mount à un volume nommé.

### Variables d'environnement

| Variable      | Défaut               | Description                                   |
|---------------|-----------------------|------------------------------------------------|
| `PORT`        | `3000`                | Port d'écoute HTTP                             |
| `HOST`        | `0.0.0.0`              | Interface d'écoute                             |
| `CONFIG_PATH` | `/data/config.json`   | Emplacement du fichier de configuration        |
| `TZ`          | (fuseau système)       | Fuseau horaire utilisé pour la planification cron et l'affichage des heures |

## Utilisation

1. **Imprimante** : renseignez l'IP et le port de l'imprimante réseau, choisissez le profil de caractères (CP858 recommandé pour les accents français), puis cliquez sur "Tester l'impression".
2. **Planification** : définissez l'heure d'impression quotidienne, ou déclenchez une impression immédiate avec "Imprimer maintenant".
3. **Constructeur** : activez/désactivez les modules, réordonnez-les (▲/▼), configurez chacun (ville pour la météo, liste d'anniversaires, valeurs boursières suivies...). L'aperçu à droite reflète le rendu réel sur papier.

## Notes techniques

- Aucune clé API requise : météo via [Open-Meteo](https://open-meteo.com), crypto via [CoinGecko](https://www.coingecko.com), actions via l'endpoint public Yahoo Finance.
- Si un module échoue à récupérer ses données (API indisponible), le ticket continue d'être imprimé avec un message d'indisponibilité pour ce seul module.
- Les caractères imprimés sont encodés selon le profil choisi (CP437/CP858/CP1252) via `iconv-lite` ; en cas de caractère non supporté par le profil, l'imprimante affichera typiquement un `?` (aucune interruption de l'impression).
