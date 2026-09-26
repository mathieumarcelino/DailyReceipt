# Module Actualités (`news`)

Résumé par IA (Gemini) des principaux articles d'un ou plusieurs flux RSS/Atom suivis.

**Fichiers source** : [src/modules/news.module.ts](../../src/modules/news.module.ts), [src/lib/rss.ts](../../src/lib/rss.ts), [src/lib/ai-summarizer.ts](../../src/lib/ai-summarizer.ts), [src/routes/news.routes.ts](../../src/routes/news.routes.ts)

## Rendu sur le ticket

```
ACTUALITÉS
TECH
Un résumé fluide en français d'une vingtaine
de lignes tenant compte de la largeur réelle
de l'imprimante configurée...

SPORT
Indisponible (aucun article trouvé)
```

Un sujet dont la récupération échoue (flux injoignable, IA indisponible, clé API manquante...) s'affiche avec `Indisponible (...)` plutôt que de faire échouer tout le module.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `topics` | liste de sujets (`news-topics`) | Un sujet par entrée (réordonnable avec ▲/▼, l'ordre de la liste est l'ordre sur le ticket) : `label` (nom affiché), un ou plusieurs flux (`url` RSS ou Atom, fusionnés en un seul résumé), `storiesCount` (nombre d'histoires retenues pour la synthèse, 8 par défaut, 1 à 20), `hoursBack` (remonter de N heures, vide = 24 h, plafonné à 72 h) et un `prompt` optionnel (voir ci-dessous). |
| `summaryTargetLines` | nombre | Longueur cible du résumé, en nombre de lignes du ticket (5 à 60, 20 par défaut). Indicative pour l'IA — un dépassement important est tronqué automatiquement. Convertie en caractères via `columns * summaryTargetLines`, à partir de la largeur d'impression réellement configurée (`printer.columns`). |
| `apiKey` | mot de passe | Clé API Gemini (Google AI Studio, gratuite sans carte bancaire au moment de l'écriture). |
| `model` | texte | Nom exact du modèle Gemini à utiliser, `gemini-3.5-flash-lite` par défaut. Volontairement configurable plutôt que figé en dur : l'offre de modèles Google évolue régulièrement (le précédent défaut, `gemini-2.5-flash-lite`, a été déprécié pour les nouvelles clés API quelques mois après l'écriture initiale du module). Le préfixe `models/` (tel que renvoyé par `GET /v1beta/models`) est toléré et retiré automatiquement. |
| `clearCache` | action | Bouton "Vider le cache" — force un nouveau résumé sans attendre l'expiration naturelle (lendemain), utile pour tester une modification immédiatement. Appelle `POST /api/news/clear-cache`. |

### Prompt par sujet

Chaque sujet peut remplacer le prompt par défaut (`DEFAULT_PROMPT_TEMPLATE`, `src/lib/ai-summarizer.ts`) via « Personnaliser le prompt » : le champ est pré-rempli avec le prompt par défaut (route `GET /api/news/default-prompt`) pour partir d'une base. Vide ou « Rétablir le prompt par défaut » = prompt par défaut du code, qui reste donc la référence pour tous les sujets non modifiés. Ce prompt est celui de la **passe 2** (synthèse finale, voir « Deux passes »). Le prompt par défaut demande **une ligne courte par histoire, commençant par « - »**, dans l'ordre des scores. Variables résolues à l'envoi : `{sujet}`, `{nombre_sujets}` (nombre d'histoires fournies), `{longueur_par_sujet}` (budget d'une ligne = longueur maximale ÷ nombre d'histoires, pour que l'IA ne saute pas d'histoire), `{longueur_max}` (budget total, en caractères) et `{longueur_cible}` (~60 % du maximum). Les histoires, avec leur score d'importance, sont toujours ajoutées à la suite par le code (`buildPrompt()`), classées par score décroissant : le prompt ne contient que les consignes. Le prompt de la passe 1 (`DEFAULT_SELECTION_PROMPT_TEMPLATE`) n'est pas modifiable par sujet. Le résumé est mis en cache par sujet : après un changement de prompt, utiliser « Vider le cache » pour voir le nouveau résultat.

### Champ de type `action`

Type générique (pas spécifique à ce module) : un simple bouton qui déclenche un appel `POST`/`DELETE` vers une route backend, sans envoyer de données de formulaire. Voir `ConfigField` (`src/modules/types.ts`), le rendu dans `builder.ejs` et `runModuleAction()` dans `builder.js`.

### Champ de type `news-topics`

Spécifique à ce module (pas un `array` générique) : chaque sujet regroupe visuellement plusieurs flux dans une carte, le libellé n'étant saisi qu'une seule fois pour tout le groupe — pas de champ imbriqué à re-remplir par flux. Ce niveau d'imbrication (sujets contenant des flux) n'est volontairement pas supporté par le champ générique `array` (`itemSchema: Exclude<ConfigField, {type: "array"}>[]`, `src/modules/types.ts`), d'où un champ dédié plutôt qu'une extension du moteur de formulaire générique. Rendu dans `builder.ejs`, actions (`addNewsTopic`/`removeNewsTopic`/`addNewsFeed`/`removeNewsFeed`) dans `builder.js`.

