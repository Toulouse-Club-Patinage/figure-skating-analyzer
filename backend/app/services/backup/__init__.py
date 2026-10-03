"""Sauvegarde automatique de la base SQLite (+ logos) en archives tar.gz.

Inspiré de ligue-app-competitions (`backend/app/backup/`). Différences voulues :
copie à chaud par l'API backup de SQLite, restauration par nom de colonne (une
archive antérieure à l'ajout d'une colonne reste restaurable), dossier de
destination fixé par l'environnement (`BACKUP_DIR`), jamais par l'UI.
"""
