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

Le renderer final, la validation sémantique pré-render et le repair du Strategy
Plan restent hors périmètre.

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

B2 implémente uniquement le premier niveau. Chaque assertion expose donc
`semanticSupportValidation = not-evaluated`. Un plan référentiellement valide ne
doit jamais être présenté comme une preuve de correction mécanique ou tactique.

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

## Limites et phase C

La phase C devra traiter, sans confondre les responsabilités :

- la validation sémantique du support entre texte et facts ;
- le repair ciblé d'assertions invalides ou insuffisantes ;
- le renderer contraint vers `MatchupAnalysis` ;
- la validation mécanique pré-render du résultat complet ;
- la mesure de qualité et de coût avant toute activation utilisateur.

Risques encore ouverts : une référence valide peut être hors sujet, une stratégie
peut être médiocre malgré des facts exacts et `insufficient` peut nécessiter une
politique produit avant rendu. Aucun de ces risques n'est masqué par le statut B2.

