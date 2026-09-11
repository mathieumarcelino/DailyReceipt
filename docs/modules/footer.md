# Module Pied de page (`footer`)

Citation aléatoire inspirante et mention de génération du ticket.

**Fichier source** : [src/modules/footer.module.ts](../../src/modules/footer.module.ts)

## Rendu sur le ticket

```
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   « La vie, c'est comme une bicyclette, il faut
      avancer pour ne pas perdre l'équilibre. »

          Généré par DailyReceipt le 07:30
```

Si la citation est désactivée, seule la mention de génération est imprimée (sans le séparateur en tildes).

## Configuration

| Champ | Type | Description |
|---|---|---|
| `showQuote` | booléen | Affiche ou non une citation aléatoire avant la mention de génération. |

## Source de données

Aucune API externe : citation tirée aléatoirement d'une liste locale ([src/lib/quotes.ts](../../src/lib/quotes.ts)).

## Particularités

Aucune.
