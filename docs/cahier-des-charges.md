# Cahier des charges — Botlane Matchup Analyzer

## 1. Présentation du projet

### 1.1 Contexte

Lors d'une partie de League of Legends, la connaissance du matchup botlane influence fortement la manière de jouer les premiers niveaux, la gestion de la vague, les fenêtres d'engage et les conditions de victoire de la lane.

L'objectif du projet est de créer une petite application capable de répondre rapidement à une question du type :

**« Comment jouer Ziggs + Galio contre Jinx + Swain ? »**

L'application doit produire un plan de lane concret, directement utilisable pendant la partie, plutôt qu'une simple description générale des quatre champions.

L'analyse est générée par un moteur d'analyse IA appelé par le backend LaneLens
derrière une abstraction `MatchupAnalysisProvider`. Le provider concret reste
remplaçable et ne constitue pas une exigence fonctionnelle du produit.

---

# 2. Objectif du produit

L'utilisateur sélectionne :

* son champion ;
* le champion de son allié ;
* l'ADC adverse ;
* le support adverse.

Il lance ensuite une analyse.

L'application retourne un guide structuré expliquant :

* le plan général de la lane ;
* les principales menaces ;
* comment répondre aux menaces ;
* les fenêtres d'engage ;
* la condition de victoire ;
* la manière de jouer les niveaux 1 à 3 ;
* le plan de wave ;
* la cible prioritaire ;
* les changements après le niveau 6 ;
* les opportunités de roam ;
* une cheat sheet courte utilisable pendant la partie ;
* une règle principale à retenir.

L'objectif est d'obtenir une réponse du même niveau de précision que :

> **Plan de lane : prenez la prio sans perma-crash, faites rebondir la wave, puis cherchez Jinx sur le bounce après un E de Swain raté ou les Chompers de Jinx dépensés. Votre duo gagne par burst court + contrôle, pas par combat prolongé.**

---

# 3. Périmètre du MVP

Le MVP doit volontairement rester petit.

## Fonctionnalités incluses

### Sélection des champions

L'écran principal présente quatre emplacements :

**Notre botlane**

* Carry
* Support

**Botlane adverse**

* Carry
* Support

Chaque emplacement permet de rechercher et sélectionner un champion.

Exemple :

```text
NOTRE BOTLANE

[ Ziggs ▼ ]    [ Galio ▼ ]

CONTRE

[ Jinx ▼ ]     [ Swain ▼ ]

        [ ANALYSER ]
```

Les portraits des champions doivent être affichés.

La liste des champions et les assets peuvent provenir de Data Dragon.

---

### Détection du patch

L'application doit connaître le patch actuellement utilisé pour l'analyse.

Exemple :

```text
Patch : 26.19
```

LaneLens détermine, prépare, versionne et transmet le contexte de patch au moteur
d'analyse. Le LLM n'est pas une source de vérité du patch courant et la version
technique Data Dragon ne doit pas être assimilée automatiquement au patch joueur.

Le numéro de patch ne doit pas être codé en dur.

Une valeur de fallback peut néanmoins être configurée si la récupération automatique échoue.
La source de vérité exacte du patch reste une décision différée.

Le contexte doit être préparé et réutilisé par patch, sans recherche web à chaque analyse :

```text
nouveau patch
     ↓
actualisation du contexte LaneLens
     ↓
validation et mise en cache
     ↓
réutilisation pour les analyses du patch
```

---

### Génération de l'analyse

Lorsque l'utilisateur clique sur :

**Analyser le matchup**

le frontend envoie les quatre champions et le patch au backend.

Exemple :

```json
{
  "allyCarry": "Ziggs",
  "allySupport": "Galio",
  "enemyCarry": "Jinx",
  "enemySupport": "Swain",
  "patch": "26.19"
}
```

Le contrôleur Node / Hono transmet la demande à `MatchupAnalysisService`. Le
service prépare le contexte LaneLens, puis invoque un `MatchupAnalysisProvider`
sans dépendre d'un provider, d'un SDK LLM ou d'un modèle précis.

