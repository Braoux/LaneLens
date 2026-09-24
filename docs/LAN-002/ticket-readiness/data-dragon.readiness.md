# Ticket Readiness — Charger et mettre en cache les champions depuis Data Dragon

**Ticket :** LAN-002  
**Branche :** LAN-002  
**Type :** Tâche technique / intégration frontend  
**Date de réévaluation :** 2026-09-24  
**Readiness Score :** 10 / 10  
**Status :** READY  
**Révision :** 2 — remplace l'évaluation initiale à 7,5 / 10, NEEDS CLARIFICATION.

## Résumé

Au démarrage, LaneLens recherche la dernière version globale Data Dragon, fournit un catalogue normalisé en `fr_FR` et conserve le dernier catalogue valide dans `localStorage`. Il réutilise ce catalogue lorsqu'il est à jour ou en repli si le réseau échoue, sans mélanger version, données et URLs des portraits.

La nouvelle version du ticket définit les comportements nominaux et dégradés, les dépendances et la frontière avec LAN-003. Aucun arbitrage produit bloquant ne subsiste. Cette décision porte sur la préparation du ticket, pas sur la conformité d'une implémentation.

## Sources et contexte

- Version révisée de LAN-002 fournie dans la conversation, comprenant les décisions fonctionnelles, six cas de chargement, AC1 à AC12 et la Definition of Done.
- Rapport initial relu avant mise à jour ; les constats TR-01 à TR-04 sont conservés ci-dessous comme historique résolu.
- [Cahier des charges](../../cahier-des-charges.md), notamment sections 3, 18, 24, 25 et 32.
- [Architecture actuelle](../../architecture.md) et inspection du socle lors de l'évaluation initiale : modules champions et stockage réservés, démarrage limité à la santé du backend.
- [Documentation officielle Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon), consultée lors de l'évaluation initiale dans cette conversation.
- Skill appliqué : `C:/Skills/Skills/Ticket-Readyness/SKILL.md`, déjà lu dans cette conversation.

La branche courante a été revérifiée : `LAN-002`. La recherche mémoire est indisponible ; l'analyse utilise le ticket fourni et le rapport local, sans dépendre de ce rappel. Aucun test applicatif n'est exécuté pour cette réévaluation documentaire.

## Score de readiness

| Dimension | Score | Justification |
|---|---:|---|
| R1 — Intention et résultat attendu | 2 / 2 | Catalogue officiel chargé au démarrage et disponible aux futurs composants. |
| R2 — Règles et comportement | 2 / 2 | Version globale, locale, identifiants, provenance et six cas de chargement définis. |
| R3 — Acceptation et vérifiabilité | 2 / 2 | Douze AC observables et Definition of Done cohérente ; vérifications sans interface métier possibles. |
| R4 — Périmètre et dépendances | 2 / 2 | LAN-001, réseau et localStorage identifiés ; frontière avec LAN-003 explicite. |
| R5 — Cas limites et complétude opérationnelle | 2 / 2 | Repli, absence de cache, mise à jour échouée, conservation de l'ancien catalogue et cohérence de version couverts. |
| **Total** | **10 / 10** | **Aucune décision produit importante à inventer.** |

## Informations confirmées

### Données et version

- Catalogue issu de Data Dragon, sans liste manuelle ni fallback codé en dur.
- Dernière version globale publiée recherchée à chaque démarrage ; aucune résolution régionale.
- Version technique conservée avec le catalogue, jamais assimilée automatiquement au patch d'un joueur.
- Locale imposée : `fr_FR`.
- `Champion.id` reprend l'identifiant textuel Data Dragon, pas le nom localisé.
- `Champion.name` reprend le nom du catalogue français.
- `Champion.imageUrl` correspond au portrait de la version associée au catalogue.
- Données, version, locale, provenance, état potentiellement obsolète et date de récupération accessibles aux consommateurs ; forme exacte du modèle adaptable.

### Chargement et cache

- Cache obligatoire dans `localStorage`, persistant après rechargement.
- Contenu minimal : version, locale, champions normalisés et date de récupération.
- Lecture du cache puis recherche de la dernière version à chaque démarrage.
- Cache valide de même version réutilisable sans nouveau téléchargement complet.
- Nouvelle version : tentative de récupération, remplacement du cache seulement après succès.
- En cas d'échec réseau ou de récupération du nouveau catalogue, repli sur l'ancien catalogue valide avec `source = "cache"` et `stale = true`.
- Un repli conserve la version réelle des données sauvegardées.
- Sans réseau ni cache exploitable : état d'erreur contrôlé, sans crash ni catalogue manuel.
- Aucun TTL fixe requis ; la fraîcheur est vérifiée au démarrage.
- Chargement réellement intégré au démarrage, pas seulement une fonction exportée mais inutilisée.

