# Module Météo (`weather`)

Températures et conditions du jour pour une ville donnée.

**Fichier source** : [src/modules/weather.module.ts](../../src/modules/weather.module.ts)

## Rendu sur le ticket

```
METEO
Paris — Partiellement nuageux
Actuellement                                20°C
Min / Max du jour                    15°C / 25°C
Vent                                      5 km/h
------------------------------------------------
```

## Configuration

| Champ | Type | Description |
|---|---|---|
| `city` | texte | Nom de la ville affiché sur le ticket (n'influence pas la donnée récupérée). |
| `latitude` | nombre | Latitude GPS de la ville. |
| `longitude` | nombre | Longitude GPS de la ville. |

## Source de données

[Open-Meteo](https://open-meteo.com) — `GET https://api.open-meteo.com/v1/forecast`, **sans clé API**. Un seul appel récupère la température/condition actuelles ainsi que le min/max du jour.

## Particularités

- Les codes météo WMO renvoyés par l'API sont traduits en libellés français via une table de correspondance dédiée ([src/lib/wmo-codes.ts](../../src/lib/wmo-codes.ts)).
- Pas d'icônes/emoji pour représenter la météo (☀️, 🌧️...) : les pages de code ESC/POS (CP437/CP858/CP1252) ne les supportent pas et les imprimeraient comme des caractères invalides sur le papier. Uniquement du texte.
