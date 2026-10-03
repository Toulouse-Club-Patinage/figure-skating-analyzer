from __future__ import annotations

import contextlib
import json
import shutil
import sqlite3
import tarfile
import tempfile
from pathlib import Path

from app.services.backup.archive import extract_archive
from app.services.backup.manifest import validate_manifest

# Tables sans lesquelles une base n'est pas une base SkateLab.
REQUIRED_TABLES = ("app_settings", "competitions", "users")

# Réglages propres à CETTE instance, pas à l'archive : restaurer une vieille
# archive ne doit pas désactiver (ou déplacer) les sauvegardes automatiques.
PRESERVED_SETTINGS_COLUMNS = (
    "auto_backup_enabled",
    "auto_backup_time",
    "auto_backup_retention",
    "auto_backup_last_run_at",
    "auto_backup_last_status",
    "auto_backup_last_error",
)


class RestoreError(Exception):
    """Erreur métier de restauration : `code` ∈ {"badarchive", "too_new"}."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def list_user_tables(conn: sqlite3.Connection, schema: str = "main") -> list[str]:
    rows = conn.execute(
        f"SELECT name FROM {schema}.sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    # `_…` : restes de migrations (`_self_evaluations_old`…), hors périmètre.
    return [n for (n,) in rows if not n.startswith("sqlite_") and not n.startswith("_")]


def _columns(conn: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f'PRAGMA {schema}.table_info("{table}")').fetchall()]


def check_incoming_db(src_db: Path) -> None:
    try:
        src = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise RestoreError("badarchive") from exc
    try:
        integrity = src.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RestoreError("badarchive")
        present = set(list_user_tables(src))
        if not all(t in present for t in REQUIRED_TABLES):
            raise RestoreError("badarchive")
    except sqlite3.DatabaseError as exc:  # fichier qui n'est pas une base SQLite
        raise RestoreError("badarchive") from exc
    finally:
        src.close()


def copy_database_in_place(dest: sqlite3.Connection, src_db: Path) -> None:
    """Remplace le contenu de `dest` par celui de `src_db`, sans toucher au
    fichier de `dest` (le pool SQLAlchemy y garde des connexions).

    Copie par NOM de colonne (colonnes communes aux deux schémas) : une colonne
    ajoutée depuis l'archive prend sa valeur par défaut, une colonne disparue est
    ignorée. Une table absente de l'archive est vidée. Le tout dans une seule
    transaction, clés étrangères coupées AVANT le BEGIN (ignoré sinon) et
    vérifiées avant le COMMIT. `dest` doit être en isolation_level=None."""
    tables = list_user_tables(dest)
    preserved = _read_preserved_settings(dest)
    dest.execute("ATTACH DATABASE ? AS src", (str(src_db),))
    dest.execute("PRAGMA foreign_keys = OFF")
    try:
        src_tables = set(list_user_tables(dest, "src"))
        dest.execute("BEGIN IMMEDIATE")
        for t in tables:
            dest.execute(f'DELETE FROM main."{t}"')
            if t not in src_tables:
                continue
            src_cols = set(_columns(dest, "src", t))
            cols = [c for c in _columns(dest, "main", t) if c in src_cols]
            if not cols:
                continue
            col_list = ", ".join(f'"{c}"' for c in cols)
            dest.execute(f'INSERT INTO main."{t}" ({col_list}) SELECT {col_list} FROM src."{t}"')
        if preserved:
            assignments = ", ".join(f'"{c}" = ?' for c in preserved)
            dest.execute(f"UPDATE main.app_settings SET {assignments}", tuple(preserved.values()))
        # Un import en cours au moment de la sauvegarde n'a jamais fini : même
        # traitement qu'au démarrage (job_queue.cleanup).
        if "jobs" in tables:
            dest.execute(
                "UPDATE main.jobs SET status = 'failed', error = 'Interrompu (restauration)'"
                " WHERE status IN ('queued', 'running')"
            )
        if dest.execute("PRAGMA main.foreign_key_check").fetchall():
            raise RuntimeError("foreign_key_check en échec après restauration")
        dest.execute("COMMIT")
    except Exception:
        with contextlib.suppress(sqlite3.OperationalError):
            dest.execute("ROLLBACK")
        raise
    finally:
        dest.execute("PRAGMA foreign_keys = ON")
        dest.execute("DETACH DATABASE src")


def _read_preserved_settings(conn: sqlite3.Connection) -> dict[str, object]:
    if "app_settings" not in list_user_tables(conn):
        return {}
    present = set(_columns(conn, "main", "app_settings"))
    cols = [c for c in PRESERVED_SETTINGS_COLUMNS if c in present]
    if not cols:
        return {}
    row = conn.execute(
        f"SELECT {', '.join(cols)} FROM main.app_settings ORDER BY id LIMIT 1"
    ).fetchone()
    return dict(zip(cols, row)) if row else {}


def restore_from_archive(archive_path: Path, *, db_path: Path, logos_dir: Path) -> None:
    """Restaure base + logos depuis une archive. Lève RestoreError pour une
    archive refusée (base intacte) ; toute autre exception est un échec
    technique (la base reste intacte : la copie est transactionnelle)."""
    workdir = Path(tempfile.mkdtemp(prefix="bk-restore-"))
    try:
        try:
            extract_archive(Path(archive_path), workdir)
        except (tarfile.TarError, OSError, EOFError) as exc:
            raise RestoreError("badarchive") from exc
        try:
            manifest = json.loads((workdir / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            manifest = None
        error = validate_manifest(manifest)
        if error:
            raise RestoreError(error)
        src_db = workdir / "db.sqlite"
        if not src_db.is_file():
            raise RestoreError("badarchive")
        check_incoming_db(src_db)

        conn = sqlite3.connect(db_path, isolation_level=None, timeout=30)
        try:
            copy_database_in_place(conn, src_db)
        finally:
            conn.close()

        logos = workdir / "logos"
        if logos.is_dir():
            Path(logos_dir).mkdir(parents=True, exist_ok=True)
            shutil.copytree(logos, logos_dir, dirs_exist_ok=True)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
