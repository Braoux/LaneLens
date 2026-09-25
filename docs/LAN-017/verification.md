# LAN-017 — Vérification de la correction

## Reproduction avant correction

Reproduction effectuée le 24 septembre 2026 avec le runtime réel :

- provider sélectionné : `gemini` ;
- modèle : `gemini-3.8-flash` ;
- patch : `26.19` (`26.19-v1`) ;
- matchup : Ziggs + Galio contre Jinx + Swain ;
- statut HTTP : `503` ;
- code public : `ANALYSIS_PROVIDER_UNAVAILABLE` ;
- `X-Request-Id` : `bdbf0c7d-77f8-4824-8f27-adfad6cbdf68`.

Les événements `matchup_analysis_started`, `matchup_analysis_failed`,
`analysis_provider_failed` et `http_request_completed` étaient présents, mais
`analysis_provider_failed` ne contenait que le nom du provider et le code
LaneLens. La cause Google originale avait été supprimée successivement par le
provider puis par `MatchupAnalysisService`.

## Cause racine observée

Un appel direct minimal avec le SDK installé `@google/genai@2.24.0`, la même
configuration et le même modèle a retourné :

- statut provider : `429` ;
- type : `RateLimitError` ;
- catégorie normalisée : `rate_limit` ;
- motif : quota journalier Free Tier de `gemini-3.8-flash` dépassé.

La requête Interactions utilisée par LaneLens a également été comparée aux
types locaux du SDK et à la documentation Google : modèle, `system_instruction`,
entrée déterministe, `response_format` JSON Schema, `tools: []`, `store: false`,
timeout et absence de retry applicatif sont cohérents. Le Structured Output et
le schéma LaneLens ne sont pas la cause de cet incident.

## Correction

- Les providers encapsulent désormais leur cause dans une erreur structurée
  contenant le provider, le modèle, une catégorie et le statut lorsqu'il existe.
- `MatchupAnalysisService` préserve cette cause tout en continuant à exposer
  uniquement `ANALYSIS_PROVIDER_UNAVAILABLE` au contrôleur.
- `analysis_provider_failed` journalise les champs diagnostiques allowlistés et
  une erreur sérialisée/redacted, sans prompt, contexte, réponse, header ou clé.
- Les erreurs connues ne journalisent plus de stack ; la stack reste réservée aux
  erreurs internes inattendues.
- Le client frontend conserve le statut, le code LaneLens et `X-Request-Id` dans
  une erreur sûre, sans exposer le body technique dans l'interface.
- Aucun fallback de provider ou de format de sortie n'a été ajouté.

## Vérification après correction

Le même appel réel reste correctement sanitizé côté HTTP lorsqu'un quota Google
est fermé. Le request ID `f303c564-1466-4b98-b94c-dc22b9a21c76` corrèle :

- `matchup_analysis_started` ;
- `matchup_analysis_failed` ;
- `analysis_provider_failed` avec `provider=gemini`,
  `model=gemini-3.8-flash`, `category=rate_limit`, `status=429` et
  `errorName=RateLimitError` ;
- `http_request_completed` avec `status=503`.

Le contrat HTTP ne contient toujours que `ANALYSIS_PROVIDER_UNAVAILABLE`.
Aucune clé ou donnée de requête provider n'est présente dans les logs.

Un appel provider réel HTTP 200 doit être confirmé lorsque le quota Google de la
clé de développement est de nouveau disponible. Les tests automatisés restent
entièrement hors réseau.
