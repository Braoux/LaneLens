# Runner d’évaluation gameplay

Pour l’usage quotidien sous Windows, voir le [launcher interactif](interactive-evaluation-runner.md) : un double-clic suffit pour lancer, reprendre ou inspecter un run. Les commandes ci-dessous restent la référence pour les développeurs et l’automatisation.

Le runner exécute un corpus JSON externe contre le pipeline métier réel de
LaneLens, sans démarrer Hono et sans appeler `POST /api/matchup`.

```text
corpus JSON
    ↓
VersionedPatchContextResolver
    ↓
MatchupAnalysisService
    ↓
GameplayContextResolver → prompt → provider → validations
    ↓
run.json + results.json + summary.json
```

Il sert à produire des résultats reproductibles avant et après une évolution du
contexte gameplay. Il n’évalue pas automatiquement la qualité stratégique avec
un second LLM.

## Prérequis

- Node.js `>=22.13.1 <25` ;
- dépendances installées avec `npm ci` ;
- un provider LaneLens configuré dans `.env` (`AI_PROVIDER` et sa clé serveur) ;
- un corpus externe conforme au schéma V1.

Le runner utilise exactement la même sélection de provider et de modèle que le
serveur. Il ne démarre aucun serveur HTTP.

DeepSeek est sélectionnable sans modification de code :

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_EVALUATION_TIMEOUT_MS=120000
DEEPSEEK_EVALUATION_TRANSPORT_TIMEOUT_MS=130000
```

`deepseek-v4-pro` peut être utilisé pour un run distinct en modifiant uniquement
`DEEPSEEK_MODEL`. Les runs DeepSeek enregistrent aussi dans `run.json` le format
`json_object`, le mode thinking `enabled` et l’effort `high`. Chaque tentative
conserve sa durée, son statut HTTP/erreur normalisée et, lorsque DeepSeek les
retourne, le request ID provider ainsi que les tokens d’entrée, sortie, total et
raisonnement.

La deadline DeepSeek du runner et son timeout transport sont enregistrés dans
`run.json` avec les autres paramètres de génération. La valeur runner par défaut
est de 120 s et ne dépend pas de la deadline applicative de 90 s. Ces paramètres
sont comparés à la reprise afin de préserver la reproductibilité de la campagne.

## Format du corpus V1

Le corpus de référence V1 est versionné publiquement dans
`evaluation/corpus/lan-032-corpus-v1.json`. En CLI, le chemin reste toujours passé
par `--corpus`, ce qui permet également d’exécuter un corpus alternatif. Le launcher
peut détecter automatiquement le corpus canonique local.

Exemple synthétique :

```json
{
  "schemaVersion": 1,
  "corpusVersion": "1.0.0",
  "patch": "26.19",
  "frozen": true,
  "matchups": [
    {
      "id": "EXAMPLE-001",
      "patch": "26.19",
      "ally": { "carry": "Jinx", "support": "Thresh" },
      "enemy": { "carry": "Caitlyn", "support": "Lux" },
      "tags": ["range", "engage"],
      "sentinel": true,
      "sentinelRationale": "Exemple fictif de cas à relire humainement."
    }
  ]
}
```

Les IDs doivent être uniques. Tous les cas doivent utiliser le patch annoncé à
la racine. Lorsque `rules.expectedMatchups` ou `rules.expectedSentinels` existe,
le nombre réel doit correspondre.

## Commandes

Corpus complet :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json
```

Sentinelles uniquement :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --sentinels
```

Un matchup :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --id EXAMPLE-001
```

Un ID absent provoque une erreur CLI explicite.

