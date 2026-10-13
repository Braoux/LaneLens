# Matchup Strategy Plan

## Objectif et statut

`MatchupStrategyPlan` sépare le raisonnement stratégique expérimental des faits
mécaniques déterministes et du futur rendu utilisateur. Le composant est livré
comme brique backend inspectable ; aucune route HTTP, vue frontend ou génération
du parcours utilisateur ne l'appelle actuellement.

Le flux B2 est :

```text
MatchupFactPack déterministe
        ↓
StrategyPlanGenerationContext
        ↓
StructuredOutputProvider
        ↓
MatchupStrategyPlan non fiable
        ↓
validation structurelle et référentielle
        ↓
artefact d'inspection expérimental
```

Le pipeline expérimental complète désormais B2 avec une validation mécanique
pré-render, un repair ciblé et un renderer déterministe contraint.

## Technical Design

### Contrat versionné

Le contrat est défini dans `server/strategy/MatchupStrategyPlan.ts` :

- `schemaVersion = 1` et `planVersion = matchup-strategy-plan-v1` ;
- identité du matchup et patch ;
- lane approach, menace, réponse, fenêtre de trade et condition de victoire ;
- niveaux 1 à 3, plan de vague, cible, post-6 et roam ;
- une `StrategyAssertion` par décision.

Chaque assertion contient :

- `text`, la recommandation lisible ;
- `grounding`, parmi `fact-grounded`, `strategic-only` et `insufficient` ;
- `participantIds`, les champions impliqués avec leur équipe et leur rôle ;
- `factIds`, les faits mécaniques cités ;
- `missingKnowledge`, les connaissances explicitement absentes.

Une recommandation purement stratégique n'est pas forcée à citer un fait.
Inversement, une assertion mécanique `fact-grounded` doit citer au moins un fait
et ne peut masquer une connaissance manquante. `insufficient` permet de conserver
une recommandation non démontrable sans inventer l'interaction manquante.

### Contexte de génération

`buildStrategyPlanContext()` projette le Fact Pack sans appel réseau ni provider.
B2 fournit tous les faits bornés du pack : 20 capacités pour les quatre champions,
les facts KB vérifiés applicables et les éventuels `globalFacts`. Aucun sélecteur
heuristique n'est introduit : sur ce petit domaine, conserver la couverture
mécanique prime sur une économie marginale de tokens.

Le contexte préserve :

- les versions, le matchup et le patch ;
- les équipes, rôles et propriétaires ;
- les noms, slots, disponibilités, cast models et effets ;
- les `factId` et identifiants de provenance ;
- les couvertures partielles et informations manquantes.

Le Fact Pack reçu n'est jamais modifié.

### Provider structuré

`StructuredOutputProvider` est une primitive générique partagée par OpenAI,
Gemini, Groq et DeepSeek. `MatchupAnalysisProvider.analyze()` continue de déléguer
au même adapter avec son schéma historique ; le pipeline de production conserve
donc son comportement et son contrat `MatchupAnalysis`.

`StrategyPlanGenerationService` utilise cette primitive avec le schéma strict du
Strategy Plan. Une réponse non JSON ou invalide produit une erreur explicite. Il
n'existe aucun fallback silencieux ni provider codé en dur dans la couche métier.

## Validation

`StrategyPlanValidator` contrôle :

- la forme stricte, sans propriétés supplémentaires ;
- le matchup et le patch ;
- l'existence et l'unicité des facts et participants ;
- la provenance des facts ;
- l'appartenance du fact au champion et à l'équipe référencés ;
- la cohérence de l'état de grounding ;
- l'explicitation des connaissances manquantes.

Deux statuts restent volontairement distincts :

1. **Reference validation** : le `factId` existe bien dans ce Fact Pack et sa
   référence est cohérente.
2. **Semantic support validation** : le texte est réellement soutenu par les
   facts cités.

B2 expose toujours séparément la validation de référence. Le validateur
pré-render complète désormais ce contrôle avec les règles mécaniques
déterministes existantes et un état explicite `supported`, `invalid`,
`insufficient` ou `not-applicable` par assertion. La qualité tactique reste hors
de ce statut. Voir [Validation pré-render](strategy-plan-pre-render-validation.md).

## Inspection locale

Le mode fixture est déterministe et n'appelle aucun provider :

```powershell
npm run eval:strategy-plan -- --corpus evaluation/corpus/lan-061-golden-v1.json --id L61-G06 --fixture tests/fixtures/strategy-plan-l61-g06.json
```

La sortie JSON contient le plan, les statuts de validation, les faits résolus,
les références invalides et les connaissances manquantes.

La génération provider est toujours explicite :

```powershell
npm run eval:strategy-plan -- --id L61-G06 --generate
```

Elle utilise le provider configuré côté serveur. Aucune commande de test ou de
validation ne déclenche ce mode. `--output <path>` crée un nouvel artefact sans
écraser un fichier existant.

## Extension future des facts globaux

Le plan référence des `factIds` sans supposer qu'ils décrivent nécessairement
une capacité. Il peut donc consommer ultérieurement les `globalFacts` du Fact Pack
pour les objectifs neutres, règles de carte ou mécaniques saisonnières. B2 ne
crée aucune donnée macro, aucune recommandation macro et aucun resolver associé.

## Limites et lots suivants

Le lot suivant devra mesurer la qualité et le coût avant toute activation
utilisateur.

Le repair ciblé est documenté séparément dans
[Repair ciblé du Strategy Plan](strategy-plan-repair.md). Il conserve le même
validateur pré-render, limite les modifications aux chemins rejetés et borne le
nombre de passes à deux.

L'orchestration complète est documentée dans
[Pipeline fact-grounded expérimental](fact-grounded-pipeline.md).

Risques encore ouverts : une formulation mécanique peut dépasser les règles
déterministes reconnues, une stratégie peut être médiocre malgré des facts exacts
et `insufficient` nécessite encore une politique de repair avant rendu. Aucun de
ces risques n'est transformé en validation positive.

