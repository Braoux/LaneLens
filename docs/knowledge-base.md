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

## Golden truth mécanique

Le golden benchmark ajoute un gate distinct de `KnowledgeCoverage`. Un matchup est
`mechanically fully-covered` uniquement lorsque chacun de ses quatre champions
dispose d'une preuve positive et structurée pour les cinq slots : ownership,
nom, disponibilité, cooldown utile, description mécanique Data Dragon, cast
model des sorts actifs et liste fermée des effets normalisés. Une liste
`effects: []` signifie que la taxonomie normalisée a été relue et ne contient
aucun des effets déclarés par `AbilityEffect`; une propriété absente ne vaut
jamais preuve négative. Les heuristiques et observations de matchup ne sont pas
consultées par ce gate.

La source versionnée
`server/knowledge/data/mechanical-golden-truth.ts` fixe le domaine (8 champions),
le patch corpus `26.19`, le snapshot Data Dragon `16.19.1` et les cinq slots.
Elle ne recopie aucun nom, cooldown ou texte Data Dragon. Les seuls ajouts
curatés vivent dans `TRUSTED_ABILITY_MECHANICS` : cast model et effets que Data
Dragon décrit en prose mais n'expose pas sous forme structurée. Le marqueur
`complete: true` atteste la revue exhaustive de cette taxonomie réduite pour
une capacité; sans ce marqueur, la capacité échoue le gate.

### Audit des huit champions

| Champion | Data Dragon | Mécaniques structurées initiales | Faits KB déjà présents | Manques critiques comblés |
| --- | --- | --- | --- | --- |
| Caitlyn | P/Q/W/E/R, noms, cooldowns, prose | E : dash, slow, directional | E self-peel; heuristique poke/spacing | cast models Q/W/R; root W; fermeture P/Q/R |
| Jinx | P/Q/W/E/R, noms, cooldowns, prose | aucune | modes Q; heuristique scaling | cast models Q/W/E/R; slow W; root E; fermeture P/Q/R |
| Ziggs | P/Q/W/E/R, noms, cooldowns, prose | W/E/R; displacement W; slow E | waveclear; W disengage | cast model Q; fermeture P/Q/R |
| Galio | P/Q/W/E/R, noms, cooldowns, prose | W/E; taunt W; dash/knock-up E | zone W; heuristique engage | cast models Q/R; shield + knock-up R; fermeture P/Q |
| Leona | P/Q/W/E/R, noms, cooldowns, prose | Q/E; stun Q; root/dash E | engage E; heuristiques; observation Morgana | cast models W/R; stun + slow R; fermeture P/W |
| Lux | P/Q/W/E/R, noms, cooldowns, prose | W/E; shield W; slow E | heuristique poke/spacing | cast models Q/R; root Q; fermeture P/R |
| Morgana | P/Q/W/E/R, noms, cooldowns, prose | E : shield, target-ally | observation E contre Leona | cast models Q/W/R; heal P; root Q; slow + stun R |
| Swain | P/Q/W/E/R, noms, cooldowns, prose | W/E; slow W; root/pull E | fenêtre de catch E; heuristique engage | cast models Q/R; heal P/R; slow R; fermeture Q |

Les ajouts sont justifiés par les descriptions Riot déjà versionnées dans le
snapshot : ils rendent explicites le ciblage et les effets nécessaires aux
sentinelles (root, stun, slow, knock-up, displacement, dash, shield, heal), sans
dupliquer les noms, valeurs ou textes sources. Les passifs n'exigent pas de
cast model. Les huit ultimes standard doivent être disponibles au niveau 6.

### Gate et vérification

`MechanicalCoverageGate` renvoie un résultat par champion et par matchup. Un
échec contient des raisons concrètes, par exemple `Jinx E normalized mechanics
not complete` ou `Morgana E cast model missing`. Le runner d'évaluation exécute
ce contrôle immédiatement après le chargement d'un corpus qui déclare
`rules.fullCoverageGate`, avant la configuration du provider et avant tout
appel LLM.

Vérification autonome, sans réseau :

```powershell
npm run eval:golden-coverage
```

Le résultat attendu pour le corpus golden gelé est :

```text
Golden benchmark
10/10 mechanically fully covered
Champions: 8/8
```

Le gate vérifie également que le profil utilise bien le patch `26.19` et le
snapshot Data Dragon `16.19.1`. Toute évolution de ces versions demande une
nouvelle revue explicite de la golden truth; elle ne doit pas être masquée par
une modification silencieuse du corpus gelé.

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
