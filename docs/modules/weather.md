# Module Météo (`weather`)

Températures et conditions du jour pour une ville donnée.

**Fichiers source** : [src/modules/weather.module.ts](../../src/modules/weather.module.ts), [src/routes/weather.routes.ts](../../src/routes/weather.routes.ts)

## Rendu sur le ticket

```
METEO
PARIS
Prévision                           Partiellement nuageux
Actuellement                                20°C
Min / Max                            15°C / 25°C
Ressenti                             14°C / 24°C
Précipitations                        10% - 0mm
Vent max                                  5 km/h
Lever / Coucher                    07:30 / 19:59
------------------------------------------------
```

La ville est affichée en majuscules. Seule la ligne "Actuellement" est ponctuelle (température à l'instant de génération du ticket) ; toutes les autres lignes ("Prévision", "Min / Max", "Ressenti", "Précipitations", "Vent max", "Lever / Coucher") reflètent le résumé quotidien Open-Meteo (`daily`), pas l'instant de l'appel. La quantité en mm est affichée en complément du pourcentage de précipitation car ces deux valeurs proviennent de composantes de modèle distinctes chez Open-Meteo et peuvent occasionnellement sembler incohérentes prises isolément (ex: un code "averses légères" avec 0% de probabilité mais 0.1mm prévu) ; les afficher ensemble lève l'ambiguïté. Les heures de lever/coucher sont renvoyées par Open-Meteo déjà dans le fuseau horaire local (`timezone=auto`), aucune conversion supplémentaire n'est nécessaire.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `city` | texte | Nom de la ville affiché sur le ticket (n'influence pas la donnée récupérée). Pré-rempli automatiquement par le widget de carte (voir ci-dessous), mais reste librement modifiable à tout moment. |
| `latitude` / `longitude` | coordonnées | Position GPS choisie via une petite carte OpenStreetMap (voir ci-dessous), plutôt que saisie à la main. |

### Widget de sélection sur carte (`coordinates`)

Champ de type dédié : une carte [Leaflet](https://leafletjs.com) affichant des tuiles [OpenStreetMap](https://www.openstreetmap.org), avec un repère déplaçable. Cliquer sur la carte ou faire glisser le repère met à jour `latitude`/`longitude` (arrondies à 4 décimales, précision largement suffisante pour une prévision météo locale) ; les valeurs numériques restent affichées sous la carte pour vérification.

Chaque déplacement du repère déclenche aussi un géocodage inverse (`GET /api/weather/reverse-geocode`, backé par [Nominatim](https://nominatim.org)) qui pré-remplit le champ `city` avec le nom de ville trouvé (`address.city`, avec repli sur `town`/`village`/`municipality`/`county` selon ce que Nominatim renvoie pour la zone cliquée). Le champ `city` reste un texte libre standard : l'utilisateur peut le corriger ou le remplacer à tout moment sans que la carte ne l'écrase — un géocodage qui échoue (zone non trouvée, ex: pleine mer) laisse simplement `city` inchangé.

Leaflet est vendorisé localement ([scripts/copy-vendor.js](../../scripts/copy-vendor.js) copie `node_modules/leaflet/dist` dans `src/public/vendor/leaflet/`, comme Alpine.js) : aucune dépendance CDN au chargement de la page. Seules les tuiles de carte et l'appel Nominatim sont chargés depuis internet au moment où l'utilisateur manipule la carte dans le Constructeur — sans incidence sur l'impression quotidienne, qui n'a besoin que des coordonnées et du nom de ville déjà enregistrés.

## Source de données

[Open-Meteo](https://open-meteo.com) — `GET https://api.open-meteo.com/v1/forecast`, **sans clé API**. Un seul appel récupère la température actuelle ainsi que le résumé du jour (condition dominante, min/max, précipitations).

## Particularités

- Les codes météo WMO renvoyés par l'API sont traduits en libellés français via une table de correspondance dédiée ([src/lib/wmo-codes.ts](../../src/lib/wmo-codes.ts)).
- Pas d'icônes/emoji pour représenter la météo (☀️, 🌧️...) : les pages de code ESC/POS (CP437/CP858/CP1252) ne les supportent pas et les imprimeraient comme des caractères invalides sur le papier. Uniquement du texte.
