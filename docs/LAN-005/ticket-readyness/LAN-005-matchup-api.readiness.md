# Ticket Readiness — LAN-005 — Exposer l’analyse via `POST /api/matchup`

**Ticket :** LAN-005  
**Branche inspectée :** `lanelens-home`  
**Date :** 24 septembre 2026  
**Type :** Tâche technique — API backend / Intégration  
**Readiness Score :** 4 / 10  
**Status :** NEEDS CLARIFICATION

## Summary

LAN-005 veut exposer le moteur d’analyse derrière `POST /api/matchup`, valider la
requête navigateur, appeler le backend LaneLens et retourner un
`MatchupAnalysis` ou une erreur contrôlée.

L’intention générale est correcte, mais le ticket est antérieur à ADR-001 et à
LAN-004. Il impose encore OpenClaw dans ses critères alors que l’architecture
acceptée interdit au contrôleur de connaître un provider concret. Surtout, le
contrôleur ne peut pas construire le `MatchupAnalysisInput` requis par LAN-004 :
la requête ne transporte qu’un patch, aucun producteur de `PatchContext` n’existe
et aucun provider runtime concret n’est actuellement disponible.

Le ticket doit être révisé avant implémentation afin de définir les dépendances
du contrôleur, le contrat HTTP d’erreur et les règles de validation de la requête.

## Readiness score

| Dimension | Score | Justification |
|---|---:|---|
| Intent and expected outcome | 1 / 2 | La route et la réponse de succès sont identifiées, mais les AC restent couplés à OpenClaw. |
| Business rules and behavior | 0,5 / 2 | La construction de `PatchContext`, la validité des champions et les erreurs HTTP ne sont pas définies. |
| Acceptance and verifiability | 1 / 2 | Les parcours principaux sont nommés, sans statuts, schémas d’erreur ni stratégie d’injection vérifiables. |
| Scope and dependencies | 1 / 2 | LAN-004 est disponible, mais le producteur de contexte et le provider runtime manquent. |
| Edge cases and operational completeness | 0,5 / 2 | JSON malformé, types incorrects, chaînes vides, contenu HTTP et disponibilité de la composition ne sont pas couverts. |
| **Total** | **4 / 10** | |

## Confirmed information

- ADR-001 est `Accepted` et interdit une dépendance directe du contrôleur envers
  OpenClaw, un SDK LLM ou un modèle.
- LAN-004 est implémenté et ses 40 tests passent.
- `MatchupAnalysisService` dépend uniquement de `MatchupAnalysisProvider`.
- Le provider retourne `unknown` et LaneLens valide la réponse avant de produire
  un `MatchupAnalysis`.
- `MatchupAnalysisInput` requiert les quatre rôles, `patch` et un `PatchContext`
  valide contenant au moins un fait.
- Une incohérence entre `input.patch` et `patchContext.patch` produit actuellement
  `ANALYSIS_FAILED` avant l’appel provider.
- Les autres erreurs métier disponibles sont
  `ANALYSIS_PROVIDER_UNAVAILABLE` et `INVALID_ANALYSIS_RESPONSE`.
- Aucun provider concret, aucun producteur de `PatchContext` et aucune route
  `POST /api/matchup` n’existent actuellement.
- `server/index.ts` instancie directement Hono et démarre le serveur ; aucune
  fabrique d’application ou injection du service n’est encore définie.
- Le frontend et le proxy Vite utilisent déjà le préfixe relatif `/api`.

## Findings

### TR-01 — Les critères imposent encore OpenClaw

**Severity:** BLOCKER

**Observed:**  
AC1 exige « l’analyse OpenClaw correspondante » et AC4 décrit « OpenClaw
indisponible ».

**Conflict:**  
ADR-001 et LAN-011 imposent un contrôleur dépendant de
`MatchupAnalysisService`, sans connaissance d’OpenClaw ni d’un autre provider.

**Required clarification:**  
Remplacer ces formulations par « analyse LaneLens obtenue via
`MatchupAnalysisService` » et « service/provider d’analyse indisponible ».
L’éventuel provider concret ne doit apparaître ni dans le contrat HTTP ni dans
les critères fonctionnels génériques.

### TR-02 — Aucun provider runtime n’est disponible pour produire HTTP 200

**Severity:** BLOCKER

**Observed:**  
LAN-004 a volontairement livré uniquement la frontière et des fake providers.
Le ticket exige pourtant qu’une requête valide retourne une analyse réelle.

**Impact:**  
Une route peut être testée avec un service injecté, mais l’application démarrée
ne peut pas construire un `MatchupAnalysisService` fonctionnel sans provider
concret. Choisir implicitement OpenClaw contredirait le report explicite du choix
du provider.

