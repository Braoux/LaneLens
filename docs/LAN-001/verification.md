# LAN-001 — Vérification du socle

Date : 2026-09-24.

## Livré

- Frontend Vite / TypeScript / HTML / CSS sans framework UI.
- Backend Node.js / TypeScript / Hono, écoute locale sur le port 3000.
- `npm run dev` lance les deux services ; Vite relaie `/api` vers Hono.
- Page initiale avec vérification de santé et possibilité de réessayer.
- Structure demandée, modules métier laissés explicitement réservés.
- Configuration TypeScript distincte du backend pour produire du JavaScript Node.js.
- `.env.example`, `.gitignore`, verrou npm et instructions dans le README.

## Résultats observés

Environnement : Windows, Node.js 26.10.0, npm 11.19.1.

| Contrôle | Résultat |
|---|---|
| Installation npm | Réussie ; aucun problème de vulnérabilité signalé par npm à l'installation. |
| `npm run build` | Réussi, incluant le contrôle TypeScript du frontend et du backend. |
| `npm run dev` | Vite et Hono démarrent, sans fichier `.env`. |
| HTML sur `http://127.0.0.1:5173/` | HTTP 200, titre LaneLens. |
| Module frontend transformé par Vite | HTTP 200. |
| `http://127.0.0.1:3000/api/health` | HTTP 200 et corps exactement `{"status":"ok"}`. |
| `http://127.0.0.1:5173/api/health` | HTTP 200 et même corps exact, via le proxy. |
| Protection Git | `.env`, `.env.local`, `.env.production`, `node_modules/` et `dist/` ignorés ; `.env.example` non ignoré. Aucun fichier d'environnement secret suivi identifié. |
| `git diff --check` | Aucun défaut d'espacement ; avertissement Git de normalisation LF/CRLF sur le README. |

## Limite de validation

Le navigateur automatisé a refusé la navigation locale avec « browser navigation
blocked by policy ». L'affichage visuel, le clic sur le bouton et les transitions
d'état dans un navigateur n'ont donc pas été vérifiés. Les vérifications HTTP
ne sont pas présentées comme un test navigateur.

Le lancement du backend compilé via `npm run start:server` n'a pas fait l'objet
d'un essai d'exécution séparé ; sa compilation a réussi.

## Recette manuelle complémentaire

1. Ouvrir http://127.0.0.1:5173 après `npm run dev`.
2. Vérifier « Service disponible » et cliquer sur « Vérifier la connexion ».
3. Pour tester l'indisponibilité, lancer uniquement `npm run dev:client` :
   la page doit signaler l'indisponibilité ; démarrer ensuite `npm run dev:server`
   dans un second terminal puis réessayer.

Aucune intégration OpenClaw ou Riot, base de données, authentification,
CI/CD, Docker ou fonctionnalité de déploiement n'a été ajoutée.
