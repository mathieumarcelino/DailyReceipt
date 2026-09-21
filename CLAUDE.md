# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Le projet

DailyReceipt : application web auto-hébergée qui génère et imprime chaque matin, sur une imprimante thermique réseau (ESC/POS, port 9100), un ticket de caisse récapitulatif (météo, anniversaires, bourse, crypto, sport, citation...). Conçue pour tourner en Docker sur un NAS (TrueNAS SCALE, Synology, Unraid...).

Choix architecturaux volontairement minimalistes, à respecter pour toute évolution :
- **Pas de base de données** — un seul fichier JSON (voir Persistance ci-dessous).
- **Pas de build frontend lourd** (React, Vite...) — EJS rendu serveur + Alpine.js pour l'interactivité.
- **Pas de dépendance native** — portable sur NAS ARM ou x86 sans compilation croisée.
- **Préférer une API sans clé** quand une alternative équivalente existe (c'est le cas pour toutes les intégrations actuelles : Open-Meteo, Yahoo Finance, CoinGecko, ESPN, Nominatim) — une clé API reste acceptable si c'est la seule solution pour une intégration donnée, ce n'est pas une contrainte absolue. Internet est requis à l'impression quotidienne (chaque module actif interroge son API — météo, bourse, crypto, sport) ; seuls la recherche (équipe/action/crypto) et le géocodage/carte (widget `coordinates`) sont des appels **admin uniquement**, déclenchés à la demande dans le Constructeur, jamais pendant l'impression planifiée.

## Commandes

```bash
npm install          # installe les dépendances + vendorise Alpine.js et Leaflet dans src/public (postinstall)
npm run dev           # serveur (tsx watch) + Tailwind (watch) en parallèle, http://localhost:3000
npm test              # test runner natif de Node (node:test) via tsx, fichiers *.test.ts dans test/ (miroir de src/)
npm run typecheck     # tsc --noEmit via tsconfig.test.json (couvre src/ ET test/)
npm run build         # build:css (Tailwind) + build:server (tsc via tsconfig.json, ne voit que src/) + copy:assets
npm start             # lance dist/server.js (après build)
docker compose up -d --build   # build + lancement en conteneur
```

Pas de linter configuré. Les tests utilisent `node:test`/`node:assert` (zéro dépendance ajoutée, cf. philosophie minimaliste) plutôt que Jest/Vitest, dans un dossier `test/` séparé qui reflète la structure de `src/` (ex: `src/receipt/context.ts` → `test/receipt/context.test.ts`, imports relatifs du type `../../src/...`) — pas de config supplémentaire à maintenir, `npm test` ramasse tout via `find`. Pour lancer un seul fichier : `npx tsx --test test/receipt/context.test.ts`. Priorité de test : la logique **pure et déterministe** (`ReceiptBuilder`, `commands.ts`, les helpers de `src/lib/`) et le parsing des réponses d'API externes via des fixtures JSON + mock de `fetch` (`t.mock.method(globalThis, "fetch", ...)`, voir `weather.module.test.ts`) — pas de tests d'intégration bout-en-bout contre les vraies API tierces.

Variables d'environnement : `PORT` (3000), `HOST` (0.0.0.0), `CONFIG_PATH` (`/data/config.json`, avec repli automatique sur `./data/config.json` si `/data` n'est pas accessible en écriture et que la variable n'a pas été fixée explicitement — voir `src/config/store.ts`), `TZ` (fuseau pour le cron et l'affichage des heures).

## Architecture

### Le pipeline "un seul rendu, deux sorties"

Le cœur du projet : chaque module de ticket écrit ses lignes via `ReceiptContext` (`src/modules/types.ts`), implémenté par `ReceiptBuilder` (`src/receipt/context.ts`). Cette même liste de `ReceiptLine[]` sert ensuite à deux usages :
- **Aperçu web** (`GET /api/receipt/preview`, page Constructeur) : les lignes sont directement affichées en HTML monospace.
- **Impression réelle** (`src/escpos/builder.ts` → `encodeReceipt`) : les mêmes lignes sont converties en commandes ESC/POS brutes (encodées selon le profil de codepage CP437/CP858/CP1252 via `iconv-lite`) et envoyées en TCP brut sur le port 9100 (`src/escpos/network-printer.ts`).

Conséquence directe : **tout le word-wrap, l'alignement et la troncature doivent vivre dans `ReceiptBuilder`**, jamais dans un module ou dans le template EJS de l'aperçu — sinon aperçu et papier divergent. `rawLine()` existe spécifiquement pour les cas où un module a déjà calculé un alignement caractère par caractère (colonnes façon tableau, cf. `sports.module.ts`) et ne veut pas que `text()` renormalise les espaces.

### Orchestration et séparateurs (`src/services/receipt-builder.ts`)

