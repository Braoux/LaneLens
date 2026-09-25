# LAN-018 — Vérification Groq

## Configuration locale

Le test réel est optionnel et n'est jamais exécuté par `npm test`.

```env
AI_PROVIDER=groq
GROQ_API_KEY=<clé locale>
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TIMEOUT_MS=30000
```

Le secret reste uniquement dans `.env`, ignoré par Git.

## Recette manuelle

1. Démarrer le serveur avec `npm run dev:server`.
2. Lire le patch actif avec `GET /api/analysis-context`.
3. Envoyer `POST /api/matchup` avec Ziggs + Galio contre Jinx + Swain et ce patch.
4. Vérifier un HTTP 200 et un `MatchupAnalysis` valide.
5. Ouvrir le frontend et vérifier Quick Overlay puis Full Analysis.

Le provider utilise Chat Completions, un JSON Schema strict, le raisonnement
`medium`, un timeout borné, aucun outil et aucun retry. En cas d'échec, le
contrat public reste `ANALYSIS_PROVIDER_UNAVAILABLE` et le diagnostic local
`analysis_provider_failed` conserve uniquement des champs sûrs et redacted.

## Résultat du test réel

Test effectué le 25 septembre 2026 avec le serveur réel configuré via
`AI_PROVIDER=groq` :

- modèle : `openai/gpt-oss-120b` ;
- matchup : Ziggs + Galio contre Jinx + Swain ;
- patch : `26.19` ;
- résultat : HTTP 200 ;
- request ID : `88589b7f-295c-46dc-a4d4-2bde19ee37cd` ;
- les dix sections attendues du contrat étaient présentes ;
- la réponse a passé la validation LaneLens.

Le client Groq omet entièrement le champ `tools` de la requête SDK afin de ne
pas activer le chemin tool-use, incompatible avec les Structured Outputs
stricts. Un test de régression vérifie cette absence.

La réponse complète et la clé n'ont pas été affichées ni écrites dans ce rapport.
