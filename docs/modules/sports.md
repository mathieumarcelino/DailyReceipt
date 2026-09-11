# Module Sports (`sports`)

Suivi de plusieurs équipes, tous sports confondus (clubs et sélections nationales) : match du jour, résultat de la veille (score, buteurs, cartons), ou prochain match à venir.

**Fichiers source** : [src/modules/sports.module.ts](../../src/modules/sports.module.ts), [src/routes/sports.routes.ts](../../src/routes/sports.routes.ts)

## Rendu sur le ticket

Une section par équipe suivie, séparées par une ligne vide (aucune ligne vide après la dernière).

**Match à venir** (aucun match hier ni aujourd'hui) :

```
SPORTS
PARIS SAINT-GERMAIN - À VENIR
French Ligue 1
Brest - Paris Saint-Germain
Dimanche 13 septembre 2026 à 20:45
```

**Match aujourd'hui** :

```
STADE RENNAIS - AUJOURD'HUI
French Ligue 1
Stade Rennais - Marseille
Aujourd'hui à 20:45
```

**Résultat de la veille**, avec les buts et cartons du match dans l'ordre chronologique (en **gras** pour les faits impliquant un joueur de l'équipe suivie) :

```
LENS - RÉSULTAT
UEFA Champions League - League Phase
Slavia Prague 2 - 3 Lens
Hier à 21:00
Faits de jeu :
[R] 49' Mikuláš Konečný
51' Danijel Šturm
[J] 62' Pierre Ganiou
73' Abdallah Sima
88' Danijel Šturm
90'+1' Florian Thauvin
90'+3' Ruben Aguilar
```

Si aucune équipe suivie n'a de match pertinent (rien hier/aujourd'hui et l'option "prochain match" désactivée), le module n'imprime rien du tout, pas même le titre "SPORTS".

## Configuration

| Champ | Type | Description |
|---|---|---|
| `teams` | liste | Une entrée par équipe suivie, via le widget de recherche (voir ci-dessous) — pas de clé API à renseigner. |
| `showNextMatchIfNoGame` | booléen | Si activé, affiche le prochain match à venir quand aucun match n'a eu lieu hier ni n'est prévu aujourd'hui. |

### Widget de recherche d'équipe (`team-search`)

Champ de type dédié (pas un simple texte) : l'utilisateur tape un nom, clique "Rechercher", puis **choisit explicitement** parmi les résultats retournés (nom, sport, ligue, blason) avant que l'équipe soit ajoutée.

**Pourquoi pas un champ texte libre** : `GET https://site.api.espn.com/apis/search/v2?query=...&type=team` renvoie souvent plusieurs équipes homonymes pour un même nom (équipe masculine/féminine, équipe jeunes, clubs différents partageant un nom) — un champ texte libre résolu automatiquement risquerait de suivre silencieusement la mauvaise équipe. La route `GET /api/sports/search-teams?q=...` (backend) et `searchTeams()` (exportée par le module) exposent cette recherche à l'UI.

## Source de données

**API publique (non officielle) d'ESPN** — `site.api.espn.com` — sans clé requise :

| Usage | Endpoint |
|---|---|
| Recherche d'équipe | `GET /apis/search/v2?query={nom}&type=team` |
| Matchs passés récents | `GET /apis/site/v2/sports/{sport}/{ligue}/teams/{id}/schedule` |
| Prochain match (+ infos équipe) | `GET /apis/site/v2/sports/{sport}/{ligue}/teams/{id}` (champ `team.nextEvent`) |
| Buteurs/cartons d'un match | `GET /apis/site/v2/sports/{sport}/{ligue}/summary?event={id}` (champ `keyEvents`) |

Exemple concret pour le Paris Saint-Germain (id ESPN `160`, ligue `fra.1`) :
```
https://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/teams/160
```

## Particularités

- **Un identifiant d'équipe, plusieurs compétitions** : le même ID ESPN désigne une équipe dans toutes les compétitions d'un même sport (ex: `160` est le PSG aussi bien sous `soccer/fra.1` que sous `soccer/uefa.champions`), mais chaque endpoint reste scopé à **une seule compétition à la fois** — le calendrier Ligue 1 du PSG n'inclut pas son match de Ligue des Champions de la veille. Pour les équipes de football, le module interroge donc la ligue domestique **et** les 3 principales compétitions continentales (`uefa.champions`, `uefa.europa`, `uefa.europa.conf`) avant de choisir le match pertinent. Les autres sports ne vérifient que la ligue principale de l'équipe.
- **`/schedule` ne renvoie que le passé** : contrairement à ce que son nom suggère, cet endpoint ne contient jamais de matchs à venir. Le prochain match vient du champ `nextEvent` de l'endpoint "infos équipe", lui aussi scopé par compétition.
- **Phase affichée** (ex: "League Phase", "Preseason") : vient du champ `seasonType.name` d'ESPN, affiché uniquement s'il apporte une information distincte du nom de la compétition (une ligue domestique classique n'affiche donc rien de plus que son nom).
- **Buteurs/cartons incomplets possibles** : l'endpoint `summary`/`keyEvents` est riche mais pas garanti exhaustif selon la compétition ; le module affiche ce qu'il reçoit sans jamais bloquer le ticket si ces données manquent (seul le score reste alors affiché).