**Required decision:**  
Préciser l’une des trajectoires suivantes :

1. LAN-005 livre uniquement le contrôleur et une fabrique Hono injectant un
   `MatchupAnalysisService`, tandis que le branchement runtime réel dépend d’un
   ticket provider distinct ; ou
2. un provider concret explicitement choisi et spécifié devient un prérequis de
   LAN-005 ; ou
3. LAN-005 inclut un adapter concret, ce qui élargit fortement son périmètre et
   nécessite ses propres critères.

Le comportement du serveur lancé sans provider doit également être défini.

### TR-03 — La requête ne permet pas de construire `MatchupAnalysisInput`

**Severity:** BLOCKER

**Observed:**  
Le JSON public contient les quatre champions et `patch`. LAN-004 exige en plus
un `PatchContext` serveur valide, avec `contextVersion` et au moins un fait.
Aucun composant ne sait actuellement récupérer ou préparer ce contexte.

**Conflict:**  
Le contexte ne doit pas être inventé par le LLM, déduit de la version Data
Dragon ou accepté aveuglément depuis le navigateur. La source de vérité et la
préparation réelles ont été explicitement différées.

**Required decision:**  
Définir un prérequis ou une abstraction injectée, par exemple un producteur de
contexte côté serveur recevant le patch demandé. Préciser les comportements
« contexte inconnu », « contexte indisponible » et « contexte incohérent », sans
inventer ici la source de vérité si elle reste hors périmètre.

### TR-04 — Le contrat HTTP d’erreur n’est pas défini

**Severity:** MAJOR

**Observed:**  
Le ticket demande une « erreur contrôlée » mais ne fixe ni statut HTTP ni schéma
JSON.

**Missing mappings:**

- requête JSON malformée ;
- corps absent ou mauvais `Content-Type` ;
- champ absent, mauvais type ou chaîne vide ;
- patch/contexte invalide ;
- `ANALYSIS_PROVIDER_UNAVAILABLE` ;
- `INVALID_ANALYSIS_RESPONSE` ;
- `ANALYSIS_FAILED` ;
- erreur interne inattendue.

**Required clarification:**  
Définir les statuts et une enveloppe d’erreur stable, sans détails provider,
secret, stack trace ou chemin local. Exemple conceptuel, non prescriptif :
`{ "error": { "code": "...", "message": "..." } }`.

### TR-05 — « champions valides » et validation serveur sont ambigus

**Severity:** MAJOR

**Observed:**  
Le ticket ne précise pas si « valide » signifie seulement une chaîne non vide,
un identifiant du catalogue, un nom canonique, ni comment traiter casse et
espaces. Il ne dit pas non plus si le serveur doit appliquer les règles de
doublons/Mirror définies par LAN-003.

**Impact:**  
AC3 interdit de faire confiance au navigateur, mais aucun oracle ne permet de
tester les valeurs métier acceptées. Le catalogue Data Dragon est actuellement
chargé uniquement côté frontend.

**Required clarification:**  
Définir la validation du DTO public : types, trim, champs supplémentaires,
format du patch, identité des champions et règles de doublons. Si la validation
contre un catalogue serveur est différée, l’indiquer explicitement et limiter ce
ticket à une validation structurelle documentée.

### TR-06 — Composition et testabilité de l’application Hono

**Severity:** IMPORTANT

**Observed:**  
`server/index.ts` crée l’application et démarre immédiatement le serveur. Tester
la route avec un service factice nécessiterait soit un effet de bord réseau, soit
une extraction de la construction de l’application.

**Assessment:**  
Une fabrique telle que `createApp(dependencies)` et un point d’entrée de démarrage
séparé constituent une solution technique naturelle. Le nom des fichiers reste
un détail d’implémentation, mais le ticket devrait exiger des tests HTTP hors
réseau réel et l’injection du service/provider plutôt qu’un import concret.

### TR-07 — Les scénarios de test API sont insuffisants

**Severity:** IMPORTANT

Les AC devraient être complétés par des tests couvrant au minimum :

- succès avec service injecté et vérification exacte de l’entrée préparée ;
- champ absent, mauvais type et chaîne vide ;
- JSON malformé ;
- contexte de patch indisponible ou incohérent ;
- traduction des trois codes d’erreur LAN-004 ;
- réponse JSON et statut associés à chaque catégorie ;
- absence de détail sensible ;
- preuve que le contrôleur n’importe aucun provider concret ;
- maintien de `GET /api/health`.

## Acceptance criteria assessment

### Partially clear

