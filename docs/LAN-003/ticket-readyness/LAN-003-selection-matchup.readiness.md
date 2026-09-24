# Ticket Readiness — LAN-003 — Sélectionner les quatre champions du matchup

**Ticket :** LAN-003  
**Branche inspectée :** LAN-002  
**Date :** 2026-09-24  
**Type :** Fonctionnalité frontend  
**Readiness Score :** 7 / 10  
**Status :** NEEDS CLARIFICATION

## Résumé

Créer l'écran principal avec quatre slots de matchup, un sélecteur de champions recherchable, la possibilité de remplacer les sélections et un bouton Analyser conditionné au remplissage du formulaire. Consommer le catalogue préparé par LAN-002 et afficher sa version technique explicitement comme Data Dragon, jamais comme un patch joueur déduit.

Le parcours de sélection est compréhensible. Les règles de doublons et la portée du bouton Analyser restent à préciser pour ne pas inventer de comportement produit.

## Sources et contexte inspectés

- Ticket fourni dans la conversation, y compris sa note complémentaire qui remplace explicitement l'ancien libellé d'AC6.
- [Cahier des charges](../../cahier-des-charges.md), notamment écran principal, recherche (§15), style (§14), erreurs (§24) et responsive (§27).
- [Architecture](../../architecture.md).
- `src/champions.ts`, `src/catalog-state.ts` et `src/main.ts` inspectés dans le dépôt.
- Skill appliqué : `C:/Skills/Skills/Ticket-Readyness/SKILL.md`, déjà lu dans cette conversation.

La branche courante est encore `LAN-002`. Le rapport suit la convention demandée `docs/<branche>/`, avec LAN-003 dans son nom pour éviter toute confusion. Aucun changement de branche, de code ou d'architecture réalisé.

## Score de readiness

| Dimension | Score | Justification |
|---|---:|---|
| R1 — Intention et résultat attendu | 2 / 2 | Écran, quatre rôles et interactions principales explicites. |
| R2 — Règles et comportement | 1 / 2 | Doublons et résultat de l'action Analyser non définis (TR-01, TR-02). |
| R3 — Acceptation et vérifiabilité | 1,5 / 2 | Sélection et version vérifiables ; AC5 ne décrit pas le parcours après remplissage (TR-02). |
| R4 — Périmètre et dépendances | 1,5 / 2 | Dépendance LAN-002 claire, mais frontière avec l'analyse métier incomplète (TR-02). |
| R5 — Cas limites et complétude opérationnelle | 1 / 2 | États catalogue non nominal, recherche vide et portraits indisponibles non explicités pour l'écran (TR-03). |
| **Total** | **7 / 10** | |

## Informations confirmées

- Exactement quatre slots : carry allié, support allié, carry adverse, support adverse.
- Deux groupes Notre botlane / botlane adverse, séparés par VS.
- Les rôles sont des labels, pas des filtres : tout champion du catalogue est accessible pour chaque rôle.
- Cliquer sur un slot ouvre un Champion Picker avec recherche et résultats comprenant nom et portrait.
- Recherche insensible à la casse ; `jin` doit notamment retourner Jinx.
- Sélection : nom et portrait apparaissent dans le slot correspondant.
- Une sélection existante peut être remplacée.
- Analyser reste désactivé tant que les quatre slots ne sont pas remplis.
- Version Data Dragon affichée explicitement comme telle, sans conversion ni résolution régionale.
- La clarification finale remplace l'exemple « Patch 26.19 » d'AC6 : ce n'est pas une contradiction résiduelle à faire arbitrer.
- Restriction ADC/support, recommandations, statistiques et compte Riot exclus.
- Le cahier des charges complète la direction visuelle : sombre, minimaliste, sans framework UI lourd, utilisable sur PC, tablette et smartphone.

## Dépendance LAN-002 constatée dans le code

- `Champion` expose `id`, `name`, `imageUrl`.
- `ChampionCatalog` expose les champions, `dataDragonVersion`, `locale`, `source`, `stale` et `fetchedAt`.
- `initializeChampionCatalog()` retourne une promesse partagée ; `getChampionCatalogState()` expose idle/loading/ready/error.
- Le chargement est déjà déclenché depuis `main.ts`.
- Le cache peut produire un catalogue valide mais potentiellement obsolète.
- Les URLs des portraits sont conservées, pas leurs fichiers : un catalogue utilisable ne garantit pas des images disponibles.
- L'écran actuel est une page d'attente avec contrôle de santé du backend. Aucun sélecteur ni formulaire de matchup n'existe dans le code inspecté.