---

# 4. Format attendu de l'analyse

La réponse IA doit suivre une structure stable afin de pouvoir être correctement affichée graphiquement.

Le provider produit une réponse destinée à respecter le contrat attendu. LaneLens
valide le JSON et le contrat avant de l'exposer au frontend comme
`MatchupAnalysis`. Ce contrat reste indépendant du provider concret.

Exemple de structure :

```ts
interface MatchupAnalysis {
  matchup: {
    allyCarry: string;
    allySupport: string;
    enemyCarry: string;
    enemySupport: string;
    patch: string;
  };

  lanePlan: string;

  threatResponseWindow: {
    threat: string;
    response: string;
    window: string;
    winCondition: string;
  };

  earlyLevels: {
    level1: string;
    level2: string;
    level3: string;
  };

  wavePlan: string;

  targetPriority: {
    primaryTarget: string;
    explanation: string;
  };

  postLevel6: string;

  roamPlan: string;

  cheatSheet: string[];

  goldenRule: string;

  sources?: {
    name: string;
    url?: string;
  }[];
}
```

---

# 5. Affichage du résultat

La page de résultat doit privilégier la lecture rapide.

## Header

```text
ZIGGS + GALIO
      VS
JINX + SWAIN

Patch 26.19
```

Avec les portraits des quatre champions.

---

## Plan de lane

Le premier bloc doit immédiatement répondre à :

**« Qu'est-ce qu'on fait dans cette lane ? »**

Exemple :

```text
PLAN DE LANE

Prenez la prio sans perma-crash, faites rebondir
la wave puis cherchez Jinx lorsque Swain rate E
ou lorsque Jinx dépense ses Chompers.
```

Ce bloc doit être particulièrement visible.

---

# 6. Threat → Response → Window → Win condition

L'interface présente quatre cartes.

```text
┌──────────────┐
│    THREAT    │
│              │
│ Swain E ...  │
└──────────────┘

┌──────────────┐
│   RESPONSE   │
│              │
│ Se décaler...│
└──────────────┘

┌──────────────┐
│    WINDOW    │
│              │
│ Swain E miss │
└──────────────┘

┌──────────────┐
│ WIN CONDITION│
│              │
│ Punir Jinx...│
└──────────────┘
```

Sur desktop les cartes peuvent être alignées.

Sur mobile elles passent les unes sous les autres.

---

# 7. Niveaux 1 à 3

Section :

```text
EARLY GAME

NIVEAU 1
...

NIVEAU 2
...

NIVEAU 3
...
```

L'analyse doit indiquer notamment :

* qui possède théoriquement la priorité ;
* qui souhaite pousser ;
* qui souhaite conserver ses HP ;
* les pouvoirs obtenus lors du niveau 2 ;
* le premier timing d'engage ;
* les sorts adverses importants à surveiller.

---

# 8. Plan de wave

Une section dédiée doit expliquer la gestion recommandée de la vague.

Exemple :

```text
WAVE PLAN

Wave 1
Push contrôlé

        ↓

Wave 2
Pression niveau 2

        ↓

Wave 3
Crash

        ↓

Bounce

        ↓

Kill window
```

Le but n'est pas de calculer précisément chaque minion.

Il s'agit d'expliquer l'état de wave recherché.

---

# 9. Target Priority

L'application doit clairement afficher la cible prioritaire.

Exemple :

```text
TARGET PRIORITY

JINX
★★★★★

Swain
★★
```

Attention : les étoiles représentent ici uniquement une priorité tactique dans la lane, pas une évaluation du champion.

Une formulation encore plus simple peut être :

```text
PRIMARY TARGET
JINX

Éviter d'engager Swain avec toutes ses ressources.
```

---

# 10. Niveau 6+

Une section spécifique explique ce qui change lorsque les ultimes deviennent disponibles.

Exemple :

