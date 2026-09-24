# LaneLens

> Know the matchup before it knows you.

LaneLens est une application d’analyse de matchups botlane League of Legends.
Sélectionnez les quatre champions et obtenez un plan de lane concret :
priorité, fenêtres de trade, gestion de wave, cible prioritaire et décisions clés.

<p align="center">
  <img src="docs/assets/lanelens-home.png"
       alt="LaneLens — sélection d'un matchup botlane League of Legends"
       width="1200">
</p>

## Documentation

- [Cahier des charges](docs/cahier-des-charges.md)
- [Architecture technique](docs/architecture.md)
- [Maintenance des contextes de patch](docs/patch-context.md)

## Démarrage local

Prérequis : Node.js >= 22.12 et npm.

```sh
npm ci
npm run dev
```

Ouvrir http://127.0.0.1:5173. Cette commande lance Vite et Hono ensemble ;
Ctrl+C arrête les deux. Les ports 5173 et 3000 doivent être disponibles.

Le frontend appelle `/api/health` via le proxy Vite vers Hono sur
http://127.0.0.1:3000. La réponse est HTTP 200 avec exactement `{"status":"ok"}`.
La page affiche « Service disponible » lorsque cet appel réussit.

## Configuration et secrets

Aucun fichier `.env` ni identifiant n'est nécessaire pour démarrer le serveur ou
appeler `/api/health`.

Sans `OPENAI_API_KEY`, `POST /api/matchup` retourne :

```text
503 ANALYSIS_NOT_CONFIGURED
```

Avec une clé valide, le runtime utilise le provider OpenAI derrière
`MatchupAnalysisProvider`.

Configuration disponible :

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-sol
OPENAI_TIMEOUT_MS=30000
```

`OPENAI_MODEL` et `OPENAI_TIMEOUT_MS` sont facultatifs.

Les secrets restent exclusivement côté serveur.

Ne jamais placer une clé dans :

```text
src/
public/
VITE_*
```

Les fichiers `.env` et leurs variantes locales sont ignorés par Git,
à l'exception de `.env.example`, qui ne contient aucun secret.

## Vérification et compilation

```sh
npm run typecheck
npm test
npm run build
```

Le contrôle TypeScript couvre le frontend, la configuration Vite et le backend.

La compilation génère :

```text
dist/client/
dist/server/
```

`npm run start:server` exécute le backend compilé sur le port 3000.
Cette commande ne sert pas le frontend compilé : le déploiement reste hors périmètre.

## État actuellement implémenté

- `src/` : frontend TypeScript sans framework, catalogue, règles de matchup et interface de sélection ;
- `server/` : serveur Hono, moteur d’analyse provider-agnostic, provider OpenAI et contexte de patch versionné ;
- `POST /api/matchup` : validation HTTP, résolution du contexte de patch et appel de `MatchupAnalysisService` ;
- `MatchupAnalysisService` : orchestration de l’analyse et validation de la réponse ;
- `MatchupAnalysisProvider` : abstraction permettant de remplacer le moteur d’inférence sans modifier le reste de l’application ;
- contexte actuellement versionné : `26.19-v1`.

Sans configuration du provider, la route d’analyse reste indisponible de manière contrôlée tandis que le reste du serveur continue de fonctionner.

## Architecture du moteur d’analyse

LaneLens sépare volontairement le transport HTTP, le métier et le provider d’inférence :

```text
Frontend
   ↓
POST /api/matchup
   ↓
Hono
   ↓
MatchupAnalysisService
   ↓
MatchupAnalysisProvider
   ↓
Provider concret
   ↓
validation LaneLens
   ↓