### Périmètre

- Aucun sélecteur ou catalogue graphique requis ; rendu des champions prévu dans LAN-003.
- État d'erreur exposé aux consommateurs, mais interface de gestion des erreurs reportée.
- Seules les URLs des portraits sont mises en cache ; disponibilité hors ligne des images non garantie.
- Aucune clé Riot ni dépendance OpenClaw.
- TypeScript doit compiler sans erreur.

## Inférences, hypothèses et inconnues

### Inférences techniques raisonnables

- Un cache dont la fraîcheur vient d'être confirmée peut être exposé avec `source = "cache"` et `stale = false`. Un catalogue téléchargé avec succès est de source réseau et non obsolète au moment du chargement.
- La date de récupération correspond à l'acquisition du catalogue, pas simplement à sa relecture ; réutiliser le cache ne constitue pas un nouveau téléchargement.
- Le caractère « valide » d'un catalogue suppose une validation suffisante de la structure, de la locale, de la version et des données avant réutilisation ou remplacement du dernier cache exploitable.
- Les numéros donnés en exemple dans le ticket sont illustratifs : ils ne doivent ni être codés en dur ni être interprétés comme une source de version actuelle.

Ces points explicitent la lecture du ticket sans ajouter de fonctionnalité métier.

### Hypothèses

Aucune hypothèse produit non confirmée n'est nécessaire pour commencer. Les anciennes hypothèses concernant version globale, locale et identifiant sont devenues des décisions explicites.

### Choix techniques restant ouverts, non bloquants

- Forme exacte de l'état d'erreur et du contrat consommable par les futurs composants.
- Clé de stockage, validation du cache, format exact de date et organisation interne des modules.
- Délais réseau, traitement des données malformées et protection contre les exceptions de stockage.

Le ticket suppose `localStorage` disponible. Les limites de quota ou restrictions du navigateur méritent une gestion défensive lors de la conception ; elles ne justifient pas un nouveau blocage de readiness ni une exigence de persistance garantie dans un environnement qui l'interdit.

## Suivi des constats précédents

| Constat | Gravité initiale | État | Réponse dans le ticket révisé |
|---|---|---|---|
| TR-01 — Cache et repli ambigus | BLOCKING | **Résolu** | Cache localStorage obligatoire ; cas 1 à 6 ; AC6 à AC11 ; fraîcheur vérifiée à chaque démarrage ; erreur contrôlée sans cache. |
| TR-02 — Sélection de version et sens du patch | IMPORTANT | **Résolu** | Dernière version globale ; version technique distincte du patch joueur ; résolution régionale exclue. |
| TR-03 — Frontière données/interface | MINOR | **Résolu** | Données et état seulement ; déclenchement réel AC12 ; sélecteurs et rendu reportés à LAN-003. |
| TR-04 — Identifiant et langue | MINOR | **Résolu** | Identifiant textuel Data Dragon et noms issus de `fr_FR` explicitement imposés. |

Aucun nouveau constat bloquant ou important. La présentation graphique du repli prévue au niveau MVP dans le cahier des charges reste différée par ce ticket, sans contradiction : l'état nécessaire est fourni aux futurs écrans.

## Évaluation des critères d'acceptation

| Critère | Évaluation et observation possible |
|---|---|
| AC1 — Chargement initial | Vérifiable sans cache : recherche de version, récupération française et catalogue disponible. |
| AC2 — Données champion | Vérifiable sur les champs normalisés et la correspondance des URLs à la version. |
| AC3 — Sélection de version | Vérifiable avec plusieurs versions proposées ; version globale retenue sans conversion régionale. |
| AC4 — Locale | Vérifiable dans la ressource demandée et les noms normalisés. |
| AC5 — Pas de clé Riot | Vérifiable sans variable ni en-tête d'authentification Riot. |
| AC6 — Cache persistant | Vérifiable après un rechargement de page, et pas uniquement dans la mémoire du module. |
| AC7 — Catalogue déjà à jour | Vérifiable par réutilisation du catalogue sauvegardé après contrôle de version ; aucun nouveau téléchargement complet nécessaire. |
| AC8 — Mise à jour | Vérifiable avec une nouvelle version et en contrôlant que l'ancien cache n'est remplacé qu'après récupération valide. |
| AC9 — Fallback | Vérifiable en simulant l'indisponibilité avec cache : source cache, état obsolète, ancienne version conservée. |
| AC10 — Échec sans cache | Vérifiable sans données valides : état d'erreur contrôlé, application encore utilisable, aucune liste de substitution. |
| AC11 — Cohérence | Vérifiable dans tous les parcours, notamment si une nouvelle version est détectée mais son catalogue échoue. |
| AC12 — Déclenchement réel | Vérifiable depuis le parcours de démarrage de LaneLens, pas seulement par un appel isolé du module. |

