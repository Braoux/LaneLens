# Ticket Readiness — LAN-010 — Documenter le retrait d’OpenClaw du runtime LaneLens

**Ticket :** LAN-010  
**Branche inspectée :** `LAN-010`  
**Date :** 24 septembre 2026  
**Type :** Tâche technique — Architecture / Documentation / ADR  
**Readiness Score :** 9,5 / 10  
**Status :** READY

## Summary

Créer `docs/decisions/ADR-001-remplacer-openclaw-runtime.md` avec le statut
`Proposed`. L’ADR doit établir qu’OpenClaw peut rester un outil de développement
ou un provider temporaire, mais ne doit pas être une dépendance runtime obligatoire.
Il doit documenter l’architecture cible par service et provider, la propriété du
contexte de patch par LaneLens, le cache, le benchmark futur et une migration
progressive, sans modifier le code ni le comportement utilisateur.

Le ticket est suffisamment précis pour rédiger et vérifier l’ADR sans inventer de
décision architecturale majeure. Une divergence documentaire avec le cahier des
charges actuel doit être explicitée dans l’ADR, mais ne bloque pas sa création.

## Readiness score

| Dimension | Score | Justification |
|---|---:|---|
| Intent and expected outcome | 2 / 2 | Problème, décision recherchée, livrable et résultat attendu sont explicites. |
| Business rules and behavior | 2 / 2 | Responsabilités, frontières provider/service, contexte de patch, cache et benchmark sont cadrés. |
| Acceptance and verifiability | 2 / 2 | Neuf critères d’acceptation et une Definition of Done permettent une revue objective du document. |
| Scope and dependencies | 1,5 / 2 | Le périmètre documentaire est clair ; la coexistence avec le cahier des charges historique mérite une mention explicite (TR-01). |
| Edge cases and operational completeness | 2 / 2 | Pour un ADR, conséquences, inconvénients, migration, cache et stratégie de modèle couvrent les cas pertinents. |
| **Total** | **9,5 / 10** | |

## Confirmed information

- Le seul livrable demandé est l’ADR versionné à l’emplacement
  `docs/decisions/ADR-001-remplacer-openclaw-runtime.md`.
- Le statut initial obligatoire est `Proposed`.
- OpenClaw peut rester un outil de développement et une implémentation temporaire
  de `MatchupAnalysisProvider`, mais ne doit pas être une dépendance runtime obligatoire.
- Le contrôleur doit dépendre de `MatchupAnalysisService`, lequel dépend de
  `MatchupAnalysisProvider`; le contrôleur ne doit pas connaître OpenClaw.
- Le contrat `MatchupAnalysis` doit rester indépendant du provider et stable pour
  le frontend, `POST /api/matchup`, la Quick Overlay et le cache.
- LaneLens prépare et fournit le contexte de patch. Le LLM n’est pas une source de
  vérité pour le patch courant.
- Le contexte de patch doit être actualisé par patch, mis en cache et réutilisé ;
  une recherche web à chaque analyse est exclue.
- Les analyses doivent pouvoir être mises en cache avec une clé déterministe fondée
  au minimum sur le patch et les quatre champions dans leurs rôles respectifs.
- Le modèle de production sera choisi ultérieurement par benchmark ; le choix et
  l’exécution de ce benchmark sont hors périmètre.
- La migration doit rester progressive et permettre temporairement un provider OpenClaw.
- Aucun provider, endpoint, cache, benchmark, déploiement ou changement UI ne doit
  être implémenté dans LAN-010.
- Aucun code runtime ne doit être modifié.

## Existing system context

- La branche active est `LAN-010` et aucun fichier `docs/decisions/` n’existe encore ;
  l’identifiant `ADR-001` ne collisionne donc avec aucun ADR constaté.
- `server/openclaw.ts` et `server/prompt.ts` sont des modules vides réservés à de
  futurs travaux. Le runtime livré ne contient aucune intégration OpenClaw.
- Le backend expose uniquement `GET /api/health`; `POST /api/matchup` et
  `GET /api/patch` ne sont pas encore implémentés.
- `docs/cahier-des-charges.md` décrit encore directement le flux backend → OpenClaw,
  les erreurs OpenClaw et OpenClaw comme moteur d’analyse du MVP.
- `docs/architecture.md` décrit correctement le code actuellement livré et précise
  qu’aucun appel OpenClaw n’est implémenté.

## Assumptions

- **ASM-01 —** LAN-010 crée uniquement l’ADR demandé. Il ne met pas à jour le
  cahier des charges, l’architecture courante, le README ou les variables d’environnement.
- **ASM-02 —** L’exemple d’interface provider est conceptuel : l’ADR peut employer
  des types non encore implémentés sans créer de fichiers TypeScript.
- **ASM-03 —** La source de vérité exacte du patch sera définie par un ticket futur.
  LAN-010 doit documenter la responsabilité de LaneLens, pas choisir ni implémenter
  cette source.
- **ASM-04 —** Le passage de `Proposed` à `Accepted` est un processus ultérieur ;
  l’approbateur et le mécanisme de validation n’ont pas à être définis pour créer l’ADR.

## Findings

### TR-01 — Articulation avec la documentation historique non explicitée

**Severity:** IMPORTANT

**Observed:**  
Le cahier des charges actuel affirme qu’OpenClaw constitue le moteur d’analyse,
que le backend lui transmet directement le prompt et que le MVP appelle OpenClaw.
LAN-010 demande un ADR `Proposed` qui remplace cette cible par une abstraction provider.

