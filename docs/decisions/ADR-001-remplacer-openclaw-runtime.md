# ADR-001 — Rendre OpenClaw remplaçable dans le runtime LaneLens

- **Date:** 2026-09-24
- **Status:** Accepted

## Contexte

Le cahier des charges initial de LaneLens prévoit qu’OpenClaw soit le moteur
runtime chargé de produire les analyses de matchups :

```text
Frontend
   ↓
Node / Hono
   ↓
OpenClaw
   ↓
LLM
   ↓
MatchupAnalysis
```

OpenClaw facilite le développement, l’expérimentation de prompts et les tâches
d’ingénierie assistées. Son utilisation comme intermédiaire runtime obligatoire
ajouterait cependant au parcours utilisateur des dépendances qui ne sont pas
propres au besoin métier de LaneLens : Gateway et sessions OpenClaw, profils
d’authentification, quotas ou cooldowns associés, disponibilité d’un service
OpenClaw local et contraintes supplémentaires de déploiement.

Le besoin runtime de LaneLens est plus restreint : fournir quatre champions, un
contexte de patch préparé et des instructions d’analyse à un moteur LLM, puis
obtenir un objet `MatchupAnalysis` JSON validé.

## État actuel du dépôt

L’architecture OpenClaw décrite dans le cahier des charges est une architecture
initialement envisagée, pas une intégration déjà livrée.

À la date de cet ADR :

- aucune intégration OpenClaw runtime n’est implémentée ;
- `server/openclaw.ts` et `server/prompt.ts` sont des modules réservés et vides ;
- le backend Hono expose uniquement `GET /api/health` ;
- `POST /api/matchup` n’existe pas ;
- aucune configuration provider n’est consommée par l’application.

Cet ADR intervient avant l’implémentation du moteur d’analyse afin d’éviter
l’introduction d’un couplage direct qu’il faudrait ensuite retirer.

## Problème

Un contrôleur HTTP dépendant directement d’OpenClaw mélangerait trois
responsabilités : le contrat API de LaneLens, l’orchestration métier d’une analyse
et les détails d’un fournisseur d’inférence. Cette dépendance rendrait un
changement de moteur susceptible d’affecter le contrôleur, les erreurs exposées,
le cache, voire les consommateurs du résultat.

Elle rendrait également le fonctionnement de LaneLens dépendant d’un service
conçu d’abord pour assister le développement, alors que le produit doit pouvoir
être déployé et utilisé indépendamment de la machine et des sessions de
développement.

## Décision proposée

OpenClaw peut rester un outil de développement et peut, si cela aide le MVP,
devenir temporairement une implémentation de `MatchupAnalysisProvider`. Il ne
doit toutefois pas être une dépendance runtime obligatoire de LaneLens.

Le backend devra séparer :

1. le contrôleur HTTP, responsable du transport et de la traduction des erreurs ;
2. `MatchupAnalysisService`, responsable du cas d’usage d’analyse ;
3. `MatchupAnalysisProvider`, frontière abstraite avec le moteur d’inférence ;
4. un provider concret, responsable de l’appel à un moteur donné ;
5. la validation du résultat avant qu’un `MatchupAnalysis` soit retourné.

Une dépendance directe est exclue :

```text
Controller
   ↓
OpenClaw
```

La dépendance cible est :

```text
Controller
   ↓
MatchupAnalysisService
   ↓
MatchupAnalysisProvider
```

## Précédence documentaire

Le présent ADR est `Accepted`. Il remplace les prescriptions architecturales
historiques qui présentaient OpenClaw comme moteur runtime direct et obligatoire.
Le cahier des charges reste la référence fonctionnelle du produit, mais
l’intégration du moteur d’analyse est désormais régie par cet ADR.

Les documents principaux ont été alignés lors de LAN-011 afin de généraliser :

- le flux backend vers `MatchupAnalysisService` et `MatchupAnalysisProvider` ;
- la construction d’une entrée destinée à un provider interchangeable ;
- la validation des réponses par LaneLens ;
- les erreurs fonctionnelles du service d’analyse ;
- les critères MVP auparavant spécifiques à OpenClaw.

Toute documentation future doit respecter cette séparation entre contrat produit
et implémentation du provider.

## Architecture cible

```text
Frontend
   ↓
POST /api/matchup
   ↓
Controller Node / Hono
   ↓
MatchupAnalysisService
   ↓
MatchupAnalysisProvider
   ↓
Provider LLM concret
   ↓
validation
   ↓
MatchupAnalysis
```

### Contrôleur HTTP

Le contrôleur reçoit la requête, valide son format, appelle le service et produit
la réponse HTTP. Il ne connaît ni OpenClaw, ni un SDK LLM, ni un modèle précis.

### `MatchupAnalysisService`

Le service orchestre le cas d’usage : préparation de l’entrée, récupération du
contexte LaneLens nécessaire, consultation éventuelle du cache, invocation du
provider et validation du résultat. Il dépend du contrat provider, jamais d’une
implémentation concrète.

