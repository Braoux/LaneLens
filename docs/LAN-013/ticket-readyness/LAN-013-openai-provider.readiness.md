# Ticket Readiness — LAN-013 — Premier provider LLM OpenAI

**Ticket :** LAN-013  
**Branche inspectée :** `LAN-005`  
**Date :** 24 septembre 2026  
**Type :** Tâche technique — Provider backend / Intégration OpenAI  
**Readiness Score :** 8,5 / 10  
**Status :** READY

## Summary

LAN-013 doit ajouter un premier adapter concret `OpenAIProvider` derrière la
frontière `MatchupAnalysisProvider` livrée par LAN-004. Il utilisera le SDK Node
officiel, la Responses API, un JSON Schema strict, un modèle configurable dont
le défaut est `gpt-6-sol`, un timeout configurable et aucun retry, outil ou état
conversationnel.

Le ticket est cohérent avec ADR-001 et avec le code actuel. La documentation
officielle OpenAI confirme que `gpt-6-sol` prend en charge la Responses API, les
Structured Outputs et `reasoning.effort=medium`. Elle confirme également la
forme `text.format` du JSON Schema strict et l’existence de retries automatiques
dans les SDK, que le ticket demande correctement de désactiver.

Aucun blocage n’empêche l’implémentation. Un point important doit toutefois être
fixé pendant la réalisation : la Responses API stocke les réponses par défaut.
Pour correspondre à l’intention stateless du ticket et éviter une rétention
applicative implicite, l’appel devrait définir explicitement `store: false`.

## Readiness score

| Dimension | Score | Justification |
|---|---:|---|
| Intent and expected outcome | 2 / 2 | Le provider, sa frontière et le flux de validation sont explicites. |
| Business rules and behavior | 1,5 / 2 | Modèle, reasoning, timeout, retries, outils et sorties sont définis ; `store` reste à expliciter. |
| Acceptance and verifiability | 2 / 2 | Les AC et tests attendus fournissent des oracles précis et hors réseau. |
| Scope and dependencies | 2 / 2 | LAN-004/LAN-005 sont disponibles et la composition complète reste correctement différée. |
| Edge cases and operational completeness | 1 / 2 | Refus, absence de sortie, parse, timeout et erreurs sont couverts ; quelques règles de normalisation/configuration restent mineures. |
| **Total** | **8,5 / 10** | |

## Official OpenAI verification