`buildReceiptLines()` exécute chaque module **actif** dans un `ReceiptBuilder` isolé (une instance par module), puis assemble les résultats. C'est volontaire : ça permet de détecter qu'un module n'a produit aucune ligne (ex: module Sports sans aucun match du jour) et de ne jamais lui accoler de séparateur — sinon on se retrouve avec un "-----" flottant entre deux sections vides. Les séparateurs eux-mêmes ("=" entre en-tête/corps et corps/pied de page, "-" entre les autres modules, jamais après le dernier module non vide) sont **calculés ici, pas dans les modules** : un module ne doit jamais appeler `ctx.separator()` en fin de rendu.

Une erreur de `fetchData()` (API tierce down, etc.) n'interrompt pas les autres modules : elle est catchée et transformée en ligne "Module indisponible (...)" imprimée à la place du contenu normal du module.

### Modules de ticket (`src/modules/*.module.ts`)

Chaque module implémente `ReceiptModule<TConfig, TData>` (`src/modules/types.ts`) : `id`, `name`, `description`, `dataSource` (URL affichée dans le Constructeur, absente si aucune API externe), `configSchema` (décrit le formulaire admin), `defaultConfig`, `fetchData(config)`, `renderReceipt(data, ctx, config)`. Le registre central est `src/modules/registry.ts` (`MODULE_REGISTRY`) — **c'est le seul endroit à modifier pour ajouter/retirer un module** ; l'UI (toggle, ordre, formulaire, aperçu) s'adapte automatiquement au tableau.

`configSchema` pilote un formulaire **entièrement générique** côté admin (`src/views/builder.ejs` + `src/public/js/builder.js`) : aucun module n'a de code UI dédié pour ses champs simples (texte, nombre, booléen, select, image, tableau). Les champs plus spécialisés sortent de ce moule générique et nécessitent 3 endroits à faire cohabiter si tu en ajoutes un nouveau :
1. Le type dans l'union `ConfigField` (`src/modules/types.ts`).
2. Le rendu du champ dans `builder.ejs` (+ un composant Alpine dédié dans `builder.js` si besoin d'état local, ex: `teamSearchState`/`stockSearchState`/`cryptoSearchState`/`coordinatesPickerState`).
3. Si le champ a besoin de données externes (recherche, géocodage...), une route backend dédiée (`src/routes/*.routes.ts`) — jamais d'appel direct depuis le navigateur vers l'API tierce (voir plus bas pourquoi).

Champs spécialisés existants : `team-search`/`stock-search`/`crypto-search` (widget rechercher → choisir dans une liste de résultats, pour éviter de suivre silencieusement la mauvaise entité en cas d'homonymie — voir `docs/modules/{sports,stocks,crypto}.md`), `coordinates` (petite carte Leaflet/OpenStreetMap avec repère déplaçable, `latKey`/`lngKey` + `cityKey` optionnel pour un géocodage inverse auto-remplissant sans jamais écraser une saisie manuelle ultérieure), `action` (bouton générique déclenchant un appel backend sans donnée de formulaire, ex: vidage manuel du cache du module Actualités — pas de composant Alpine dédié nécessaire, juste `endpoint`/`method` dans le `ConfigField`), `news-topics` (liste de sujets contenant chacun plusieurs flux RSS, `src/modules/news.module.ts` — un niveau d'imbrication que le champ générique `array` exclut volontairement, d'où un champ dédié plutôt qu'un `array` de `array`).

Chaque module a sa propre fiche dans `docs/modules/` (rendu exact sur le ticket, champs de configuration, source de données, particularités) — à tenir à jour si tu modifies le rendu ou la configuration d'un module.

### Pourquoi les recherches externes passent par le backend

`GET /api/stocks/search`, `/api/crypto/search`, `/api/sports/search-teams`, `/api/weather/reverse-geocode` proxient toutes un appel serveur → API tierce, plutôt qu'un `fetch()` direct depuis le navigateur. Ce n'est pas qu'une préférence : Nominatim (géocodage inverse) **exige** un `User-Agent` identifiant l'application, un header que les navigateurs interdisent de fixer depuis du JS client (`fetch`/`XHR`) — un appel client-side échouerait silencieusement à respecter leur politique d'usage. Garder ce pattern uniforme pour toute nouvelle intégration tierce plutôt que de mélanger deux approches.

### Configuration et persistance (`src/config/`)

Un seul fichier JSON (`ConfigStore`, `src/config/store.ts`) : cache en mémoire + file d'attente d'écriture sérialisée (`writeQueue`) pour éviter toute corruption en cas d'écritures concurrentes (ex: sauvegarde config + mise à jour du statut de dernière impression en parallèle). `getConfig()` renvoie un clone profond (jamais l'objet interne) ; toute modification passe par `updateConfig(mutator)` qui clone → mute → persiste sur disque → remplace le cache.

