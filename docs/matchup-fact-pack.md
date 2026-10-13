# Matchup Fact Pack

## Objectif

`MatchupFactPack` est une projection métier déterministe des faits autorisés
pour un matchup. Sa construction est locale, sans provider, réseau, scraping ou
génération LLM. Elle ne modifie pas le parcours HTTP utilisateur.

Le builder ne crée pas une nouvelle base de vérité. Il assemble :

- les identités, noms, slots, disponibilités, cooldowns et descriptions depuis
  le snapshot Data Dragon projeté par `StaticGameplayContextResolver` ;
- les cast models et effets normalisés depuis `TRUSTED_ABILITY_MECHANICS` ;
- les faits vérifiés et leurs IDs depuis `StaticKnowledgeRepository` ;
- la preuve de couverture depuis `MechanicalCoverageGate` et la golden truth
  versionnée.

Les heuristiques ne sont jamais intégrées aux faits autorisés du pack.

### Extension globale volontairement vide en B1

Le schéma sépare `championFacts` de `globalFacts`. `globalFacts` vaut toujours
`[]` dans l'implémentation actuelle. Son contrat minimal réserve seulement un
`factId`, un domaine, une période de validité par patch et des sources. Il
permettra ultérieurement de représenter objectifs neutres, mécaniques
saisonnières, règles macro ou règles de patch sans les mélanger aux faits
propres aux champions.

B1 n'ajoute ni données globales, ni resolver, ni couverture, ni logique métier
pour ces domaines. Leur sélection et leur validation devront être définies par
un lot ultérieur à partir de sources canoniques.

## Contrat livré

Le contrat est défini dans `server/knowledge/MatchupFactPack.ts` et construit
par `MatchupFactPackBuilder`.

Un pack contient :

- `factPackVersion`, `patch`, `knowledgeBaseVersion`, `goldenTruthVersion` et
  `dataDragonVersion` ;
- quatre participants ordonnés : carry allié, support allié, carry ennemi,
  support ennemi ;
- `championFacts`, qui contient un fait par capacité avec propriétaire, slot,
  nom, disponibilité, cooldowns, descriptions, cast model, effets et
  provenance, ainsi que les faits KB vérifiés applicables aux champions ;
- `globalFacts`, point d'extension distinct pour les faits globaux du jeu ;
- une couverture explicite des champions, capacités, interactions critiques et
  informations manquantes.

Les identifiants de capacité suivent la forme stable
`ability:<champion-key>:<slot>`, par exemple `ability:jinx:e`. Une évolution de
valeur est désambiguïsée par les versions et le patch du pack, sans changer
l'identité conceptuelle de la capacité.

Chaque capacité référence ses sources :

- `data-dragon:<version>:<champion-key>:<slot>` pour la projection Riot ;
- `trusted-mechanics:<champion-key>:<slot>` pour la taxonomie mécanique relue ;
- l'ID KB existant, par exemple `ability-jinx-e-mechanics`, lorsqu'une entrée
  structurée correspondante existe.

## Couverture

`coverage.status` vaut `full` uniquement si le matchup satisfait le mechanical
coverage gate et si toutes ses capacités projetées sont couvertes. La présence
des quatre champions ou un `KnowledgeCoverage.full` ne suffit jamais.

Une donnée absente reste visible dans :

- `ability.coverage.status = partial` ;
- `ability.coverage.missing` ;
- `coverage.missing` ;
- `coverage.status = partial`.

`criticalInteractions.status = none-known` signifie qu'aucun fait
d'interaction vérifié n'est disponible pour ce matchup. Cela ne prouve pas
l'absence d'interaction mécanique et n'invente pas un manque bloquant que la
golden truth actuelle n'exige pas. Lorsqu'une interaction vérifiée existe, ses
IDs apparaissent dans `criticalInteractions.factIds`.

## Inspection locale

La commande suivante inspecte un matchup du corpus qui déclare un
`fullCoverageGate` :

```powershell
npm run eval:fact-pack -- --id L61-G01
```

Un autre corpus peut être fourni explicitement :

```powershell
npm run eval:fact-pack -- --corpus evaluation/corpus/lan-061-golden-v1.json --id L61-G01
```

La commande écrit un document JSON unique sur la sortie standard. Elle ne
configure et n'appelle aucun provider.

## Contrat préparatoire du Strategy Plan

Le futur `MatchupStrategyPlan` n'est pas implémenté dans ce lot. Son contrat
d'assertion devra au minimum conserver :

```ts
interface StrategyAssertionFactReference {
  readonly assertion: string;
  readonly factIds: readonly string[];
}
```

Règles attendues pour le lot suivant :

1. chaque `factId` doit être résolu dans le Fact Pack exact utilisé pour le
   plan ;
2. une assertion mécanique doit référencer au moins un fact ;
3. plusieurs facts peuvent justifier une interaction ou une séquence ;
4. un fact absent ne peut pas être reconstruit depuis une ancienne analyse ;
5. une information `partial`, `none-known` ou absente reste explicitement
   inconnue ;
6. le Strategy Plan ne doit pas modifier le Fact Pack reçu.

La sélection stratégique, la génération, le repair et le renderer du Strategy
Plan restent hors périmètre de ce contrat livré.
