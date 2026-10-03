"""Sauvegarde / restauration de la base : archive, planification, rétention,
restauration in-place par nom de colonne."""

import json
import os
import sqlite3
import tarfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine

from app.services.backup.archive import (
    archive_name,
    create_archive,
    list_backups,
    prune_backups,
)
from app.services.backup.manifest import SCHEMA_VERSION, validate_manifest
from app.services.backup.restore import RestoreError, restore_from_archive
from app.services.backup.schedule import should_run_now

PARIS = ZoneInfo("Europe/Paris")


def _make_db(path: Path) -> Path:
    """Base fichier au schéma SkateLab courant."""
    import app.models  # noqa: F401
    from app.database import Base

    eng = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(eng)
    eng.dispose()
    return path


def _insert_competition(db: Path, name: str) -> None:
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO competitions (name, url, polling_enabled) VALUES (?, ?, 0)",
        (name, f"https://example.org/{name}/index.htm"),
    )
    conn.commit()
    conn.close()


def _competition_names(db: Path) -> list[str]:
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT name FROM competitions ORDER BY name").fetchall()
    conn.close()
    return [r[0] for r in rows]


# ── Planification ────────────────────────────────────────────────────────────


def test_should_run_disabled():
    now = datetime(2026, 10, 3, 4, 0, tzinfo=PARIS)
    assert not should_run_now(enabled=False, time="03:00", last_run_at=None, now=now)


def test_should_run_before_milestone():
    now = datetime(2026, 10, 3, 2, 59, tzinfo=PARIS)
    assert not should_run_now(enabled=True, time="03:00", last_run_at=None, now=now)


def test_should_run_after_milestone_never_run():
    now = datetime(2026, 10, 3, 3, 0, tzinfo=PARIS)
    assert should_run_now(enabled=True, time="03:00", last_run_at=None, now=now)


def test_should_run_already_ran_today():
    now = datetime(2026, 10, 3, 9, 0, tzinfo=PARIS)
    last = datetime(2026, 10, 3, 3, 1, tzinfo=PARIS).isoformat()
    assert not should_run_now(enabled=True, time="03:00", last_run_at=last, now=now)


def test_should_run_catch_up_after_downtime():
    """Serveur éteint à 03:00 : rattrapage au premier tick suivant."""
    now = datetime(2026, 10, 3, 11, 30, tzinfo=PARIS)
    last = datetime(2026, 10, 2, 3, 0, tzinfo=PARIS).isoformat()
    assert should_run_now(enabled=True, time="03:00", last_run_at=last, now=now)


# ── Archive ──────────────────────────────────────────────────────────────────


def test_archive_name():
    now = datetime(2026, 10, 3, 3, 0, 5, tzinfo=PARIS)
    assert archive_name(now, "auto") == "skatelab-20261003-030005-auto.tar.gz"


