# DailyReceipt

Application web légère et auto-hébergeable qui génère et imprime chaque matin, sur une imprimante thermique réseau (ESC/POS, port 9100), un ticket de caisse récapitulatif : météo, anniversaires du jour, cours de bourse/crypto, citation du jour...

Conçue pour tourner en Docker sur un NAS (TrueNAS SCALE, Synology, Unraid...).

## Stack technique

- **Backend** : Node.js + TypeScript + [Fastify](https://fastify.dev)
- **Frontend** : rendu serveur (EJS) + [Alpine.js](https://alpinejs.dev) + [Leaflet](https://leafletjs.com) (tous deux vendorisés, aucun CDN externe requis à l'exécution) + Tailwind CSS (compilé, pas de CDN) — seules les tuiles de carte OpenStreetMap (widget de sélection de coordonnées) sont chargées depuis internet, uniquement à l'usage dans le Constructeur
- **Persistance** : simple fichier JSON (`/data/config.json`), monté en volume Docker
- **Ordonnancement** : `node-cron`
- **Impression** : moteur ESC/POS maison (aucune dépendance native), envoi en raw TCP sur le port 9100
- **Flux RSS/Atom** : `fast-xml-parser` (module Actualités) ; résumé des articles via l'API [Google Gemini](https://ai.google.dev/gemini-api/docs/pricing) (clé API requise, offre gratuite au moment de l'écriture)

Choix volontairement minimaliste : pas de base de données, pas de build frontend lourd (React/Vite), pas de dépendances natives (donc portable sur NAS ARM ou x86 sans souci de compilation croisée).

## Arborescence

```
dailyreceipt/
├── Dockerfile
├── docker-compose.yml
├── package.json / tsconfig.json / tailwind.config.js
├── scripts/
│   ├── copy-vendor.js      # copie Alpine.js et Leaflet dans src/public (postinstall)
│   └── copy-assets.js      # copie views + public dans dist/ (build)
├── docs/modules/           # une fiche détaillée par module (voir plus bas)
├── data/                   # config.json (persisté via volume Docker)
├── test/                   # tests (node:test), miroir de la structure de src/
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
    │   ├── news.module.ts
    │   └── footer.module.ts
    ├── receipt/
    │   └── context.ts       # ReceiptBuilder : word-wrap + mise en page (partagé ESC/POS + aperçu web)
    ├── escpos/
    │   ├── commands.ts      # constantes de commandes ESC/POS brutes
    │   ├── builder.ts       # ReceiptLine[] -> Buffer ESC/POS (encodage iconv-lite)
    │   └── network-printer.ts # envoi TCP brut (port 9100)
    ├── services/
    │   ├── tickets.service.ts    # CRUD des tickets + migration schedule/modules à plat -> tickets
    │   ├── modules.service.ts    # fusion registre + config utilisateur, scopée par ticket
    │   ├── receipt-builder.ts    # orchestration des modules d'un ticket -> lignes du ticket
    │   ├── printer.service.ts    # ticket de test / impression d'un ticket
    │   └── scheduler.service.ts  # une tâche cron par jour activé de chaque ticket
    ├── routes/               # endpoints Fastify (pages + API JSON)
    ├── views/                 # pages EJS (Tickets / Paramètres / Constructeur d'un ticket)
    └── public/                 # CSS compilé, JS Alpine, Alpine.js vendorisé
```

## Tickets multiples

L'application peut gérer plusieurs tickets indépendants (ex: un ticket "Matin" et un ticket "Soir"), chacun avec sa propre planification (`schedule`) et sa propre sélection/configuration de modules (`modules`) — voir `Ticket` dans [src/config/types.ts](src/config/types.ts). La planification est définie **jour par jour** : chaque jour de la semaine a sa propre heure et son propre statut activé/désactivé (ex: 06:00 en semaine, 09:00 le week-end, désactivé le dimanche). L'imprimante physique (`printer`) reste unique et partagée par tous les tickets. La page **Tickets** liste tous les tickets créés (résumé de planification, impression immédiate, suppression) ; chacun ouvre son propre **Constructeur** (`/tickets/:id`) pour la configuration des modules et de la planification (bouton "Paramètres"). Un cron est planifié indépendamment par jour activé de chaque ticket (`src/services/scheduler.service.ts`).

## Architecture modulaire du ticket

Chaque module implémente l'interface `ReceiptModule` ([src/modules/types.ts](src/modules/types.ts)) :

```ts
interface ReceiptModule<TConfig, TData> {
  id: string;
  name: string;
  configSchema: ConfigField[];        // décrit le formulaire généré automatiquement dans l'UI
  defaultConfig: TConfig;
  fetchData(config: TConfig, context: FetchContext): Promise<TData>; // context.ticketId : utile aux modules dont l'état doit être scopé par ticket (ex: cache Actualités)
  renderReceipt(data: TData, ctx: ReceiptContext, config: TConfig): void;
}
```

`ReceiptContext` (implémenté par `ReceiptBuilder`) expose une API simple (`text()`, `row()`, `separator()`, `spacer()`, `image()`) qui fait le word-wrap et la mise en page **une seule fois** : le rendu ESC/POS réel et l'aperçu web utilisent exactement les mêmes lignes, donc l'aperçu est toujours fidèle au papier.

**Pour ajouter un module** : créer `src/modules/mon-module.module.ts` implémentant `ReceiptModule`, puis l'ajouter au tableau `MODULE_REGISTRY` dans [src/modules/registry.ts](src/modules/registry.ts). Rien d'autre à modifier : l'UI (toggle, ordre, formulaire de config) et l'aperçu s'adaptent automatiquement.

Le type de champ `configSchema: { type: 'array', itemSchema: [...] }` permet de gérer des listes (utilisé par les anniversaires, les actions/cryptos suivies et les équipes suivies) via un formulaire générique, sans code UI dédié. Le type `{ type: 'image' }` permet l'upload d'un PNG (stocké en data URL directement dans la config du module) — utilisé par le module En-tête pour un logo optionnel, via la primitive `ctx.image()`. Les types `{ type: 'team-search' }`, `{ type: 'stock-search' }` et `{ type: 'crypto-search' }` sont des widgets dédiés (rechercher → choisir dans une liste de résultats) plutôt qu'un simple champ texte — utilisés respectivement par les modules Sports, Bourse et Crypto, voir leur documentation pour le détail. Le type `{ type: 'coordinates', latKey, lngKey, cityKey? }` affiche une petite carte OpenStreetMap (Leaflet) pour choisir une position GPS par clic/glisser-déposer plutôt qu'en tapant manuellement deux champs numériques ; si `cityKey` est fourni, ce champ est aussi pré-rempli par géocodage inverse (Nominatim) à chaque déplacement du repère, sans jamais écraser une saisie manuelle ultérieure — utilisé par le module Météo. Le type `{ type: 'action', buttonLabel, endpoint, method? }` affiche un simple bouton qui déclenche un appel backend sans donnée de formulaire — utilisé par le module Actualités pour vider manuellement le cache des résumés. Le type `{ type: 'news-topics' }` affiche une liste de sujets contenant chacun plusieurs flux RSS (label saisi une seule fois par sujet, pas par flux) — un niveau d'imbrication volontairement absent du type `array` générique, d'où ce champ dédié au module Actualités.

### Documentation par module

Chaque module a sa propre fiche détaillée (rendu exact sur le ticket, champs de configuration, source de données, particularités) :

- [En-tête](docs/modules/header.md)
- [Météo](docs/modules/weather.md)
- [Anniversaires du jour](docs/modules/birthdays.md)
- [Bourse](docs/modules/stocks.md)
- [Crypto](docs/modules/crypto.md)
- [Sports](docs/modules/sports.md)
- [Actualités](docs/modules/news.md)
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

### Image publiée

À chaque push sur `main`, le workflow `.github/workflows/docker-publish.yml` construit l'image (linux/amd64) et la publie sur GitHub Container Registry : `ghcr.io/mathieumarcelino/dailyreceipt:latest` (ainsi qu'un tag par commit, et un tag `x.y.z` pour chaque tag Git `vx.y.z`). Le package hérite de la visibilité du dépôt (public) : aucun identifiant n'est nécessaire pour la télécharger.

