# Compétitions visibles par les comptes patineur + notifications de résultats

**Date** : 2026-10-08
**Statut** : design validé, à implémenter

## Problème

Un utilisateur de rôle `skater` (parent ou patineur) ne voit aujourd'hui que les
scores de ses patineurs rattachés (`UserSkater`), depuis la page d'analyse du
patineur. Il ne peut pas ouvrir l'écran d'une compétition (`GET
/api/competitions/*` appelle `reject_skater_role`), donc pas voir le classement
complet d'une catégorie. Il n'est pas non plus prévenu quand les résultats de ses
patineurs tombent : seuls les admins reçoivent une notification lors du polling
d'une compétition en cours (`notify_competition_update`).

On veut :

1. qu'un compte patineur voie les résultats des compétitions auxquelles ses
   patineurs participent, **sans** pouvoir ouvrir le profil des autres patineurs
   depuis cet écran ;
2. qu'il reçoive une notification quand les scores de ses patineurs sont publiés
   ou mis à jour, ou que leur feuille de score est disponible.

## Décisions

- **« Inscrit » = a au moins un résultat dans la compétition** (`Score` ou
  `CategoryResult`). Les listes d'engagés ne sont pas scrapées ; une compétition
  apparaît pour le compte dès la publication du premier segment.
- **Classements complets, sans détail pour les autres** : le compte voit toutes
  les lignes (nom, club, rang, TES/PCS/total) de toutes les catégories de la
  compétition ; les noms des autres patineurs ne sont pas cliquables, et leurs
  éléments, composantes détaillées par juge et lien PDF ne sont pas exposés.
- **Événements notifiés** : nouveau score de segment, score corrigé, feuille de
  score disponible, classement final publié ou modifié. **Pas** les simples
  changements de rang d'un segment (trop fréquents pendant que les autres
  patinent).
- **Regroupement** : une notification par (utilisateur, compétition) et par
  passage de polling, listant patineurs et événements.
- **Canaux** : in-app (cloche existante) + email si `User.email_notifications`.
- **Déclencheur** : uniquement pour une compétition en cours
  (`Competition.polling_enabled`) — polling automatique ou import manuel. Jamais
  pour un réimport d'archives.
