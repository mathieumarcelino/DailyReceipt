# Module Crypto (`crypto`)

Cours d'une ou plusieurs cryptomonnaies suivies au choix.

**Fichiers source** : [src/modules/crypto.module.ts](../../src/modules/crypto.module.ts), [src/routes/crypto.routes.ts](../../src/routes/crypto.routes.ts)

## Rendu sur le ticket

```
CRYPTO
Bitcoin                          67 921 € (+1.3%)
Ethereum                          2 148 € (+1.5%)
```

Une valeur dont la récupération échoue s'affiche avec `N/A` plutôt que de faire échouer tout le module.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `assets` | liste | Une entrée par crypto : `crypto` (choisie via le widget de recherche, voir ci-dessous) et `label` (optionnel). Le libellé affiché sur le ticket est le nom retourné par CoinGecko si `label` est laissé vide, ou surchargé par la valeur saisie sinon. |

### Widget de recherche de crypto (`crypto-search`)

Champ de type dédié (pas un simple texte) : l'utilisateur tape un nom ou un symbole, clique "Rechercher", puis **choisit explicitement** parmi les résultats retournés (nom, symbole, rang par capitalisation) avant que la crypto soit ajoutée.

**Pourquoi pas un champ texte libre** : `GET https://api.coingecko.com/api/v3/search?query=...` renvoie souvent plusieurs cryptos pour un même nom (forks, clones, jetons homonymes — ex: "Bitcoin Cash", "Bitcoin SV" pour une recherche "bitcoin") — un champ texte libre résolu automatiquement risquerait de suivre silencieusement la mauvaise crypto ou de nécessiter de connaître à l'avance l'identifiant CoinGecko exact. Le rang par capitalisation boursière (affiché entre parenthèses) aide à repérer la crypto "légitime" parmi des jetons obscurs partageant un nom proche. La route `GET /api/crypto/search?q=...` (backend) et `searchCryptos()` (exportée par le module) exposent cette recherche à l'UI.

## Source de données

[CoinGecko](https://www.coingecko.com), sans clé requise :

- **Recherche** : `GET https://api.coingecko.com/api/v3/search?query=...`, pour le widget `crypto-search`.
- **Cotation** : `GET https://api.coingecko.com/api/v3/simple/price`, un seul appel groupé pour toutes les cryptos suivies (cotées en EUR).

## Particularités

- Le séparateur de milliers utilise une espace ASCII normale et non `toLocaleString('fr-FR')`, dont l'espace fine insécable (U+202F) n'existe dans aucune page de code ESC/POS et s'imprimerait comme un caractère invalide.
- L'échec d'une valeur (identifiant invalide, API indisponible...) n'affecte que cette ligne (`N/A`), pas le reste du module ni du ticket.
- Anciennement fusionné avec le module Bourse sous l'identifiant `markets`, puis basé sur un champ texte libre (identifiant CoinGecko saisi à la main) ; la config existante est migrée automatiquement vers le nouveau format `crypto` au premier démarrage.