### Déployer sur TrueNAS SCALE (25.10+)

1. **Dataset** : créez un dataset dédié (ex. `Data/app/dailyreceipt`) avec le preset **Apps**, et vérifiez que l'utilisateur `apps` (UID/GID 568) peut y écrire (propriétaire `apps:apps` ou ACL « Modifier »).
2. **Apps → Discover Apps → ⋮ → Install via YAML**, avec (adaptez le chemin du dataset) :

   ```yaml
   services:
     dailyreceipt:
       image: ghcr.io/mathieumarcelino/dailyreceipt:latest
       pull_policy: always
       restart: unless-stopped
       user: "568:568"
       ports:
         - "3000:3000"
       environment:
         TZ: "Europe/Paris"
         PORT: "3000"
         CONFIG_PATH: "/data/config.json"
       volumes:
         - /mnt/Data/app/dailyreceipt:/data
   ```

   - `user: "568:568"` est nécessaire : l'image tourne par défaut en `node` (UID 1000), qui n'a pas les droits d'écriture sur un dataset TrueNAS. Comme `CONFIG_PATH` est fixé explicitement, il n'y a pas de repli sur `./data` : sans droits d'écriture, la sauvegarde de la configuration échoue.
   - `TZ` fixe l'heure de l'impression planifiée (sinon UTC).
   - Le réseau bridge par défaut suffit pour joindre l'imprimante, tant que le NAS est sur le même réseau local qu'elle.
