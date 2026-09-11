# Module Bourse / Crypto (`markets`)

Cours d'une ou plusieurs valeurs (actions ou cryptomonnaies) suivies au choix.

**Fichier source** : [src/modules/markets.module.ts](../../src/modules/markets.module.ts)

## Rendu sur le ticket

```
BOURSE & CRYPTO
Bitcoin (BTC)                   67 921 € (+1.3%)
Ethereum (ETH)                   2 148 € (+1.5%)
iShares MSCI World               6.91 EUR (+0.5%)
------------------------------------------------
```

Une valeur dont la récupération échoue s'affiche avec `N/A` plutôt que de faire échouer tout le module.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `assets` | liste | Une entrée par valeur : `type` (`crypto` ou `stock`), `symbol` (identifiant chez le fournisseur correspondant) et `label` (libellé affiché sur le ticket). |

Format du `symbol` selon le type :
- **crypto** : identifiant CoinGecko (ex: `bitcoin`, `ethereum`, pas le ticker `BTC`).
- **stock** : symbole Yahoo Finance (ex: `AAPL`, `MC.PA` pour une valeur Euronext Paris).

## Source de données

- **Crypto** : [CoinGecko](https://www.coingecko.com) — `GET https://api.coingecko.com/api/v3/simple/price`, un seul appel groupé pour toutes les cryptos suivies (cotées en EUR).
- **Actions** : endpoint non officiel Yahoo Finance — `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`, un appel par action suivie.

Aucune des deux API ne nécessite de clé.

## Particularités

- Le séparateur de milliers utilise une espace ASCII normale et non `toLocaleString('fr-FR')`, dont l'espace fine insécable (U+202F) n'existe dans aucune page de code ESC/POS et s'imprimerait comme un caractère invalide.
- L'échec d'une valeur (symbole invalide, API indisponible...) n'affecte que cette ligne (`N/A`), pas le reste du module ni du ticket.
