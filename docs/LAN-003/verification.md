# Vérification — LAN-003 — Sélection du matchup

Date : 24 septembre 2026  
Branche : `LAN-003`

## Résultat

LAN-003 est implémenté. L'écran consomme le catalogue LAN-002 et n'ajoute aucun
appel d'analyse backend ou OpenClaw.

## Contrôles automatisés

Commandes exécutées :

```sh
npm test
npm run typecheck
npm run build
```

- 24 tests réussis : 17 existants pour LAN-002 et 7 pour LAN-003.
- TypeScript frontend et backend : aucun diagnostic.
- Build Vite et compilation backend : réussis.

Les tests LAN-003 couvrent la recherche partielle insensible à la casse, le blocage
des doublons par défaut, le miroir entre équipes, le refus dans une même équipe,
la limite de deux occurrences, le remplacement d'un slot et la complétude du contrat.

## Recette navigateur locale

Une recette Chromium headless a chargé l'application réelle et le catalogue
Data Dragon, puis vérifié le parcours suivant :

1. ouverture du carry allié et recherche `JIN` : Jinx est l'unique résultat ;
2. sélection de Jinx puis consultation du support allié : Jinx reste visible,
   grisée et marquée « Déjà utilisé dans cette équipe » ;
3. consultation du carry adverse sans Mirror : Jinx est désactivée et son survol
   met en évidence le bouton Mirror ;
4. activation de Mirror : Jinx devient sélectionnable dans l'équipe adverse ;
5. composition Jinx + Thresh contre Jinx + Nautilus : Analyser devient actif ;
6. clic sur Analyser : l'instantané local contient les quatre champions attendus ;
7. aucune ressource `/api/matchup` ni OpenClaw n'est demandée.

Une capture desktop 1440 × 1200 a également confirmé la disposition des quatre
slots, le libellé `Data Dragon 16.19.1`, l'état désactivé initial d'Analyser et le
retour de santé du service. Les règles responsive sont définies à 820 px et 520 px.

## États non nominaux livrés

- chargement : slots indisponibles et « Chargement des champions... » ;
- erreur sans cache : « Impossible de charger les champions. » ;
- cache obsolète : catalogue sélectionnable et « Données en cache » ;
- recherche vide : « Aucun champion trouvé. » ;
- portrait indisponible : placeholder neutre avec initiale, sélection conservée.
