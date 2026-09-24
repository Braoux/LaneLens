# Ticket Readiness — Socle technique LaneLens

**Date :** 2026-09-24  
**Type :** Tâche technique  
**Readiness Score :** 9 / 10  
**Status :** READY

## Résumé

Initialiser le socle léger de LaneLens : frontend Vite en TypeScript, HTML et CSS, backend Node.js TypeScript avec Hono, communication via `GET /api/health` et configuration documentée sans secrets versionnés. Ce ticket prépare le développement ; il ne livre pas le MVP fonctionnel.

## Sources et contexte inspectés

- Ticket fourni dans la conversation, sans identifiant.
- `docs/cahier-des-charges.md`, notamment sections 16–17, 28, 30 et 32.
- `README.md` et inventaire du dépôt : documentation présente, aucun code applicatif existant identifié.
- `docs/architecture.md` : fichier vide, aucune contrainte supplémentaire exploitable.
- Skill appliqué : `C:/Skills/Skills/Ticket-Readyness/SKILL.md`.

Le README est déjà modifié et le dossier docs contient des fichiers non suivis dans Git. Ces contenus préexistants sont laissés intacts.

## Score de readiness

| Dimension | Score | Justification |
|---|---:|---|
| R1 — Intention et résultat attendu | 2 / 2 | Socle à créer et technologies explicites. |
| R2 — Règles et comportement | 2 / 2 | Comportement technique suffisamment défini ; aucune règle métier nécessaire ici. |
| R3 — Acceptation et vérifiabilité | 1,5 / 2 | AC vérifiables, avec quelques modalités de recette à préciser (TR-01). |
| R4 — Périmètre et dépendances | 2 / 2 | Structure, contraintes et exclusions claires ; aucune dépendance externe indispensable identifiée pour ce socle. |
| R5 — Cas limites et complétude opérationnelle | 1,5 / 2 | Comportement sans configuration OpenClaw non explicite (TR-02). |
| **Total** | **9 / 10** | |

## Informations confirmées

- Frontend Vite, TypeScript, HTML, CSS ; ni React, ni Angular, ni Vue pour le MVP.
- Backend Node.js, TypeScript, Hono ; aucune base de données.
- Arborescence attendue avec `src/`, `server/`, `public/` et les fichiers de configuration listés ; adaptations mineures autorisées.
- Application accessible dans le navigateur après installation et démarrage.
- Appel frontend de `GET /api/health` aboutissant au backend avec HTTP 200 ; exemple JSON fourni : `{"status":"ok"}`.
- Frontend et backend doivent compiler sans erreur TypeScript.
- `.env.example` documente au minimum `OPENCLAW_URL` et `OPENCLAW_API_KEY`.
- Aucun secret commité ; le cahier des charges impose également leur confinement côté serveur.
- Authentification, base de données, Riot API, CI/CD, Docker et déploiement explicitement exclus.
- Le cahier des charges demande un démarrage local avec une commande simple (§32).

## Inférences, hypothèses et inconnues

### Inférences

- Les modules champions, stockage, OpenClaw et prompt préparent les tickets suivants : leur présence dans l'arborescence ne demande pas leur implémentation fonctionnelle ici.
- Les fonctionnalités complètes du cahier des charges ne constituent pas les critères d'acceptation de ce ticket d'initialisation.
- Aucun service OpenClaw actif ni identifiant réel ne paraît nécessaire pour une route de santé locale ; cette lecture mérite d'être explicitée (TR-02).

### Hypothèses

- Aucune hypothèse métier n'est nécessaire pour déclarer le ticket prêt. Les précisions proposées ci-dessous ne sont pas traitées comme des exigences déjà approuvées.

### Inconnues non bloquantes

- Version Node.js, gestionnaire de paquets, noms des commandes et ports locaux non imposés. Ce sont des choix techniques à documenter lors de l'implémentation, pas des décisions produit manquantes.
- Contenu exact de la page initiale et modalités d'observation de l'appel de santé non spécifiés.

## Constats

### TR-01 — Modalités de recette légèrement implicites

**Severity :** MINOR

**Observé :** AC1 exige une application accessible ; AC2 donne un statut HTTP et un exemple de corps ; AC3 exige une compilation TypeScript des deux parties. Le cahier des charges précise un démarrage local simple.

**Manquant ou ambigu :** Les commandes de validation ne sont pas encore définies, le contenu minimal de la page n'est pas décrit et le JSON de santé est présenté comme un exemple plutôt que comme un contrat exact.