```text
LEVEL 6+

Swain R
    ↓
DISENGAGE
    ↓
POKE
    ↓
WAIT
    ↓
RE-ENGAGE
```

---

# 11. Roaming

L'analyse doit déterminer dans quelles situations le support peut quitter la lane.

Classification proposée :

```text
ROAM GRATUIT
✓ grosse wave crashée

ROAM ACCEPTABLE
~ ward river + hover rapide

ROAM RISQUÉ
! wave neutre

NE PAS ROAM
✗ mauvais bounce
```

---

# 12. Cheat Sheet

La cheat sheet est conçue pour être consultée rapidement pendant une partie.

Elle doit tenir sur environ un écran.

Exemple :

```text
GALIO + ZIGGS vs JINX + SWAIN

CIBLE
→ Jinx

SWAIN E MISS
→ avance
→ menace E

JINX E DOWN
→ grosse fenêtre

SWAIN R
→ disengage

WAVE
push
→ crash
→ bounce
→ engage

ÉVITER
× engage Swain
× fight prolongé
× E frontal dans Chompers
```

Un bouton :

**Copier la cheat sheet**

permet de copier son contenu dans le presse-papier.

---

# 13. Golden Rule

Chaque analyse doit terminer par une seule règle considérée comme la plus importante.

Exemple :

```text
RÈGLE À RETENIR

Je n'engage pas simplement parce que Jinx est
à portée.

J'engage quand Swain E ou Jinx E vient d'être
consommé.
```

L'objectif est que même un joueur ne lisant pas toute l'analyse puisse repartir avec une information immédiatement exploitable.

---

# 14. Interface graphique

## Direction générale

L'interface doit être :

* sombre ;
* minimaliste ;
* rapide ;
* lisible ;
* inspirée de League of Legends sans chercher à reproduire son client.

Pas d'animations complexes.

Pas de framework UI lourd.

---

## Écran principal

Structure :

```text
┌─────────────────────────────────────────┐
│            BOTLANE MATCHUP              │
│                  26.19                  │
│                                         │
│             NOTRE BOTLANE               │
│                                         │
│       [ Ziggs ]       [ Galio ]         │
│                                         │
│                    VS                   │
│                                         │
│       [ Jinx ]        [ Swain ]         │
│                                         │
│             [ ANALYSER ]                │
└─────────────────────────────────────────┘
```

---

# 15. Sélecteur de champion

Lorsqu'un emplacement est sélectionné :

```text
Choisir un champion

[ rechercher...             ]

Ahri
Akshan
Alistar
Ambessa
Amumu
...
```

La recherche doit fonctionner immédiatement.

Exemple :

```text
jin
```

retourne :

```text
Jinx
```

Chaque résultat affiche :

* portrait ;
* nom du champion.

---

# 16. Architecture technique recommandée

Afin de conserver l'application la plus légère possible :

## Frontend

```text
Vite
TypeScript
HTML
CSS
```

Pas de :

```text
React
Angular
Vue
Next.js
```

pour le MVP.

Ils n'apporteraient pas suffisamment de valeur pour une application aussi petite.

---

## Backend

Petit serveur Node.js TypeScript.

Une solution légère peut être :

```text
Node.js
+
Hono
```

Le backend expose essentiellement :

```text
POST /api/matchup
```

et éventuellement :

```text
GET /api/patch
```

---

# 17. Architecture globale

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
validation LaneLens
   ↓