La dépendance est présente au niveau du code. Cette évaluation ne réexécute pas sa recette et ne prétend pas vérifier son fonctionnement navigateur.

## Inférences, hypothèses et inconnues

### Inférences

- Le choix doit identifier le slot actif et n'affecter que celui-ci.
- La recherche porte naturellement sur le nom affiché issu du catalogue français ; la recherche immédiate est demandée par le cahier des charges.
- La clarification de version exclut une nouvelle dépendance à un service de patch joueur.

### Hypothèses non confirmées

- Aucune règle d'unicité ne peut être déduite des rôles ou de l'exemple à quatre champions distincts.
- L'activation d'Analyser après quatre choix est suggérée, mais son effet n'est pas spécifié.
- La persistance des sélections n'est pas demandée : elle ne doit pas être importée implicitement du cache catalogue.

### Choix techniques non bloquants

Modale ou panneau, découpage des modules DOM, tri des résultats, fermeture du picker et retour de focus relèvent d'une conception proportionnée. La navigation clavier et des libellés accessibles doivent être pris en compte sans exiger une maquette exhaustive avant de commencer.

## Constats

### TR-01 — Unicité des champions non définie

**Severity :** BLOCKING

**Observé :** Les quatre slots peuvent consulter le même catalogue, sans filtrage par rôle. Aucune règle n'indique si un champion déjà choisi reste sélectionnable ailleurs.

**Manquant ou ambigu :** Doublons autorisés partout, interdits dans une équipe seulement, ou interdits sur les quatre slots ? En cas d'interdiction, quel comportement à la sélection d'un doublon ?

**Pourquoi cela compte :** La réponse change la validité du matchup et le comportement de sélection. Autoriser le même champion en carry et support, empêcher un miroir entre équipes ou déplacer une sélection constituent des décisions produit différentes. Les règles de League ne doivent pas être imposées implicitement à cet outil.

**Question / action requise — bloquante :** Définir la portée de l'unicité. Si une restriction est demandée, préciser le résultat attendu d'un choix déjà utilisé, sans déplacer silencieusement un autre slot.

### TR-02 — Effet et frontière du bouton Analyser

**Severity :** BLOCKING

**Observé :** AC5 définit uniquement quand le bouton reste désactivé. L'objectif porte sur l'écran de sélection ; le cahier des charges décrit ultérieurement un appel backend d'analyse.

**Manquant ou ambigu :** Après quatre sélections valides, faut-il seulement activer le bouton, exposer le matchup à un futur consommateur, afficher un état transitoire ou appeler une API ? Aucun contrat d'action n'est établi pour LAN-003.

**Pourquoi cela compte :** Un bouton actif sans effet, un événement local et une intégration backend ne représentent pas la même livraison. Importer la génération d'analyse depuis le cahier des charges élargirait fortement le périmètre et réintroduirait la question du patch d'analyse, explicitement différée.

**Question / action requise — bloquante :** Définir l'effet observable d'Analyser une fois les quatre choix valides, et indiquer explicitement si les appels réseau d'analyse restent hors périmètre. Un simple contrat local est possible, mais il ne doit pas être inventé par l'évaluation.

### TR-03 — Restitution des états non nominaux du catalogue

**Severity :** IMPORTANT

**Observé :** LAN-002 fournit les états loading/error, un indicateur stale et des portraits dont la disponibilité n'est pas garantie. Le ticket décrit seulement la sélection avec un catalogue disponible.

**Manquant ou ambigu :** Que voit l'utilisateur durant le chargement, sans catalogue exploitable ou avec un cache obsolète ? Comment distinguer une recherche sans résultat d'un catalogue en erreur ? Un portrait absent doit-il avoir un remplacement visuel ?

**Pourquoi cela compte :** Cet écran devient le consommateur effectif des états préparés par LAN-002. Sans restitution, un picker vide ou inaccessible est ambigu pour l'utilisateur. Ces cas ne nécessitent pas une interface d'erreur complexe, mais des résultats observables minimaux.