### `MatchupAnalysisProvider`

Le provider traduit une entrée LaneLens vers le moteur choisi et retourne un
résultat conforme au contrat attendu. Les détails d’authentification, de timeout,
de retry et de protocole restent encapsulés dans l’implémentation concrète ou
dans son infrastructure dédiée.

### Validation

Une réponse du moteur n’est pas considérée comme un `MatchupAnalysis` valide sur
la seule déclaration du provider ou du LLM. LaneLens valide le JSON et son contrat
avant de l’exposer au frontend ou de le placer dans un cache d’analyse valide.

## Rôle futur d’OpenClaw

OpenClaw peut continuer à être utilisé pour :

- le développement et la maintenance du projet ;
- le Ticket Readiness, l’analyse de code et l’architecture ;
- la production de documentation ;
- l’expérimentation et l’évaluation de prompts.

Si OpenClaw est utile pendant le MVP, il peut être encapsulé dans un
`OpenClawProvider` temporaire respectant la même frontière que les autres
providers. Aucune couche métier, aucun contrôleur et aucun consommateur ne doit
alors dépendre de ses concepts de Gateway, session ou profil.

Un utilisateur doit pouvoir générer une analyse lorsque le provider runtime
sélectionné n’utilise pas OpenClaw. OpenClaw est donc un outil de développement
ou une implémentation interchangeable, pas une condition de fonctionnement du
produit.

## Abstraction provider

La frontière conceptuelle attendue est équivalente à :

```ts
interface MatchupAnalysisProvider {
  analyze(
    input: MatchupAnalysisInput
  ): Promise<MatchupAnalysis>;
}
```

Des implémentations futures peuvent inclure :

- `OpenClawProvider` ;
- `OpenAIProvider` ;
- `AnthropicProvider` ;
- `LocalProvider`.

Cette liste est illustrative. Cet ADR ne sélectionne ni n’implémente aucun de
ces providers.

`MatchupAnalysisInput` représente une entrée préparée par LaneLens, pas une
requête brute du frontend. Elle pourra notamment contenir les quatre champions,
le patch retenu, le contexte de ce patch et les instructions versionnées utiles
à l’analyse. Son schéma détaillé relève d’un futur ticket de conception.

Le contrat `MatchupAnalysis` reste indépendant du provider. Remplacer une
implémentation ne doit pas imposer de modification au :

- frontend ;
- contrat public de `POST /api/matchup` ;
- contrat `MatchupAnalysis` ;
- composant Quick Overlay ;
- mécanisme de cache applicatif ;
- reste des consommateurs du service d’analyse.

## Gestion du contexte de patch

Le LLM n’est pas une source de vérité pour le patch courant. LaneLens est
responsable de déterminer, préparer, versionner et fournir le contexte utilisé
pour une analyse.

Ce contexte pourra combiner :

- les données statiques pertinentes de Data Dragon ;
- les données associées au patch courant ;
- du contexte statique maintenu par LaneLens.

La version technique Data Dragon ne doit pas être assimilée automatiquement au
patch joueur. La source de vérité exacte du patch et la méthode de construction
du contexte seront décidées dans un ticket ultérieur.

LaneLens doit privilégier une préparation par patch :

```text
nouveau patch
     ↓
actualisation du contexte LaneLens
     ↓
validation et mise en cache
     ↓
réutilisation pour les analyses du patch
```

Une recherche web ne doit pas être effectuée pour chaque analyse. La préparation
en amont réduit le coût, la latence, les dépendances externes et la variabilité
entre deux générations portant sur le même contexte.

## Cache des analyses

L’architecture doit permettre de mettre en cache une analyse validée à partir
d’une clé déterministe comprenant au minimum :

1. le patch ;
2. le carry allié ;
3. le support allié ;
4. le carry adverse ;
5. le support adverse.

Exemple conceptuel :

```text
26.19:ziggs:galio:jinx:swain
```

L’ordre des rôles fait partie de l’identité du matchup : permuter une équipe ou
un rôle produit une autre clé. Le cache appartient à LaneLens et ne dépend pas
du mécanisme de session ou de cache d’un provider.

La normalisation exacte des identifiants et les dimensions supplémentaires
nécessaires — par exemple version du contrat, du prompt ou de la stratégie de
génération — seront définies avec l’implémentation du cache. Cet ADR n’impose ni
stockage, ni durée de vie, ni politique d’invalidation.

## Stratégie de modèles

Le choix du provider et du modèle de production est reporté à un benchmark
séparé. Les providers candidats devront recevoir les mêmes entrées et être
évalués sur un corpus représentatif de matchups.

Le benchmark comparera au minimum :

- la pertinence tactique ;
- l’exactitude des interactions entre sorts ;
- la gestion de wave ;
- la qualité des fenêtres de trade ;
- la qualité du résumé Early / Mid / Late ;
- le respect du contrat JSON ;
- la latence ;
- le coût.