**Missing or unclear:**  
Le ticket ne demande pas de modifier les documents historiques et ne précise pas
si l’ADR proposé les remplace immédiatement, les complète, ou ne les remplacera
qu’après son passage à `Accepted`.

**Why it matters:**  
Sans mention de précédence, les futurs tickets peuvent rencontrer deux références
architecturales contradictoires. Le risque porte sur la lecture de la documentation,
pas sur la capacité à produire le livrable LAN-010.

**Question / action required:**  
Non bloquant pour LAN-010. Dans l’ADR, identifier le cahier des charges comme la
conception initiale et préciser qu’un ADR `Proposed` documente la cible proposée ;
prévoir l’alignement des documents historiques lors de l’acceptation ou dans un
ticket documentaire séparé.

### TR-02 — La migration ne doit pas supposer une intégration déjà livrée

**Severity:** MINOR

**Observed:**  
Le plan proposé commence par « isoler l’intégration actuelle », puis créer un
`OpenClawProvider`. Dans le dépôt inspecté, OpenClaw n’est pas intégré : le module
correspondant est vide et `/api/matchup` n’existe pas.

**Missing or unclear:**  
Le terme « actuelle » peut désigner l’architecture initialement prévue plutôt que
le code effectivement livré.

**Why it matters:**  
L’ADR doit rester factuel et ne pas faire croire qu’un couplage runtime existe déjà.

**Question / action required:**  
Non bloquant. Présenter les étapes comme une trajectoire applicable à
l’intégration temporaire planifiée ou future, et distinguer explicitement l’état
du dépôt de l’architecture initialement envisagée.

## Acceptance criteria assessment

### Clear

- **AC1 — ADR créé :** chemin exact et nom de fichier fournis.
- **AC2 — Décision explicite :** rôle futur d’OpenClaw défini sans ambiguïté.
- **AC3 — Architecture cible :** service, provider et interdiction du couplage
  contrôleur/OpenClaw explicités.
- **AC4 — Migration progressive :** six étapes et maintien temporaire d’OpenClaw fournis.
- **AC5 — Provider indépendant :** invariants externes à préserver listés.
- **AC6 — Données de patch :** LaneLens est explicitement responsable du contexte.
- **AC7 — Cache :** composition minimale de la clé et exemple donnés.
- **AC8 — Benchmark :** décision reportée et critères de comparaison détaillés.
- **AC9 — Aucun changement fonctionnel :** absence de fonctionnalité runtime et
  de modification utilisateur explicitement exigée.

### Missing or ambiguous

- Aucun critère d’acceptation bloquant ne manque.
- La normalisation exacte de la clé de cache, le format complet de
  `MatchupAnalysisInput`, le provider API retenu, la source précise du patch et le
  corpus de benchmark sont volontairement laissés aux futurs tickets.
- L’alignement des documents historiques n’est pas exigé par les critères actuels
  et constitue le point non bloquant TR-01.

## Scope

### Known scope

- Créer un unique ADR en Markdown avec les sections minimales imposées.
- Décrire la décision, l’architecture cible, les responsabilités, le cache, les
  modèles, la migration, les conséquences et les éléments non impactés.
- Conserver `Status: Proposed`.
- Documenter les travaux futurs sans les implémenter.

### Out of scope

- Implémentation ou suppression d’un provider.
- Modification de `/api/matchup` ou migration de LAN-004.
- Appel direct à OpenAI, Anthropic ou un autre fournisseur.
- Cache effectif, benchmark, déploiement ou changement UI.
- Toute modification du code runtime.

### Unclear scope

- Mise à jour immédiate ou ultérieure des documents historiques contradictoires
  avec la décision proposée (TR-01).

## Dependencies

- Aucune dépendance externe ou secret n’est nécessaire pour produire l’ADR.
- Le choix du provider direct, la source de vérité du patch, le contrat détaillé
  d’entrée et le benchmark sont des décisions futures non bloquantes.
- Les futurs tickets de migration dépendront de l’acceptation de l’ADR, mais leur
  création n’est pas un prérequis à sa rédaction en statut `Proposed`.

## Questions requiring clarification

### Blocking

Aucune.

### Non-blocking

1. L’acceptation de l’ADR devra-t-elle déclencher la mise à jour du cahier des
   charges existant, ou cette synchronisation fera-t-elle l’objet d’un ticket séparé ?
2. Quel rôle ou quelle personne validera ultérieurement le passage de `Proposed`
   à `Accepted` ?

## Suggested clarifications

- Ajouter une phrase indiquant que l’ADR décrit une cible proposée et qu’il ne
  remplace les prescriptions historiques contradictoires qu’une fois accepté.
- Préciser que « intégration actuelle » désigne l’intégration OpenClaw planifiée
  ou temporaire, car elle n’est pas encore présente dans le dépôt inspecté.
- Prévoir explicitement l’alignement du cahier des charges parmi les suites de
  l’acceptation de l’ADR, sans l’ajouter au périmètre runtime de LAN-010.

## Readiness decision

**Status:** READY

**Reason:**  
Le livrable, son emplacement, son statut, son contenu minimal, la décision à
documenter, les invariants et les exclusions sont tous vérifiables. Les deux
écarts relevés concernent la cohérence documentaire et la formulation de l’état
existant ; ils peuvent être traités dans l’ADR sans modifier son orientation ni
inventer de décision produit ou technique.

## Recommended next step

Rédiger directement l’ADR LAN-010 en respectant le statut `Proposed` et en
distinguant clairement l’état actuel du dépôt de l’architecture cible. Aucun
Conceptual Analysis ni Technical Design séparé n’est nécessaire pour ce ticket
strictement documentaire.
