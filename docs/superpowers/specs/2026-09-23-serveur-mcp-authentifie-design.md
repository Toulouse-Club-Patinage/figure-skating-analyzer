# Serveur MCP authentifié (interroger SkateLab depuis Claude)

**Date** : 2026-09-23
**Statut** : design validé, spike (phase 0) réalisé le 2026-09-23 — plan : `docs/superpowers/plans/2026-09-23-serveur-mcp-authentifie.md`

## Problème

Les données de SkateLab (scores, éléments, PCS, résultats par catégorie,
statistiques club) ne sont consultables que via l'interface web. On veut pouvoir
les interroger en langage naturel depuis Claude : « compare la progression en
PCS de X sur la saison », « quels éléments le club rate le plus en Régional 2 ? ».

Le moyen standard est un **serveur MCP distant**, servi par l'instance SkateLab
elle-même, authentifié avec les comptes existants de l'application.

## Décisions de cadrage

| Question | Décision |
|---|---|
| Clients visés | **claude.ai (web, Desktop, mobile) + Claude Code** |
| Qui peut se connecter | **Tout utilisateur SkateLab, mêmes droits que dans l'app** (`skater` : patineurs rattachés uniquement ; `reader`/`coach` : données club ; `admin` : tout) |
| Surface exposée | **Outils métier typés, en lecture seule** — pas de SQL libre |
| Périmètre de données | **Compétition uniquement** (scores, éléments, PCS, résultats, stats club). Entraînement, bilans coach, incidents, humeurs et auto-évaluations **exclus** (données personnelles de mineurs envoyées à un tiers — nécessiterait une analyse RGPD dédiée) |
| Architecture | **Option A : MCP + serveur d'autorisation OAuth embarqués dans le backend Litestar**, outils implémentés par rebouclage sur les routes existantes |

## Contraintes imposées par Claude

