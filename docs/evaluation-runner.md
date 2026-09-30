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

Reprendre un run interrompu :

```sh
npm run eval:gameplay -- --corpus evaluation/corpus/lan-032-corpus-v1.json --resume <run-directory>
```

La reprise vérifie le hash et la version du corpus, le patch, le provider et le
modèle. Elle conserve l’identité et les paramètres initiaux, ignore les cas
terminés et continue les cas `in_progress`. `--resume` ne se combine pas avec
`--output`, `--sentinels` ou `--id`.

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
par défaut est de **2000 ms** entre deux matchups :

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

Lors d’une reprise, la valeur de `run.json` est immuable. Le runtime doit charger exactement cette version ; une baseline ne peut pas devenir post-KB et un run KB ne peut pas être repris sans sa version.

Seuls les rate limits sont retentés automatiquement. Après un HTTP 429 :

1. `retry-after` Groq est utilisé lorsqu’il est présent ;
2. sinon, le runner applique un backoff exponentiel borné avec un petit jitter ;
3. chaque tentative est persistée avant l’attente suivante ;
4. après épuisement, le cas devient `rate_limited` et le corpus continue.

Les quotas Groq ne sont jamais hardcodés. Les métadonnées conservées sont
limitées à `retry-after` et aux headers `x-ratelimit-*` documentés. Aucun header
d’authentification n’est écrit.

## Résultats

Chaque répertoire de run contient :

- `run.json` : identité du corpus, hash, commit Git, provider, modèle, mode,
  timestamps, délai, tentatives et `knowledgeBaseVersion` ;
- `results.json` : input de chaque matchup, statut, analyse réussie, erreur
  métier contrôlée, violations de conformité, couverture KB, éventuelle revue
  qualité et tentatives provider ;
- `summary.json` : totaux, cas évaluables gameplay, statuts, retries, latences,
  sentinelles, catégories de rejet, couverture et classification qualité.

Statuts terminaux :

- `success` : analyse valide et évaluable ;
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
