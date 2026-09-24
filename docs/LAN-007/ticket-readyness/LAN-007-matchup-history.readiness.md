# Ticket Readiness — LAN-007 — Conserver les derniers matchups consultés

**Ticket :** LAN-007 révisé après Ticket Readiness
**Branche inspectée :** `LAN-007`
**Date :** 24 septembre 2026
**Type :** Fonctionnalité frontend / persistance locale
**Readiness Score :** 10 / 10
**Status :** READY

## Réévaluation du ticket révisé

Les clarifications ajoutées lèvent tous les blocages identifiés ci-dessous :

- le snapshot autonome conserve `id`, `name` et `imageUrl` pour chaque champion ;
- la clé, l’enveloppe versionnée et la validation individuelle sont définies ;
- l’identité, la déduplication, l’ordre et la limite sont déterministes ;
- la consultation historique invalide et annule la requête active ;
- le caractère sauvegardé, le patch et la date possèdent un oracle visuel ;
- la sélection courante reste indépendante de la consultation historique ;
- les tests hors réseau et la recette desktop/mobile sont explicitement définis.

Le ticket révisé est donc implémentable sans choix produit implicite. Les constats
du rapport initial sont conservés plus bas comme trace de la première évaluation.

## Résumé

LAN-007 propose une persistance locale proportionnée au MVP : conserver au plus
dix `MatchupAnalysis` déjà validés, sans base de données, sans nouvel appel LLM
et sans donnée provider. Le dépôt possède déjà les briques nécessaires : contrat
public partagé, validation défensive frontend, rendu Quick Overlay / Full
Analysis, token anti-réponse obsolète et adaptateur `localStorage` sûr.

Le ticket n’est toutefois pas encore entièrement déterministe. Le rendu LAN-006
exige un `MatchupSelection` contenant les portraits des quatre champions, alors
que l’entrée historique minimale ne conserve que leurs noms. La stratégie de
déduplication et l’ordre de présentation ne disent pas quel élément gagne ni si
sa date est renouvelée. Enfin, consulter l’historique pendant une analyse en vol
doit explicitement invalider cette requête afin qu’elle ne remplace pas ensuite
le résultat historique.

Ces décisions modifient le comportement observable et doivent être fixées avant
une implémentation complète.

## Score de readiness

| Dimension | Score | Justification |
|---|---:|---|
| Intention et résultat attendu | 2 / 2 | Persistance locale, limite et consultation sans provider clairement visées. |
| Règles métier et comportement | 1 / 2 | Déduplication, ordre et reconstruction du snapshot visuel restent ambigus. |
| Acceptation et vérifiabilité | 1 / 2 | Critères fonctionnels présents, mais oracles de validation stockée et navigation in-flight incomplets. |
| Périmètre et dépendances | 2 / 2 | LAN-006 est livré ; aucun backend, provider ou stockage cloud requis. |
| Cas limites et complétude opérationnelle | 1 / 2 | Erreurs localStorage couvertes en principe, mais catalogue indisponible, entrée partiellement invalide et réponse obsolète non tranchés. |
| **Total** | **7 / 10** | |

## Contexte du dépôt confirmé

- `MatchupAnalysis`, `MatchupRequest` et les sources vivent dans
  `shared/analysis-contract.ts`.
- `src/analysis.ts` fournit `isMatchupAnalysis(value, request)` et vérifie la
  structure complète, les quatre positions et le patch.
- `src/main.ts` ne rend une analyse réseau qu’après cette validation et après
  vérification du token monotone actif.
- `renderResult(snapshot, analysis)` exige un `MatchupSelection` complet ; chaque
  champion contient `id`, `name` et `imageUrl` pour le header avec portraits.
- `src/storage.ts` encapsule déjà `getItem`, `setItem`, `JSON.parse` et
  `JSON.stringify` derrière des erreurs contrôlées.
- Le retour « Nouvelle analyse » masque immédiatement le résultat sans reload.
- La suite de référence passe actuellement : **112 tests**.
- Le worktree contenait avant ce rapport deux modifications sans rapport direct,
  `.env.example` et `.gitignore`; elles ont été laissées intactes.

## Trace du flux cible