**Pourquoi cela compte :** Une recette documentée permettra de distinguer clairement une page servie, un appel réellement reçu par Hono et une vérification TypeScript couvrant les deux parties.

**Question / action requise — non bloquante :** Documenter les commandes et l'URL locale lors de la réalisation. Préciser si le JSON `{"status":"ok"}` est le contrat exact attendu. Aucun écran métier n'est nécessaire pour évaluer ce socle.

### TR-02 — Démarrage sans configuration OpenClaw non explicite

**Severity :** MINOR

**Observé :** Le ticket exige un `.env.example` avec deux variables OpenClaw, mais ne demande aucun appel à ce service.

**Manquant ou ambigu :** Le comportement lorsque ces valeurs sont absentes ou vides n'est pas expressément indiqué.

**Pourquoi cela compte :** Une dépendance involontaire à des identifiants réels compliquerait la validation après clonage, sans contribuer au socle demandé.

**Question / action requise — non bloquante :** Expliciter que le frontend et `/api/health` doivent fonctionner sans OpenClaw configuré. Il s'agit d'une clarification proposée, cohérente avec le périmètre, et non d'une intégration à ajouter.

## Évaluation des critères d'acceptation

| Critère | Évaluation |
|---|---|
| AC1 — Frontend | Vérifiable par installation, démarrage et ouverture dans le navigateur. Commandes et URL à documenter ; page minimale suffisante au regard du ticket. |
| AC2 — Backend | Vérifiable en appelant `/api/health` depuis le frontend et en constatant HTTP 200 provenant du backend. Caractère contractuel du corps JSON à expliciter. |
| AC3 — TypeScript | Vérifiable par un contrôle TypeScript couvrant `src/` et `server/`. Un simple affichage navigateur ne prouve pas ce critère. |
| AC4 — Configuration | Vérifiable par inspection de `.env.example`, de l'exclusion des fichiers secrets et des fichiers suivis par Git. Le cahier des charges complète ce contrôle par l'absence de secrets dans le frontend. |

Aucune exigence de tests automatisés n'est nécessaire pour rendre ce ticket prêt. Il n'existe pas de contradiction bloquante entre le ticket et le cahier des charges : Hono devient un choix imposé par le ticket, `/api/health` complète les routes métier futures, et `.env.example` documente la configuration sans versionner le `.env` réel.

## Périmètre

### Inclus

- Initialisation de la structure, configuration des outils, démarrage local frontend/backend.
- Route de santé et possibilité de l'appeler depuis le frontend.
- Validation TypeScript des deux parties.
- Exemple d'environnement et protection des secrets contre le versionnement et l'exposition frontend.

### Exclu ou non demandé dans ce ticket

- Toutes les exclusions explicites du ticket.
- Sélection des champions, Data Dragon, récupération du patch, analyses de matchups, appels effectifs à OpenClaw, historique et persistance fonctionnelle.
- Réalisation de l'interface complète du MVP.

La présence de fichiers réservés à ces fonctions ne les fait pas entrer dans le périmètre fonctionnel de ce socle.

## Dépendances

- Environnement Node.js et accès aux dépendances nécessaires à l'installation.
- Choix de versions compatibles à effectuer pendant l'implémentation ; aucune version n'a été sélectionnée ni vérifiée dans cette évaluation.
- Aucun autre ticket, service externe actif, base de données ou jeu de données n'est identifié comme prérequis pour ce socle.

## Questions nécessitant clarification

### Bloquantes

Aucune.

### Non bloquantes

1. Le corps de réponse de santé doit-il être exactement `{"status":"ok"}` ?
2. Peut-on expliciter le fonctionnement du socle et de sa route de santé lorsque les variables OpenClaw sont absentes ou vides ?

## Clarifications suggérées

- Ajouter les commandes d'installation, de démarrage local et de validation TypeScript à la documentation livrée.
- Rendre explicite le corps JSON attendu sur `/api/health`.
- Indiquer que la configuration OpenClaw n'est pas nécessaire pour démarrer et vérifier ce socle.

## Décision de readiness

**Status : READY**

L'objectif, les contraintes et les critères permettent de commencer sans inventer de décision produit importante. Les deux constats concernent des précisions mineures ; ils ne justifient pas de bloquer le développement.

## Prochaine étape recommandée

Passer à l'implémentation de ce ticket technique simple, en documentant les choix de lancement et de validation. Une analyse conceptuelle séparée n'est pas nécessaire. Cette évaluation ne réalise ni conception détaillée ni implémentation.