Répertoire de sortie explicite :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --output <run-directory>
```

Le répertoire doit être vide. Le runner ne remplace jamais silencieusement un
run existant. Sans `--output`, il crée un répertoire ignoré par Git sous :

```text
.lanelens-evaluation/runs/<timestamp>-<uuid>/
```

Pour conserver des résultats privés hors du dépôt public, toujours fournir un
`--output` situé dans l’espace privé prévu à cet effet.

## Répétitions expérimentales

`--repeat` rejoue volontairement chaque matchup comme une nouvelle observation
indépendante. Sa valeur par défaut est `1` et elle doit être un entier positif :

```sh
npm run eval:gameplay -- --corpus <corpus> --repeat 5
```

Avec 10 matchups et `--repeat 5`, le run contient 50 observations. L'ordre est
**matchup-major** : les répétitions 1 à 5 du premier matchup sont exécutées,
puis celles du deuxième. Une observation reçoit une identité stable telle que
`EXAMPLE-001#3`, ainsi qu'un `matchupId` et un index `repetition` distincts.

Les deux paramètres suivants ont des responsabilités différentes :

- `repeat` = réplication expérimentale produisant une nouvelle observation ;
- `maxAttempts` = retry technique, uniquement à l'intérieur de la même
  observation lorsqu'un rate limit est explicitement reconnu.

Ainsi, une observation peut contenir une tentative rate-limited puis une
tentative réussie sans consommer une répétition supplémentaire.

## Repair ciblé d’un run existant

Le composant métier backend `TargetedAnalysisRepairService` porte le feedback,
la reconstruction ciblée et la revalidation. Il n’est pas branché au parcours
HTTP utilisateur. Le runner de repair ne fait que l’orchestrer pour les
benchmarks et reprend uniquement les observations `invalid_analysis` d’un run
existant. Il ne rejoue jamais leur génération initiale. Pour être
éligible, une observation doit contenir à la fois :

- `candidateAnalysis`, la réponse structurée rejetée ;
- `violations`, les diagnostics exacts du validator.

Le launcher Windows accessible par `run-gameplay-evaluation.cmd` expose ce
runner de deux façons : **Réparer un run terminé**, ou repair automatique après
un nouveau run avec un choix explicite entre désactivé, une passe et deux passes.
Même dans ce second cas, le repair démarre seulement après la fin du run initial
et conserve ses propres artefacts ; il ne modifie pas `results.json`.

Le préflight est local et ne configure pas le provider :

```sh
npm run eval:repair -- --source <run-directory> --preflight-only
```

S’il manque une candidate ou ses violations, la commande liste chaque
observation concernée et l’ignore. Les autres analyses invalides restent
réparables et le benchmark continue normalement. Le repair est bloqué sans
appel provider uniquement lorsque **aucune** analyse invalide n’est réparable.
Les observations ignorées et leurs données manquantes sont conservées dans
`repair-run.json`, et leur nombre apparaît dans `repair-summary.json`.

Les anciens artefacts créés avant la conservation de `candidateAnalysis` ne
peuvent donc pas être réparés artificiellement, mais ils ne bloquent pas les
observations complètes du même run.

Nouvelle expérimentation, avec une seule passe de repair :

```sh
npm run eval:repair -- --source <run-directory> --output <repair-directory> --max-repairs 1
```

Expérimentation avec au plus deux passes :

```sh
npm run eval:repair -- --source <run-directory> --output <repair-directory> --max-repairs 2
```

Une reprise conserve le même run source et les mêmes bornes :

```sh
npm run eval:repair -- --source <run-directory> --resume <repair-directory>
```

Pendant une nouvelle expérimentation comme pendant une reprise, le repair
réutilise le loader du runner principal. Le terminal affiche en direct le
spinner, le pourcentage, le compteur terminé/total, l'observation courante,
la passe de repair et la tentative technique. Les observations déjà terminées
comptent immédiatement dans le pourcentage lors d'une reprise.

Les responsabilités sont distinctes :

- `maxRepairs` = nombre maximal de corrections expérimentales d’une candidate
  encore invalide ;
- `maxAttempts` = retries techniques d’une même passe, réservés aux rate
  limits explicitement reconnus.

Le feedback contient les codes, catégories et chemins exacts des violations,
ainsi que les facts KB fiables directement associés lorsqu’ils existent. Le
provider retourne un contrat complet, mais LaneLens ne recopie que les champs
signalés par le validator. Tous les autres champs proviennent de la candidate
précédente. La candidate reconstruite repasse ensuite les validateurs de
structure, de conformité et de langue inchangés.