**Question / action requise — non bloquante pour construire le parcours nominal :** Ajouter des attentes minimales de chargement, erreur, résultat vide et image indisponible ; préciser si le catalogue stale reste sélectionnable avec une indication informative. Le texte exact et le dessin du placeholder sont des détails non bloquants.

## Évaluation des critères d'acceptation

| Critère | Évaluation |
|---|---|
| AC1 — Quatre slots | Clair : vérifier le nombre, les rôles et les groupes. |
| AC2 — Recherche | Testable avec `jin`, `JIN` et `Jin` ; pas de filtre de rôle. L'exemple ne demande pas que Jinx soit l'unique résultat. |
| AC3 — Sélection | Clair sur nom, portrait et slot destinataire ; dépend de TR-01 pour les doublons. |
| AC4 — Modification | Testable : remplacer un choix sans altérer les autres ; politique de doublons à fixer. |
| AC5 — Analyse désactivée | Testable pour 0 à 3 sélections ; comportement à 4 et après clic à préciser via TR-02. |
| AC6 — Version visible | Appliquer la clarification : afficher `Data Dragon <dataDragonVersion>` du catalogue réellement utilisé, y compris en cache. Ne pas déduire un patch régional. |

Le passage au mobile et la lisibilité sont à contrôler selon le cahier des charges. La sensibilité aux accents ou la recherche par alias ne sont pas exigées ; leur absence ne constitue pas un blocage.

## Périmètre

### Connu

Écran principal, quatre slots, picker, recherche insensible à la casse, choix et remplacement, condition d'activation du bouton et version technique affichée. Réutilisation du catalogue frontend de LAN-002.

### À préciser

Unicité des choix, action finale du bouton et restitution minimale des états catalogue.

### Exclu ou non demandé

Filtres de rôle, recommandations, statistiques, compte Riot, conversion ou détection du patch joueur. Persistance du matchup, drag-and-drop, échange automatique de slots et raccourcis spécialisés non demandés. L'analyse OpenClaw ne doit pas entrer implicitement dans ce ticket.

## Dépendances

- LAN-002 : contrats et cache disponibles dans le dépôt inspecté.
- Catalogue réseau ou cache exploitable pour sélectionner ; fichiers portraits potentiellement indisponibles séparément.
- Stack vanilla TypeScript, HTML et CSS du socle existant.
- Aucune nouvelle clé Riot ou source de patch régional nécessaire.
- Aucune maquette exhaustive ni conception technique détaillée indispensable à la readiness.

## Questions nécessitant clarification

### Bloquantes

1. Un champion peut-il apparaître dans plusieurs slots ? Si non, l'interdiction concerne-t-elle chaque équipe ou tout le matchup, et que se passe-t-il lors d'un choix en conflit ?
2. Une fois les quatre slots valides, quel est l'effet d'Analyser dans LAN-003 ? Les appels backend/OpenClaw restent-ils exclus ?

### Non bloquantes

1. Quels états minimaux afficher pendant le chargement, en erreur sans catalogue, avec cache obsolète et sans résultat de recherche ?
2. Quel remplacement visuel utiliser si un portrait est inaccessible ?

## Clarifications suggérées

- Ajouter une règle explicite sur les doublons avec un exemple autorisé/interdit.
- Compléter AC5 par l'activation après quatre choix valides et l'effet attendu du clic, sans imposer une intégration non prévue.
- Décrire succinctement les états catalogue et recherche ; un placeholder de portrait et un message simple suffisent si retenus.
- Conserver la clarification Data Dragon comme référence d'AC6 ; aucune nouvelle question n'est nécessaire sur ce point.

Ces suggestions ne sont pas des règles déjà approuvées et ne constituent pas une réécriture du ticket.

## Décision de readiness

**Status : NEEDS CLARIFICATION — 7 / 10**

L'écran et ses données sont suffisamment cadrés pour préparer le travail, mais les doublons et l'action Analyser exigent deux décisions fonctionnelles avant une implémentation complète. La clarification du libellé Data Dragon est suffisante et n'est pas un blocage.

## Prochaine étape recommandée

Répondre aux deux questions bloquantes, préciser les états visuels minimaux, puis mettre à jour ce rapport et passer à l'implémentation. Aucun code n'a été modifié et aucun service n'a été démarré pour cette analyse.