def test_create_archive_contents(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    _insert_competition(db, "CSNPA Automne")
    logos = tmp_path / "logos"
    logos.mkdir()
    (logos / "logo.png").write_bytes(b"png")
    dest = tmp_path / "backups"

    path = create_archive(
        db_path=db, logos_dir=logos, dest_dir=dest,
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="auto",
    )

    assert path.name == "skatelab-20261003-030000-auto.tar.gz"
    with tarfile.open(path) as tar:
        names = set(tar.getnames())
        assert {"db.sqlite", "manifest.json", "logos/logo.png"} <= names
        manifest = json.load(tar.extractfile("manifest.json"))
    assert manifest["schemaVersion"] == SCHEMA_VERSION
    assert manifest["app"] == "skatelab"
    assert manifest["kind"] == "auto"
    # Aucun fichier temporaire laissé dans le dossier de destination
    assert os.listdir(dest) == [path.name]


def test_list_and_prune_per_kind(tmp_path):
    for i, kind in enumerate(["auto", "auto", "auto", "manuel", "manuel"]):
        p = tmp_path / f"skatelab-2026100{i + 1}-030000-{kind}.tar.gz"
        p.write_bytes(b"x")
        os.utime(p, (1_000_000 + i, 1_000_000 + i))
    (tmp_path / "autre-fichier.txt").write_text("ignoré")

    entries = list_backups(tmp_path)
    assert [e.name for e in entries][0] == "skatelab-20261005-030000-manuel.tar.gz"
    assert len(entries) == 5

    deleted = prune_backups(tmp_path, retention=2)
    assert deleted == ["skatelab-20261001-030000-auto.tar.gz"]
    assert len(list_backups(tmp_path)) == 4


def test_list_backups_missing_dir(tmp_path):
    assert list_backups(tmp_path / "absent") == []


# ── Manifest ─────────────────────────────────────────────────────────────────


def test_validate_manifest():
    ok = {"app": "skatelab", "schemaVersion": SCHEMA_VERSION, "createdAt": "x", "kind": "auto"}
    assert validate_manifest(ok) is None
    assert validate_manifest({**ok, "schemaVersion": SCHEMA_VERSION + 1}) == "too_new"
    assert validate_manifest({**ok, "app": "ligue"}) == "badarchive"
    assert validate_manifest(None) == "badarchive"
    assert validate_manifest({**ok, "schemaVersion": True}) == "badarchive"


# ── Restauration ─────────────────────────────────────────────────────────────


def test_backup_restore_roundtrip(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    _insert_competition(db, "Avant")
    logos = tmp_path / "logos"
    archive = create_archive(
        db_path=db, logos_dir=logos, dest_dir=tmp_path / "backups",
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="manuel",
    )
    _insert_competition(db, "Après")
    assert _competition_names(db) == ["Après", "Avant"]

    restore_from_archive(archive, db_path=db, logos_dir=logos)

    assert _competition_names(db) == ["Avant"]


def test_restore_preserves_backup_settings(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO app_settings (id, club_name, club_short, current_season, smtp_port,"
        " auto_backup_enabled, auto_backup_time, auto_backup_retention)"
        " VALUES (1, 'TCP', 'TCP', '2025-2026', 587, 0, '03:00', 14)"
    )
    conn.commit()
    conn.close()
    archive = create_archive(
        db_path=db, logos_dir=tmp_path / "logos", dest_dir=tmp_path / "backups",
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="manuel",
    )
    conn = sqlite3.connect(db)
    conn.execute(
        "UPDATE app_settings SET club_name='Modifié', auto_backup_enabled=1,"
        " auto_backup_time='04:30', auto_backup_retention=7"
    )
    conn.commit()
    conn.close()

    restore_from_archive(archive, db_path=db, logos_dir=tmp_path / "logos")

    conn = sqlite3.connect(db)
    row = conn.execute(
        "SELECT club_name, auto_backup_enabled, auto_backup_time, auto_backup_retention"
        " FROM app_settings"
    ).fetchone()
    conn.close()
    assert row == ("TCP", 1, "04:30", 7)


def test_restore_older_archive_missing_column(tmp_path):
    """Archive prise avant l'ajout d'une colonne : restaurable, la colonne
    neuve reçoit sa valeur par défaut."""
    old_db = _make_db(tmp_path / "old.db")
    conn = sqlite3.connect(old_db)
    conn.execute("ALTER TABLE competitions DROP COLUMN rink")
    conn.commit()
    conn.close()
    _insert_competition(old_db, "Ancienne")
    archive = create_archive(
        db_path=old_db, logos_dir=tmp_path / "logos", dest_dir=tmp_path / "backups",
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="manuel",
    )

    db = _make_db(tmp_path / "skating.db")
    _insert_competition(db, "Courante")
    restore_from_archive(archive, db_path=db, logos_dir=tmp_path / "logos")

    assert _competition_names(db) == ["Ancienne"]


def test_restore_marks_unfinished_jobs_failed(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    _insert_competition(db, "C")
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO jobs (id, type, trigger, competition_id, status, created_at)"
        " VALUES ('j1', 'import', 'manual', 1, 'running', '2026-10-03 03:00:00')"
    )
    conn.commit()
    conn.close()
    archive = create_archive(
        db_path=db, logos_dir=tmp_path / "logos", dest_dir=tmp_path / "backups",
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="manuel",
    )

    restore_from_archive(archive, db_path=db, logos_dir=tmp_path / "logos")

    conn = sqlite3.connect(db)
    assert conn.execute("SELECT status FROM jobs").fetchone()[0] == "failed"
    conn.close()


def test_restore_restores_logos(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    logos = tmp_path / "logos"
    logos.mkdir()
    (logos / "logo.png").write_bytes(b"ancien")
    archive = create_archive(
        db_path=db, logos_dir=logos, dest_dir=tmp_path / "backups",
        now=datetime(2026, 10, 3, 3, 0, tzinfo=PARIS), kind="manuel",
    )
    (logos / "logo.png").write_bytes(b"nouveau")

    restore_from_archive(archive, db_path=db, logos_dir=logos)

    assert (logos / "logo.png").read_bytes() == b"ancien"


def _tar_with(tmp_path: Path, manifest: dict | None, db: Path | None) -> Path:
    out = tmp_path / "in.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        if manifest is not None:
            m = tmp_path / "manifest.json"
            m.write_text(json.dumps(manifest))
            tar.add(m, arcname="manifest.json")
        if db is not None:
            tar.add(db, arcname="db.sqlite")
    return out


def test_restore_rejects_too_new(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    archive = _tar_with(
        tmp_path,
        {"app": "skatelab", "schemaVersion": SCHEMA_VERSION + 1, "createdAt": "x", "kind": "auto"},
        db,
    )
    with pytest.raises(RestoreError) as exc:
        restore_from_archive(archive, db_path=db, logos_dir=tmp_path / "logos")
    assert exc.value.code == "too_new"


def test_restore_rejects_foreign_db(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    _insert_competition(db, "Intacte")
    foreign = tmp_path / "foreign.db"
    conn = sqlite3.connect(foreign)
    conn.execute("CREATE TABLE autre (id INTEGER)")
    conn.commit()
    conn.close()
    archive = _tar_with(
        tmp_path,
        {"app": "skatelab", "schemaVersion": SCHEMA_VERSION, "createdAt": "x", "kind": "auto"},
        foreign,
    )
    with pytest.raises(RestoreError) as exc:
        restore_from_archive(archive, db_path=db, logos_dir=tmp_path / "logos")
    assert exc.value.code == "badarchive"
    assert _competition_names(db) == ["Intacte"]


def test_restore_rejects_not_a_tarball(tmp_path):
    db = _make_db(tmp_path / "skating.db")
    bogus = tmp_path / "bogus.tar.gz"
    bogus.write_bytes(b"pas une archive")
    with pytest.raises(RestoreError) as exc:
        restore_from_archive(bogus, db_path=db, logos_dir=tmp_path / "logos")
    assert exc.value.code == "badarchive"
