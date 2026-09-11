# Module En-tête (`header`)

Titre du ticket (texte ou logo image) suivi de la date du jour formatée en français.

**Fichier source** : [src/modules/header.module.ts](../../src/modules/header.module.ts)

## Rendu sur le ticket

```
            DAILYRECEIPT
       Jeudi 10 septembre 2026
================================================
```

Si un logo est configuré, il remplace le titre texte (centré, au-dessus de la date) :

```
              [ logo ]
       Jeudi 10 septembre 2026
================================================
```

## Configuration

| Champ | Type | Description |
|---|---|---|
| `title` | texte | Titre affiché en gros caractères centrés. Ignoré si un logo est défini. |
| `logo` | image (PNG) | Logo optionnel qui remplace le titre. Upload direct depuis le Constructeur (500 Ko max), stocké en data URL dans la config du module. |

## Source de données

Aucune API externe : seule la date du jour (`new Date()`) est utilisée.

## Particularités

- **Repli automatique** : si le logo est invalide ou corrompu (décodage PNG en échec), le module retombe silencieusement sur le titre texte plutôt que de faire échouer tout le ticket.
- **Traitement du logo** : le PNG est redimensionné à la largeur d'impression, tramé en 1-bit noir/blanc (Floyd-Steinberg) puis empaqueté en commande ESC/POS `GS v 0`, entièrement en JS pur (`pngjs`, pas de dépendance native) — voir [src/escpos/image-raster.ts](../../src/escpos/image-raster.ts). C'est la même primitive `ctx.image()` que n'importe quel futur module pourrait utiliser (QR code, etc.).
- L'aperçu web du Constructeur réutilise le résultat **déjà tramé** (pas l'image d'origine) : ce qui s'affiche à l'écran est fidèle au rendu papier réel, artefacts de tramage inclus.
