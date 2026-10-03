"""Orchestration : sauvegarde (manuelle, automatique, de sécurité), tick du
planificateur, restauration. Les chemins sont relus dans `app.config` à chaque
appel (les tests les remplacent)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app import config
from app.services.backup.archive import BackupEntry, create_archive, list_backups, prune_backups
from app.services.backup.restore import restore_from_archive
from app.services.backup.schedule import should_run_now

logger = logging.getLogger(__name__)

DEFAULT_RETENTION = 14

# Une seule opération à la fois (sauvegarde ou restauration) dans ce process.
_lock = asyncio.Lock()


class BackupUnavailable(Exception):
    """Base hors SQLite fichier : pas de sauvegarde possible."""


def is_available() -> bool:
    return config.DB_PATH is not None


def now_local() -> datetime:
    try:
        return datetime.now(ZoneInfo(config.BACKUP_TIMEZONE))
    except Exception:
        return datetime.now().astimezone()


def backup_dir() -> Path:
    return Path(config.BACKUP_DIR)


def list_archives() -> list[BackupEntry]:
    return list_backups(backup_dir())


async def _load_settings():
    import app.database as db_mod
    from app.models.app_settings import AppSettings

    async with db_mod.async_session_factory() as session:
        return (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()


async def _retention() -> int:
    s = await _load_settings()
    return s.auto_backup_retention if s and s.auto_backup_retention else DEFAULT_RETENTION


async def _run_locked(kind: str, now: datetime, retention: int) -> BackupEntry:
    if config.DB_PATH is None:
        raise BackupUnavailable()
    path = await asyncio.to_thread(
        create_archive,
        db_path=config.DB_PATH,
        logos_dir=Path(config.LOGOS_DIR),
        dest_dir=backup_dir(),
        now=now,
        kind=kind,
    )
    pruned = await asyncio.to_thread(prune_backups, backup_dir(), retention)
    if pruned:
        logger.info("[backup] archives supprimées (rétention %d) : %s", retention, pruned)
    st = path.stat()
    return BackupEntry(name=path.name, kind=kind, size=st.st_size, mtime=st.st_mtime)


async def run_backup(kind: str) -> BackupEntry:
    """Sauvegarde immédiate (manuelle ou de sécurité)."""
    retention = await _retention()
    async with _lock:
        entry = await _run_locked(kind, now_local(), retention)
    logger.info("[backup] sauvegarde %s : %s", kind, entry.name)
    return entry


async def backup_tick(now: datetime | None = None) -> bool:
    """Un tick du planificateur : lance la sauvegarde automatique si elle est
    due. Retourne True si une sauvegarde a été tentée.

    `last_run_at` est posé même en cas d'échec : sinon la sauvegarde repartirait
    à chaque tick (une tentative par minute). L'échec reste visible dans
    Réglages (statut + message) et l'admin peut relancer à la main."""
    if not is_available():
        return False
    now = now or now_local()
    s = await _load_settings()
    if s is None or not should_run_now(
        enabled=bool(s.auto_backup_enabled),
        time=s.auto_backup_time or "03:00",
        last_run_at=s.auto_backup_last_run_at,
        now=now,
    ):
        return False

    status, error = "ok", None
    try:
        async with _lock:
            entry = await _run_locked("auto", now, s.auto_backup_retention or DEFAULT_RETENTION)
        logger.info("[backup] sauvegarde automatique : %s", entry.name)
    except Exception as exc:
        logger.exception("[backup] échec de la sauvegarde automatique")
        status, error = "error", f"{type(exc).__name__}: {exc}"[:1000]

    await _record_run(now.isoformat(timespec="seconds"), status, error)
    return True


async def _record_run(at: str, status: str, error: str | None) -> None:
    import app.database as db_mod
    from app.models.app_settings import AppSettings

    async with db_mod.async_session_factory() as session:
        s = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
        if s is None:
            return
        s.auto_backup_last_run_at = at
        s.auto_backup_last_status = status
        s.auto_backup_last_error = error
        await session.commit()


async def restore(archive_path: Path) -> BackupEntry:
    """Restaure `archive_path` après une sauvegarde de sécurité de l'état
    courant (retournée). Lève RestoreError si l'archive est refusée."""
    import app.database as db_mod

    if config.DB_PATH is None:
        raise BackupUnavailable()
    retention = await _retention()
    async with _lock:
        safety = await _run_locked("avant-restauration", now_local(), retention)
        try:
            await asyncio.to_thread(
                restore_from_archive,
                archive_path,
                db_path=config.DB_PATH,
                logos_dir=Path(config.LOGOS_DIR),
            )
        finally:
            # La base a pu muter sous le pool : on recycle les connexions.
            await db_mod.engine.dispose()
    logger.info("[backup] restauration de %s (sécurité : %s)", archive_path.name, safety.name)
    return safety


async def backup_loop(interval: float = 60) -> None:
    """Tick périodique. Le premier tick, immédiat, rattrape une sauvegarde
    manquée pendant un arrêt du serveur."""
    while True:
        try:
            await backup_tick()
        except Exception:
            logger.exception("[backup] erreur dans la boucle de sauvegarde")
        await asyncio.sleep(interval)