- [`gpt-6-sol`](https://developers.openai.com/api/docs/models/gpt-6-sol) est un
  identifiant de modèle officiel. La page indique la prise en charge de
  `v1/responses`, des Structured Outputs et des niveaux de reasoning dont
  `medium`.
- La documentation [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
  confirme que la Responses API utilise `text.format` avec `type: "json_schema"`,
  `strict: true`, les propriétés requises et `additionalProperties: false`.
- La documentation [Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
  confirme que les SDK officiels ont un timeout configurable et peuvent effectuer
  automatiquement des retries ; LAN-013 doit donc configurer explicitement
  `maxRetries: 0`.
- Le guide [Migration vers Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
  précise que les réponses sont stockées par défaut et que `store: false`
  désactive ce stockage.

## Confirmed repository context

- ADR-001 est accepté et impose une frontière provider remplaçable.
- LAN-004 fournit :
  - `MatchupAnalysisProvider.analyze(request): Promise<unknown>` ;
  - `MatchupAnalysisProviderRequest` avec `input` et `instructions` ;
  - `MatchupAnalysisService`, qui traduit tout rejet provider en
    `ANALYSIS_PROVIDER_UNAVAILABLE` ;
  - la validation runtime et la cohérence du matchup.
- LAN-005 fournit `createApp()` et `POST /api/matchup`, mais `server/index.ts`
  démarre encore volontairement l’application sans dépendances d’analyse.
- Aucun provider concret ou SDK OpenAI n’est actuellement installé.
- `.env.example` ne contient encore que les anciennes variables réservées à un
  éventuel provider OpenClaw.
- Le projet utilise Node.js 22+, TypeScript strict, ESM/NodeNext et le runner de
  tests natif Node via `tsx`.
- Les 56 tests existants passent sans réseau.

## Assumptions

- **ASM-01 —** Le SDK officiel est ajouté comme dépendance serveur ordinaire
  `openai` et verrouillé dans `package-lock.json`.
- **ASM-02 —** Le provider reçoit un client Responses étroit injecté dans ses
  tests ; seul le factory de production construit réellement `new OpenAI(...)`.
- **ASM-03 —** L’entrée est sérialisée de manière déterministe avec
  `JSON.stringify(request.input)` et envoyée comme contenu utilisateur, tandis
  que `request.instructions` est transmis dans le champ `instructions`.
- **ASM-04 —** Le provider extrait `response.output_text`, tente exactement un
  parse JSON et retourne `null` en cas de refus, sortie absente ou parse
  impossible. Il ne corrige aucune donnée métier.
- **ASM-05 —** Un modèle configuré par `OPENAI_MODEL` doit accepter les mêmes
  paramètres Responses, Structured Outputs et reasoning que le défaut ; une
  incompatibilité est une erreur provider, pas une adaptation du cœur métier.

## Findings

### TR-01 — Compatibilité de `gpt-6-sol`

**Severity:** CONFIRMED

La documentation officielle confirme que le modèle existe, utilise l’identifiant
`gpt-6-sol`, expose `v1/responses`, prend en charge Structured Outputs et accepte
`reasoning.effort=medium`. Le modèle proposé est donc techniquement compatible
avec le ticket.

Le choix qualitatif reste correctement présenté comme un défaut initial, et non
comme le résultat du benchmark futur.

### TR-02 — Forme Structured Outputs

**Severity:** CONFIRMED

Le ticket demande le bon mécanisme pour la Responses API :

```ts
text: {
  format: {
    type: 'json_schema',
    name: 'matchup_analysis',
    strict: true,
    schema: { /* ... */ },
  },
}
```

Tous les objets imbriqués devront contenir `additionalProperties: false` et leurs
propriétés devront être requises. Exclure `sources` du schéma initial est cohérent
avec son caractère optionnel dans le contrat métier. La validation LaneLens
reste nécessaire, notamment pour la non-vacuité, la cardinalité de `cheatSheet`
et la cohérence du matchup.

### TR-03 — Stockage implicite des Responses

**Severity:** IMPORTANT

**Observed:**  
Le ticket interdit la mémoire persistante et exige des appels indépendants, mais
ne fixe pas le champ `store`. La Responses API stocke les réponses par défaut.

**Assessment:**  
Ne pas fournir `previous_response_id` ou un identifiant de conversation suffit à
éviter qu’une analyse influence la suivante, mais n’empêche pas la rétention de
la réponse par la plateforme. L’intention stateless et le principe de moindre
conservation sont mieux servis par un choix explicite.

**Recommended amendment:**  
Ajouter aux paramètres obligatoires de chaque appel :

```ts
store: false
```

et vérifier ce champ dans le test « Requête envoyée ».

Cette correction est sûre, localisée et ne nécessite pas un nouvel arbitrage
produit ; elle ne bloque donc pas l’implémentation.

### TR-04 — Désactivation des retries

**Severity:** CONFIRMED

Les SDK OpenAI effectuent normalement des retries automatiques sur certaines
erreurs. Pour respecter AC13, le client ou chaque requête doit fixer explicitement
`maxRetries: 0`. Le timeout doit être fixé à la valeur configurée. Un test du
factory/client doit observer ces deux options plutôt que mesurer 30 secondes en
temps réel.

### TR-05 — Frontière de client injectable

**Severity:** MINOR

Le ticket autorise un client ou transport injecté sans en fixer la forme. Pour
éviter de simuler tout le SDK, l’implémentation peut définir un port étroit
équivalent à :

```ts
interface OpenAIResponsesClient {
  responses: {
    create(params: OpenAIResponseRequest): Promise<OpenAIResponseResult>;
  };
}
```

Le factory de production adapte le SDK officiel à ce port. Cette décision reste
interne au provider et n’affecte aucun contrat LaneLens.

### TR-06 — Normalisation de la configuration

**Severity:** MINOR

Les règles fonctionnelles sont suffisantes, mais les détails suivants ne sont pas
explicitement formulés :

- une clé contenant uniquement des espaces doit être considérée absente ;
- un modèle vide après `trim()` doit utiliser `gpt-6-sol` ;
- le timeout peut être accepté après `trim()`, mais doit représenter uniquement
  un entier strictement positif et sûr ;
- les erreurs de configuration doivent utiliser des messages fixes sans inclure
  les valeurs d’environnement.

Ces règles constituent des choix de validation défensifs naturels et testables,
sans impact architectural.

### TR-07 — Modèle configurable et reasoning fixe

**Severity:** MINOR

`OPENAI_MODEL` autorise une valeur arbitraire alors que le provider transmet
toujours `reasoning.effort=medium` et un JSON Schema strict. Un modèle configuré
qui ne prend pas ces options en charge échouera lors de l’appel.

Ce comportement est acceptable pour LAN-013 : la configuration opérateur doit
choisir un modèle compatible et l’échec est traduit par le service en
`ANALYSIS_PROVIDER_UNAVAILABLE`. Le provider ne doit pas ajouter de fallback ou
modifier silencieusement le niveau de reasoning.

### TR-08 — Refus et extraction de sortie

**Severity:** CONFIRMED

La documentation officielle montre que la sortie Responses est disponible via
`output_text` et qu’un refus peut ne produire aucune sortie structurée. Le ticket
définit correctement le résultat attendu : absence, refus ou JSON non parsable
retournent une valeur invalide contrôlée telle que `null`; le validateur LAN-004
produit ensuite `INVALID_ANALYSIS_RESPONSE`.

Une erreur réseau, timeout, authentification, rate limit ou serveur doit au
contraire rester un rejet du provider afin que `MatchupAnalysisService` la
traduise en `ANALYSIS_PROVIDER_UNAVAILABLE`.

## Acceptance criteria assessment

### Clear and verifiable

- **AC1–AC4 :** interface provider, Responses API, schéma strict et validation
  LaneLens sont directement testables.
- **AC5–AC7 :** modèle par défaut/configuré et reasoning `medium` sont des valeurs
  observables sur le fake client.
- **AC8–AC9 :** entrée complète transmise et absence d’outils sont observables
  dans les paramètres de requête.
- **AC10–AC14 :** secret serveur, erreurs, timeout, retries désactivés et tests
  hors réseau sont suffisamment définis.
- **AC15 :** l’absence de faux resolver est vérifiable par le diff et les imports.
- **AC16 :** commandes projet explicites.

### Missing or ambiguous

Aucun AC bloquant ne manque. Il est recommandé d’ajouter `store: false` au test
de la requête envoyée et de rendre explicites les règles mineures de
normalisation de configuration décrites dans TR-06.

## Scope

### Known scope

- SDK OpenAI officiel, backend uniquement.
- Configuration et validation de `OPENAI_API_KEY`, `OPENAI_MODEL` et
  `OPENAI_TIMEOUT_MS`.
- Adapter `OpenAIProvider` derrière `MatchupAnalysisProvider`.
- Responses API avec Structured Outputs stricts.
- Reasoning `medium`, aucun outil, aucun retry, timeout configurable.
- Extraction/parse sans correction métier.
- Tests unitaires avec client injecté et zéro réseau.
- Mise à jour de `.env.example`.

### Out of scope

- Producteur ou récupération réelle de `PatchContext`.
- Composition complète de `createApp()` et fonctionnement réel de la route.
- Frontend, cache, conversations, outils, web search, fallback et benchmark.
- Autres providers ou choix définitif du modèle.

### Unclear scope

Aucun élément bloquant. La rétention (`store`) et les détails de normalisation de
configuration sont localisés au provider/factory.

## Dependencies

- **ADR-001 :** accepté.
- **LAN-004 :** terminé et fournit la frontière/service/validation.
- **LAN-005 :** terminé et conserve la composition runtime optionnelle.
- **LAN-014 :** futur resolver concret et composition complète ; non requis ici.
- **OpenAI SDK Node :** à ajouter comme dépendance de production.
- **Accès réel au modèle :** non requis pour les tests ; sa disponibilité dépendra
  du projet et du niveau d’accès OpenAI au déploiement.

## Questions requiring clarification

### Blocking

Aucune.

### Non-blocking

1. Confirmer l’ajout explicite de `store: false` pour éviter le stockage par
   défaut des Responses.
2. Confirmer que les variables composées uniquement d’espaces sont traitées comme
   absentes.
3. Confirmer qu’un modèle configuré incompatible avec Structured Outputs ou
   reasoning `medium` échoue sans fallback automatique.

## Readiness decision

**Status:** READY

**Reason:**  
Les capacités OpenAI demandées existent et correspondent aux contrats déjà
livrés dans LaneLens. Le ticket fixe la frontière, le modèle, la configuration,
la forme de sortie, le comportement des refus/erreurs et une stratégie de test
hors réseau suffisamment précise. Le seul point important manquant —
`store: false` — peut être appliqué directement conformément à l’intention
stateless sans modifier le périmètre ni demander un choix produit.

## Recommended next step

LAN-013 peut passer en implémentation. Avant le premier appel réel :

1. ajouter `store: false` au contrat de requête et à son test ;
2. créer un loader de configuration pur et testé ;
3. injecter une frontière Responses minimale dans `OpenAIProvider` ;
4. laisser `server/index.ts` et `createApp()` sans composition réelle jusqu’à
   LAN-014.
