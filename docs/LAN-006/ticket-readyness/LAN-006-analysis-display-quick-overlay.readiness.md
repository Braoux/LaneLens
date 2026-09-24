# Ticket Readiness — LAN-006 — Afficher l’analyse et la Quick Overlay

**Ticket :** LAN-006 révisé après Ticket Readiness  
**Branche inspectée :** `LAN-006`  
**Date :** 24 septembre 2026  
**Readiness Score :** 10 / 10  
**Status :** READY

## Summary

La version initiale avait obtenu 6/10 en raison de deux blocages : aucune source
du patch d’analyse n’était disponible côté frontend et le mapping
`MatchupAnalysis → QuickOverlay` n’était pas déterministe.

La version révisée résout ces points et les ambiguïtés associées :

- `GET /api/analysis-context` fournit le patch et la version du contexte
  réellement sélectionnés côté serveur ;
- les contrats HTTP publics sont partagés entre frontend et backend ;
- le HTTP 200 est validé défensivement avant affichage ;
- le snapshot, le verrouillage et le token de requête empêchent un résultat
  obsolète d’être présenté ;
- le mapping Quick Overlay est défini champ par champ et ne comporte plus de
  section Late artificielle ;
- le Clipboard, le retour à la sélection et la recette responsive ont des
  comportements vérifiables.

Le ticket est prêt pour implémentation sans décision produit ou architecturale
supplémentaire.

## Readiness score

| Dimension | Score | Justification |
|---|---:|---|
| Intent and expected outcome | 2 / 2 | Parcours, états et deux niveaux de lecture explicites. |
| Business rules and behavior | 2 / 2 | Mapping Quick Overlay et Full Analysis entièrement définis. |
| Acceptance and verifiability | 2 / 2 | Oracles HTTP, rendu, Clipboard, requêtes obsolètes et responsive précis. |
| Scope and dependencies | 2 / 2 | LAN-003/004/005/013/014 sont explicitement requis et livrés. |
| Edge cases and operational completeness | 2 / 2 | Patch indisponible, HTTP 200 invalide, erreurs sûres et concurrence couverts. |
| **Total** | **10 / 10** | |

## Confirmed repository context

- ADR-001 est accepté et le frontend reste provider-agnostic.
- LAN-003 fournit la sélection et les portraits.
- LAN-004 fournit `MatchupAnalysis` et sa validation métier backend.
- LAN-005 fournit `POST /api/matchup` et son enveloppe d’erreur sûre.
- LAN-013/LAN-014 fournissent le provider et le contexte versionné `26.19-v1`.
- La version Data Dragon est déjà distinguée du patch d’analyse.
- Les tests utilisent TypeScript et le runner Node ; les fonctions de mapping et
  de validation peuvent être testées sans DOM ni réseau externe.

## Runtime dependency trace

| Étape | État avant LAN-006 | Apport du ticket |
|---|---|---|
| Sélection et portraits | Implémenté | Snapshot immuable utilisé par le chargement et le résultat. |
| Patch d’analyse | Serveur uniquement | `GET /api/analysis-context` et validation frontend. |
| Contrats HTTP | Répartis côté serveur | Module TypeScript partagé. |
| Appel matchup | Endpoint implémenté | Client frontend strict et provider-agnostic. |
| Validation HTTP 200 | Backend uniquement | Garde-fou frontend structure/cohérence. |
| Quick Overlay | Non implémentée | Mapping pur exact, sans Late. |
| Full Analysis | Non implémentée | Sections successives définies. |
| Concurrence UI | Non implémentée | Verrouillage et identifiant monotone. |

## Resolved findings

### TR-01 — Source du patch

**Resolved:** le frontend récupère `patch` et `contextVersion` via
`GET /api/analysis-context`. Il ne tronque ni ne convertit Data Dragon et ne
code pas `26.19` en dur.

### TR-02 — Quick Overlay

**Resolved:** la nouvelle forme retire `late` et mappe explicitement chaque
champ source vers `plan`, `window`, `early`, `mid`, `target` et `goldenRule`.

### TR-03 — Contrat public et validation frontend

**Resolved:** un module partagé contient les contrats HTTP. Le frontend rejette
les JSON 200 incomplets, mal typés ou incohérents sans rendu partiel.

### TR-04 — Réponses obsolètes

**Resolved:** les contrôles sont verrouillés pendant l’appel, le rendu utilise
le snapshot envoyé et un token monotone fait ignorer les réponses non actives.

### TR-05 — Clipboard, sources et nouvelle analyse

**Resolved:** texte copié, durées de feedback, échec sûr, attribut `rel` et
retour sans reload sont définis.

## Acceptance assessment

Tous les critères initiaux et supplémentaires sont clairs et vérifiables. Les
clarifications prévalent correctement sur les anciennes formulations concernant
la Quick Overlay et l’ajout d’un endpoint backend.

## Dependencies

- LAN-003, LAN-004, LAN-005, LAN-013 et LAN-014 : livrés.
- LAN-008 : ultérieur, non bloquant pour l’état d’erreur générique de LAN-006.

## Readiness decision

**Status:** READY

LAN-006 peut être implémenté. Les validations attendues sont : tests unitaires
hors réseau, `npm run typecheck`, `npm test`, `npm run build`, puis recette
navigateur 1440×900 et 390×844.