3. **Mise à jour** : poussez sur `main`, attendez la fin du workflow GitHub Actions, puis cliquez sur **Update** ou redémarrez l'application dans TrueNAS (`pull_policy: always` retélécharge l'image). La configuration, stockée dans le dataset, est conservée.

Sur un autre NAS (Synology, Unraid...), le même principe s'applique : utilisez l'image publiée plutôt que `build: .`, et montez un dossier persistant sur `/data` accessible en écriture par l'utilisateur du conteneur.

### Variables d'environnement

| Variable      | Défaut               | Description                                   |
|---------------|-----------------------|------------------------------------------------|
| `PORT`        | `3000`                | Port d'écoute HTTP                             |
| `HOST`        | `0.0.0.0`              | Interface d'écoute                             |
| `CONFIG_PATH` | `/data/config.json`   | Emplacement du fichier de configuration        |
| `TZ`          | (fuseau système)       | Fuseau horaire utilisé pour la planification cron et l'affichage des heures |

## Utilisation

1. **Paramètres** : renseignez l'IP et le port de l'imprimante réseau, choisissez le profil de caractères (CP858 recommandé pour les accents français), puis cliquez sur "Tester l'impression". En cas d'erreur `EHOSTUNREACH`, l'imprimante n'est pas à l'adresse indiquée : imprimez sa fiche de statut réseau (bouton poussoir à l'arrière, près du port Ethernet, sur les Epson). Les interfaces réseau Epson (UB-E04...) sortent d'usine en IP fixe `192.168.192.168` ; changez-la via leur page d'administration web (EpsonNet Config → Configuration → TCP/IP → IPv4 Address).
2. **Tickets** : créez un ou plusieurs tickets, définissez l'heure d'impression quotidienne de chacun (ou déclenchez une impression immédiate avec "Imprimer maintenant"), puis ouvrez son Constructeur.
3. **Constructeur** (par ticket) : activez/désactivez les modules, réordonnez-les (▲/▼), configurez chacun (ville pour la météo, liste d'anniversaires, valeurs boursières suivies...). L'aperçu à droite reflète le rendu réel sur papier.

## Notes techniques

- Seul le module Actualités nécessite une clé API (gratuite, [Google AI Studio](https://aistudio.google.com)) pour les résumés par IA ; tous les autres modules fonctionnent sans clé : météo via [Open-Meteo](https://open-meteo.com), crypto via [CoinGecko](https://www.coingecko.com), actions via l'endpoint public Yahoo Finance, sports via l'API publique ESPN, géocodage via [Nominatim](https://nominatim.org).
- **Usage personnel uniquement** : ce projet est conçu pour un usage personnel et non commercial. Les endpoints Yahoo Finance et ESPN sont publics mais non officiels/non documentés (ils peuvent changer ou disparaître sans préavis), et les flux RSS ainsi que Nominatim imposent leurs propres conditions d'utilisation, à respecter par chaque utilisateur.
- Si un module échoue à récupérer ses données (API indisponible), le ticket continue d'être imprimé avec un message d'indisponibilité pour ce seul module.
- Les caractères imprimés sont encodés selon le profil choisi (CP437/CP858/CP1252) via `iconv-lite` ; en cas de caractère non supporté par le profil, l'imprimante affichera typiquement un `?` (aucune interruption de l'impression).
