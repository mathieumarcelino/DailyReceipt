# Module Anniversaires du jour (`birthdays`)

Liste locale de personnes (jour/mois), mise en avant sur le ticket si c'est leur anniversaire aujourd'hui.

**Fichier source** : [src/modules/birthdays.module.ts](../../src/modules/birthdays.module.ts)

## Rendu sur le ticket

Sans anniversaire aujourd'hui :

```
ANNIVERSAIRES
Aucun anniversaire aujourd'hui.
------------------------------------------------
```

Avec un ou plusieurs anniversaires :

```
ANNIVERSAIRES
        * Joyeux anniversaire Marie ! *
------------------------------------------------
```

## Configuration

| Champ | Type | Description |
|---|---|---|
| `people` | liste | Une entrée par personne : `name` (nom affiché) et `date` (au format `jj/mm`, sans année). |

## Source de données

Aucune API externe : liste saisie et stockée localement dans la configuration du module (`config.json`).

## Particularités

- Seuls le jour et le mois sont comparés à la date du jour — l'année de naissance n'est pas demandée ni stockée.
- Une date mal formée (autre que `jj/mm`) est silencieusement ignorée pour cette personne plutôt que de faire échouer le module.
- `1/1` et `01/01` sont équivalents (normalisation automatique avant comparaison).
