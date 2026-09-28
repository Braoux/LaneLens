# Technical Design — LAN-032 Knowledge Base gameplay structurée

**Status:** Draft  
**Source:** GitHub issue #51 — LAN-032  
**Ticket:** LAN-032  
**Technical readiness:** Ready for implementation

## Summary

Étendre le contexte gameplay existant en Knowledge Base structurée sans créer de second pipeline. La V1 reste dans le monolithe Node/TypeScript, avec stockage statique versionné. Un `KnowledgeRepository` expose les connaissances vérifiées et un `KnowledgeResolver` sélectionne le sous-ensemble pertinent pour les quatre champions et le patch. `MatchupAnalysisService` transmet ensuite le contexte au prompt et au `AnalysisConformanceValidator`.

## Requirements

### Business requirements

- Distinguer `official_fact`, `derived_fact`, `heuristic`, `matchup_observation`.
- Conserver provenance, confiance, validation et portée patch/structurelle.
- Injecter uniquement les connaissances pertinentes.
- Réutiliser la connaissance pour génération et conformité.
- Mesurer sur 100 matchups fixes/versionnés, dont ~25 sentinelles revues humainement.
- Séparer `factual_error` et `strategic_issue` (`questionable`, `poor`, `dangerous`).
- Supporter une KB partielle sans bloquer l'analyse.
- Déduire le roster V1 du corpus (~20–30 champions).

### Invariants

- Un candidat LLM n'est jamais automatiquement `verified`.
- Un `official_fact` Riot fiable peut être vérifié automatiquement.
- Un `derived_fact` ne l'est que si ses sources sont vérifiées et sa règle de dérivation validée.
- `heuristic` et `matchup_observation` nécessitent validation humaine en V1.
- Absence de connaissance ≠ négation d'une mécanique.
- Faible couverture KB ≠ blocage.
- Les heuristiques ne deviennent pas automatiquement des règles bloquantes.
- Aucun scraping web synchrone pendant une analyse.

### Technical constraints

- Monolithe Node.js/TypeScript/Hono conservé.
- Pas de vector DB, microservice ou DB obligatoire en V1.
- Réutiliser `StaticGameplayContextResolver → prompt → provider → AnalysisConformanceValidator`.
- Le provider reste indépendant du stockage KB.
- Filtrer les données patch-dependent sur le patch demandé.
- Borner le contexte envoyé au LLM.

## Existing architecture

```text
POST /api/matchup
 → PatchContextResolver
 → MatchupAnalysisService
 → StaticGameplayContextResolver
 → buildMatchupAnalysisInstructions
 → MatchupAnalysisProvider
 → validateMatchupAnalysis
 → AnalysisConformanceValidator
 → AnalysisLanguageValidator
```

`StaticGameplayContextResolver` charge Data Dragon et applique `TRUSTED_MECHANICS` et les exceptions de disponibilité. Le validateur exploite déjà ce contexte pour disponibilité, association champion/sort, effets, targeting, interactions, cooldowns, valeurs exactes et cohérence temporelle. LAN-032 enrichit donc cette voie au lieu d'en créer une seconde.

## Scope

### In scope

- Modèle KB, stockage statique V1, repository, resolver ciblé.
- Migration/réutilisation Data Dragon et trusted mechanics.
- Enrichissement prompt et validator.
- Couverture observable et rejets catégorisés.
- Corpus/runner d'evaluation reproductible.
- Tests unitaires et d'intégration.

### Out of scope

- Microservices, DB/vector DB, embeddings, fine-tuning, scraping runtime.
- Couverture exhaustive du roster.
- Modification obligatoire du contrat frontend.
- Remplacement du provider.

## Proposed design

Créer `server/knowledge/`. Le contexte Data Dragon existant reste exploité. Les connaissances enrichies sont statiques et validées. Pendant la migration, `ResolvedKnowledgeContext` contient un `GameplayContext` compatible avec le validateur actuel plus les connaissances typées et la couverture.

```text
Data Dragon + trusted mechanics + curated KB
                    ↓
            KnowledgeRepository
                    ↓
             KnowledgeResolver
                    ↓
        ResolvedKnowledgeContext
          ↙                    ↘
GameplayContext            Knowledge facts
     ↓                          ↓
Validator                 Prompt builder
          ↘                    ↙
             MatchupAnalysisService
                    ↓
                 Provider
```

