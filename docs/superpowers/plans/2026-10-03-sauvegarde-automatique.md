# Sauvegarde automatique de la base — plan

Inspiré de `ligue-app-competitions/backend/app/backup/` (archive tar.gz + manifest,
tick du planificateur avec rattrapage, rétention, restauration in-place).

## Décisions

- **Archive** `skatelab-YYYYMMDD-HHMMSS-<type>.tar.gz` (types : `auto`, `manuel`,
  `avant-reinit`, `avant-restauration`) : `db.sqlite` + `manifest.json` + `logos/`.
  Les PDF (`PDF_DIR`) ne sont pas sauvegardés : ce sont des caches re-téléchargeables.
- **Copie à chaud** via l'API `sqlite3.Connection.backup()` (cohérente même si
  une écriture a lieu pendant la copie), puis `PRAGMA integrity_check` sur la copie.
- **Restauration par nom de colonne** (colonnes communes) et non `SELECT *` :
  une archive antérieure à l'ajout d'une colonne reste restaurable, la colonne
  neuve prend sa valeur par défaut. Le manifest ne sert qu'à refuser une archive
  d'un schéma plus récent (`schemaVersion`), à n'incrémenter que pour un
  changement incompatible (renommage, sémantique).
- Les réglages de sauvegarde (`app_settings.auto_backup_*`) décrivent l'instance,
  pas l'archive : ils sont conservés lors d'une restauration.
- **Dossier de destination** : variable d'environnement `BACKUP_DIR`
  (défaut `DATA_DIR/backups`, `/data/backups` en Docker), non modifiable depuis
  l'UI (un chemin réglable par l'UI serait une écriture arbitraire sur le serveur).
- **Heure** interprétée en `Europe/Paris` (`BACKUP_TIMEZONE`), le conteneur étant en UTC.
- **Rétention** : les N plus récentes archives de chaque type.
- **Sécurité** : sauvegarde automatique avant réinitialisation et avant restauration
  (opération refusée si cette sauvegarde échoue) ; restauration refusée (409) si un
  import est en file ou en cours.
- Désactivée par défaut, à activer depuis Réglages après déploiement.
- Copie hors VPS (Drive, rsync) : second temps.

## Étapes

1. `app/services/backup/` : `manifest.py`, `archive.py`, `schedule.py`,
   `restore.py`, `service.py` (sauvegarde, tick du planificateur, verrou).
2. `AppSettings` : `auto_backup_enabled/time/retention/last_run_at/last_status/last_error`
   + migrations `_migrate_add_columns`.
3. `config.py` : `BACKUP_DIR`, `BACKUP_TIMEZONE`, `DB_PATH` (dérivé de `DATABASE_URL`,
   `None` hors SQLite → fonction désactivée).
4. `main.py` : `_backup_loop()` (tick 60 s, premier tick au démarrage = rattrapage).
5. `routes/backups.py` (`/api/admin/backups`, admin) : état + liste, réglages,
   sauvegarder maintenant, télécharger, restaurer (serveur / fichier envoyé, 100 Mo).
   `POST /api/admin/reset-database` : sauvegarde `avant-reinit` préalable.
6. Front : `client.ts` + carte « Sauvegardes » dans `SettingsPage.tsx`.
7. Déploiement : `nginx.conf` (taille du corps pour l'envoi d'archive),
   `deploy/compose.vps.yml` (bind mount `./var/backups:/data/backups`),
   `docs/deployment-guide.md`.
8. Tests : planification, rétention, aller-retour sauvegarde/restauration sur base
   fichier, archive ancienne (colonne manquante), archive trop récente, routes
   (rôles, nom d'archive invalide, import en cours).
