"""Routes /api/admin/backups et planificateur (tick)."""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, select

from app import config
from app.models.app_settings import AppSettings
from app.services.backup import service

PARIS = ZoneInfo("Europe/Paris")


@pytest.fixture
def file_db(tmp_path, monkeypatch) -> Path:
    """Base fichier servant de « vraie » base pour la sauvegarde/restauration."""
    import app.models  # noqa: F401
    from app.database import Base

    path = tmp_path / "skating.db"
    eng = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(eng)
    eng.dispose()
    conn = sqlite3.connect(path)
    conn.execute(
        "INSERT INTO competitions (name, url, polling_enabled) VALUES ('Avant', 'https://x/a', 0)"
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(config, "DB_PATH", path)
    return path


def _names(db: Path) -> list[str]:
    conn = sqlite3.connect(db)
    rows = [r[0] for r in conn.execute("SELECT name FROM competitions ORDER BY name")]
    conn.close()
    return rows


@pytest.fixture
async def settings_row(db_session):
    s = AppSettings(club_name="TCP", club_short="TCP", current_season="2026-2027")
    db_session.add(s)
    await db_session.commit()
    return s


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_status_requires_admin(client, reader_token):
    r = await client.get("/api/admin/backups/", headers=_auth(reader_token))
    assert r.status_code == 403


async def test_status_unavailable_without_sqlite_file(client, admin_token):
    r = await client.get("/api/admin/backups/", headers=_auth(admin_token))
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert body["settings"]["enabled"] is False

    r = await client.post("/api/admin/backups/run", headers=_auth(admin_token))
    assert r.status_code == 409


async def test_update_settings(client, admin_token, settings_row):
    r = await client.patch(
        "/api/admin/backups/settings",
        json={"enabled": True, "time": "04:30", "retention": 7},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert r.json()["time"] == "04:30"
    assert r.json()["retention"] == 7


@pytest.mark.parametrize("payload", [{"time": "25:00"}, {"time": "3h"}, {"retention": 0}, {"retention": "7"}])
async def test_update_settings_validation(client, admin_token, settings_row, payload):
    r = await client.patch("/api/admin/backups/settings", json=payload, headers=_auth(admin_token))
    assert r.status_code == 400


async def test_run_list_download_restore(client, admin_token, settings_row, file_db):
    r = await client.post("/api/admin/backups/run", headers=_auth(admin_token))
    assert r.status_code == 201
    name = r.json()["name"]
    assert name.endswith("-manuel.tar.gz")

    r = await client.get("/api/admin/backups/", headers=_auth(admin_token))
    assert [a["name"] for a in r.json()["archives"]] == [name]

    r = await client.get(f"/api/admin/backups/{name}/download", headers=_auth(admin_token))
    assert r.status_code == 200
    assert r.content[:2] == b"\x1f\x8b"  # gzip

    conn = sqlite3.connect(file_db)
    conn.execute("INSERT INTO competitions (name, url, polling_enabled) VALUES ('Après', 'https://x/b', 0)")
    conn.commit()
    conn.close()

    r = await client.post(f"/api/admin/backups/{name}/restore", headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    assert r.json()["safety_backup"]["kind"] == "avant-restauration"
    assert _names(file_db) == ["Avant"]


async def test_restore_upload(client, admin_token, settings_row, file_db):
    r = await client.post("/api/admin/backups/run", headers=_auth(admin_token))
    archive = Path(config.BACKUP_DIR) / r.json()["name"]
    conn = sqlite3.connect(file_db)
    conn.execute("DELETE FROM competitions")
    conn.commit()
    conn.close()

    r = await client.post(
        "/api/admin/backups/restore-upload",
        files={"data": ("sauvegarde.tar.gz", archive.read_bytes(), "application/gzip")},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    assert _names(file_db) == ["Avant"]


async def test_restore_upload_rejects_garbage(client, admin_token, settings_row, file_db):
    r = await client.post(
        "/api/admin/backups/restore-upload",
        files={"data": ("x.tar.gz", b"n'importe quoi", "application/gzip")},
        headers=_auth(admin_token),
    )
    assert r.status_code == 400
    assert "Archive invalide" in r.json()["detail"]
    assert _names(file_db) == ["Avant"]


@pytest.mark.parametrize("name", ["../skating.db", "skating.db", "skatelab-20261003-030000-auto.tar.gz"])
async def test_archive_name_rejected(client, admin_token, file_db, name):
    r = await client.post(f"/api/admin/backups/{name}/restore", headers=_auth(admin_token))
    assert r.status_code == 404


async def test_restore_refused_while_import_running(client, admin_token, settings_row, file_db, db_session):
    from app.models.competition import Competition
    from app.models.job import Job

    r = await client.post("/api/admin/backups/run", headers=_auth(admin_token))
    name = r.json()["name"]
    comp = Competition(name="C", url="https://x/c")
    db_session.add(comp)
    await db_session.flush()
    db_session.add(Job(id="j1", type="import", competition_id=comp.id, status="running", created_at=datetime.now()))
    await db_session.commit()

    r = await client.post(f"/api/admin/backups/{name}/restore", headers=_auth(admin_token))
    assert r.status_code == 409


# ── Tick du planificateur ────────────────────────────────────────────────────


async def test_tick_runs_when_due_and_records(client, settings_row, file_db, db_session):
    settings_row.auto_backup_enabled = True
    settings_row.auto_backup_time = "03:00"
    await db_session.commit()

    now = datetime(2026, 10, 3, 3, 1, tzinfo=PARIS)
    assert await service.backup_tick(now) is True
    archives = service.list_archives()
    assert [a.kind for a in archives] == ["auto"]

    s = (await db_session.execute(select(AppSettings))).scalar_one()
    assert s.auto_backup_last_status == "ok"
    assert s.auto_backup_last_run_at == now.isoformat(timespec="seconds")

    # Même jour, plus tard : rien à faire
    assert await service.backup_tick(now + timedelta(hours=2)) is False


async def test_tick_disabled_by_default(client, settings_row, file_db):
    assert await service.backup_tick(datetime(2026, 10, 3, 9, 0, tzinfo=PARIS)) is False
    assert service.list_archives() == []


async def test_tick_records_failure(client, settings_row, file_db, db_session, monkeypatch):
    settings_row.auto_backup_enabled = True
    await db_session.commit()
    monkeypatch.setattr(config, "DB_PATH", file_db.parent / "absente.db")

    assert await service.backup_tick(datetime(2026, 10, 3, 4, 0, tzinfo=PARIS)) is True
    s = (await db_session.execute(select(AppSettings))).scalar_one()
    assert s.auto_backup_last_status == "error"
    assert s.auto_backup_last_error
