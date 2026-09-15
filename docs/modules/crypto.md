# Module Crypto (`crypto`)

Cours d'une ou plusieurs cryptomonnaies suivies au choix.

**Fichier source** : [src/modules/crypto.module.ts](../../src/modules/crypto.module.ts)

## Rendu sur le ticket

```
CRYPTO
Bitcoin (BTC)                   67 921 € (+1.3%)
Ethereum (ETH)                   2 148 € (+1.5%)
```

Une valeur dont la récupération échoue s'affiche avec `N/A` plutôt que de faire échouer tout le module.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `assets` | liste | Une entrée par crypto : `symbol` (identifiant CoinGecko) et `label` (libellé affiché sur le ticket). |

Format du `symbol` : identifiant CoinGecko (ex: `bitcoin`, `ethereum`, pas le ticker `BTC`).

## Source de données

[CoinGecko](https://www.coingecko.com) — `GET https://api.coingecko.com/api/v3/simple/price`, un seul appel groupé pour toutes les cryptos suivies (cotées en EUR). Ne nécessite pas de clé.

## Particularités

- Le séparateur de milliers utilise une espace ASCII normale et non `toLocaleString('fr-FR')`, dont l'espace fine insécable (U+202F) n'existe dans aucune page de code ESC/POS et s'imprimerait comme un caractère invalide.
- L'échec d'une valeur (symbole invalide, API indisponible...) n'affecte que cette ligne (`N/A`), pas le reste du module ni du ticket.
- Anciennement fusionné avec le module Bourse sous l'identifiant `markets` ; la config existante des cryptos est migrée automatiquement vers ce module au premier démarrage.