Le répertoire de repair contient :

- `repair-run.json` : hashes des artefacts source, corpus, commits, provider,
  modèle, paramètres, version KB, bornes et timestamps ;
- `repair-results.json` : candidate originale, appels intermédiaires,
  réponses rejetées, violations successives et résultat final ;
- `repair-summary.json` : comparaison sans repair / une passe / deux passes,
  récupérations, échecs techniques, violations corrigées/restantes,
  régressions, appels, tokens et latence additionnelle.

Le coût reste absent lorsque le projet ne possède pas de tarif provider fiable
et versionné. Les tokens et le nombre d’appels permettent alors de calculer le
coût a posteriori sans inventer une estimation.

Reprendre un run interrompu :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --resume <run-directory>
```

La reprise vérifie le hash et la version du corpus, le patch, le provider, le
modèle, les paramètres de génération, la golden truth et le nombre de
répétitions. Elle conserve l’identité et les paramètres initiaux, ignore les
observations terminées et continue les observations `in_progress`. Un
`--repeat` explicitement différent est refusé. `--resume` ne se combine pas
avec `--output`, `--sentinels` ou `--id`.

## Progression en temps réel

Dans un terminal interactif, le runner affiche une seule ligne animée et la
réécrit pendant toute l’exécution :

```text
⠹  46% · 46/100 · LLC-047 · analyse · tentative 2/3 · 12s
```

La ligne indique le pourcentage de cas terminés, le compteur, le matchup actif,
la tentative provider et le temps écoulé. Pendant un rate limit, elle affiche le
compte à rebours avant la reprise ; pendant le délai préventif, elle affiche le
temps restant avant le cas suivant. Une reprise commence au pourcentage déjà
persisté : les cas terminés ne sont pas recomptés à partir de zéro.

Lorsque la sortie standard est redirigée et n’est pas un TTY, le runner désactive
l’animation et n’écrit qu’à chaque progression du compteur afin de garder des
logs lisibles.

## Rythme et retries

L’exécution est strictement séquentielle (`concurrency = 1`). Le délai préventif
par défaut est de **2000 ms** entre deux observations :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --delay-ms 3000
```

La politique par défaut autorise **3 tentatives** :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --max-attempts 3
```

La baseline pré-KB conserve `knowledgeBaseVersion: null` et compose explicitement
le resolver sans enrichissement KB. Une exécution post-KB active la version
runtime correspondante ; une valeur arbitraire est refusée :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --knowledge-base-version lan-032-kb-v1
```

Avec le launcher Windows, ce choix est obligatoire pour chaque nouveau run et l’argument est construit automatiquement. Le préflight affiche l’état/version KB et calcule localement la couverture de la sélection avant confirmation et avant tout appel provider. Une couverture `none` sur 100 % d’un run annoncé avec KB bloque le lancement.