Source : [Authentication for connectors](https://claude.com/docs/connectors/building/authentication).

- claude.ai n'accepte pas de jeton statique par utilisateur : il faut **OAuth
  avec enregistrement dynamique (DCR, RFC 7591) ou CIMD**. Le grant
  `client_credentials` (sans utilisateur) n'est pas supporté.
- **PKCE S256** obligatoire, annoncé via `code_challenge_methods_supported`.
- Découverte : `401` + `WWW-Authenticate: Bearer resource_metadata="…"` ;
  métadonnées RFC 9728 dont le champ `resource` correspond **exactement** à l'URL
  saisie ; métadonnées RFC 8414 servies par le serveur d'autorisation.
- `/token` en `application/x-www-form-urlencoded` ; `/register` en JSON.
- Clients publics (DCR/CIMD) → **rotation des refresh tokens** obligatoire ;
  refresh invalide → `invalid_grant` (pas d'autre code).
- Redirections : `https://claude.ai/api/mcp/auth_callback` (et bientôt
  `https://claude.com/api/mcp/auth_callback`) ; Claude Code utilise
  `http://localhost:<port>/callback` et `http://127.0.0.1:<port>/callback`,
  **port variable** → correspondance sans le port.
- Délai max 10 s pour découverte/registration/token, 30 s pour le refresh.
- Trafic entrant depuis `160.79.104.0/21` (le serveur doit être joignable
  publiquement, ce qu'il est déjà).
- Si `offline_access` figure dans `scopes_supported`, Claude le demande pour
  obtenir un refresh token.

## Architecture retenue

### Pourquoi l'option A

Trois options ont été examinées :

- **A. Embarqué dans le backend** — retenue.
- B. Conteneur MCP séparé appelant l'API REST : le serveur d'autorisation doit
  de toute façon vivre dans le backend (c'est lui qui a les utilisateurs) et la
  spec MCP interdit de relayer le jeton tel quel → échange de jeton en plus,
  deux services pour le même résultat.
- C. IdP externe (Auth0, WorkOS, Keycloak) : synchronisation des comptes et des
  rôles, dépendance (payante) supplémentaire — disproportionné pour un club.
  Google, déjà utilisé pour la connexion, ne fait ni DCR ni CIMD.

A garde la propriété « une instance autonome par club » (un process, un
déploiement, SQLite embarquée) et, surtout, permet de **réutiliser telles
quelles les règles d'accès des routes** (voir « Outils »).

### URLs

Avec `PUBLIC_BASE_URL=https://skatelab.toulouseclubpatinage.com` :

| URL | Rôle |
|---|---|
| `/mcp` | Endpoint MCP (Streamable HTTP) — l'URL à saisir dans Claude |
| `/.well-known/oauth-protected-resource/mcp` | Métadonnées de ressource protégée (RFC 9728), `resource` = `…/mcp`, `authorization_servers` = [issuer] |
| `/.well-known/oauth-authorization-server` | Métadonnées du serveur d'autorisation (RFC 8414), issuer = `PUBLIC_BASE_URL` |
| `/authorize` | Autorisation (redirige vers la page de consentement) |
| `/token` | Échange de code, refresh |
| `/register` | DCR |
| `/revoke` | Révocation (RFC 7009) |
| `/autorisation?demande=<id>` | Page React de consentement (UI en français) |
| `GET /api/oauth/requests/{id}` | Détails de la demande pour la page de consentement |
| `POST /api/oauth/consent` | Validation du consentement par l'utilisateur connecté (JWT habituel) |
| `GET/DELETE /api/oauth/grants` | Liste / révocation des applications connectées |

### Composants

```
backend/app/mcp/
  server.py        # instance MCP (SDK officiel `mcp`), déclaration des outils
  tools.py         # outils : appel rebouclé + mise en forme des réponses
  loopback.py      # client httpx ASGITransport vers l'app Litestar, JWT interne
  oauth_provider.py# OAuthAuthorizationServerProvider adossé à la base
  mount.py         # montage ASGI dans Litestar (MCP + routes auth du SDK)
  glossary.md      # ressource MCP : vocabulaire de notation (TES, PCS, GOE, catégories FFSG)
backend/app/models/oauth.py   # OAuthClient, OAuthAuthRequest, OAuthToken
backend/app/routes/oauth.py   # /api/oauth/consent, /api/oauth/grants
frontend/src/pages/AuthorizePage.tsx          # /autorisation
frontend/src/pages/ProfilePage.tsx            # + section « Applications connectées »
nginx.conf                                    # + locations /mcp, /.well-known/oauth-, /authorize, /token, /register, /revoke
```

Le SDK Python officiel (`mcp`) fournit le transport Streamable HTTP, les
handlers OAuth (`create_auth_routes` : métadonnées, authorize, token, register,
revoke, PKCE) et l'interface `OAuthAuthorizationServerProvider` que l'on
implémente. Le choix de version (1.x vs 2.x) est tranché au spike.

## OAuth et consentement

### Enregistrement des clients

- **DCR** uniquement : le SDK 2.2 ne prend pas en charge CIMD côté serveur
  (constaté au spike). Claude se rabat sur DCR, ce qui est supporté.
- **Liste blanche de `redirect_uris`** : un enregistrement est refusé si une de
  ses URIs n'est pas l'une de :
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
  - `http://localhost/callback`, `http://127.0.0.1/callback` (port ignoré)

  Le connecteur est ainsi réservé aux clients Claude : un site tiers ne peut pas
  s'enregistrer et hameçonner un consentement.
- `/register` limité en débit (réutilisation de `auth/rate_limit.py`).
- Purge des clients sans jeton actif depuis 30 jours (tâche dans la boucle de
  fond existante de `main.py`).

### Flux d'autorisation

1. Claude appelle `/mcp` sans jeton → `401` + `WWW-Authenticate: Bearer
   resource_metadata="{base}/.well-known/oauth-protected-resource/mcp",
   scope="skatelab:read"`.
2. Découverte, (enregistrement), puis `GET /authorize` avec PKCE. Le SDK
   valide client / redirect / PKCE ; `provider.authorize()` enregistre une
   **demande en attente** (`oauth_auth_requests` : client, redirect_uri,
   code_challenge, state, scopes, resource, expiration 10 min) et redirige vers
   `/autorisation?demande=<id>`.
3. La page React : si l'utilisateur n'est pas connecté → `LoginPage` avec
   retour vers la page (mot de passe ou Google ; changement de mot de passe
   forcé traité d'abord). Puis affichage :
   - « **Claude** demande un accès en lecture à vos données SkateLab »
   - l'identité connectée et ce qu'elle verra (« vos patineurs rattachés » pour
     `skater`, « les données du club » sinon)
   - l'hôte de redirection, avec **avertissement** si c'est une adresse locale
     (exigence de la spec MCP pour les redirections loopback)
   - boutons **Autoriser** / **Refuser**
4. `POST /api/oauth/consent {demande, approuve}` (JWT habituel) : crée un code
   d'autorisation à usage unique (≥ 160 bits, 5 min) lié à l'utilisateur et
   renvoie l'URL de redirection (`redirect_uri?code=…&state=…`, ou
   `error=access_denied`). Le navigateur y est envoyé.
5. `POST /token` : le SDK vérifie PKCE ; `exchange_authorization_code()`
   consomme le code et émet access + refresh.

### Jetons

- **Opaques** (aléatoires, 256 bits), stockés **hachés** (SHA-256) dans
  `oauth_tokens` (user_id, client_id, type, scopes, resource, expires_at,
  revoked_at, famille de refresh).
- Access : **1 h**. Refresh : **30 jours**, **rotation à chaque usage** ;
  réutilisation d'un refresh déjà consommé → révocation de toute la famille
  (détection de vol) et `invalid_grant`.
- Scopes : `skatelab:read` (unique) + `offline_access`.
- **Validation à chaque requête MCP en base** : jeton non révoqué et non
  expiré, `resource` = URL MCP, utilisateur `is_active`, et `token_version` de
  l'utilisateur identique à celle du moment de l'émission. Conséquence :
  désactiver un compte, « se déconnecter partout » ou changer de mot de passe
  coupe aussi l'accès MCP. (Les access JWT de l'app, eux, restent sans état.)

### Gestion des accès

- Profil → section **« Applications connectées »** : liste des autorisations
  (client, date, dernière utilisation) et bouton **Révoquer**.
- Admin : vue de toutes les autorisations actives, révocation possible.

## Outils

### Principe : rebouclage sur les routes existantes

Chaque outil appelle en interne une route `GET /api/...` **inscrite sur une
liste blanche**, via `httpx.AsyncClient(transport=ASGITransport(app))`, avec un
JWT d'accès **éphémère (60 s)** créé par `create_access_token(user_id, role,
expires_seconds=60)` pour l'utilisateur du jeton MCP. `auth_guard` l'accepte
sans modification.

Avantages : aucune logique de droits dupliquée, les règles d'accès suivent
automatiquement l'évolution des routes. L'outil ne fait que choisir la route,
passer les paramètres, **alléger** la réponse (champs purement UI retirés,
paramètre `limit`, tri) et la renvoyer en JSON. Tous les outils sont annotés
`readOnlyHint`.

### Liste des outils (v1)

| Outil | Route(s) rebouclée(s) | Rôles |
|---|---|---|
| `whoami` | aucune — lu directement depuis l'utilisateur du jeton (nom, email, rôle) | tous |
| `list_my_skaters` | `GET /api/me/skaters` | tous (utile surtout à `skater`) |
| `search_skaters(query, club?)` | `GET /api/skaters/` | hors `skater` |
| `get_skater(skater_id)` | `GET /api/skaters/{id}` | tous (scopé) |
| `get_skater_scores(skater_id, season?)` | `GET /api/skaters/{id}/scores` | tous (scopé) |
| `get_skater_elements(skater_id, element?)` | `GET /api/skaters/{id}/elements` | tous (scopé) |
| `get_skater_category_results(skater_id)` | `GET /api/skaters/{id}/category-results` | tous (scopé) |
| `get_skater_seasons(skater_id)` | `GET /api/skaters/{id}/seasons` | tous (scopé) |
| `list_competitions(season?)` | `GET /api/competitions/` | hors `skater` |
| `get_competition(competition_id)` | `GET /api/competitions/{id}` | hors `skater` |
| `get_score_elements(score_id)` | `GET /api/scores/{id}/elements` | **voir constat ci-dessous** |
| `get_team_scores(competition_id)` | `GET /api/competitions/{id}/team-scores` | **voir constat ci-dessous** |
| `club_progression_ranking` | `GET /api/stats/progression-ranking` | hors `skater` |
| `club_benchmarks` | `GET /api/stats/benchmarks` | hors `skater` |
| `club_element_mastery` | `GET /api/stats/element-mastery` | hors `skater` |
| `competition_club_analysis` | `GET /api/stats/competition-club-analysis` | hors `skater` |

Les outils réservés « hors `skater` » restent listés pour tous (le SDK n'a pas
de filtrage par utilisateur simple) : pour un `skater`, la route renvoie 403 et
l'outil répond un message clair (« réservé à l'encadrement du club »).

**Jamais sur la liste blanche** : `training`, `self_eval`, `me` hors `/api/me/skaters`,
`admin`, `users`, `jobs`, `reports`, et toute route non-`GET`.

Ressource MCP `skatelab://glossaire` : vocabulaire de notation (TES, PCS, GOE,
valeur de base, catégories et niveaux FFSG, segments) pour que Claude interprète
correctement les chiffres.

Chaque appel rebouclé est journalisé (utilisateur, rôle, route et paramètres,
code retour, durée) ; `whoami` n'appelle aucune route et n'est donc pas
journalisé.

### ⚠️ Constat préalable : routes sans contrôle de rôle

Relevé pendant l'étude : `GET /api/scores/`, `GET /api/scores/{id}/elements`,
`GET /api/scores/category-results` et les routes de `team_scores.py` ne
vérifient **ni le rôle ni le rattachement**. Un compte `skater` peut donc déjà
lire tous les scores de tous les patineurs via l'API.

**Décision (2026-09-23) : on corrige ces routes avant d'exposer les outils.**
Pour le rôle `skater` : `GET /api/scores/` et `GET /api/scores/category-results`
ne renvoient que les patineurs rattachés ; `GET /api/scores/{id}/elements`
vérifie le rattachement du patineur du score ; les routes `team-scores` /
`team-medians` refusent le rôle `skater` (l'UI skater n'affiche pas ces pages).
`get_score_elements` et `get_team_scores` suivent alors les mêmes règles que les
autres outils. La phase 2 inclut un **audit, sous forme de tests**, de chaque
route de la liste blanche avec un compte `skater` non rattaché.

## Déploiement

- Nouvelle variable `PUBLIC_BASE_URL` (issuer et `resource` ; doit correspondre
  exactement à l'URL saisie dans Claude, sans slash final).
- `nginx.conf` (image frontend) : `location = /mcp` (`proxy_buffering off`,
  `proxy_read_timeout` long, en-têtes `X-Forwarded-*`), `location
  /.well-known/oauth-`, `location = /authorize|/token|/register|/revoke` →
  `backend:8000`. En dev, le proxy Vite relaie les mêmes chemins. La route SPA
  `/autorisation` reste servie par le fallback.
- VM GCP actuelle : son `docker-compose.yml` est écrit à la main sur la VM
  (`docs/gcp-setup.md` §6) → y ajouter `PUBLIC_BASE_URL`. VPS (futur) : le Caddy
  de bordure relaie déjà tout vers le frontend, rien à changer.
- Aucun conteneur supplémentaire. Tables créées par `init_db` comme les autres.

## Résultats du spike (phase 0, 2026-09-23)

SDK `mcp` **2.2.0** (ligne 2.x), Litestar 2.22. Script jetable, hors dépôt.

- **Montage** : un **dispatcher ASGI externe** (`app.main:app`) envoie `/mcp`,
  `/.well-known/oauth-*`, `/authorize`, `/token`, `/register`, `/revoke` à
  l'app Starlette du SDK et tout le reste à Litestar. `auth_guard` ne voit
  jamais les chemins MCP. Le session manager du SDK est démarré depuis le
  `lifespan` Litestar. Validé : 401 + `resource_metadata`, métadonnées, DCR
  public (`none`) avec le callback claude.ai, `initialize`, appel d'outil.
- **Rebouclage** : validé (outil → `GET /api/skaters/` in-process, 200).
- Les endpoints OAuth du SDK sont **à la racine** (issuer = URL de base) : on
  garde ces chemins plutôt que `/oauth/*`, qui casserait la découverte RFC 8414.
- L'issuer doit être en HTTPS (sauf `localhost`) et passé en **chaîne** (un
  `AnyHttpUrl` ajoute un `/` final).
- Les métadonnées du SDK n'annoncent pas `none` dans
  `token_endpoint_auth_methods_supported` alors que les clients publics sont
  acceptés : on sert nos propres métadonnées AS, complétées.
- Redirections comparées **exactement** : sous-classe du modèle client pour
  ignorer le port des adresses loopback.
- **Pas de CIMD** côté serveur → DCR seul.
- `session_manager.run()` n'est appelable qu'**une fois par instance** : l'app
  MCP est construite par une fabrique (une instance par test).

## Risques identifiés avant le spike

1. **Montage du SDK dans Litestar** : monter les apps Starlette du SDK (MCP +
   routes auth) via un handler `asgi(is_mount=True)` ; vérifier que
   `before_request=auth_guard` ne s'applique pas à ces montages (sinon ajouter
   les préfixes aux chemins publics), et démarrer le session manager
   Streamable HTTP depuis le `lifespan` Litestar.
   **Repli** : écrire les ~300 lignes d'endpoints OAuth nativement en Litestar
   et n'utiliser le SDK que pour le transport MCP et la vérification de jeton.
