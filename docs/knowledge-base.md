# Knowledge Base gameplay

LAN-032 ajoute une base de connaissances atomiques et versionnées au pipeline d’analyse existant. Elle reste un module TypeScript du monolithe et ne déclenche aucun scraping ni appel réseau pendant une analyse.

## Flux runtime

```text
Data Dragon + mécaniques de confiance + connaissances relues
  → StaticKnowledgeRepository
  → KnowledgeResolver (4 champions, patch, phase, budget)
  → OFFICIAL FACTS / DERIVED MECHANICS / HEURISTICS / MATCHUP OBSERVATIONS
  → provider LLM
  → AnalysisConformanceValidator
```

`KnowledgeRepository` isole le stockage. Le provider ne reçoit que des instructions sérialisées et ne dépend jamais du repository.

## Modèle et validation

Une entrée conserve notamment son type, son sujet (`champion`, `ability`, `interaction` ou `lane_concept`), ses champions, tags, phases, portée structurelle ou patch-dependent, confiance, statut, mode de vérification et sources.

La validation du dataset impose les règles suivantes :

- un fait officiel vérifié automatiquement doit avoir une source Riot ;
- un fait dérivé automatique doit référencer des faits vérifiés et une règle de dérivation validée ;
- une heuristique ou observation vérifiée exige une validation humaine ;
- une proposition issue d’un LLM ne peut jamais être `verified` ;
- les IDs sont uniques et les dépendances doivent être résolubles.

Les mécaniques déjà exploitées par `StaticGameplayContextResolver` sont stockées dans une source canonique commune sous `server/knowledge/data/trusted-mechanics.ts`. Le contexte Data Dragon complet reste projeté séparément dans le contexte composite pendant la migration : la KB enrichie ne le duplique pas.

## Sélection et fallback

Le resolver exclut les candidates, les patchs incompatibles, les phases hors sujet et les champions absents du matchup. Une observation de matchup n’est injectée que si tous ses participants sont présents. Un budget (24 entrées par défaut) borne le contexte.

La couverture vaut `full`, `partial` ou `none`, avec le nombre de champions couverts et d’entrées injectées. **En V1, cette couverture est une couverture par champion : `full` signifie que chacun des quatre champions possède au moins une connaissance pertinente sélectionnée. Elle ne signifie pas que toutes les capacités, mécaniques ou interactions possibles du matchup sont couvertes ni automatiquement vérifiables.** Une couverture partielle ou nulle n’empêche jamais l’analyse. L’absence d’une entrée ne prouve pas l’absence d’une mécanique.

Conséquence importante : une analyse peut être `success` avec une couverture `full` tout en contenant une erreur factuelle sur une capacité qui n’est pas suffisamment modélisée par les faits structurés disponibles. Le chantier [LAN-042 (#92)](https://github.com/Braoux/LaneLens/issues/92) suit l’évolution de cette métrique vers une distinction plus explicite entre couverture champion, capacité et mécanique.

## Conformité et observabilité

Le validateur continue d’utiliser le contexte gameplay Data Dragon et peut également rattacher une contradiction à un fait structuré via `knowledgeId` et `subject`. Les heuristiques ne créent pas de règle bloquante.

Les violations exposent une catégorie stable : `ABILITY_NOT_AVAILABLE`, `INVALID_ABILITY_EFFECT`, `IMPOSSIBLE_INTERACTION`, `INVALID_TIMING`, `KNOWLEDGE_CONTRADICTION` ou `OTHER`. Les logs corrèlent couverture et rejets avec le `requestId`, sans écrire le prompt.

## Évaluation avant/après

Une évaluation sans `--knowledge-base-version` compose explicitement le pipeline pré-KB. Pour activer la KB V1 :

```powershell
npm run eval:gameplay -- --corpus "evaluation/corpus/lan-032-corpus-v1.json" --knowledge-base-version lan-032-kb-v1
```

Le launcher Windows demande explicitement **Baseline pré-KB** ou **Évaluation avec Knowledge Base** pour chaque nouveau run. En mode KB, il résout la sélection localement et affiche le nombre de matchups à couverture non nulle/nulle avant toute confirmation ou consommation de tokens. Une sélection intégralement à `none` est refusée.

Un run n’est post-KB que si son `run.json` contient une `knowledgeBaseVersion` non nulle effectivement chargée. Un nom de dossier ou une intention opérateur ne suffit pas. Cette valeur reste immuable pendant une reprise.

Les résultats conservent la couverture. Les revues humaines peuvent distinguer `factualErrors` et `strategicIssues` (`questionable`, `poor`, `dangerous`), que le résumé agrège séparément. Une fois les deux runs complets :

```powershell
npm run eval:compare -- --before <pre-kb-summary.json> --after <post-kb-summary.json>
```

La comparaison calcule les taux de rejet, erreurs factuelles et problèmes stratégiques sans inventer de seuil de succès.
Elle vérifie également le protocole : `before` doit être pré-KB et `after` doit porter une version KB réelle, sinon elle échoue avant de produire un rapport.
