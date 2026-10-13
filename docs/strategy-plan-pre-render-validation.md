# Validation pré-render du Strategy Plan

## Statut

Le validateur pré-render contrôle un `MatchupStrategyPlan` avant tout rendu vers
`MatchupAnalysis`. Il appartient uniquement au pipeline expérimental. Aucune
route HTTP ou vue utilisateur ne l'appelle.

## Audit d'intégration B2

B2 fournit déjà :

- un contrat strict et versionné ;
- trois états de grounding ;
- un contexte déterministe dérivé du `MatchupFactPack` ;
- une validation de structure, patch, participants, références et provenance ;
- une génération structured-output provider-agnostic ;
- une CLI d'inspection et des fixtures sans provider.

La dépendance manquante était volontaire :
`semanticSupportValidation` restait à `not-evaluated`. C1 complète cette couche
sans créer de deuxième représentation des faits ou de deuxième taxonomie
mécanique.

## Architecture

```text
Strategy Plan non fiable
        ↓
StrategyPlanValidator (B2)
        ↓
adaptation textuelle sans rendu
        ↓
AnalysisConformanceValidator existant
        ↓
contrôle de pertinence fact ↔ assertion
        ↓
StrategyPlanPreRenderResult
```

`StrategyPlanPreRenderValidator` reconstruit le contexte gameplay uniquement
depuis le Fact Pack reçu. Les assertions sont projetées vers les champs textuels
déjà compris par `AnalysisConformanceValidator`. Les chemins sont ensuite
remappés vers le contrat Strategy Plan.

Cette projection réutilise les contrôles mécaniques existants : ownership, slot,
nom, disponibilité par niveau, effets, ciblage, interactions, cooldown reset,
valeurs exactes, lethal et contradictions avec les mécaniques connues.

Le pipeline historique et le validator final ne sont pas modifiés.

## Résultats par assertion

Chaque assertion reçoit un statut :

- `supported` : références valides, facts pertinents et aucun défaut mécanique
  détecté par les règles déterministes prises en charge ;
- `invalid` : contradiction mécanique, mauvaise référence ou grounding invalide ;
- `insufficient` : interaction ou propriété non démontrable avec les contrôles
  et facts disponibles ;
- `not-applicable` : recommandation stratégique ne revendiquant pas de preuve
  mécanique.

`supported` ne signifie pas que la stratégie est optimale. Il signifie seulement
que les propriétés mécaniques reconnues ne contredisent pas les facts cités.

Une recommandation conditionnelle comme « avancer après que Leona a raté E »
reste admissible en `strategic-only`. Le validateur ne décide pas si cette action
est universellement optimale.

## Pertinence des références

L'existence d'un `factId` n'est pas suffisante. C1 exige également une relation
déterministe entre le texte et chaque fact cité :

- capacité nommée par son nom canonique ;
- association explicite champion + slot, ou slot + champion ;
- interaction KB dont les champions sont effectivement mentionnés ;
- statement global explicitement repris, lorsque des global facts existeront.

Une référence valide mais sans relation démontrable produit
`FACT_NOT_SUPPORTING_ASSERTION`.

Une capacité avec `coverage.status = partial`, une assertion déclarée
`insufficient` ou un warning mécanique non résolu bloque le rendu avec un état
insuffisant. L'absence de contradiction n'est jamais utilisée comme preuve quand
la source mécanique elle-même est incomplète.

## Diagnostics

Chaque diagnostic contient :

- `code` stable ;
- `path` exact dans le plan ;
- `rule` stable ;
- `factIds` concernés ;
- `reason` ;
- `category` ;
- `severity` ;
- `repairable`.

Les codes et catégories mécaniques de `AnalysisConformanceValidator` sont
réutilisés. C1 ajoute seulement :

- `FACT_NOT_SUPPORTING_ASSERTION` ;
- `INSUFFICIENT_MECHANICAL_SUPPORT` ;
- les catégories transversales `STRUCTURE`, `REFERENCE`, `GROUNDING` et
  `INSUFFICIENT_SUPPORT`.

Les incohérences de matchup, patch, forme globale ou provenance sont marquées
non réparables par une correction d'assertion. Les erreurs localisées sont
préparées pour le repair ciblé du lot suivant.

## Inspection

La commande fixture exécute maintenant la validation pré-render complète :

```powershell
npm run eval:strategy-plan -- --corpus evaluation/corpus/lan-061-golden-v1.json --id L61-G06 --fixture tests/fixtures/strategy-plan-l61-g06.json
```

Aucun appel provider n'est effectué dans ce mode.

## Limites connues

- Le validateur est déterministe mais ne comprend pas toute la sémantique libre.
- Une formulation non reconnue reste insuffisante plutôt que prouvée.
- La pertinence d'un fact est volontairement conservatrice et lexicale.
- La qualité tactique d'une recommandation n'est pas évaluée.
- Les facts globaux restent structurellement supportés mais sont encore vides.
- Les incohérences stratégiques inter-champs non mécaniques ne sont pas bloquées.

Ces limites ne doivent pas être contournées en assouplissant les contrôles. Le
repair ciblé doit conserver le même validateur et la même politique de rejet.