## Deux passes (tri puis synthèse)

Envoyer toutes les descriptions à l'IA en une fois donnait des prompts énormes (~53 000 caractères pour 3 flux) et obligeait à plafonner arbitrairement le nombre d'articles. Le traitement d'un sujet se fait donc en deux appels (`summarizeTopic()`, `src/modules/news.module.ts`) :

1. **Collecte** : tous les articles publiés sur la période (`hoursBack`, 24 h par défaut, 72 h maximum) sont lus dans chaque flux, dédoublonnés sur le titre, triés du plus récent au plus ancien et plafonnés à 200 (`MAX_CANDIDATES`). Des identifiants courts (`a1`, `a2`...) sont attribués **par le code**, pour pouvoir valider strictement la réponse de l'IA.
2. **Passe 1 : tri** (`selectStoriesWithGemini()`, `src/lib/ai-summarizer.ts`) : seuls `id | source | titre` sont envoyés (≈ 3 400 tokens pour 112 titres). L'IA regroupe les articles qui traitent de la même histoire (y compris entre langues et entre sources), écarte le hors-sujet, note l'impact de 0 à 1 (0,85+ = majeur, 0,60-0,84 = structurant, 0,30-0,59 = secondaire) et renvoie les `storiesCount` meilleures histoires en **JSON contraint par un schéma** (`responseSchema`), avec une réflexion réduite (`thinkingLevel: low`, ~20 s au lieu de ~35 s pour un résultat équivalent). La réponse est validée : ids inconnus ou déjà utilisés ignorés, scores bornés à [0, 1], tri par score, coupe à `storiesCount`.
3. **Passe 2 : synthèse** (`summarizeWithGemini()`) : pour chaque histoire retenue, **toutes ses versions** (une par source, les plus riches d'abord, 4 au maximum — `MAX_VERSIONS_PER_STORY` — les versions secondaires étant raccourcies à 600 caractères) sont envoyées avec le score, dans l'ordre décroissant des scores. **Le score sert d'ordre d'affichage** sur le ticket.

Robustesse :
- si la passe 1 renvoie une réponse inexploitable (une nouvelle tentative est faite) ou échoue, **repli sans IA** : les `storiesCount` articles les plus récents, en alternant les sources, sans score — le ticket est produit quand même ;
- si le nombre d'articles est inférieur ou égal à `storiesCount`, la passe 1 est sautée (un appel de moins) ;
- si le modèle refuse `thinkingLevel` (paramètre propre à certaines générations Gemini, erreur 400), la passe 1 est relancée sans lui ;
- la passe 1 coûte un appel supplémentaire par sujet : sur l'offre gratuite, les 429 sont retentés comme les 503 (voir plus bas).

### Voir ce qui est échangé avec Gemini

`NEWS_DEBUG=1 npm run dev` (ou `NEWS_DEBUG=1` dans l'environnement du conteneur) affiche dans la console du serveur, pour chaque sujet généré : le prompt de la passe 1, la réponse brute de Gemini, les histoires retenues après validation, puis le prompt de la passe 2 et sa réponse. Désactivé par défaut (les prompts contiennent le texte des articles). La clé API n'est jamais affichée. Un résumé en cache n'appelle pas Gemini : cliquer sur « Vider le cache » pour voir un nouvel échange.

## Source de données

- **Flux RSS/Atom** : l'URL fournie par l'utilisateur pour chaque sujet suivi, sans clé requise. `fetchRssItems()` (`src/lib/rss.ts`) normalise les deux formats (`rss.channel.item` en RSS 2.0, `feed.entry` en Atom) via `fast-xml-parser`.
- **Résumé** : [Google Gemini](https://ai.google.dev/gemini-api/docs/pricing) (`generativelanguage.googleapis.com`), offre gratuite au moment de l'écriture. Clé API requise, à créer sur Google AI Studio.

## Particularités

- **V1 volontairement limitée aux métadonnées déjà présentes dans le flux** : aucun scraping de l'article complet (pas de récupération du HTML de la page liée). En revanche, `fetchRssItems()` (`src/lib/rss.ts`) préfère `content:encoded` (module RSS "content", très répandu sur les flux WordPress — contient souvent le corps complet de l'article directement dans le flux) à `description`/`summary` quand ce champ existe, sans appel réseau supplémentaire ; le texte retenu est tronqué à 1500 caractères pour ne pas gonfler inutilement le prompt envoyé à l'IA. Un scraping de la page liée pourrait être envisagé plus tard si même ça s'avère insuffisant pour certains flux.
- **Qualité très inégale entre flux** : les flux d'agrégateurs comme Google News (`news.google.com/rss/search?q=...`) n'ont quasiment pas de vraie description (le champ contient une liste HTML qui ne fait que reformuler le titre) et pointent vers une URL de redirection Google plutôt que l'article — les résumés générés à partir d'un tel flux resteront superficiels quel que soit le réglage du module. Préférer le flux RSS natif de l'éditeur (souvent `/rss`, `/feed`, ou une rubrique dédiée type `lemonde.fr/pixels/rss_full.xml`), dont la vraie `<description>` fait généralement 1 à 3 phrases informatives, voire le corps complet via `content:encoded` sur les sites WordPress.
- **Un sujet, plusieurs flux** : la config stocke `topics: { label, feeds: { url }[], storiesCount?, hoursBack?, prompt? }[]`. Le champ `maxArticles` par flux de l'ancien format n'existe plus : tous les articles de la période sont candidats (plafond global de 200 titres) et c'est l'IA qui sélectionne ; une valeur déjà présente dans une ancienne config est simplement ignorée.
- **Période de recherche** : fenêtre glissante en heures (`hoursBack`) plutôt que le jour calendaire. Un article sans date exploitable (absente ou non parseable) est exclu par prudence plutôt que considéré comme récent par défaut. `fetchRssItems()` lit jusqu'à 300 articles par flux (`RAW_FETCH_LIMIT`, sans coût réseau supplémentaire puisque le flux entier est de toute façon déjà téléchargé). Une valeur vide ou invalide retombe sur 24 h ; une valeur supérieure à 72 h est ramenée à 72 h pour borner la taille des prompts.
- **Migration automatique depuis l'ancien format** : la première version du module stockait un flux par entrée à plat (`feeds: { label, url, maxArticles }[]`, un flux = un sujet). `migrateLegacyNewsFeeds()` (`src/services/modules.service.ts`) regroupe automatiquement, au démarrage, les anciennes entrées partageant un même `label` en un seul sujet `topics`, sans perte de flux ni intervention manuelle.
- **Cache quotidien** (`state.newsCache`, une entrée par sujet/`label`, pas par URL de flux depuis l'ajout de la fusion multi-flux) : évite de ré-appeler l'IA à chaque rafraîchissement de l'aperçu du Constructeur, ce qui épuiserait rapidement un quota gratuit. Le résumé est réutilisé tant qu'il a été généré le même jour calendaire (heure locale) ; le lendemain, un nouveau résumé est généré au premier appel (aperçu ou impression), ce qui fait aussi glisser naturellement la fenêtre de recherche.
- **Bouton de vidage manuel du cache** : ajouté spécifiquement pour permettre de tester une modification (flux, longueur cible, modèle...) sans attendre le lendemain.
- **Isolation des erreurs à grain fin** : au sein d'un groupe de flux partageant un sujet, un flux en panne n'empêche pas les autres flux du même groupe de contribuer au résumé — le sujet entier n'échoue (`Indisponible (...)`) que si tous ses flux échouent ou qu'aucun n'a d'article récent. Un sujet en erreur n'affecte pas les autres sujets suivis. Le module entier n'échoue (`Module indisponible`) que si aucun flux n'est configuré ou si la clé API est absente.
- **Nom du modèle non figé en dur** : la liste des modèles Gemini disponibles évolue régulièrement, d'où un champ texte libre plutôt qu'un menu déroulant fixe.
- **Testé en conditions réelles** avec une vraie clé API (le module n'avait pu être vérifié qu'au niveau du contrat REST documenté lors de son écriture initiale, aucune clé n'étant disponible dans l'environnement de développement) — les résumés produits sont jugés pertinents une fois branchés sur de vrais flux avec description riche (voir le point sur la qualité inégale entre flux) et un préprompt qui demande explicitement de sélectionner les informations les plus pertinentes et de toujours répondre en français, même si les articles sources sont dans une autre langue.
- **Filtrage hors-sujet par l'IA** : le `label` du sujet (ex: "Tech") est transmis aux deux passes (`SummarizeOptions.topic` / `SelectOptions.topic`) et injecté dans les prompts, avec une consigne explicite d'ignorer les articles sans rapport avec ce sujet. Utile depuis qu'un sujet peut regrouper plusieurs flux RSS : un flux généraliste lié à un sujet précis peut remonter des articles hors-thème que ce filtrage écarte de la synthèse.
- **`404` de l'API Gemini** : signifie quasi toujours un nom de modèle introuvable ou déprécié, pas un problème de clé (une clé invalide renvoie plutôt 400/401/403). Deux causes rencontrées en pratique :
  - Copier le nom depuis la réponse de `GET /v1beta/models`, qui préfixe chaque modèle par `models/` (ex: `models/gemini-2.5-flash-lite`) — ce préfixe est toléré et retiré automatiquement par `summarizeWithGemini()` (`src/lib/ai-summarizer.ts`), donc coller la valeur telle quelle fonctionne, avec ou sans préfixe.
  - Un modèle retiré du service pour les nouvelles clés API : le message d'erreur de Gemini indique alors explicitement le nom du modèle de remplacement recommandé (ex: `gemini-2.5-flash-lite` → `gemini-3.5-flash-lite`, retiré courant 2026). Comme le nom du modèle n'est jamais figé en dur dans le code, il suffit de mettre à jour le champ `model` avec le nom recommandé — pas besoin de patch.