## Components

### KnowledgeEntry
**Type:** Domain data model  
**Status:** New  
**Responsibility:** connaissance atomique, typée, traçable et filtrable.

Champs V1 : `id`, `type`, `subject`, `statement`, `championKeys`, `abilitySlots?`, `tags`, `phases?`, `scope`, `patch?`, `confidence`, `status`, `sources`, `derivedFrom?`, `derivationRuleId?`.

Validation : patch obligatoire si patch-dependent ; `derivedFrom` obligatoire pour derived fact ; IDs uniques ; références résolubles ; candidates exclues du runtime normal.

### StaticKnowledgeRepository
**Type:** Repository de lecture  
**Status:** New  
**Responsibility:** charger/valider les entrées statiques et les rendre filtrables.  
**Dependencies:** dataset KB + validation de schéma.

Une interface `KnowledgeRepository` est justifiée pour isoler le stockage et tester le resolver.

### KnowledgeResolver
**Type:** Domain/application service  
**Status:** New  
**Responsibility:** sélectionner un contexte compact pour quatre champions + patch.

Sélection V1 :
1. `status=verified`;
2. structural ou patch compatible ;
3. lié à au moins un des quatre champions ;
4. matchup observations seulement si leurs participants sont présents ;
5. priorité official → derived → heuristic → matchup observation ;
6. déduplication par id ;
7. budget explicite de connaissances.

Sortie : `ResolvedKnowledgeContext` avec gameplay context, connaissances par type et `KnowledgeCoverage`.

### StaticGameplayContextResolver
**Type:** Existing resolver  
**Status:** Modified / progressivement absorbé  
**Responsibility:** conserver la résolution mécanique Data Dragon pendant la migration. `TRUSTED_MECHANICS` et `ATYPICAL_AVAILABILITY` doivent être migrés/projetés sans créer deux vérités indépendantes.

### MatchupAnalysisService
**Type:** Application service  
**Status:** Modified  
**Responsibility:** orchestrer KB → prompt → provider → validation. Une KB enrichie partielle ne provoque pas d'échec.

### buildMatchupAnalysisInstructions
**Type:** Prompt builder  
**Status:** Modified  
**Responsibility:** sérialiser clairement `OFFICIAL FACTS`, `DERIVED MECHANICS`, `HEURISTICS`, `MATCHUP OBSERVATIONS`, en rappelant qu'une absence d'information n'autorise pas une affirmation négative.

### AnalysisConformanceValidator
**Type:** Domain validator  
**Status:** Modified  
**Responsibility:** conserver les contrôles déterministes et consulter les faits structurés vérifiés. Une heuristic seule ne crée pas une violation mécanique bloquante.

### KnowledgeCoverage
**Type:** Observability value object  
**Status:** New

```ts
interface KnowledgeCoverage {
  readonly status: 'full' | 'partial' | 'none';
  readonly coveredChampions: number;
  readonly totalChampions: 4;
  readonly relevantKnowledgeCount: number;
}
```

Interne en V1.

### Evaluation runner
**Type:** Offline tooling  
**Status:** New  
**Responsibility:** exécuter le corpus versionné avec configuration identifiée et produire baseline/comparaison. Hors chemin HTTP.

## Execution flow

```text
POST /api/matchup
 → PatchContextResolver.resolve(patch)
 → MatchupAnalysisService.analyze(input)
 → KnowledgeResolver.resolve(4 champions, patch)
 → ResolvedKnowledgeContext
 → buildMatchupAnalysisInstructions(...)
 → Provider.analyze(...)
 → validateMatchupAnalysis(...)
 → AnalysisConformanceValidator.validate(...)
 → Language validation
 → 200 MatchupAnalysis
```

Sans connaissance enrichie, le resolver conserve le contexte mécanique disponible et retourne `partial`/`none` sans bloquer.

## Data model

Organisation proposée :

```text
server/knowledge/
  types.ts
  KnowledgeRepository.ts
  StaticKnowledgeRepository.ts
  KnowledgeResolver.ts
  validation.ts
  data/
    knowledge.ts
    derivation-rules.ts
```

