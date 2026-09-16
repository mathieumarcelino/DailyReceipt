# Module Bourse (`stocks`)

Cours d'une ou plusieurs actions suivies au choix.

**Fichiers source** : [src/modules/stocks.module.ts](../../src/modules/stocks.module.ts), [src/routes/stocks.routes.ts](../../src/routes/stocks.routes.ts)

## Rendu sur le ticket

```
BOURSE
iShares MSCI World               6.91 EUR (+0.5%)
Apple Inc.                     187.42 USD (-0.2%)
```

Une valeur dont la récupération échoue s'affiche avec `N/A` plutôt que de faire échouer tout le module.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `assets` | liste | Une entrée par action : `stock` (choisi via le widget de recherche, voir ci-dessous) et `label` (optionnel). Le libellé affiché sur le ticket est récupéré automatiquement (champ `shortName` de la réponse Yahoo Finance) si `label` est laissé vide, ou surchargé par la valeur saisie sinon. |

### Widget de recherche d'action (`stock-search`)

Champ de type dédié (pas un simple texte) : l'utilisateur tape un nom ou un symbole, clique "Rechercher", puis **choisit explicitement** parmi les résultats retournés (nom, symbole, marché) avant que l'action soit ajoutée.

**Pourquoi pas un champ texte libre** : `GET https://query1.finance.yahoo.com/v1/finance/search?q=...` renvoie souvent plusieurs cotations pour un même nom (marché principal, ETF du même nom, filiale cotée séparément, cross-listing sur une autre bourse) — un champ texte libre résolu automatiquement risquerait de suivre silencieusement le mauvais symbole. Seuls les résultats de type action (`EQUITY`) ou ETF (`ETF`) sont proposés (futures, options... sont filtrés). La route `GET /api/stocks/search?q=...` (backend) et `searchStocks()` (exportée par le module) exposent cette recherche à l'UI.

## Source de données

Endpoint non officiel Yahoo Finance, sans clé requise :

- **Recherche** : `GET https://query1.finance.yahoo.com/v1/finance/search?q=...`, pour le widget `stock-search`.
- **Cotation** : `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`, un appel par action suivie.

## Particularités

- Le séparateur de milliers utilise une espace ASCII normale et non `toLocaleString('fr-FR')`, dont l'espace fine insécable (U+202F) n'existe dans aucune page de code ESC/POS et s'imprimerait comme un caractère invalide.
- L'échec d'une valeur (symbole invalide, API indisponible...) n'affecte que cette ligne (`N/A`), pas le reste du module ni du ticket.
- Anciennement fusionné avec le module Crypto sous l'identifiant `markets` ; la config existante des actions est migrée automatiquement vers ce module (et vers le nouveau format `stock`) au premier démarrage.
