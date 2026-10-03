"""Sauvegardes de la base — /api/admin/backups/* (admin uniquement)."""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from litestar import Router, get, patch, post, Request
from litestar.datastructures import UploadFile
from litestar.di import Provide
from litestar.enums import RequestEncodingType
from litestar.exceptions import ClientException, NotFoundException
from litestar.params import Body
from litestar.response import File
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_admin
from app.database import get_session
from app.models.app_settings import AppSettings
from app.models.job import Job
from app.services.backup import service
from app.services.backup.archive import ARCHIVE_RE, BackupEntry
from app.services.backup.restore import RestoreError
from app.services.backup.schedule import parse_time

MAX_UPLOAD_BYTES = 100 * 1024 * 1024

_RESTORE_ERRORS = {
    "badarchive": "Archive invalide ou illisible (ce n'est pas une sauvegarde SkateLab).",
    "too_new": "Cette archive vient d'une version plus récente de SkateLab : mettez l'application à jour avant de la restaurer.",
}


def _entry_dto(e: BackupEntry) -> dict:
    return {
        "name": e.name,
        "kind": e.kind,
        "size": e.size,
        "created_at": datetime.fromtimestamp(e.mtime, timezone.utc).isoformat(timespec="seconds"),
    }


def _settings_dto(s: AppSettings | None) -> dict:
    return {
        "enabled": bool(s and s.auto_backup_enabled),
        "time": (s and s.auto_backup_time) or "03:00",
        "retention": (s and s.auto_backup_retention) or service.DEFAULT_RETENTION,
        "last_run_at": s.auto_backup_last_run_at if s else None,
        "last_status": s.auto_backup_last_status if s else None,
        "last_error": s.auto_backup_last_error if s else None,
    }


def _require_available() -> None:
    if not service.is_available():
        raise ClientException(
            detail="Sauvegarde indisponible : la base n'est pas un fichier SQLite.",
            status_code=409,
        )


async def _require_no_running_job(session: AsyncSession) -> None:
    busy = (
        await session.execute(
            select(func.count()).select_from(Job).where(Job.status.in_(("queued", "running")))
        )
    ).scalar_one()
    # Libère le verrou de lecture SQLite de cette session avant que la
    # restauration n'écrive dans la base par une autre connexion.
    await session.commit()
    if busy:
        raise ClientException(
            detail="Un import est en cours : attendez qu'il se termine avant de restaurer.",
            status_code=409,
        )


def _archive_path(name: str) -> Path:
    """Chemin d'une archive du dossier de sauvegarde. Le motif exclut tout
    séparateur : pas de sortie du dossier possible."""
    if not ARCHIVE_RE.match(name):
        raise NotFoundException("Archive introuvable")
    path = service.backup_dir() / name
    if not path.is_file():
        raise NotFoundException("Archive introuvable")
    return path


async def _restore(path: Path) -> dict:
    try:
        safety = await service.restore(path)
    except RestoreError as exc:
        raise ClientException(detail=_RESTORE_ERRORS[exc.code], status_code=400) from None
    return {"status": "ok", "safety_backup": _entry_dto(safety)}


@get("/")
async def backup_status(request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    s = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    available = service.is_available()
    return {
        "available": available,
        "directory": str(service.backup_dir()),
        "timezone": service.config.BACKUP_TIMEZONE,
        "settings": _settings_dto(s),
        "archives": [_entry_dto(e) for e in service.list_archives()] if available else [],
    }


@patch("/settings")
async def update_backup_settings(data: dict, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    s = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    if not s:
        raise ClientException(detail="Run setup first", status_code=400)

    if "time" in data:
        if not isinstance(data["time"], str) or parse_time(data["time"]) is None:
            raise ClientException(detail="Heure invalide (format HH:MM attendu)", status_code=400)
        s.auto_backup_time = data["time"]
    if "retention" in data:
        retention = data["retention"]
        if not isinstance(retention, int) or isinstance(retention, bool) or not 1 <= retention <= 365:
            raise ClientException(detail="Rétention invalide (entre 1 et 365)", status_code=400)
        s.auto_backup_retention = retention
    if "enabled" in data:
        s.auto_backup_enabled = bool(data["enabled"])

    await session.commit()
    await session.refresh(s)
    return _settings_dto(s)


@post("/run", status_code=201)
async def run_backup_now(request: Request) -> dict:
    require_admin(request)
    _require_available()
    try:
        entry = await service.run_backup("manuel")
    except Exception as exc:
        raise ClientException(
            detail=f"Échec de la sauvegarde : {type(exc).__name__}: {exc}", status_code=500
        ) from None
    return _entry_dto(entry)


@get("/{name:str}/download")
async def download_backup(name: str, request: Request) -> File:
    require_admin(request)
    _require_available()
    path = _archive_path(name)
    return File(path=path, filename=name, media_type="application/gzip")


@post("/{name:str}/restore", status_code=200)
async def restore_backup(name: str, request: Request, session: AsyncSession) -> dict:
    require_admin(request)
    _require_available()
    path = _archive_path(name)
    await _require_no_running_job(session)
    return await _restore(path)


@post("/restore-upload", status_code=200, request_max_body_size=MAX_UPLOAD_BYTES + 1024 * 1024)
async def restore_upload(
    request: Request,
    session: AsyncSession,
    data: UploadFile = Body(media_type=RequestEncodingType.MULTI_PART),
) -> dict:
    require_admin(request)
    _require_available()
    content = await data.read()
    if not content:
        raise ClientException(detail="Aucun fichier reçu", status_code=400)
    if len(content) > MAX_UPLOAD_BYTES:
        raise ClientException(detail="Archive trop volumineuse (100 Mo maximum)", status_code=400)
    await _require_no_running_job(session)
    workdir = tempfile.mkdtemp(prefix="bk-upload-")
    try:
        path = Path(workdir) / "upload.tar.gz"
        path.write_bytes(content)
        return await _restore(path)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


router = Router(
    path="/api/admin/backups",
    route_handlers=[
        backup_status,
        update_backup_settings,
        run_backup_now,
        download_backup,
        restore_backup,
        restore_upload,
    ],
    dependencies={"session": Provide(get_session)},
)