La couverture affichée par la V1 est **une couverture par champion**, pas une preuve de couverture mécanique exhaustive. Ainsi, `full` (4/4 champions) peut coexister avec des capacités ou interactions insuffisamment structurées pour être rejetées automatiquement en cas d’hallucination. Les sentinelles et la revue humaine restent donc nécessaires pour mesurer les faux verts (`success` mais factuellement incorrects). Voir LAN-042 (#92).

Lors d’une reprise, la valeur de `run.json` est immuable. Le runtime doit charger exactement cette version ; une baseline ne peut pas devenir post-KB et un run KB ne peut pas être repris sans sa version.

Seuls les rate limits sont retentés automatiquement. Après un HTTP 429 :

1. `retry-after` Groq est utilisé lorsqu’il est présent ;
2. sinon, le runner applique un backoff exponentiel borné avec un petit jitter ;
3. chaque tentative est persistée avant l’attente suivante ;
4. après épuisement, le cas devient `rate_limited` et le corpus continue.

Un timeout ou toute autre erreur provider n’est jamais retenté automatiquement :
le cas devient immédiatement `provider_error`. `maxAttempts` ne concerne que les
rate limits explicitement classés comme tels.

Les quotas Groq ne sont jamais hardcodés. Les métadonnées conservées sont
limitées à `retry-after` et aux headers `x-ratelimit-*` documentés. Aucun header
d’authentification n’est écrit.

## Résultats

Chaque répertoire de run contient :

- `run.json` : identité du corpus, hash, commit Git, provider, modèle, paramètres
  de génération utiles, mode, timestamps, délai, retries techniques,
  `repeat`, observations attendues, `knowledgeBaseVersion`, version de golden
  truth et snapshot du mechanical coverage gate ;
- `results.json` : identité de chaque observation (`id`, `matchupId`,
  `repetition`), input, statut, analyse réussie, erreur
  métier contrôlée, candidate et réponse rejetées lorsque disponibles,
  violations de conformité, couverture KB, éventuelle revue
  qualité, couverture mécanique et tentatives provider ;
- `summary.json` : agrégats globaux et par matchup, observations attendues et
  terminées, statuts, taux de succès, stabilité, retries, latences, tokens,
  sentinelles, catégories de rejet, couverture et classification qualité.

`run.json` est l’enveloppe de provenance commune à toutes les observations : il
porte le `runId`, le provider, le modèle, les paramètres de génération, le
patch, les versions du corpus, de la KB et de la golden truth ainsi que leurs
hashes. Chaque nouvelle observation de `results.json` recopie son `runId` pour
former une référence explicite vers cette enveloppe, sans dupliquer ces
métadonnées volumineuses cinquante fois.

Une observation rejetée peut contenir :

- `candidateAnalysis` : analyse structurée complète après validation de forme ;
- `rejectedResponse` : réponse structurée originale, ou texte final brut du
  provider lorsque le JSON n’est pas parsable ;
- `rejectionPhase` : `parsing`, `shape`, `conformance` ou `language` ;
- `violations` : codes, catégories, chemins, sujets et `knowledgeId` disponibles ;
- `languageViolations` : diagnostics linguistiques séparés.

Exemple minimal d’une observation exploitable par le repair :

```json
{
  "runId": "<run-id>",
  "id": "EXAMPLE-001#2",
  "matchupId": "EXAMPLE-001",
  "repetition": 2,
  "status": "invalid_analysis",
  "rejectionPhase": "conformance",
  "candidateAnalysis": { "lanePlan": "...", "matchup": { "patch": "26.19" } },
  "violations": [
    {
      "code": "ABILITY_EFFECT_MISMATCH",
      "category": "INVALID_ABILITY_EFFECT",
      "path": "lanePlan",
      "subject": "Jinx E",
      "knowledgeId": "<fact-id>",
      "severity": "error"
    }
  ]
}
```

Le texte brut conservé est uniquement le contenu final retourné par le modèle :
les headers, clés API, diagnostics SDK, prompts et éventuelles données internes
de raisonnement ne sont jamais inclus. Les snapshots sont écrits atomiquement
après chaque tentative. Un résultat `parsing` reste inspectable, mais il n’est
pas réparable tant qu’aucune candidate structurée et aucune violation ciblable
ne sont disponibles ; le préflight le signale sans relancer la génération.

Ces artefacts peuvent contenir du contenu généré volumineux. Ils doivent rester
dans `.lanelens-evaluation/` ou dans un répertoire privé explicitement choisi,
tous deux hors du dépôt public. Ne copiez pas un `results.json` réel dans un
dossier versionné.

La stabilité par matchup utilise trois états simples :

- `stable_success` : toutes les répétitions sont terminées et réussies ;
- `stable_failure` : toutes les répétitions sont terminées et aucune ne réussit ;
- `unstable` : mélange de succès/échecs ou matchup encore incomplet.

Les moyennes de tokens ne sont produites que lorsque le provider expose ces
métadonnées. Aucun coût n'est inventé lorsqu'aucune donnée tarifaire fiable
n'est disponible.

Statuts terminaux :

- `success` : analyse conforme au contrat et n’ayant déclenché aucun validator bloquant ; ce statut ne constitue pas une certification humaine de l’exactitude factuelle ou stratégique ;
- `invalid_analysis` : sortie invalide ou rejetée par les validators, évaluable
  pour le taux de conformité ;
- `rate_limited` : quota épuisé, non évaluable gameplay ;
- `provider_error` : panne provider non liée à la qualité gameplay ;
- `execution_error` : erreur locale ou contexte de patch indisponible.

Un succès après 429 reste `success`, mais ses tentatives et son retry restent
visibles. Une erreur individuelle n’interrompt pas le corpus. Les snapshots JSON
sont écrits via fichier temporaire puis renommage après chaque tentative et
chaque matchup.

Sous Windows, les remplacements retentent brièvement les erreurs transitoires
`EPERM`, `EBUSY` et `EACCES`. Si `rename` ne peut pas remplacer directement un
snapshot existant, le writer déplace d’abord l’ancien fichier vers une sauvegarde
temporaire, installe le nouveau snapshot, puis supprime la sauvegarde. Si
l’installation échoue, l’ancien snapshot est restauré avant de remonter l’erreur.

Les résultats ne contiennent ni clé API, ni token, ni headers arbitraires, ni
chemin absolu du corpus.

## Revalidation hors ligne

La revalidation rejoue uniquement le validator local sur les analyses déjà
persistées. Elle ne contacte aucun provider et n’écrase pas les artefacts
sources.

```powershell
npm run eval:revalidate -- `
  --source-results "<run-source>\results.json" `
  --repair-results "<run-repair>\repair-results.json" `
  --output "<nouveau-dossier>"
```

`--repair-results` est facultatif. Le dossier de sortie reçoit
`initial-revalidation.json` et, lorsqu’un run de repair est fourni,
`repair-revalidation.json`. Lorsque la commande embarque une revue explicite
des suppressions historiques, elle produit également
`supplemental-removal-review.json`.

Chaque observation de revalidation conserve séparément :

- les violations historiques (`initialViolations`) ;
- les violations produites par le validator courant (`violationsAfter`) ;
- les diagnostics supprimés et nouvellement détectés ;
- les enrichissements de `subject` et `knowledgeId` ;
- la classification revue d'une suppression, lorsqu'elle existe.

Les classifications possibles sont :

- `CONFIRMED_FALSE_POSITIVE` : le diagnostic historique était incorrect ;
- `DIAGNOSTIC_REASSOCIATION` : la même erreur reste détectée, mais avec une
  association canonique plus précise ;
- `LEGITIMATE_DEDUPLICATION` : seul un doublon strict a disparu ;
- `VALIDATOR_REGRESSION` : une erreur réelle n'est plus détectée ;
- `UNDETERMINED` : les éléments persistés ne suffisent pas pour conclure.

Une violation n'est jamais qualifiée de faux positif uniquement parce qu'elle
disparaît après revalidation. Une entrée `UNDETERMINED` reste soumise à une
revue humaine et ne constitue ni une validation positive de la formulation, ni
une autorisation d'assouplir le validator. Le texte original, le diagnostic
historique et la justification sont conservés dans l'artefact de revue afin que
la décision reste auditable.

## Baseline avant Knowledge Base

Pour une baseline réelle, utiliser le provider configuré et un output privé :

1. exécuter les sentinelles et effectuer leur revue humaine ;
2. exécuter ensuite le corpus complet ;
3. conserver le corpus figé et les répertoires de run pour la comparaison future.

Les revues humaines distinguent `factualErrors` des `strategicIssues`, ces derniers
étant classés `questionable`, `poor` ou `dangerous`. Après les deux runs complets :

```sh
npm run eval:compare -- --before <pre-kb-summary.json> --after <post-kb-summary.json>
```

Le comparateur lit aussi le `run.json` situé à côté de chaque summary. Il exige un run `before` avec `knowledgeBaseVersion: null` et un run `after` avec une version non nulle ; deux runs pré-KB ou un `before` déjà enrichi sont refusés. Le nom du dossier n’est jamais une preuve d’activation : « post-KB » signifie que le runtime a réellement persisté une version KB non nulle.

Les tests automatisés utilisent uniquement des providers déterministes hors
réseau et ne consomment aucun crédit.
