# Ticket Readiness — LAN-004 — Moteur d’analyse derrière un provider remplaçable

**Ticket :** LAN-004  
**Branche inspectée :** `LAN-004`  
**Date :** 24 septembre 2026  
**Type :** Tâche technique — Architecture backend / Intégration  
**Readiness Score :** 9,5 / 10  
**Status :** READY

## Summary

LAN-004 doit créer le cœur backend provider-agnostic du moteur d’analyse :
contrats d’entrée et de sortie, contexte de patch, instructions LaneLens,
frontière `MatchupAnalysisProvider`, orchestration par
`MatchupAnalysisService`, validation runtime, cohérence du matchup et erreurs
génériques. Les tests utilisent uniquement des providers factices, sans endpoint,
réseau, secret ou service LLM réel.

La version révisée résout tous les blocages du précédent passage de readiness.
Les contrats, invariants, règles de validation, comparaisons et scénarios de test
sont désormais suffisamment déterministes pour une implémentation directe.

## Readiness score

| Dimension | Score | Justification |
|---|---:|---|
| Intent and expected outcome | 2 / 2 | Le résultat attendu et la direction des dépendances sont explicites. |
| Business rules and behavior | 2 / 2 | `PatchContext`, l’entrée, les instructions, les erreurs et les invariants sont définis. |
| Acceptance and verifiability | 2 / 2 | Les quinze AC et les scénarios de test fournissent des oracles précis. |
| Scope and dependencies | 2 / 2 | Les prérequis sont satisfaits et les tickets futurs sont nettement séparés. |
| Edge cases and operational completeness | 1,5 / 2 | Les cas limites principaux sont couverts ; deux précisions terminologiques mineures restent non bloquantes. |
| **Total** | **9,5 / 10** | |

## Confirmed information

- ADR-001 est présent avec le statut `Accepted`.
- LAN-011 a aligné la documentation sur la frontière service/provider.
- Le backend actuel expose uniquement `GET /api/health` ; `POST /api/matchup`
  reste réservé à LAN-005.
- Aucun provider concret, y compris OpenClaw, n’est obligatoire dans LAN-004.
- `PatchContext` et `PatchContextFact` possèdent un schéma minimal explicite et
  des règles de validité testables.
- `MatchupAnalysisInput` conserve strictement les quatre rôles positionnels, le
  patch et le contexte préparé par LaneLens.
- Le provider reçoit un `MatchupAnalysisProviderRequest` comprenant l’entrée et
  les instructions LaneLens, puis retourne `Promise<unknown>`.
- Seul le validateur LaneLens peut transformer la donnée non fiable en
  `MatchupAnalysis`.
- Toutes les chaînes obligatoires doivent être non vides après `trim()`.
- `cheatSheet` doit contenir au moins une chaîne non vide ; `sources` est
  facultatif et ses URL éventuelles doivent être absolues en HTTP(S).
- Les champions sont comparés après `trim()` sans tenir compte de la casse, mais
  restent strictement positionnels ; le patch est comparé après `trim()` avec
  égalité exacte.
- Les erreurs sont encapsulées derrière trois catégories LaneLens et ne doivent
  divulguer aucun détail sensible du provider.
- La validation tactique, le provider de production, le contexte réel, le cache,
  l’endpoint et le frontend sont hors périmètre.
- `npm run typecheck`, `npm test` et `npm run build` doivent réussir.

## Existing system context

- Le projet utilise TypeScript strict, ESM/NodeNext côté serveur et le runner de
  tests natif Node via `tsx`.
- Aucune bibliothèque de validation runtime n’est installée ; une validation
  maison ou l’ajout d’une dépendance serveur restent des choix d’implémentation.
- Le script de tests exécute `tests/*.test.ts`.
- Le contrat `MatchupAnalysis` du ticket est aligné avec celui du cahier des charges.

## Assumptions

- **ASM-01 —** Une entrée préparée invalide est rejetée avant l’appel provider ;
  sa représentation interne peut utiliser une erreur LaneLens générique tant
  que LAN-004 n’expose aucun contrat HTTP.
- **ASM-02 —** La traduction HTTP des erreurs et la validation d’une requête
  publique restent réservées à LAN-005.
- **ASM-03 —** Le format textuel exact des instructions est libre, mais les thèmes
  obligatoires doivent être observables dans le test du fake provider.
- **ASM-04 —** Le contrat de `PatchContext` est indépendant de sa source ; ses
  faits pourront être produits ultérieurement à partir de sources choisies par
  LaneLens sans modifier le cœur LAN-004.

## Findings

### TR-01 — Schéma minimal de `PatchContext`

**Severity:** RESOLVED

La révision définit `PatchContext`, `PatchContextFact`, leurs champs obligatoires,
la non-vacuité, la cardinalité minimale et la cohérence entre les deux valeurs de
patch. Le producteur et la source de vérité restent correctement hors périmètre.

### TR-02 — Critères d’une analyse exploitable

**Severity:** RESOLVED

La révision fournit des règles déterministes pour les chaînes, `cheatSheet`,
`goldenRule`, `sources`, les URL, le matchup et le patch. Les tests disposent
désormais d’un oracle complet pour la validation structurelle.

### TR-03 — Frontière entre donnée provider et contrat validé

**Severity:** RESOLVED