MatchupAnalysis
```

Le contrôleur gère le transport HTTP et la traduction des erreurs. Le service
orchestre le cas d'usage, le contexte, le cache éventuel, l'appel au provider et
la validation. Le provider constitue la frontière avec le moteur d'inférence et
encapsule l'authentification, le protocole et les détails propres au moteur.

---

# 18. Data Dragon

Data Dragon sera utilisé pour récupérer les données statiques nécessaires à l'interface.

Principalement :

* liste des champions ;
* nom ;
* identifiant ;
* portrait ;
* éventuellement sorts et descriptions.

Une récupération pourra être effectuée au démarrage de l'application puis conservée en cache.

Les données statiques ne nécessitent donc pas de clé API Riot.

---

# 19. Riot API

L'utilisation directe de la Riot API n'est **pas nécessaire au MVP**.

Elle pourra être introduite ultérieurement pour récupérer par exemple :

* profil du joueur ;
* historique de matchs ;
* rang ;
* statistiques ;
* champions joués ;
* participants d'une partie ;
* analyses basées sur les parties précédentes.

Cette séparation permet au cœur de l'application de fonctionner même sans clé Riot valide.

---

# 20. Moteur d'analyse IA

LaneLens ne dépend d'aucun moteur unique. `MatchupAnalysisProvider` constitue la
frontière entre les couches métier et le provider d'analyse concret.

OpenClaw peut rester un outil de développement ou, si cela facilite le MVP, être
encapsulé dans un `OpenClawProvider` temporaire. Les concepts propres à OpenClaw,
notamment Gateway, session et profil, ne doivent pas se propager dans les
contrôleurs ou les couches métier et ne sont jamais une condition de
fonctionnement du produit.

Le backend transmet au provider sélectionné un contexte structuré préparé par
LaneLens.

Exemple conceptuel :

```text
PATCH
26.19

ALLIED BOTLANE
Carry: Ziggs
Support: Galio

ENEMY BOTLANE
Carry: Jinx
Support: Swain

TASK
Analyse this botlane matchup.

Focus on:
- lane plan
- level 1
- level 2
- level 3
- wave management
- trade windows
- enemy cooldowns
- target priority
- level 6
- roaming
- win condition

Return JSON matching MatchupAnalysis.
```

---

# 21. Règles de génération IA

L'agent ne doit pas produire un guide générique du type :

> Jinx est un hypercarry et il faut essayer de la tuer.

Il doit rechercher des interactions concrètes entre les quatre champions.

L'analyse doit prioriser :

**Threat → Response → Window → Win condition**

Elle doit particulièrement identifier :

* les sorts qui déclenchent une fenêtre ;
* les sorts à ne pas engager ;
* les conditions de trade ;
* les conditions de disengage ;
* les différences entre trade court et combat prolongé ;
* la géométrie de la lane ;
* le positionnement ;
* la gestion de wave ;
* les timings de niveau ;
* la cible prioritaire.

---

# 22. Fiabilité des réponses

Lorsqu'une information dépend fortement du patch, l'agent doit connaître le patch demandé.

Ce patch et son contexte sont fournis par LaneLens. Le moteur d'analyse ne doit
pas déduire seul le patch courant ni déclencher une recherche web systématique
pour chaque matchup.

Il doit différencier :

* mécanique permanente d'un champion ;
* valeur numérique susceptible de changer ;
* tendance de build ;
* stratégie de matchup.

Si une information n'est pas suffisamment fiable, elle ne doit pas être présentée comme certaine.

---

# 23. Chargement

Lors du clic sur **Analyser** :

```text
Analyse du matchup...

Ziggs + Galio
vs
Jinx + Swain
```

Un loader simple est suffisant.

Pas d'animation complexe.

---

# 24. Gestion des erreurs

Cas prévus :

### Service d'analyse indisponible

```text
Impossible de générer l'analyse.

[ Réessayer ]
```

### Données champion indisponibles

Utiliser les données mises en cache.

### Patch impossible à récupérer

Utiliser le dernier patch connu et afficher :

```text
Patch estimé : 26.19
```

### Réponse IA invalide

LaneLens valide le JSON et le contrat `MatchupAnalysis` retournés par le provider.
Les erreurs propres au provider restent internes au backend et ne font pas partie
du contrat fonctionnel exposé au frontend.

Si le format est invalide :

```text
L'analyse retournée est invalide.

