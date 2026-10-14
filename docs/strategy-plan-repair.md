# Repair ciblé du Strategy Plan

## Statut

`TargetedStrategyPlanRepairService` est un composant métier expérimental du
backend. Il corrige les assertions rejetées par le validateur pré-render sans
modifier le pipeline HTTP actuel ni le composant historique de repair des
`MatchupAnalysis`.

## Flux

```text
MatchupStrategyPlan
        ↓
StrategyPlanPreRenderValidator
        ↓ invalid
sélection des chemins réparables
        ↓
StructuredOutputProvider
        ↓
fusion limitée aux chemins demandés
        ↓
même validation pré-render
```

Le nombre de passes fonctionnelles est explicite : `0`, `1` ou `2`. Le service
s'arrête dès que le plan est valide. Une erreur non réparable, par exemple un
patch incohérent, interrompt le repair avant tout appel provider.

## Périmètre envoyé au provider

Pour chaque chemin rejeté, la requête contient :

- l'assertion originale ;
- ses diagnostics structurés ;
- les facts autorisés explicitement cités ou liés aux participants concernés ;
- le texte des autres assertions comme contexte de cohérence, sans autorisation
  de les remplacer ;
- le schéma strict du remplacement attendu.

Le provider doit retourner exactement une assertion par chemin demandé. Un
chemin supplémentaire, manquant ou dupliqué rend la réponse invalide. La fusion
reconstruit un nouveau plan et ne touche qu'aux chemins autorisés.

## Validation et traçabilité

Chaque passe conserve :

- les chemins ciblés ;
- le provider et le modèle ;
- les timestamps et la latence ;
- les métadonnées de tokens disponibles ;
- les remplacements proposés ;
- les diagnostics après revalidation ;
- les diagnostics résolus et nouvellement introduits ;
- la distinction entre réponse invalide, rejet mécanique et erreur provider.

Le Fact Pack n'est jamais modifié. Une assertion réparée repasse toutes les
règles du validateur pré-render ; aucune règle n'est désactivée pendant le
repair. Après deux échecs, le plan demeure `invalid`.

Le pipeline complet et le choix du renderer sont décrits dans
[Pipeline fact-grounded expérimental](fact-grounded-pipeline.md).

## Coûts et retries

Une passe de repair représente un appel fonctionnel distinct. Les retries
techniques du provider restent internes à cet appel et ne doivent pas être
comptés comme une nouvelle passe. C2 borne donc le repair à deux appels
fonctionnels maximum par plan, hors génération initiale.

## Limites

- C2 ne répare pas les incohérences globales de schéma, matchup, patch ou
  provenance.
- Le contexte des assertions voisines aide à préserver la cohérence, mais aucune
  évaluation générale de la qualité stratégique n'est prétendue.
- Le repair d'un plan n'autorise pas son rendu : le plan final doit être valide
  avant d'entrer dans le renderer contraint.
- Aucun appel provider n'est déclenché par les tests.