Quand tu changes la **forme** de la config stockée d'un module (ex: un champ texte devient un objet structuré), ajoute une migration dans `ensureInstances()`/`migrateLegacy*()` (`src/services/modules.service.ts`) plutôt que de casser silencieusement la config déjà enregistrée par un utilisateur — trois migrations de ce type existent déjà et servent de modèle (fusion Bourse+Crypto → séparation en deux modules, puis symbole texte → objet candidat de recherche pour ces deux mêmes modules, puis flux RSS à plat → sujets groupés pour le module Actualités).

### Frontend

Rendu serveur (EJS, `src/views/`) + Alpine.js pour toute l'interactivité (toggles, formulaires, aperçu live, widgets de recherche/carte) — pas de framework JS, pas de bundler. Alpine.js et Leaflet sont **vendorisés localement** (`scripts/copy-vendor.js`, exécuté en `postinstall`, copie depuis `node_modules` vers `src/public/`) : zéro dépendance CDN au chargement de la page, choix délibéré pour un NAS à connectivité potentiellement limitée/filtrée. Toute nouvelle dépendance frontend doit suivre ce même pattern de vendoring, pas un `<script src="https://...">`. Seules les tuiles de carte OpenStreetMap et l'appel Nominatim (widget `coordinates`) contactent effectivement internet depuis le navigateur, et uniquement à l'usage dans le Constructeur — jamais pendant l'impression planifiée.

Tailwind est compilé (pas de CDN) via `npm run dev:css`/`build:css`.

### Impression ESC/POS (`src/escpos/`)

- `commands.ts` : constantes de commandes brutes (init, alignement, gras, souligné, taille, image raster, avance+coupe) et tables de correspondance codepage (`CODEPAGE_TABLE`/`ICONV_ENCODING`) pour les 3 profils supportés (CP437/CP858/CP1252) — le profil doit correspondre à celui réellement configuré sur l'imprimante physique pour un affichage correct des accents.
- `builder.ts` : `encodeReceipt()` transforme `ReceiptLine[]` en `Buffer` de commandes.
- `network-printer.ts` : envoi TCP brut sur le port 9100 (JetDirect/raw, standard sur la quasi-totalité des imprimantes thermiques).
- `image-raster.ts` : PNG → 1-bit noir/blanc (tramage Floyd-Steinberg) pour la commande raster `GS v 0`, utilisé par le module En-tête pour un logo optionnel ; génère aussi un aperçu PNG data-URL fidèle au rendu tramé réel (même tramage que le papier).

### Intégrations externes

| Module | API | Détail |
|---|---|---|
| Météo | Open-Meteo (sans clé) | `current` (température instantanée uniquement) + `daily` (tout le reste : condition, min/max, ressenti, précipitations %/mm, vent max, lever/coucher) |
| Bourse | Yahoo Finance (sans clé) | `/v1/finance/search` (recherche) + `/v8/finance/chart/{symbol}` (cotation) — `shortName` de l'API est tronqué à ~31 caractères sans "…", préférer `longName` |
| Crypto | CoinGecko (sans clé) | `/v3/search` (recherche) + `/v3/simple/price` (cotation groupée) |
| Sports | ESPN (API publique non documentée, sans clé) | recherche + calendrier + infos équipe + résumé de match, scopé par sport/ligue — voir `docs/modules/sports.md`, les particularités déjà rencontrées y sont consignées |
| Météo (géocodage) | Nominatim (OSM, sans clé) | reverse geocoding, `User-Agent` identifiant obligatoire |
| Actualités | flux RSS/Atom (sans clé) + Google Gemini (clé API requise) | `fast-xml-parser` normalise RSS 2.0 (`rss.channel.item`) et Atom (`feed.entry`) — voir `docs/modules/news.md`. Gemini reste la seule intégration à clé API du projet : conservée malgré la préférence "sans clé" du projet car aucune alternative sans clé équivalente n'existe pour du résumé par IA ; offre gratuite au moment de l'écriture, nom de modèle laissé configurable (pas figé en dur) car l'offre de modèles évolue régulièrement |

Ces API ne sont pas toujours bien documentées ou cohérentes entre leurs propres champs (ex: `weather_code` et `precipitation_probability_max` d'Open-Meteo viennent de sous-modèles différents et peuvent sembler se contredire ; la forme des réponses ESPN varie selon le sport). **Vérifie le comportement réel avec un appel direct (`curl`) avant d'écrire du code de parsing**, plutôt que de deviner la forme d'une réponse à partir de sa documentation ou de la mémoire.

## État actuel notable

- Interface entièrement en français, pas de couche i18n/multi-langue.
- La page de réglages imprimante est nommée `/printer` (`printer.ejs`), pas "Configuration".