[ Régénérer ]
```

---

# 25. Persistance

Aucune base de données n'est nécessaire pour le MVP.

Utiliser :

```text
localStorage
```

pour mémoriser éventuellement :

* dernière botlane jouée ;
* derniers matchups recherchés ;
* préférences utilisateur.

Le cache des analyses appartient à LaneLens et reste indépendant du provider.
Une clé déterministe peut comprendre au minimum :

```text
patch
+ carry allié
+ support allié
+ carry adverse
+ support adverse
```

Exemple conceptuel :

```text
26.19:ziggs:galio:jinx:swain
```

La normalisation, le stockage, la durée de vie et la politique d'invalidation de
ce cache seront définis ultérieurement.

---

# 26. Historique

Fonction facultative mais très simple à implémenter.

Conserver par exemple les dix dernières recherches.

```text
HISTORIQUE

Ziggs + Galio vs Jinx + Swain
Ziggs + Galio vs Kai'Sa + Nautilus
Jhin + Thresh vs Caitlyn + Lux
```

Cliquer sur une ligne relance ou réaffiche l'analyse.

---

# 27. Responsive

L'application doit fonctionner au minimum sur :

* PC ;
* tablette ;
* smartphone.

Le desktop reste néanmoins la cible principale du MVP.

---

# 28. Sécurité

Les secrets ne doivent jamais être présents dans le frontend. Les secrets du
provider d'analyse et les éventuelles clés Riot restent exclusivement côté
serveur ; leur configuration dépend du provider concret.

Par exemple, selon le provider retenu :

```text
OPENCLAW_API_KEY
RIOT_API_KEY
```

doivent uniquement exister côté serveur.

Configuration via :

```text
.env
```

Exemple :

```text
OPENCLAW_URL=
OPENCLAW_API_KEY=

RIOT_API_KEY=
```

`OPENCLAW_URL` et `OPENCLAW_API_KEY` peuvent être utilisés uniquement par un
éventuel `OpenClawProvider`. Ils ne constituent pas une configuration obligatoire
de LaneLens.

La clé Riot reste facultative dans le MVP.

---

# 29. Performance

L'application doit être pratiquement instantanée hors génération IA.

Objectifs :

```text
chargement UI : < 1 seconde
recherche champion : immédiate
changement de champion : immédiat
bundle frontend : minimal
```

Le principal temps d'attente sera celui de la génération de l'analyse IA.

---

# 30. Structure du projet

Structure suggérée :

```text
botlane-matchup/
│
├── src/
│   ├── main.ts
│   ├── api.ts
│   ├── champions.ts
│   ├── storage.ts
│   │
│   ├── components/
│   │   ├── ChampionPicker.ts
│   │   ├── MatchupForm.ts
│   │   ├── MatchupResult.ts
│   │   └── CheatSheet.ts
│   │
│   └── styles/
│       └── main.css
│
├── server/
│   ├── index.ts
│   ├── analysis/
│   │   ├── MatchupAnalysisService.ts
│   │   ├── MatchupAnalysisProvider.ts
│   │   └── providers/
│   │       └── ...
│   ├── prompt.ts
│   └── types.ts
│
├── public/
│
├── .env
├── package.json
├── tsconfig.json
└── vite.config.ts
```

Cette structure est une cible documentaire. Elle ne signifie pas que le service,
l'interface provider, les providers concrets ou `POST /api/matchup` sont déjà
implémentés.

Les composants ne sont pas des composants React.

Il s'agit simplement de modules TypeScript responsables de certaines parties du DOM.

---

# 31. Endpoints MVP

## POST `/api/matchup`

Entrée :

```json
{
  "allyCarry": "Ziggs",
  "allySupport": "Galio",
  "enemyCarry": "Jinx",
  "enemySupport": "Swain"
}
```

Sortie :

```json
{
  "matchup": {
    "allyCarry": "Ziggs",
    "allySupport": "Galio",
    "enemyCarry": "Jinx",
    "enemySupport": "Swain",
    "patch": "26.19"
  },

  "lanePlan": "...",

  "threatResponseWindow": {
    "threat": "...",
    "response": "...",
    "window": "...",
    "winCondition": "..."
  },

  "earlyLevels": {
    "level1": "...",
    "level2": "...",
    "level3": "..."
  },

  "wavePlan": "...",

  "targetPriority": {
    "primaryTarget": "Jinx",
    "explanation": "..."
  },

  "postLevel6": "...",
  "roamPlan": "...",

  "cheatSheet": [
    "Target Jinx",
    "Swain E miss → advance",
    "Jinx E down → engage window",
    "Swain R → disengage"
  ],

  "goldenRule": "..."
}
```

---

# 32. Critères d'acceptation du MVP

Le MVP est considéré fonctionnel lorsque :

1. l'application démarre localement avec une commande simple ;
2. les champions League sont disponibles dans les sélecteurs ;
3. les portraits sont affichés ;
4. les quatre champions peuvent être sélectionnés ;
5. le bouton Analyser appelle le backend ;
6. le backend obtient une réponse via `MatchupAnalysisProvider` ;
7. LaneLens valide une `MatchupAnalysis` structurée avant de la retourner ;
8. l'analyse est affichée graphiquement ;
9. le patch utilisé est visible ;
10. une cheat sheet est générée ;
11. la golden rule est clairement affichée ;
12. aucune clé privée n'est exposée dans le navigateur.

---

# 33. Hors périmètre du MVP

Ne pas implémenter immédiatement :

* création de compte ;
* authentification Riot ;
* base de données ;
* statistiques globales ;
* machine learning ;
* winrates calculés par matchup ;
* overlay League ;
* détection automatique de la partie ;
* application desktop Electron ;
* mobile natif ;
* système social ;
* commentaires ;
* notation des analyses ;
* historique cloud.

Ces fonctionnalités pourront être ajoutées uniquement si le MVP est réellement utilisé.

---

# 34. Évolutions possibles

## Version 1.1 — Riot ID

L'utilisateur renseigne :

```text
Braoux#EUW
```

L'application récupère son profil Riot.

Elle peut connaître automatiquement certains champions fréquemment joués.

---

## Version 1.2 — Champion pools

Définir :

```text
Mon pool ADC
Ziggs
Jhin
Caitlyn

