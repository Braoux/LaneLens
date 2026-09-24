# LAN-002 — Rapport de réalisation et de vérification

Date : 2026-09-24. Branche : `LAN-002`.

## Livré

- Catalogue français récupéré directement depuis Data Dragon, sans clé Riot.
- Dernière version globale recherchée au démarrage ; version technique conservée sans conversion régionale.
- Cache JSON persistant via `localStorage`, réutilisation si à jour et repli marqué obsolète.
- Validation avant remplacement de l'ancien cache ; cohérence version/données/portraits.
- État d'erreur contrôlé lorsqu'aucun catalogue n'est utilisable.
- État partagé et promesse consommable par les futurs composants, déclenchés dans `main.ts`.
- Aucune interface de sélection ou de gestion d'erreur ajoutée.
- Architecture et README actualisés ; aucun changement du backend ni nouvelle dépendance.

## Vérifications exécutées

### Tests déterministes

Commande : `npm test`. **17 tests réussis, 0 échec.**

Les tests utilisent le runner natif Node.js via `tsx`, un transport contrôlé et un
stockage simulant `getItem`/`setItem`. Les versions et champions fictifs des fixtures
sont réservés aux tests ; ils ne sont ni inclus dans le bundle ni utilisés comme fallback.

| Scénario | Résultat |
|---|---|
| Première récupération avec plusieurs versions | Dernière version du flux, locale française, identifiant textuel, portrait versionné et sauvegarde corrects. |
| Nouveau chargement avec cache sérialisé à jour | Vérification de version seule ; aucune récupération complète ni nouvelle date d'acquisition. |
| Nouvelle version | Ancien cache conservé pendant les requêtes puis remplacé après validation. |
| Versions inaccessibles ou liste vide | Repli obsolète sur le dernier cache valide. |
| Nouveau catalogue HTTP 503 ou timeout | Repli sans remplacement ni changement de version du cache. |
| Catalogue de mauvaise version, vide ou JSON malformé | Rejet et maintien du cache précédent. |
| Réseau indisponible sans cache ou avec cache inexploitable | Erreur contrôlée, aucune donnée codée en dur. |
| URL en cache liée à une autre version | Cache rejeté ; récupération réseau valide. |
| Lecture/écriture de stockage refusée | Catalogue réseau utilisable ; persistance signalée indisponible. |
| Initialisation partagée | États idle/loading/ready et promesse commune aux consommateurs, sans requêtes dupliquées. |

### Intégration réelle avec Data Dragon

Le chargeur applicatif a été exécuté sous Node.js avec le vrai `fetch` et un
stockage en mémoire pour cet essai. Aucun secret n'a été fourni.

- Version récupérée : **16.19.1** (observation ponctuelle, pas une constante applicative).
- Nombre de champions : **173**.
- Locale : **fr_FR**.
- Premier chargement : `source: network`.
- Second chargement : `source: cache`, `stale: false`.
- Un portrait du catalogue réel : **HTTP 200**.

### Compilation et contrôle du dépôt

- `npm run build` : réussi, frontend Vite et backend TypeScript.
- `npm run typecheck` : réussi après ajout des tests au périmètre TypeScript.
- `git diff --check` : aucun défaut d'espacement ; avertissements LF/CRLF usuels de Git.
- L'appel effectif à `initializeChampionCatalog()` dans `src/main.ts` a été contrôlé
  dans le code ; le build inclut le module catalogue.

## Couverture des critères

| Critères | Preuve principale |
|---|---|
| AC1–AC5 | Tests de normalisation et de transport, intégration réelle Data Dragon. |
| AC6 | Adaptateur localStorage livré ; réutilisation d'un cache sérialisé vérifiée dans les tests. |
| AC7–AC9 | Tests cache à jour, mise à jour réussie et différents échecs de récupération. |
| AC10 | Tests d'erreur sans cache exploitable. |
| AC11 | Validation du catalogue et des URLs, tests d'incohérence et de repli. |
| AC12 | Appel dans le démarrage réel inspecté, état partagé testé et compilation réussie. |

## Limites de validation

Aucun rechargement dans un navigateur réel n'a été exécuté pour LAN-002. Le test
de persistance utilise un stockage simulé, et l'intégration réelle utilise Node.js :
ces résultats ne constituent pas une preuve du comportement CORS ou de la
persistance du navigateur après rechargement. Le démarrage visuel n'a pas été testé.

Lors de LAN-001, la navigation locale de l'outil navigateur avait été bloquée par sa
politique ; aucun contournement n'est utilisé ici. Le rapport distingue donc la
livraison du code et les vérifications effectuées d'une recette navigateur complète.

## Recette navigateur complémentaire

Après `npm run dev`, ouvrir `http://127.0.0.1:5173` :

1. Retirer uniquement la clé `lanelens.champion-catalog.v1` du stockage de cette origine.
2. Recharger : observer `versions.json`, puis `fr_FR/champion.json` dans le réseau
   et la nouvelle entrée dans localStorage.
3. Recharger avec la même version : `versions.json` doit être vérifié, sans nouveau
   téléchargement complet du catalogue.
4. Bloquer les requêtes vers Data Dragon dans les outils du navigateur, puis
   recharger la page locale : consulter l'état du module, qui doit exposer le cache obsolète.
5. Sans cette clé et avec Data Dragon bloqué : vérifier l'état `error` et l'absence
   d'erreur non gérée. Réactiver ensuite les requêtes.

En développement Vite, la console peut consulter le résultat sans interface ajoutée :

```js
const catalogModule = await import('/src/catalog-state.ts');
await catalogModule.initializeChampionCatalog();
catalogModule.getChampionCatalogState();
```

Le cache des URLs ne garantit ni les portraits hors connexion ni le chargement
hors connexion de l'application elle-même. L'état de santé du backend est distinct
de l'état du catalogue.