| Étape | État actuel | Besoin LAN-007 |
|---|---|---|
| Réponse API | Validée et cohérente avec le snapshot envoyé | Ajouter uniquement la réponse active et affichable. |
| Entrée historique | Absente | Contrat local versionné et validateur runtime. |
| Persistance | Helpers JSON défensifs disponibles | Lecture/écriture d’une liste limitée à dix. |
| Identité | Patch et rôles disponibles | Normalisation et règle de remplacement explicites. |
| Consultation | `renderResult` exige snapshot + portraits | Producteur de snapshot historique ou rendu dédié. |
| Requête en vol | Token monotone protège le résultat réseau | Le clic historique doit invalider/annuler la requête active. |
| Patch historique | Déjà présent dans l’analyse | Afficher patch et date historique sans les requalifier. |

## Constats

### TR-01 — Le snapshot visuel historique n’est pas reconstructible de manière garantie

**Sévérité : BLOCKING**

L’entrée proposée stocke les quatre noms, le patch, l’analyse et `generatedAt`.
Or `renderResult` attend quatre objets `Champion` avec `id`, `name` et
`imageUrl`. Après rechargement, ces objets n’existent plus dans l’état de
sélection. Les reconstruire depuis le catalogue courant introduit une dépendance
non décrite et échoue si le catalogue est indisponible ou si une entrée a changé.

**Décision minimale requise :** choisir l’une des stratégies suivantes et définir
son fallback :

1. stocker un snapshot d’affichage minimal des quatre champions (`id`, `name`,
   `imageUrl`) avec l’entrée historique ; ou
2. reconstruire depuis le catalogue courant, avec un rendu textuel/placeholder
   explicite si un champion ou le catalogue manque.

La consultation locale ne doit pas devenir impossible uniquement parce que Data
Dragon est indisponible, sauf décision produit explicite contraire.

### TR-02 — La déduplication et l’ordre ne définissent pas le gagnant

**Sévérité : BLOCKING**

Le ticket définit l’identité positionnelle, puis indique qu’une stratégie simple
est acceptable. Il ne précise pas si une nouvelle analyse du même matchup :

- remplace l’ancienne et renouvelle `generatedAt` ;
- déplace l’entrée existante en tête sans changer sa date ;
- ou crée un doublon.

L’ordre visuel n’est pas non plus explicite, alors que « dix plus récentes » et
« supprimer les plus anciennes » exigent un ordre total.

**Décision minimale requise :** définir la normalisation de la clé et la règle de
remplacement. Une règle vérifiable possible est : patch trimé exact, champions
trimés et comparés sans casse, rôles positionnels ; la nouvelle analyse remplace
l’ancienne, reçoit une nouvelle date et passe en tête ; la liste est triée du
plus récent au plus ancien puis tronquée à dix.

Cette proposition n’est pas encore une règle approuvée.

### TR-03 — Consultation historique et requête en vol

**Sévérité : BLOCKING**

LAN-006 possède un token monotone empêchant une réponse réseau obsolète de
remplacer la sélection courante. Le ticket ne dit pas ce qui se passe si
l’utilisateur ouvre une entrée historique pendant qu’une analyse est en cours.
Sans règle explicite, la réponse réseau peut ensuite remplacer le résultat local.

**Décision minimale requise :** le clic historique doit soit être désactivé
pendant l’analyse, soit annuler/invalider la requête active avant d’afficher
l’entrée. Dans les deux cas, aucun résultat réseau antérieur ne peut remplacer
la consultation historique.

### TR-04 — Validation et version du stockage local insuffisamment définies

**Sévérité : IMPORTANT**

Le contenu `localStorage` est non fiable. Le ticket demande de l’ignorer mais ne
précise pas les invariants complets ni la granularité : rejeter toute la liste ou
filtrer seulement les entrées invalides.

Une entrée doit au minimum vérifier :

- cinq champs d’identité non vides après trim ;
- `generatedAt` chaîne ISO représentant une date valide ;
- cohérence de `analysis.matchup` avec ces cinq champs via le validateur LAN-006 ;
- structure complète de `MatchupAnalysis`, y compris sources éventuelles ;
- absence de propriétés internes attendues comme `PatchContext`, prompt ou
  configuration provider.