`MatchupAnalysisProvider.analyze()` retourne explicitement `Promise<unknown>`.
La transformation en `MatchupAnalysis` appartient exclusivement au validateur
LaneLens.

### TR-04 — Transmission des instructions au provider

**Severity:** RESOLVED

Le contrat `MatchupAnalysisProviderRequest` transporte explicitement `input` et
`instructions`. Un scénario de test vérifie que les thèmes obligatoires sont bien
reçus par le fake provider.

### TR-05 — « Indépendant de Data Dragon » peut être interprété trop largement

**Severity:** MINOR

**Observed:**  
Le ticket indique que `PatchContext` doit rester indépendant de Data Dragon,
alors que l’architecture acceptée permet à LaneLens de préparer le contexte à
partir de sources potentielles, dont Data Dragon.

**Assessment:**  
L’intention paraît être que le **contrat** `PatchContext` reste source-agnostic et
ne contienne aucun type Data Dragon, et non que ses faits ne puissent jamais être
dérivés de Data Dragon. Comme la récupération du contexte est hors périmètre,
cette nuance ne bloque pas LAN-004.

**Suggested wording:**  
« Le contrat `PatchContext` reste indépendant des types et protocoles de Data
Dragon, Riot API, recherche web et providers ; ses sources réelles seront
définies séparément. »

### TR-06 — Catégorie d’erreur d’une entrée préparée invalide

**Severity:** MINOR

**Observed:**  
Le service doit valider l’entrée et refuser notamment un `PatchContext` incohérent,
mais les trois codes nommés couvrent surtout indisponibilité provider, réponse
provider invalide et échec générique.

**Assessment:**  
Le ticket n’expose encore aucun endpoint et autorise `ANALYSIS_FAILED` pour les
échecs non couverts. Le choix est donc implémentable sans modifier le contrat
public, mais devra être explicité avant que LAN-005 traduise les erreurs en HTTP.

## Acceptance criteria assessment

### Clear and verifiable

- **AC1 à AC3 :** frontière `Promise<unknown>`, service découplé et absence de
  couplage OpenClaw directement vérifiables par les types et imports.
- **AC4 et AC5 :** contrats `PatchContext` et `MatchupAnalysisInput` complets.
- **AC6 et AC7 :** instructions transmises explicitement et donnée provider non
  fiable observables dans les tests.
- **AC8 à AC10 :** règles exhaustives de validation, cohérence, golden rule et
  cheat sheet.
- **AC11 :** catégories d’erreur et interdictions de fuite explicites.
- **AC12 à AC14 :** aucun provider concret obligatoire, tests hors réseau et
  absence de nouvel endpoint.
- **AC15 :** commandes de vérification projet explicites.

### Missing or ambiguous

Aucun critère d’acceptation bloquant ou important ne manque. TR-05 et TR-06 sont
des précisions mineures qui n’empêchent ni l’implémentation ni l’acceptation de
LAN-004.

## Scope

### Known scope

- Contrats backend `PatchContext`, entrée, requête provider et sortie.
- Construction et transmission d’instructions provider-agnostic.
- Interface provider et service d’orchestration injecté.
- Validation runtime structurelle et cohérence du matchup.
- Erreurs LaneLens génériques et sûres.
- Tests unitaires hors réseau avec fake/stub providers.

### Out of scope

- Endpoint `/api/matchup`, contrôleur HTTP et intégration frontend.
- Provider concret, modèle de production et benchmark.
- Source, récupération, actualisation, stockage et versionnement effectifs du
  contexte de patch.
- Cache, retry/fallback, observabilité et maîtrise des coûts.
- Évaluation automatique de la qualité tactique.

### Unclear scope

Aucun élément bloquant. Les deux nuances de TR-05 et TR-06 peuvent être réglées
pendant la conception sans élargir le ticket.

## Dependencies

- **ADR-001 :** accepté dans le dépôt inspecté.
- **LAN-011 :** documentation alignée et fusionnée.
- **LAN-005 :** consommateur futur du service ; non requis pour LAN-004.
- **Contexte de patch futur :** producteur non requis ; contrat minimal désormais
  suffisamment stabilisé.
- **Validation runtime :** choix technique libre et non bloquant.
- **OpenClaw :** aucune instance, Gateway, configuration ou credential requis.

## Questions requiring clarification

### Blocking

Aucune.

### Non-blocking

1. Confirmer que « indépendant de Data Dragon » signifie « contrat
   source-agnostic », sans interdire que de futurs faits soient dérivés de cette
   source.
2. Lors de LAN-005, décider si une entrée préparée invalide doit rester
   `ANALYSIS_FAILED` ou recevoir une catégorie dédiée pour sa traduction HTTP.

## Readiness decision

**Status:** READY

**Reason:**  
La révision transforme toutes les ambiguïtés structurantes en règles explicites
et testables. Aucun choix produit ou architectural manquant n’oblige désormais
l’implémentation à inventer un contrat. Les deux remarques restantes sont
mineures, localisées et sans impact sur la réalisation du cœur LAN-004.

## Recommended next step

LAN-004 peut passer directement en implémentation. Une courte conception
technique peut fixer l’organisation des fichiers, la stratégie de validation et
la représentation des erreurs internes, sans nouvelle phase de clarification du
ticket.