2. **CIMD côté serveur** dans le SDK : pris en charge ou non ; sinon DCR seul.
3. **Rebouclage ASGI** : référence circulaire vers `app` (résolue par un
   enregistrement tardif), sessions SQLite concurrentes, coût par appel.
4. **Fuites héritées** : voir le constat ci-dessus.

Critère de sortie du spike : `claude mcp add --transport http skatelab
http://localhost:8000/mcp` en local → flux OAuth complet → un outil `whoami`
renvoie l'utilisateur connecté.

## Tests

- **Provider OAuth** (unitaires) : code à usage unique, expiration des demandes
  et des codes, rotation du refresh et révocation de la famille en cas de
  réutilisation, `invalid_grant`, liste blanche des redirections (port ignoré
  pour loopback), cascade `is_active` / `token_version`.
- **Intégration** : client MCP du SDK contre l'app ASGI (découverte → DCR →
  authorize → consentement → token → `list_tools` → appel d'outil).
- **Droits par outil** : `skater` rattaché / non rattaché, `reader`, `coach`,
  `admin` ; les outils restent listés pour tous les rôles, `skater` reçoit
  « Accès refusé » sur les outils hors de son périmètre (voir « Outils »).
- **Frontend** : page `/autorisation` (connecté / non connecté / refus / demande
  expirée).
- **Manuel** : Claude Code (`claude mcp add --transport http`) et connecteur
  personnalisé claude.ai sur un environnement exposé en HTTPS (préproduction ou
  tunnel), [MCP Inspector](https://github.com/modelcontextprotocol/inspector).

## Phases

0. **Spike** — montage SDK + poignée de main OAuth minimale + `whoami`. Tranche
   les risques 1 à 3 et la version du SDK.
1. **Serveur d'autorisation** — modèles, provider, DCR, page
   `/autorisation`, `POST /api/oauth/consent`, validation en base.
2. **Outils** — décision et correctif sur les routes sans scoping, audit
   `skater`, outils v1, ressource glossaire, journalisation.
3. **Gestion et mise en production** — « Applications connectées », vue admin,
   purge des clients, nginx, `PUBLIC_BASE_URL`, documentation utilisateur
   (comment ajouter le connecteur dans claude.ai et Claude Code).

## Hors périmètre (v1)

- Données d'entraînement et de bien-être (possible en v2 après analyse RGPD).
- SQL libre, même pour les admins.
- Toute écriture (import de compétition, modification).
- Publication dans l'annuaire des connecteurs Anthropic.