Le choix visera le modèle le moins coûteux dont la qualité est jugée suffisante
selon des critères définis dans le ticket de benchmark. Cet ADR ne fixe ni seuil,
ni corpus, ni modèle gagnant.

## Plan de migration

La trajectoire tient compte du fait qu’aucune intégration OpenClaw runtime
n’existe actuellement.

### Étape 1 — Introduire la frontière d’analyse

Lors de l’implémentation du moteur, créer `MatchupAnalysisService` et
`MatchupAnalysisProvider` avant tout branchement à un moteur concret. Le
contrôleur dépend dès l’origine du service.

### Étape 2 — Encapsuler l’éventuel usage MVP d’OpenClaw

Si OpenClaw est retenu temporairement pour le MVP, l’intégrer exclusivement sous
la forme d’un `OpenClawProvider`. Ne pas propager ses types, sessions ou erreurs
spécifiques dans les couches métier.

### Étape 3 — Ajouter un provider API direct

Implémenter ultérieurement un provider utilisant directement une API LLM, par
exemple `OpenAIProvider`, derrière la même abstraction.

### Étape 4 — Comparer les providers

Exécuter les providers candidats sur le même corpus de référence et comparer
qualité, conformité JSON, latence et coût.

### Étape 5 — Changer le provider runtime par défaut

Basculer vers le provider API direct lorsque le benchmark, la sécurité, le coût
et les contraintes produit le permettent. Ce changement ne doit pas modifier le
contrat exposé aux consommateurs.

### Étape 6 — Retirer les dépendances OpenClaw inutiles

Supprimer les configurations, dépendances et chemins runtime propres à OpenClaw
une fois qu’aucun provider actif n’en dépend. Son usage comme outil de
développement peut continuer indépendamment.

## Conséquences positives

- Le runtime comporte moins de services obligatoires.
- Le produit dépend moins de la machine et des sessions de développement.
- Un déploiement multi-utilisateur ou cloud est plus simple à concevoir.
- Les coûts, quotas et rate limits du provider peuvent être contrôlés directement.
- Le provider peut être remplacé sans modifier le contrat produit.
- Le cache d’analyse et le contexte de patch restent sous la responsabilité de
  LaneLens.
- Les providers peuvent être évalués sur une frontière commune.
- L’architecture permet un provider local ou de secours sans refonte des
  consommateurs.

## Inconvénients et responsabilités nouvelles

LaneLens devra prendre en charge, directement ou via son infrastructure dédiée :

- l’authentification auprès du provider ;
- la protection et la rotation des secrets côté serveur ;
- les timeouts et les retries ;
- la traduction des erreurs API ;
- la validation stricte des réponses ;
- le choix et la configuration du modèle ;
- le suivi des coûts et des quotas ;
- un éventuel mécanisme de fallback ;
- la préparation, la fraîcheur et la traçabilité du contexte de patch.

L’abstraction ajoute également une couche de conception et de tests. Elle ne doit
pas masquer les différences réelles entre providers : les capacités, limites et
erreurs propres à chacun devront être adaptées explicitement à la frontière
LaneLens.

Ces coûts sont acceptés au regard de la simplicité du cas d’usage runtime et du
bénéfice d’une dépendance remplaçable.

## Éléments non impactés

Cette décision ne remet pas en cause :

- Vite et TypeScript pour le frontend ;
- Node.js et Hono pour le backend ;
- Data Dragon comme source de données statiques ;
- le Champion Picker ;
- le contrat fonctionnel de `MatchupAnalysis` ;
- la Quick Overlay ;
- les fonctionnalités produit décrites dans le cahier des charges.

Elle concerne uniquement la façon dont le backend obtiendra à terme une analyse
LLM. Elle n’ajoute dans LAN-010 aucun endpoint, provider, cache, benchmark,
configuration, comportement utilisateur ou modification du code runtime.

## Décisions différées

Les sujets suivants nécessitent des tickets séparés :

- le schéma exact de `MatchupAnalysisInput` ;
- l’implémentation du service et de l’interface provider ;
- le choix de la source de vérité du patch ;
- la stratégie de stockage et d’invalidation du cache ;
- le corpus, les seuils et le protocole du benchmark ;
- le choix du provider et du modèle par défaut ;
- les politiques de retry, fallback, observabilité et maîtrise des coûts ;

## Alternatives considérées

### Conserver OpenClaw comme dépendance runtime directe

Cette option réduit le travail d’intégration initial, mais couple le parcours
utilisateur aux services, sessions et contraintes d’OpenClaw. Elle est rejetée
comme architecture cible.

### Appeler directement un SDK LLM depuis le contrôleur

Cette option évite une abstraction, mais déplace le couplage vers le fournisseur
dans la couche HTTP et complique les tests, le cache et les changements de modèle.
Elle est rejetée.

### Choisir immédiatement un provider définitif

Cette option figerait une décision avant comparaison sur le besoin réel de
LaneLens. Elle est différée au benchmark.