Les règles de dérivation validées ont un identifiant afin de tracer chaque derived fact.

## Persistence changes

Aucune DB/migration SQL. Les données KB et le corpus sont versionnés dans Git et relus comme du code.

## API changes

Aucun changement obligatoire de `POST /api/matchup`. La couverture reste interne en V1. Aucun endpoint public supplémentaire.

## Business rule placement

| Rule / invariant | Technical owner | Enforcement |
|---|---|---|
| candidat LLM jamais auto-verified | validation/import KB | promotion explicite |
| official Riot auto-verifiable | validation KB | provenance autorisée |
| derived auto-verifiable sous conditions | validation KB | sources + règle validées |
| heuristic/observation validées humainement | dataset/review | status verified |
| candidate exclu runtime | Repository/Resolver | filtre status |
| patch obsolète exclu | KnowledgeResolver | filtre patch |
| absence ≠ négation | Resolver + prompt | fallback + instruction |
| faible couverture non bloquante | MatchupAnalysisService | aucun échec coverage |
| heuristic non bloquante | ConformanceValidator | séparation faits/heuristics |

## Transactions

Aucune transaction : dataset runtime en lecture seule.

## Concurrency

Repository/résolver immuables et partageables entre requêtes. Le runner limite sa concurrence selon les quotas provider ; pas de verrou distribué.

## Idempotency

La résolution KB est déterministe pour `champions + patch + dataset version`. Les générations LLM ne le sont pas ; aucun retry automatique ajouté.

## Error handling

- Dataset invalide / derivedFrom inconnu / patch-dependent sans patch : erreur de validation du dataset.
- Champion sans KB enrichie : fallback, pas d'erreur.
- Candidate : ignorée au runtime.
- Provider indisponible : comportement existant.
- Réponse non conforme : comportement existant.
- Contradiction avec fait vérifié : violation de conformité catégorisée.

## External integrations

Data Dragon reste une source préparée, pas un appel runtime. Groq/Gemini/OpenAI ne changent pas de contrat. Aucun scraping runtime.

## Security and authorization

Pas de nouvelle auth. Aucun secret/donnée utilisateur dans la KB.

## Observability

Logger : `knowledgeCoverageStatus`, `knowledgeCoveredChampions`, `knowledgeRelevantCount`, version KB, codes de violation, `requestId`. Ne pas logger le prompt complet.

Evals : accept/reject rate, catégories, factual errors, strategic issues, couverture, provider/model/prompt/KB/corpus versions.

## Testing strategy

### Unit tests
- schéma et politique verified ;
- derivedFrom ;
- patch/structural ;
- exclusion candidates ;
- sélection champion/matchup ;
- déduplication, couverture, budget ;
- fallback partial/none.

### Integration tests
- contexte KB injecté au prompt ;
- provider indépendant du stockage ;
- validator utilise les faits structurés ;
- partial coverage atteint le provider ;
- contradiction vérifiée rejetable ;
- heuristic seule non bloquante.

### API tests
- contrat `POST /api/matchup` inchangé ;
- erreurs existantes compatibles ;
- request ID/logs corrélables.

### Evaluation tests
- exactement 100 matchups versionnés ;
- ~25 sentinelles ;
- roster dérivable ;
- fixtures hors couverture ;
- runner baseline/comparaison.

## Migration and compatibility

1. Modèle/repository sans modifier le pipeline.
2. Import/projection des trusted mechanics/exceptions.
3. KnowledgeResolver.
4. Adaptation service/prompt.
5. Adaptation validator.
6. Suppression des duplications seulement après non-régression.

Le contrat HTTP et `MatchupAnalysis` restent inchangés. Pour les evals avant/après, la composition doit permettre de désactiver l'enrichissement KB sans dupliquer le pipeline.

## Failure and rollback

Rollback simple vers le resolver/prompt actuels : aucune migration DB ni rupture API. Dataset et code de schéma sont livrés ensemble.

## Technical decisions

