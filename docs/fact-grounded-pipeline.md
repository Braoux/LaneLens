# Pipeline fact-grounded expérimental

## Statut

La phase C assemble un pipeline backend expérimental sans modifier la route
`POST /api/matchup`, le frontend ou le pipeline historique. Il n'est activé par
aucun parcours utilisateur.

```text
Matchup
  → MatchupFactPack déterministe
  → génération du MatchupStrategyPlan
  → validation pré-render
  → repair ciblé optionnel (0 à 2 passes)
  → renderer déterministe
  → validator final existant
```

## Choix du renderer

Le renderer est déterministe. Il projette les textes déjà validés dans le
contrat `MatchupAnalysis` et ne fait aucun appel LLM :

- `laneApproach` devient `lanePlan` ;
- les assertions menace/réponse/fenêtre/condition de victoire conservent leur
  texte exact ;
- les niveaux, le plan de vague, le post-6 et le roam sont copiés sans
  reformulation ;
- la cheat sheet réutilise quatre assertions existantes ;
- la golden rule réutilise la condition de victoire ;
- la cible primaire est résolue depuis exactement un `participantId` ennemi de
  `targetPriority`, jamais déduite librement de la prose.

Ce choix ajoute zéro token, zéro coût provider et aucune surface de nouvelle
hallucination. Il produit un style moins varié qu'un second appel LLM, compromis
accepté pour cette phase de fiabilisation.

Le renderer ne traduit pas. Le Strategy Plan doit déjà être produit dans la
locale demandée. Le validator linguistique final rejette une incohérence de
locale au lieu de tenter une traduction libre.

## Double validation

Le renderer refuse un plan qui n'a pas passé
`StrategyPlanPreRenderValidator`. Après projection, il applique encore :

1. la validation runtime du contrat `MatchupAnalysis` ;
2. `AnalysisConformanceValidator` avec le contexte reconstruit exclusivement
   depuis le Fact Pack ;
3. `AnalysisLanguageValidator` avec la locale demandée.

Un plan pré-render valide ne garantit donc jamais l'acceptation du résultat
présenté. Une violation détectée uniquement après rendu reste un rejet final.

## Orchestration et artefact

`ExperimentalFactGroundedPipeline` mesure et retourne dans un seul artefact :

- le Fact Pack et ses versions ;
- le plan initial et sa validation ;
- les tentatives de repair et leurs diagnostics ;
- le rendu et sa validation finale ;
- les erreurs de parsing, provider, validation ou exécution ;
- les latences par étape et la latence totale ;
- les appels provider par étape ;
- les tokens disponibles ;
- les chemins régénérés et diagnostics résolus, persistants ou introduits ;
- les violations initiales, chemins invalides et assertions insuffisantes.

L'estimation de coût reste `null` tant qu'aucune grille de prix fiable n'est
injectée. Une donnée absente n'est pas reconstruite.

## Bornage des appels

Pour une analyse :

- génération initiale du Strategy Plan : 1 appel fonctionnel ;
- repair : 0, 1 ou 2 appels fonctionnels ;
- renderer : 0 appel.

Le maximum est donc de **3 appels fonctionnels provider**. Les retries réseau du
provider restent distincts des passes de repair.

## Inspection hors ligne

Une fixture stable peut traverser tout le pipeline sans provider réel :

```powershell
npm run eval:fact-grounded -- --corpus evaluation/corpus/lan-061-golden-v1.json --id L61-G06 --fixture tests/fixtures/strategy-plan-l61-g06.json
```

Pour simuler jusqu'à deux repairs, ajouter :

```powershell
--max-repairs 2 --repair-fixture <fichier-json-contenant-un-tableau-de-réponses>
```

`--output <path>` écrit l'artefact avec création exclusive et refuse d'écraser
un fichier existant. Cette commande n'instancie aucun provider externe.

## Limites et phase D

- La qualité tactique d'une recommandation valide reste non démontrée.
- Les règles déterministes ne couvrent pas toute la sémantique libre.
- Une cible primaire doit être explicitement reliée à un participant ennemi.
- Les facts globaux restent supportés par le contrat mais ne contiennent pas
  encore de connaissances macro ou saisonnières.
- Aucun taux de réussite V2 n'est annoncé sans benchmark end-to-end séparé.

La phase D devra mesurer le pipeline sur le golden corpus, comparer les sorties
aux baselines historiques et examiner séparément qualité, rejets, repairs,
latence, tokens et coût.
