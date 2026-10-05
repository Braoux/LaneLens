# Launcher local du runner gameplay

Le launcher Windows permet d’utiliser le runner d’évaluation sans mémoriser les commandes npm ni rechercher manuellement les dossiers de runs.

## Démarrage en trois étapes

1. Installer Node.js `>= 22.13.1 < 25` et les dépendances du projet.
2. Configurer le provider LaneLens dans `.env` comme pour le serveur local. Les
   valeurs acceptées sont `openai`, `gemini`, `groq` et `deepseek`.
3. Double-cliquer sur **`run-gameplay-evaluation.cmd`** à la racine du projet.

Le menu propose :

1. une nouvelle évaluation complète ;
2. la reprise automatique du dernier run incomplet ;
3. la sélection numérotée d’un run existant ;
4. les sentinelles uniquement ;
5. un matchup précis, par exemple `LLC-009` ;
6. les informations du dernier run, sans appel provider ni consommation de tokens.

Le fichier `.cmd` ne contient aucune logique d’évaluation ni aucun secret. Il vérifie seulement la présence de Node et de `tsx`, puis démarre `scripts/evaluation/interactive-runner.ts`.

## Choix pré-KB ou avec KB

Chaque nouveau run demande explicitement l’un des deux modes :

1. **Baseline pré-KB — Knowledge Base désactivée** ;
2. **Évaluation avec Knowledge Base — `lan-032-kb-v1`**.

Aucun défaut silencieux n’est appliqué. Chaque nouveau run demande aussi le
nombre de répétitions expérimentales, avec `1` par défaut. Avant confirmation,
le launcher affiche le corpus, le mode de sélection, le nombre de matchups, les
répétitions, le total d'observations, le provider, le modèle, l’état et la
version KB ainsi que le dossier de résultats. En mode KB, il résout localement
la couverture attendue sur toute la sélection, sans appel LLM. Il bloque le
lancement si tous les matchups ont une couverture `none`.

Lorsqu'un corpus déclare `fullCoverageGate`, le launcher exécute aussi le gate
mécanique sur le corpus complet avant la confirmation et avant tout appel LLM.
Un seul matchup incomplet bloque le run et affiche les mécaniques manquantes.

La confirmation `[o/N]` intervient après ce résumé et avant le démarrage du runner. « Post-KB » ne désigne jamais un dossier nommé manuellement : cela signifie que `run.json` contient une `knowledgeBaseVersion` non nulle réellement chargée par le runtime.

## Corpus et résultats

Le chemin du corpus reste configurable. Le launcher utilise, dans l’ordre :

1. `LANELENS_EVALUATION_CORPUS` si cette variable locale est définie ;
2. le dernier chemin mémorisé localement ;
3. le corpus canonique public `evaluation/corpus/lan-032-corpus-v1.json` ;
4. un chemin demandé interactivement.

Le dernier choix est mémorisé dans `.lanelens-evaluation/launcher.json`. Ce dossier est ignoré par Git : aucun chemin local privé n’est versionné. Le corpus de référence V1, lui, est volontairement versionné dans le dépôt public.

Les nouveaux runs sont créés dans `.lanelens-evaluation/runs/` par défaut. Un autre dossier peut être défini avec `LANELENS_EVALUATION_RESULTS`. Chaque run obtient un dossier horodaté unique préfixé par `pre-kb-` ou `kb-lan-032-kb-v1-` ; un chemin existant est refusé et n’est jamais écrasé.

Pour la reprise et l’affichage d’état, le launcher cherche les runs locaux ainsi que les éventuels dossiers `results/` situés à côté du corpus configuré.

## Préflight et erreurs

Avant toute composition du provider, le launcher vérifie :

- la version Node ;
- les dépendances locales ;
- l’accessibilité et le format complet du corpus ;
- le provider, le modèle et la présence de la variable de clé correspondante ;
- l’accès en écriture au dossier de sortie ou au run repris.
- la compatibilité de la version KB du run avec le runtime local ;
- la couverture locale attendue lorsque la KB est activée.
- le mechanical coverage gate lorsqu'il est requis par le corpus ;
- le nombre positif de répétitions et le total d'observations.

Les valeurs des secrets ne sont jamais affichées. Une erreur de configuration produit un message actionnable puis revient au menu.

La reprise affiche l’état, la version KB et le nombre de répétitions enregistrés,
puis appelle le runner existant avec `--resume`. Elle conserve donc l’identité,
les métadonnées, la version KB, la golden truth, les répétitions et les
tentatives du run, et ne rejoue pas les observations terminées. Il n’existe
aucun choix permettant de transformer une baseline en run KB, de changer
`repeat`, ou de modifier le corpus pendant une reprise.

## Pendant et après l’exécution

Le launcher affiche le nom du run, son provider et son état avant de laisser le runner présenter sa progression. Après une fin normale, il rappelle :

- les observations terminées et restantes ;
- les succès et échecs ;
- les chemins de `results.json` et `summary.json`.

Après une interruption, relancer le fichier puis choisir **Reprendre la dernière évaluation incomplète**.

## Validation du launcher

Le smoke test Windows ne compose aucun provider :

```bat
run-gameplay-evaluation.cmd --smoke
```

Les commandes CLI détaillées restent disponibles dans [la documentation du runner](evaluation-runner.md) pour l’automatisation et le diagnostic avancé.