- **AC2** et **AC3** expriment correctement la nécessité d’une validation côté
  serveur, mais ne définissent pas les règles observables.
- **AC5** est couvert conceptuellement par LAN-004, à condition que la route
  appelle bien `MatchupAnalysisService` et traduise
  `INVALID_ANALYSIS_RESPONSE`.

### Contradictory or incomplete

- **AC1** et **AC4** contredisent ADR-001 en imposant OpenClaw.
- Aucun AC ne couvre la création du `PatchContext` requis.
- Aucun AC ne fixe les statuts et corps d’erreur.
- Aucun AC ne définit le branchement runtime du provider.
- Aucun AC ne garantit explicitement que le contrôleur dépend du service et non
  de `MatchupAnalysisProvider` ou d’une implémentation concrète.

## Scope

### Known scope

- Route `POST /api/matchup` dans le backend Hono.
- Validation d’un DTO HTTP non fiable.
- Appel de `MatchupAnalysisService`.
- Sérialisation d’un `MatchupAnalysis` validé.
- Traduction des erreurs métier vers le contrat HTTP.
- Tests de contrôleur avec dépendances factices.

### Explicitly out of scope

- Rate limiting, authentification, quotas utilisateur et cache d’analyses.

### Unclear scope

- Provider runtime concret et composition au démarrage.
- Production/récupération de `PatchContext`.
- Validation des champions contre un catalogue serveur.
- Règles Mirror et doublons côté API.
- Statuts et enveloppe d’erreur.
- Gestion des requêtes malformées et du `Content-Type`.

## Dependencies

- **ADR-001 :** accepté et contraignant.
- **LAN-004 :** implémenté ; fournit le service, les contrats, la validation et
  les erreurs, mais aucun provider concret.
- **Producteur de `PatchContext` :** absent et nécessaire pour appeler le service.
- **Provider runtime :** absent et nécessaire pour produire une analyse réelle.
- **LAN-003 :** définit des règles UI de sélection, sans équivalent serveur
  explicitement demandé ici.

## Questions requiring clarification

### Blocking

1. LAN-005 est-il un ticket de contrôleur testable par injection uniquement, ou
   doit-il rendre le serveur réellement capable de générer une analyse ?
2. Quel composant fournit le `PatchContext` serveur à partir du patch demandé,
   et que retourne l’API lorsque ce contexte n’existe pas ?
3. Quel provider concret est branché au démarrage, ou quel ticket préalable le
   fournira ?
4. Quels statuts HTTP et quel schéma JSON correspondent aux erreurs de validation
   et aux trois catégories d’erreur LAN-004 ?
5. Quelles règles définissent un champion et un matchup valides côté serveur ?

### Non-blocking

1. Les propriétés JSON supplémentaires sont-elles ignorées ou rejetées ?
2. Le patch est-il conservé après `trim()` ou la réponse doit-elle préserver la
   chaîne originale ?
3. Faut-il imposer `application/json` ou seulement accepter tout corps JSON
   analysable ?

## Recommended ticket changes

1. Remplacer toute mention fonctionnelle d’OpenClaw par
   `MatchupAnalysisService` ou « service d’analyse ».
2. Ajouter explicitement la dépendance du contrôleur :
   `Controller → MatchupAnalysisService`, sans import d’un provider concret.
3. Définir la stratégie de fourniture du `PatchContext`, ou rendre le ticket
   dépendant de celui qui l’implémentera.
4. Séparer clairement la route testable par injection de la composition runtime
   avec un provider réel.
5. Définir le DTO, sa normalisation, ses règles de validation et les règles de
   doublons.
6. Définir une matrice `erreur LaneLens → statut HTTP → corps JSON`.
7. Exiger des tests Hono hors réseau réel et le maintien de `/api/health`.

## Readiness decision

**Status:** NEEDS CLARIFICATION

**Reason:**  
Le ticket ne peut pas être implémenté fidèlement sans inventer deux dépendances
essentielles — le producteur de `PatchContext` et le provider runtime — ainsi que
le contrat d’erreur HTTP. Ses critères OpenClaw sont en contradiction directe
avec l’architecture acceptée. Ces choix influencent le comportement observable,
les dépendances et la capacité même à retourner HTTP 200 ; ils ne peuvent pas
être traités comme de simples détails techniques.

## Recommended next step

Réviser LAN-005 en ticket provider-agnostic après arbitrage des cinq questions
bloquantes. Si le provider et le contexte doivent rester différés, scinder la
livraison en :

1. un ticket de contrôleur Hono testable par injection ;
2. un ticket de production/versionnement de `PatchContext` ;
3. un ticket de provider concret et de composition runtime.