**Décision recommandée :** utiliser une clé/enveloppe versionnée, par exemple
`lanelens.matchup-history.v1`, filtrer chaque entrée invalide sans la réparer,
conserver l’ordre valide et appliquer à nouveau déduplication + limite après
lecture. Le choix « filtrer » ou « ignorer toute la valeur » doit être explicite.

### TR-05 — Présentation du caractère historique incomplète

**Sévérité : IMPORTANT**

Le ticket exige que le résultat ne soit pas présenté comme recalculé pour le
patch courant, mais ne donne pas l’oracle visuel minimal. Il faut au moins définir :

- où l’historique apparaît dans le parcours de sélection ;
- l’ordre des entrées ;
- l’affichage du patch stocké et de `generatedAt` ;
- un marqueur indiquant qu’il s’agit d’une analyse sauvegardée ;
- le comportement de « Nouvelle analyse » depuis un résultat historique.

Le format localisé de la date et le style exact restent des détails de design,
mais patch et date doivent être observables.

### TR-06 — Recette et tests minimaux non listés

**Sévérité : IMPORTANT**

La Definition of Done cite les trois gates projet, sans détailler la couverture
fonctionnelle. LAN-007 devrait au minimum tester hors réseau :

- lecture absente, JSON malformé et structure incompatible ;
- validation champ par champ et cohérence de l’analyse ;
- déduplication, ordre et remplacement ;
- conservation des dix plus récents ;
- écriture refusée/quota sans échec du résultat courant ;
- rechargement simulé depuis un nouveau store ;
- consultation sans appel à `POST /api/matchup` ;
- invalidation d’une réponse réseau obsolète ;
- rendu avec catalogue/portrait indisponible selon la décision TR-01.

Une recette navigateur desktop/mobile doit vérifier la lisibilité de dix entrées
et la navigation sélection → historique → nouvelle analyse sans reload.

## Évaluation des critères d’acceptation

| Critère | Évaluation |
|---|---|
| AC1 — Sauvegarde | Clair, à déclencher uniquement après validation et contrôle du token actif. |
| AC2 — Données | Structure minimale claire, mais snapshot visuel manquant pour le rendu actuel. |
| AC3 — Limite | Vérifiable une fois ordre et déduplication définis. |
| AC4 — Consultation locale | Principe clair ; construction du snapshot et concurrence restent bloquantes. |
| AC5 — Provider-agnostic | Clair et compatible avec le dépôt. |
| AC6 — Persistance | Compatible avec `src/storage.ts`; nécessite clé/version et validation. |
| AC7 — État vide | Clair. |
| AC8 — Stockage invalide | Intention claire, granularité du rejet à préciser. |
| AC9 — Échec de persistance | Clair : l’analyse courante doit rester affichée et utilisable. |
| AC10 — Patch historique | Clair sur le fond ; indicateur visuel minimal à définir. |

## Dépendances et périmètre

- LAN-006 est livré et constitue la seule dépendance fonctionnelle requise.
- Aucun changement backend ou provider n’est nécessaire.
- Aucun appel externe n’est nécessaire pour tester le module d’historique.
- Le cache catalogue LAN-002 ne doit pas être confondu avec l’historique
  d’analyses ; les clés de stockage doivent être distinctes.
- Multi-onglets, synchronisation via événement `storage`, suppression manuelle,
  favoris, cloud et cache serveur restent hors périmètre.

## Décisions minimales pour passer à READY

1. Définir comment obtenir les quatre portraits/snapshots lors d’une consultation
   après rechargement et le fallback sans catalogue.
2. Fixer clé normalisée, règle de remplacement, ordre et traitement de
   `generatedAt` lors d’un doublon.
3. Décider si le clic historique est bloqué pendant une analyse ou invalide la
   requête active.
4. Fixer la clé/version de stockage et la granularité de rejet des entrées
   invalides.
5. Définir l’indication minimale « historique » avec patch et date visibles.

## Décision de readiness initiale (historique)

**Status initial : NEEDS CLARIFICATION — 7 / 10**

Le socle technique existe et le périmètre est sain, mais les trois constats
bloquants changent directement le résultat utilisateur. LAN-007 doit être mis à
jour avec ces décisions avant implémentation afin d’éviter une dépendance cachée
au catalogue courant, des doublons incohérents ou un écrasement par une réponse
réseau obsolète.
