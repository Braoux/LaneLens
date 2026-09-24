# LaneLens
Know the matchup before it knows you.
Application d'analyse de matchups botlane League of Legends.

## Documentation

- [Cahier des charges](docs/cahier-des-charges.md)
- [Architecture technique](docs/architecture.md)
- [ADR-001 — Rendre OpenClaw remplaçable dans le runtime LaneLens](docs/decisions/ADR-001-remplacer-openclaw-runtime.md)

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

Aucun fichier `.env`, identifiant ou provider d'analyse actif n'est nécessaire
pour l'état actuellement livré. `.env.example` réserve `OPENCLAW_URL` et
`OPENCLAW_API_KEY` uniquement à un éventuel `OpenClawProvider` ; ces variables ne
sont pas consommées. Les futurs providers pourront posséder leur propre
configuration, qui devra rester exclusivement côté serveur.
Ne jamais placer une clé dans `src/`, `public/` ou une variable `VITE_*`.
Les fichiers `.env` et leurs variantes locales sont ignorés par Git,
à l'exception du modèle `.env.example`, qui ne contient aucun secret.

## Vérification et compilation

```sh
npm run typecheck
npm test
npm run build
```

Le contrôle TypeScript couvre le frontend, la configuration Vite et le backend.
La compilation génère `dist/client/` et `dist/server/`.
`npm run start:server` exécute le backend compilé (port 3000, arrêter le serveur
de développement avant). Cette commande ne sert pas le frontend compilé :
le déploiement est hors périmètre.

## État actuellement implémenté

- `src/` : frontend TypeScript sans framework, catalogue, règles de matchup et interface de sélection.
- `server/` : serveur Hono exposant uniquement `GET /api/health` et types serveur.
- `public/` : futurs assets publics, sans secrets.
- `tsconfig.server.json` : configuration distincte pour compiler le backend Node.js.
- `server/openclaw.ts` et `server/prompt.ts` restent des modules réservés et vides.
- `POST /api/matchup`, `MatchupAnalysisService`, `MatchupAnalysisProvider` et les
  providers concrets ne sont pas encore implémentés.

## Architecture cible acceptée

[ADR-001](docs/decisions/ADR-001-remplacer-openclaw-runtime.md) définit le futur
moteur d'analyse derrière une abstraction provider : le contrôleur appellera
`MatchupAnalysisService`, qui dépendra de `MatchupAnalysisProvider` plutôt que
d'un moteur concret.

OpenClaw pourra rester un outil de développement ou être encapsulé temporairement
dans un `OpenClawProvider`. Il ne sera pas une dépendance runtime obligatoire.
Le provider et le modèle de production, la source exacte du patch et les détails
du cache restent des décisions futures.

## Catalogue des champions — LAN-002

Le démarrage déclenche automatiquement le chargement Data Dragon, indépendamment
du contrôle de santé du backend. La dernière version globale est recherchée à
chaque démarrage, puis le catalogue `fr_FR` est récupéré si nécessaire.
Il ne s'agit pas d'une détection du patch régional du joueur.

Le dernier catalogue valide est conservé dans `localStorage`, sous la clé
`lanelens.champion-catalog.v1`. Un cache à jour évite le téléchargement complet ;
en cas de panne, il reste utilisable avec `source: 'cache'` et `stale: true`.
Sans cache exploitable, le résultat est une erreur contrôlée. Aucune clé Riot,
aucun service OpenClaw et aucune liste manuelle ne sont utilisés.

Les composants peuvent importer `initializeChampionCatalog()` depuis
`src/catalog-state.ts` et attendre sa promesse partagée, ou consulter
`getChampionCatalogState()`. Les états sont `idle`, `loading`, `ready` ou `error`.
Un résultat `ready` expose `catalog` et `persistence` (`saved` ou `unavailable`
si le navigateur refuse l'écriture). Les données réseau restent utilisables même
si la persistance échoue.

Seules les URLs de portraits sont stockées, pas les images : leurs fichiers ne
sont pas garantis hors ligne. Le code frontend doit d'abord avoir été chargé ;
LAN-002 n'ajoute pas de service worker ni de fonctionnement hors ligne de l'application entière.

`npm test` couvre les scénarios nominal, cache, mise à jour et pannes avec
réseau et stockage contrôlés. Voir le [rapport LAN-002](docs/LAN-002/verification.md).

## Sélection du matchup — LAN-003

L'écran principal présente exactement quatre slots (carry/support alliés et
adverses). Chaque slot ouvre un picker avec portraits et recherche insensible à
la casse. Les sélections restent modifiables et le bouton Analyser n'est actif
qu'une fois les quatre choix remplis.

Les doublons sont bloqués par défaut. Le mode Mirror autorise le même champion
une fois dans chaque équipe, mais jamais deux fois dans une équipe ni plus de
deux fois dans le matchup. Le clic sur Analyser émet localement l'événement
`lanelens:analyze` sur `#app` et rend le dernier instantané disponible via
`getLastAnalyzedSelection()` ; aucun appel backend ou OpenClaw n'est réalisé.

L'interface restitue chargement, erreur catalogue, cache potentiellement obsolète,
recherche vide et portrait indisponible. La version affichée est explicitement
libellée `Data Dragon <version>` et n'est pas présentée comme un patch joueur.
Voir le [rapport LAN-003](docs/LAN-003/verification.md).

Pas d'authentification, base de données, Riot API ou provider d'analyse fonctionnel,
CI/CD, Docker ou déploiement dans ce socle.

Références : [Vite](https://vite.dev/guide/),
[Hono sur Node.js](https://hono.dev/docs/getting-started/nodejs).