MatchupAnalysis
```

Le provider actuellement intégré utilise OpenAI, mais le contrat métier n’en dépend pas.

Changer de provider ou de modèle ne doit pas nécessiter de modifier :

- le frontend ;
- `POST /api/matchup` ;
- `MatchupAnalysisService` ;
- le contrat `MatchupAnalysis`.

LaneLens reste responsable du contexte de patch et de la validation finale de chaque analyse.

## Test manuel de l'analyse

Définir `OPENAI_API_KEY` uniquement dans l'environnement local du processus, puis
lancer :

```sh
npm run dev:server
```

`OPENAI_MODEL` et `OPENAI_TIMEOUT_MS` sont facultatifs.

Aucun secret ne doit être commité.

```sh
curl -X POST http://127.0.0.1:3000/api/matchup \
  -H "Content-Type: application/json" \
  -d '{
    "allyCarry": "Ziggs",
    "allySupport": "Galio",
    "enemyCarry": "Jinx",
    "enemySupport": "Swain",
    "patch": "26.19"
  }'
```

Avec une configuration OpenAI valide et un contexte disponible pour le patch demandé,
la réponse attendue est un `MatchupAnalysis` avec HTTP 200.

Ce test est optionnel et n'est jamais exécuté par `npm test`.

## Catalogue des champions — LAN-002

Le démarrage déclenche automatiquement le chargement Data Dragon, indépendamment
du contrôle de santé du backend.

La dernière version globale est recherchée à chaque démarrage, puis le catalogue
`fr_FR` correspondant est récupéré si nécessaire.

Cette version Data Dragon est une version technique et n'est pas utilisée comme
détection automatique du patch joueur.

Le dernier catalogue valide est conservé dans `localStorage`, sous la clé :

```text
lanelens.champion-catalog.v1
```

Un cache à jour évite le téléchargement complet.

En cas de panne, il reste utilisable avec :

```text
source: "cache"
stale: true
```

Sans cache exploitable, le résultat est une erreur contrôlée.

Aucune clé Riot ni liste manuelle de champions n'est nécessaire.

Les composants peuvent importer `initializeChampionCatalog()` depuis
`src/catalog-state.ts` et attendre sa promesse partagée, ou consulter
`getChampionCatalogState()`.

Les états disponibles sont :

```text
idle
loading
ready
error
```

Un résultat `ready` expose `catalog` et `persistence` (`saved` ou
`unavailable` si le navigateur refuse l'écriture).

Les données réseau restent utilisables même si la persistance échoue.

Seules les URLs de portraits sont stockées, pas les images elles-mêmes.

Voir le [rapport LAN-002](docs/LAN-002/verification.md).

## Sélection du matchup — LAN-003

L'écran principal présente exactement quatre slots :

```text
Carry allié
Support allié
Carry adverse
Support adverse
```

Chaque slot ouvre un picker avec portraits et recherche insensible à la casse.

Les sélections restent modifiables et le bouton `Analyser` n'est actif qu'une fois
les quatre choix remplis.

Les doublons sont bloqués par défaut.

Le mode Mirror autorise le même champion une fois dans chaque équipe, mais jamais
deux fois dans une même équipe ni plus de deux fois dans le matchup.

Le clic sur `Analyser` émet localement l'événement :

```text
lanelens:analyze
```

sur `#app` et rend le dernier instantané disponible via
`getLastAnalyzedSelection()`.

L'interface restitue les états de chargement, erreur catalogue, cache
potentiellement obsolète, recherche vide et portrait indisponible.

La version affichée est explicitement libellée :

```text
Data Dragon <version>
```

et n'est pas présentée comme un patch joueur.

Voir le [rapport LAN-003](docs/LAN-003/verification.md).

## Stack

```text
Frontend    TypeScript · Vite · HTML · CSS
Backend     Node.js · Hono
Data        Riot Data Dragon
AI          MatchupAnalysisProvider · OpenAI
Tests       TypeScript · Node.js
```

## Périmètre actuel

LaneLens reste volontairement léger pour le MVP :

- pas d'authentification ;
- pas de base de données ;
- pas de compte Riot ;
- pas de Riot API authentifiée ;
- pas de CI/CD ou Docker imposé ;
- pas de déploiement public inclus dans le socle actuel.

Références : [Vite](https://vite.dev/guide/),
[Hono sur Node.js](https://hono.dev/docs/getting-started/nodejs).