La Definition of Done ajoute explicitement la compilation TypeScript et le respect du périmètre. Aucun sélecteur graphique n'est nécessaire pour vérifier ces critères. Aucun nombre fixe de champions ni numéro de version réel figé n'est nécessaire pour la recette.

## Cas limites pertinents

| Situation | Attendu établi |
|---|---|
| Aucun cache, réseau disponible | Catalogue réseau normalisé puis sauvegardé. |
| Cache valide et même version | Réutilisation du catalogue sans téléchargement complet nécessaire. |
| Cache valide et nouvelle version récupérée | Nouveau catalogue et remplacement du cache après succès. |
| Recherche de version impossible avec cache valide | Repli cache marqué obsolète ; version conservée. |
| Version récente trouvée, catalogue impossible à récupérer | Ancien cache conservé et retourné comme obsolète. |
| Aucun cache exploitable et réseau indisponible | Erreur contrôlée sans crash ni catalogue manuel. |
| Catalogue disponible hors ligne | Aucune garantie supplémentaire sur les fichiers des portraits. |

Un cache illisible ne doit pas être confondu avec un catalogue valide : le scénario « aucun cache exploitable » fournit déjà l'issue fonctionnelle attendue. Les mécanismes précis de validation relèvent de l'implémentation.

## Périmètre et dépendances

### Inclus

Chargement au démarrage, normalisation, version globale, locale française, cache persistant, repli, erreur contrôlée et exposition des données et de leur état aux composants futurs.

### Exclu

Champion Picker, liste graphique complète, filtrage par rôle, recommandations, patch joueur/régional, statistiques, winrates, historique joueur, ranked, Riot Match API, API Riot authentifiée, téléchargement local de tous les portraits et interface complète d'erreur.

### Dépendances

- LAN-001 : socle existant constaté lors de l'inspection précédente ; aucune nouvelle preuve de conformité du socle n'est prétendue ici.
- Accès à Data Dragon pour une première récupération réussie.
- `localStorage` disponible pour la persistance demandée.
- Aucun service OpenClaw ni `RIOT_API_KEY`.

LAN-003 est un consommateur futur, pas un prérequis. Aucune dépendance circulaire n'est identifiée.

## Questions nécessitant clarification

### Bloquantes

Aucune.

### Non bloquantes

Aucune question produit indispensable. Les choix techniques ouverts peuvent être documentés pendant la conception et la réalisation, sans nouveau cycle de validation du ticket.

## Clarifications suggérées

Aucune modification obligatoire du ticket. Il est suffisamment précis sans imposer de conception détaillée. Les conventions de fraîcheur, date et validation pourront être consignées avec l'implémentation.

## Décision de readiness

**Status : READY — 10 / 10**

Les quatre constats initiaux sont résolus. Le développeur dispose des informations nécessaires pour démarrer, traiter les principaux échecs et déterminer objectivement la fin du travail, sans inventer de règle produit importante.

Un score de 10 signifie que le ticket est prêt, pas que le code est livré ou que tout incident technique imaginable est spécifié.

## Prochaine étape recommandée

Passer à une conception technique légère puis à l'implémentation, ou directement à la réalisation si les choix internes restent simples. Vérifier les parcours listés dans le ticket, la cohérence version/catalogue et la compilation TypeScript. Mettre à jour l'architecture et le rapport de vérification au moment de la livraison effective.

Cette réévaluation modifie uniquement le présent rapport. Elle ne réalise pas le développement et ne présente pas les fonctionnalités prévues comme déjà implémentées.

## Suivi après évaluation

Une implémentation a ensuite été réalisée sur demande explicite. Voir le
[rapport de réalisation et de vérification](../verification.md) et
l'[architecture actualisée](../../architecture.md). Le score ci-dessus reste
une évaluation du ticket ; les résultats de livraison et leurs limites sont
documentés séparément dans ce rapport de vérification.
