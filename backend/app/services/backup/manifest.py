from __future__ import annotations

from datetime import datetime, timezone

# À n'incrémenter que pour un changement de schéma INCOMPATIBLE avec la
# restauration par nom de colonne (renommage de colonne ou de table, changement
# de sémantique d'une valeur). Un simple ajout de colonne ou de table n'exige
# pas d'incrément : les colonnes absentes de l'archive prennent leur valeur par
# défaut (cf. restore.copy_database_in_place).
SCHEMA_VERSION = 1

APP_NAME = "skatelab"


def build_manifest(now: datetime, kind: str) -> dict[str, object]:
    return {
        "app": APP_NAME,
        "schemaVersion": SCHEMA_VERSION,
        "createdAt": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "kind": kind,
        "dbFile": "db.sqlite",
        "logosIncluded": True,
    }


def validate_manifest(raw: object) -> str | None:
    """None si l'archive est restaurable, sinon le code d'erreur
    ("badarchive" : manifest absent/invalide ou autre application ;
    "too_new" : archive d'une version plus récente de SkateLab)."""
    if not isinstance(raw, dict) or raw.get("app") != APP_NAME:
        return "badarchive"
    version = raw.get("schemaVersion")
    if not isinstance(version, int) or isinstance(version, bool):
        return "badarchive"
    if version > SCHEMA_VERSION:
        return "too_new"
    return None