Mon pool Support
Galio
Thresh
Soraka
```

L'application peut ensuite comparer plusieurs choix contre une botlane adverse.

---

## Version 1.3 — Draft Helper

L'utilisateur renseigne :

```text
Enemy ADC : Jinx
Enemy Support : Swain
```

L'application analyse les champions de son pool et explique les caractéristiques tactiques de chaque option, sans avoir à saisir chaque matchup individuellement.

---

## Version 1.4 — Live Game

Grâce aux données disponibles localement pendant une partie League, l'application pourrait détecter automatiquement :

```text
Votre équipe
Ziggs + Galio

Adversaires
Jinx + Swain
```

et générer automatiquement le guide.

---

## Version 1.5 — Match history

Après la partie :

```text
Match détecté

Ziggs + Galio
vs
Jinx + Swain

Résultat : défaite
```

Possibilité de demander :

```text
Analyser ce qui s'est passé.
```

Les données de la partie seraient alors combinées au matchup théorique.

---

# 35. Principe directeur

L'application ne doit pas chercher à répondre à :

**« Qui gagne ce matchup ? »**

Elle doit surtout répondre à :

**« Qu'est-ce que je dois faire concrètement pour bien jouer ce matchup ? »**

La valeur du produit vient de la transformation :

```text
connaissance champion
+
interaction des quatre champions
+
état de wave
+
cooldowns
+
timings de niveau
```

en instructions directement applicables :

```text
SI Swain rate E
ET Jinx est avancée
ALORS Galio prend l'espace
ET menace E sur Jinx.
```

Le produit doit donc privilégier les **décisions conditionnelles et les fenêtres de jeu** plutôt que les longues descriptions théoriques.