- **Job `poll` unique** (option retenue parmi trois) : le polling soumet un seul
  job qui enchaîne import puis enrichissement et notifie une fois à la fin. Écartés :
  une table tampon d'événements (table + flusher + purge, inutile avec une file à
  worker unique séquentiel) et une notification à la fin de chaque job (deux
  notifications/emails à une minute d'écart).

## Conception

### 1. Accès compétition pour le rôle `skater` (backend)

**Helper** dans `app/auth/guards.py` :

```python
async def visible_competition_ids(request, session) -> set[int] | None
```

`None` pour les rôles non restreints ; pour `skater`, l'ensemble des
`competition_id` où au moins un patineur lié a un `Score` ou un `CategoryResult`
(union des deux requêtes, à partir de `linked_skater_ids`).

**Routes `competitions`** :

- `GET /api/competitions/` : `reject_skater_role` retiré ; pour un patineur, la
  requête est restreinte à `Competition.id IN visible` (ensemble vide → liste
  vide). Les filtres `club`/`season`/`ligue`/`my_club` restent applicables.
- `GET /api/competitions/{id}` : `reject_skater_role` retiré ; 403 si l'id n'est
  pas dans l'ensemble visible.
- Toutes les autres routes (import, enrich, polling, métadonnées, saisons, team
  scores…) sont inchangées.

**Routes `scores`** (`GET /api/scores/` et `GET /api/scores/category-results`),
pour un patineur :

- **avec `competition_id`** appartenant à l'ensemble visible : pas de filtre sur
  `skater_id`, toutes les lignes de la compétition sont renvoyées ;
- **avec `competition_id` hors ensemble** : liste vide (même comportement
  qu'aujourd'hui, pas de 403 pour ne pas changer le contrat) ;
- **sans `competition_id`** : comportement actuel (patineurs liés uniquement).

**Minimisation** : chaque ligne porte `is_own: bool` (`True` pour tous les rôles
non restreints, et pour les patineurs liés). Pour une ligne `is_own == False`,
`_score_to_dict` renvoie `elements = None`, `pdf_url = None`, et `components`
réduit aux totaux par composante (`{nom: score}`) si le format enrichi
(`{nom: {score, factor, judges}}`) est présent. `skater_id` reste présent (clé
React, aucune donnée en soi). `GET /api/scores/{id}/elements` est déjà protégé par
`require_skater_access`.

**Limite connue** : `/api/pdfs/*` est un montage statique authentifié mais non
filtré par patineur. On n'expose plus les URLs des autres patineurs, sans
construire de filtre fichier : un PDF FS Manager couvre de toute façon tout un
segment de catégorie et est public sur le site de l'organisateur.

### 2. Détection des changements et notifications (backend)

**Changements renvoyés par l'import.** `run_import` et `run_enrich` ajoutent à leur
résultat une clé `changes: list[dict]`, chaque élément de la forme :

```python
{"skater_id": int, "kind": str, "category": str | None, "segment": str | None,
 "total_score": float | None, "rank": int | None}
```

| `kind` | Source | Condition |
|---|---|---|
| `new_score` | `run_import` | création d'un `Score` |
| `score_corrected` | `run_import` | `Score` existant dont `total_score`, `technical_score`, `component_score` ou `deductions` diffère de la valeur scrapée (non nulle). En mode non-`force`, ces valeurs sont désormais mises à jour (aujourd'hui seul le rang l'est). |
| `final_result` | `run_import` | création d'un `CategoryResult` avec `combined_total` non nul, ou `combined_total`/`overall_rank` modifié sur un existant |
| `sheet_available` | `run_enrich` | `Score.elements` renseigné alors qu'il était vide |

Un changement de `Score.rank` seul ne produit rien. `changes` n'est pas persisté
dans `last_import_log` (l'interface d'import ne l'affiche pas).

**Job `poll`.** Nouveau type traité dans le handler du lifespan (`main.py`) :
`run_import(force=False)`, puis `run_enrich(force=False)`, fusion des `changes`,
puis `notify_competition_changes`. Le résultat du job concatène les deux logs.
`_polling_loop` soumet `poll` au lieu de `import` + `enrich`. Les jobs `import` et
`reimport` manuels appellent `notify_competition_changes` avec leurs propres
`changes` si `comp.polling_enabled` ; `enrich` manuel aussi. La notification admin
actuellement appelée dans `run_import` en est retirée et déplacée dans
`notify_competition_changes` (même condition : au moins un score ou classement
importé, même contenu), pour que `run_import` reste sans effet de bord de
notification.

**`notify_competition_changes(session, comp, changes, app_base_url="")`** dans
`notification_service.py` :

1. Ne fait rien si `changes` est vide ou si `not comp.polling_enabled`.
2. Notification admin existante (contenu inchangé), calculée depuis les
   `new_score` / `final_result`.
3. Pour les comptes patineur : charger les `UserSkater` des `skater_id` concernés
   joints à `User` (`role == "skater"`, `is_active`). Pour chaque utilisateur,
   filtrer les changements sur ses patineurs ; s'il en reste, créer **une**
   `Notification` :
   - `type="competition"`, `link=f"/competitions/{comp.id}"`,
   - `title = f"Résultats : {comp.name}"`,
   - `message` : une ligne par patineur, ex.
     `Ilan Dupont : Programme court 42,31 (3e), feuille de score disponible`
     (libellés segment SP → Programme court, FS → Programme libre, sinon code
     brut ; `final_result` → `Classement final : 2e (118,40)`) ;
   - email si `user.email_notifications` et SMTP configuré, nouveau template
     `templates/emails/skater_competition_notification.html` (étend
     `base_email.html`), avec le lien vers la compétition.
4. `session.flush()` ; le commit est fait par l'appelant (cohérent avec les
   autres `notify_*`).

### 3. Frontend

- `App.tsx`, routes du rôle `skater` : ajout de
  `/competitions/:id` → `CompetitionPage`. Pas de page liste pour ce rôle : on
  arrive sur une compétition par la notification ou par les liens déjà présents
  dans `SkaterAnalyticsPage` (`/competitions/${competitionId}`).
- `CompetitionPage.tsx` : le nom d'un patineur n'est un `<Link>` vers
  `/patineurs/:id/analyse` que si `is_own !== false` ; sinon texte simple.
  Bouton/accès éléments et PDF masqués quand `elements`/`pdf_url` sont absents.
  Vérifier que les actions admin (import, polling, métadonnées) et les liens vers
  des pages non accessibles au rôle `skater` (ex. retour vers `/competitions`)
  sont conditionnés au rôle.
- `api/client.ts` : `is_own?: boolean` sur les types score et résultat de
  catégorie.

### 4. Tests

- **Accès** : un patineur voit dans la liste et en détail une compétition où son
  patineur a un résultat ; 403 sur une compétition sans ses patineurs ; avec
  `competition_id`, toutes les lignes sont renvoyées, `elements`/`pdf_url` nuls,
  composantes réduites et `is_own=False` pour les autres ; sans `competition_id`,
  seulement ses patineurs ; 403 sur `/scores/{id}/elements` d'un autre patineur ;
  reader/admin inchangés (`is_own=True` partout).
- **Détection** : `run_import` (scraper simulé) produit `new_score`,
  `score_corrected`, `final_result`, et rien pour un changement de rang seul ;
  `run_enrich` produit `sheet_available` une seule fois.
- **Notifications** : une notification par (utilisateur, compétition) regroupant
  plusieurs patineurs/événements ; rien pour un utilisateur sans patineur
  concerné ; rien si `changes` vide ou `polling_enabled` faux ; pas d'email si
  `email_notifications` faux ; notification admin toujours émise.
- **Job `poll`** : enchaîne import + enrich et n'émet qu'une notification par
  utilisateur.

## Hors périmètre

- Scraping des listes d'engagés (compétition visible avant les premiers
  résultats).
- Page liste « Compétitions » pour le rôle `skater`.
- Filtrage par patineur des fichiers `/api/pdfs/*`.
- Préférences de notification par type d'événement.
- Outils MCP : ils passent par les routes en loopback et héritent donc des
  nouveaux droits ; pas de nouvel outil.