### TD-01 — Étendre le pipeline existant
**Decision:** enrichir le pipeline actuel, pas de second moteur.  
**Reason:** résolution gameplay/prompt/validator existent déjà.  
**Alternative:** pipeline KB parallèle.  
**Consequence:** migration progressive, non-régression indispensable.

### TD-02 — Stockage statique versionné V1
**Decision:** KB dans le repository.  
**Reason:** dataset V1 limité et relu humainement.  
**Alternatives:** PostgreSQL/vector DB.  
**Consequence:** modifications via commit/review/déploiement ; repository abstrait pour évolution future.

### TD-03 — Résolution déterministe sans embeddings
**Decision:** filtrage champions/patch/type/tags/phases.  
**Reason:** suffisant pour ~20–30 champions V1.  
**Alternative:** vector search.  
**Consequence:** explicable, testable, peu coûteux.

### TD-04 — Contexte composite transitoire
**Decision:** `ResolvedKnowledgeContext` contient un `GameplayContext` compatible + nouvelles connaissances.  
**Reason:** éviter une réécriture simultanée massive du validator.  
**Alternative:** remplacement immédiat.  
**Consequence:** représentation transitoire à simplifier plus tard.

### TD-05 — Couverture observable mais non publique
**Decision:** backend/logs/evals uniquement en V1.  
**Reason:** nécessaire à la mesure, pas encore à l'UX.  
**Alternative:** badge frontend.  
**Consequence:** aucun changement API.

### TD-06 — Evals hors runtime
**Decision:** runner offline.  
**Reason:** reproductibilité, coût, absence d'abus.  
**Alternative:** endpoint d'eval.  
**Consequence:** aucune surface API supplémentaire.

## Risks

### R-01 — Deux sources de vérité gameplay
**Severity:** HIGH  
**Risk:** contradiction entre trusted mechanics/Data Dragon et KB.  
**Mitigation:** migration/projection unique, pas de saisie indépendante du même fait.

### R-02 — Mauvaise connaissance vérifiée
**Severity:** HIGH  
**Risk:** erreur systématique influençant génération et validation.  
**Mitigation:** provenance, politique de promotion, tests, review humaine, sentinelles.

### R-03 — Surcharge prompt
**Severity:** MEDIUM  
**Mitigation:** budget resolver + métriques + tests de pertinence.

### R-04 — Variance LLM dans les evals
**Severity:** MEDIUM  
**Mitigation:** enregistrer provider/model/config/dataset/corpus et répéter si nécessaire.

### R-05 — Baisse artificielle du reject rate
**Severity:** MEDIUM  
**Risk:** analyses plus vagues plutôt que meilleures.  
**Mitigation:** factual errors + strategic issues + revue humaine des sentinelles.

## Implementation plan

1. Modèle `KnowledgeEntry` + validation.
2. `KnowledgeRepository` + `StaticKnowledgeRepository`.
3. Règles de dérivation + politique verified.
4. Construire/figer les 100 matchups et ~25 sentinelles ; en dériver le roster.
5. Migrer/projeter trusted mechanics, exceptions et Data Dragon sans duplication.
6. Implémenter `KnowledgeResolver` + `KnowledgeCoverage`.
7. Introduire `ResolvedKnowledgeContext`.
8. Adapter `MatchupAnalysisService`.
9. Adapter le prompt par catégories.
10. Adapter le validator aux faits structurés.
11. Ajouter logs de couverture/rejets.
12. Runner d'eval + baseline sans enrichissement KB.
13. Dataset KB V1 du roster.
14. Exécuter comparaison avant/après.
15. Tests hors couverture/non-régression API.
16. Mettre à jour l'architecture après stabilisation.

## Open questions

### Blocking

Aucune.

### Non-blocking

1. Budget exact de connaissances/tokens à calibrer.
2. Nombre de répétitions par matchup selon variance/coût.
3. Format final du rapport d'eval (JSON ou JSON + Markdown).
4. Suppression complète de `StaticGameplayContextResolver` non requise dans LAN-032.

## Readiness

**Ready for implementation:** Yes

**Reason:** invariants tranchés, code existant inspecté, stockage, responsabilités, fallback, migration, observabilité, evals et frontières définis. Les questions restantes sont des calibrages, pas des décisions architecturales majeures.
