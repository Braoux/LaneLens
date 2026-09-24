# Contextes de patch LaneLens

LaneLens prépare et versionne côté serveur les informations de patch transmises au
moteur d’analyse. Le navigateur ne fournit jamais ce contexte et le resolver
n’effectue aucun accès réseau. La version Data Dragon affichée par le frontend
n’est pas convertie automatiquement en patch joueur.

## Contexte 26.19

- **Patch :** `26.19`
- **Version du contexte :** `26.19-v1`
- **Date de préparation :** 24 septembre 2026
- **Source :** [Notes officielles Riot Games du patch 26.19](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-19-notes/), publiées le 22 septembre 2026.

Les faits retenus couvrent les changements directement utiles à l’analyse de la
botlane : Aphelios, Lucian, World Atlas et Runic Compass. Ils ne cherchent pas à
recopier l’intégralité des notes de patch.

## Maintenance

Pour ajouter ou corriger un contexte :

1. vérifier les changements auprès d’une source officielle Riot Games ;
2. modifier `server/patch-context/data/contexts.ts` ;
3. utiliser le numéro de patch joueur exact, sans le déduire de Data Dragon ;
4. incrémenter `contextVersion` lorsqu’un contexte existant change (`26.19-v1`
   vers `26.19-v2`, par exemple) ;
5. mettre à jour dans ce document la date, la source et le périmètre des faits ;
6. exécuter `npm run typecheck`, `npm test` et `npm run build`.

Un contexte doit contenir au moins un fait tactiquement utile. Les placeholders,
les doublons de patch et les chaînes vides sont rejetés par le resolver.
