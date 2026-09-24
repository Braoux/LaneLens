# LaneLens
Know the matchup before it knows you.
Application d'analyse de matchups botlane League of Legends.

## Documentation

- [Cahier des charges](docs/cahier-des-charges.md)
- [Architecture technique](docs/architecture.md)

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

Aucun fichier `.env`, identifiant ou service OpenClaw actif n'est nécessaire
pour ce ticket. `.env.example` réserve les variables `OPENCLAW_URL` et
`OPENCLAW_API_KEY` à la future intégration serveur ; elles ne sont pas encore consommées.
Ne jamais placer une clé dans `src/`, `public/` ou une variable `VITE_*`.
Les fichiers `.env` et leurs variantes locales sont ignorés par Git,
à l'exception du modèle `.env.example`, qui ne contient aucun secret.

## Vérification et compilation

```sh
npm run typecheck
npm run build
```

Le contrôle TypeScript couvre le frontend, la configuration Vite et le backend.
La compilation génère `dist/client/` et `dist/server/`.
`npm run start:server` exécute le backend compilé (port 3000, arrêter le serveur
de développement avant). Cette commande ne sert pas le frontend compilé :
le déploiement est hors périmètre.

## Structure et périmètre

- `src/` : frontend TypeScript sans framework, styles et appel de santé.
- `server/` : serveur Hono et types serveur.
- `public/` : futurs assets publics, sans secrets.
- `tsconfig.server.json` : configuration distincte pour compiler le backend Node.js.
- Les modules champions, storage, openclaw et prompt sont des emplacements réservés,
  sans comportement métier pour l'instant.

Pas d'authentification, base de données, Riot API, intégration OpenClaw fonctionnelle,
CI/CD, Docker ou déploiement dans ce socle.

Références : [Vite](https://vite.dev/guide/),
[Hono sur Node.js](https://hono.dev/docs/getting-started/nodejs).
