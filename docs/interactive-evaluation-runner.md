# Launcher local du runner gameplay

Le launcher Windows permet d’utiliser le runner d’évaluation sans mémoriser les commandes npm ni rechercher manuellement les dossiers de runs.

## Démarrage en trois étapes

1. Installer Node.js `>= 22.13.1 < 25` et les dépendances du projet.
2. Configurer le provider LaneLens dans `.env` comme pour le serveur local.
3. Double-cliquer sur **`run-gameplay-evaluation.cmd`** à la racine du projet.

Le menu propose :

1. une nouvelle évaluation complète ;
2. la reprise automatique du dernier run incomplet ;
3. la sélection numérotée d’un run existant ;
4. les sentinelles uniquement ;
5. un matchup précis, par exemple `LLC-009` ;
6. les informations du dernier run, sans appel provider ni consommation de tokens.

Le fichier `.cmd` ne contient aucune logique d’évaluation ni aucun secret. Il vérifie seulement la présence de Node et de `tsx`, puis démarre `scripts/evaluation/interactive-runner.ts`.

## Corpus et résultats

Le chemin du corpus reste configurable. Le launcher utilise, dans l’ordre :

1. `LANELENS_EVALUATION_CORPUS` si cette variable locale est définie ;
2. le dernier chemin mémorisé localement ;
3. le corpus du dépôt interne voisin lorsqu’il existe dans l’arborescence de développement habituelle ;
4. un chemin demandé interactivement.

Le dernier choix est mémorisé dans `.lanelens-evaluation/launcher.json`. Ce dossier est ignoré par Git : aucun chemin privé ni contenu de corpus n’est versionné.

Les nouveaux runs sont créés dans `.lanelens-evaluation/runs/` par défaut. Un autre dossier peut être défini avec `LANELENS_EVALUATION_RESULTS`. Chaque run obtient un dossier horodaté unique ; un chemin existant est refusé et n’est jamais écrasé.

Pour la reprise et l’affichage d’état, le launcher cherche les runs locaux ainsi que les éventuels dossiers `results/` situés à côté du corpus configuré.

## Préflight et erreurs

Avant toute composition du provider, le launcher vérifie :

- la version Node ;
- les dépendances locales ;
- l’accessibilité et le format complet du corpus ;
- le provider, le modèle et la présence de la variable de clé correspondante ;
- l’accès en écriture au dossier de sortie ou au run repris.

Les valeurs des secrets ne sont jamais affichées. Une erreur de configuration produit un message actionnable puis revient au menu.

La reprise appelle le runner existant avec `--resume`. Elle conserve donc l’identité, les métadonnées et les tentatives du run, et ne rejoue pas les cas terminés.

## Pendant et après l’exécution

Le launcher affiche le nom du run, son provider et son état avant de laisser le runner présenter sa progression. Après une fin normale, il rappelle :

- les cas terminés et restants ;
- les succès et échecs ;
- les chemins de `results.json` et `summary.json`.

Après une interruption, relancer le fichier puis choisir **Reprendre la dernière évaluation incomplète**.

## Validation du launcher

Le smoke test Windows ne compose aucun provider :

```bat
run-gameplay-evaluation.cmd --smoke
```

Les commandes CLI détaillées restent disponibles dans [la documentation du runner](evaluation-runner.md) pour l’automatisation et le diagnostic avancé.
