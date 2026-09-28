# Module Météo (`weather`)

Températures et conditions du jour pour une ville donnée.

**Fichiers source** : [src/modules/weather.module.ts](../../src/modules/weather.module.ts), [src/routes/weather.routes.ts](../../src/routes/weather.routes.ts)

## Rendu sur le ticket

```
METEO
PARIS
Partiellement nuageux, 15°C - 25°C
Actuellement                                20°C
Min / Max                            15°C / 25°C
Ressenti                             14°C / 24°C
Précipitations                        10% - 0mm
Vent max                                  5 km/h
Lever / Coucher                    07:30 / 19:59

Température
   [graphique température, 8 points toutes les 3h sur ~24h]

Précipitations
   [graphique précipitations (%), mêmes 8 points]
------------------------------------------------
```

(les 6 lignes détaillées, de "Actuellement" à "Lever / Coucher", n'apparaissent que si `showDetailedInfo` est activé — voir Configuration)

La ville est affichée en majuscules. La ligne de résumé combine la condition dominante du jour et les températures min/max (résumé quotidien Open-Meteo `daily`, pas l'instant de l'appel).

Le champ `showDetailedInfo` (voir Configuration) ajoute, entre la ligne de résumé et les graphiques, les 6 lignes détaillées : "Actuellement" (température à l'instant de génération du ticket, contrairement à toutes les autres lignes qui reflètent le résumé quotidien), "Min / Max", "Ressenti", "Précipitations" (% et mm affichés ensemble : ces deux valeurs proviennent de composantes de modèle distinctes chez Open-Meteo et peuvent occasionnellement sembler incohérentes prises isolément, ex: un code "averses légères" avec 0% de probabilité mais 0.1mm prévu — les afficher ensemble lève l'ambiguïté), "Vent max" et "Lever / Coucher" (heures déjà dans le fuseau horaire local via `timezone=auto`, aucune conversion nécessaire).

### Graphiques horaires (~24h)

Sous la ligne de résumé, deux petits graphiques en courbe (température, puis précipitations), chacun précédé d'une légende en gras ("Température" / "Précipitations"). Les deux partagent la même base de temps : 8 points toutes les 3h sur les prochaines ~24h, à partir de l'heure actuelle jusqu'à +21h. Comme le logo du module En-tête, ce sont des images ESC/POS raster (`ctx.image()`) : chaque graphique est dessiné par [`renderLineChart()`](../../src/lib/weather-chart.ts) sous forme de PNG (aire sous la courbe en gris clair, courbe et points en noir, valeur au-dessus de chaque point, heure en dessous), puis tramé en 1-bit noir/blanc par [`rasterizePng()`](../../src/escpos/image-raster.ts) — la même fonction que pour le logo, donc le rendu papier est fidèle à l'aperçu web. L'aire grise se tramera en pointillés (tramage de Floyd-Steinberg), un rendu propre et lisible même en monochrome basse résolution.

`renderLineChart()` est générique (pas spécifique à la température) : un `yRange` optionnel fixe l'échelle Y au lieu de la cadrer automatiquement sur les valeurs des points. Le graphique de température cadre automatiquement (par défaut) ; celui des précipitations force `yRange: [0, 100]` puisque c'est un pourcentage — un cadrage automatique sur des valeurs par exemple toutes comprises entre 0 et 20% étirerait artificiellement la courbe sur toute la hauteur, donnant l'impression trompeuse d'une forte variation là où le risque reste en réalité faible.

`renderLineChart()` dessine son propre texte (valeurs, heures) avec une **police bitmap maison 5x7** (chiffres, `H`, `-`) plutôt qu'une bibliothèque de rendu de police : le jeu de caractères nécessaire est minuscule, ça évite une dépendance pour si peu. Les heures sont affichées sous forme compacte "15H" (plutôt que "15:00") pour rapprocher les graphiques des bords du ticket : la marge latérale est calculée sur la largeur réelle du libellé le plus large (heure ou valeur) plutôt qu'une valeur figée. Chaque graphique est rendu directement à `ctx.widthPx` (la largeur réelle du papier) pour que le tramage n'ait pas à redimensionner, gardant le texte net.

Si un graphique échoue à se dessiner (erreur inattendue), le reste du module s'affiche quand même sans lui — jamais de `Module indisponible` pour un souci qui ne concerne que ce petit plus visuel. Les deux graphiques sont indépendants : si une seule des deux séries horaires a assez de points, seul le graphique correspondant s'affiche (avec sa légende), l'autre est simplement omis, silencieusement.

## Configuration

| Champ | Type | Description |
|---|---|---|
| `city` | texte | Nom de la ville affiché sur le ticket (n'influence pas la donnée récupérée). Pré-rempli automatiquement par le widget de carte (voir ci-dessous), mais reste librement modifiable à tout moment. |
| `latitude` / `longitude` | coordonnées | Position GPS choisie via une petite carte OpenStreetMap (voir ci-dessous), plutôt que saisie à la main. |
| `showDetailedInfo` | case à cocher | Ajoute les 6 lignes détaillées (température actuelle, min/max, ressenti, précipitations %/mm, vent max, lever/coucher) en plus de la ligne de résumé condensée. Désactivé par défaut. |
| `hidePrecipitationChartIfZero` | case à cocher | Masque le graphique "Précipitations" (légende et image) si ses 8 points sont tous à 0% — évite un graphique plat sans intérêt les jours sans aucun risque de pluie prévu. Le graphique de température n'est jamais concerné. Activé par défaut. |

### Widget de sélection sur carte (`coordinates`)

Champ de type dédié : une carte [Leaflet](https://leafletjs.com) affichant des tuiles [OpenStreetMap](https://www.openstreetmap.org), avec un repère déplaçable. Cliquer sur la carte ou faire glisser le repère met à jour `latitude`/`longitude` (arrondies à 4 décimales, précision largement suffisante pour une prévision météo locale) ; les valeurs numériques restent affichées sous la carte pour vérification.

Chaque déplacement du repère déclenche aussi un géocodage inverse (`GET /api/weather/reverse-geocode`, backé par [Nominatim](https://nominatim.org)) qui pré-remplit le champ `city` avec le nom de ville trouvé (`address.city`, avec repli sur `town`/`village`/`municipality`/`county` selon ce que Nominatim renvoie pour la zone cliquée). Le champ `city` reste un texte libre standard : l'utilisateur peut le corriger ou le remplacer à tout moment sans que la carte ne l'écrase — un géocodage qui échoue (zone non trouvée, ex: pleine mer) laisse simplement `city` inchangé.

Leaflet est vendorisé localement ([scripts/copy-vendor.js](../../scripts/copy-vendor.js) copie `node_modules/leaflet/dist` dans `src/public/vendor/leaflet/`, comme Alpine.js) : aucune dépendance CDN au chargement de la page. Seules les tuiles de carte et l'appel Nominatim sont chargés depuis internet au moment où l'utilisateur manipule la carte dans le Constructeur — sans incidence sur l'impression quotidienne, qui n'a besoin que des coordonnées et du nom de ville déjà enregistrés.

## Source de données

[Open-Meteo](https://open-meteo.com) — `GET https://api.open-meteo.com/v1/forecast`, **sans clé API**. Un seul appel récupère la température actuelle, le résumé du jour (condition dominante, min/max, précipitations) et les données horaires (`hourly=temperature_2m,precipitation_probability`, 2 jours) pour les deux graphiques.

## Particularités

- Les codes météo WMO renvoyés par l'API sont traduits en libellés français via une table de correspondance dédiée ([src/lib/wmo-codes.ts](../../src/lib/wmo-codes.ts)).
- Pas d'icônes/emoji pour représenter la météo (☀️, 🌧️...) : les pages de code ESC/POS (CP437/CP858/CP1252) ne les supportent pas et les imprimeraient comme des caractères invalides sur le papier. Uniquement du texte (et, depuis peu, les deux petits graphiques décrits ci-dessus).
- `forecast_days=2` (plutôt que 1) : si l'heure actuelle est tard dans la journée, les prochaines ~24h débordent sur le lendemain, il faut donc les données horaires du jour suivant aussi.
- Le premier point des graphiques correspond à la première heure pleine à partir de maintenant (ex: il est 10h15 -> premier point "11H"), trouvé par comparaison de chaînes entre `hourly.time` et `current.time` plutôt que via `Date` : les deux champs sont déjà exprimés par Open-Meteo dans le fuseau de la ville (`timezone=auto`), qui peut différer du fuseau du serveur — une comparaison de `Date` réintroduirait cette ambiguïté, alors que les chaînes ISO "YYYY-MM-DDTHH:MM" se comparent correctement telles quelles. `extractHourlyChartPoints()` (`src/modules/weather.module.ts`) est générique et sert aux deux séries.
