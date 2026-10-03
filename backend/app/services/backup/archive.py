from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.services.backup.manifest import build_manifest

ARCHIVE_RE = re.compile(r"^skatelab-(\d{8})-(\d{6})-([a-z]+(?:-[a-z]+)*)\.tar\.gz$")

KINDS = ("auto", "manuel", "avant-reinit", "avant-restauration")


@dataclass(frozen=True)
class BackupEntry:
    name: str
    kind: str
    size: int
    mtime: float


def archive_name(now: datetime, kind: str) -> str:
    return f"skatelab-{now.strftime('%Y%m%d-%H%M%S')}-{kind}.tar.gz"


def list_backups(directory: Path) -> list[BackupEntry]:
    """Archives SkateLab du dossier, plus récente d'abord."""
    try:
        names = os.listdir(directory)
    except OSError:
        return []
    entries: list[BackupEntry] = []
    for name in names:
        m = ARCHIVE_RE.match(name)
        full = Path(directory) / name
        if not m or not full.is_file():
            continue
        st = full.stat()
        entries.append(BackupEntry(name=name, kind=m.group(3), size=st.st_size, mtime=st.st_mtime))
    entries.sort(key=lambda e: e.mtime, reverse=True)
    return entries


def prune_backups(directory: Path, retention: int) -> list[str]:
    """Ne garde que les `retention` archives les plus récentes DE CHAQUE TYPE :
    une rafale de sauvegardes manuelles ne doit pas évincer les automatiques."""
    keep = max(retention, 1)
    seen: dict[str, int] = {}
    deleted: list[str] = []
    for e in list_backups(directory):
        seen[e.kind] = seen.get(e.kind, 0) + 1
        if seen[e.kind] > keep:
            try:
                os.remove(Path(directory) / e.name)
                deleted.append(e.name)
            except OSError:
                pass
    return deleted


def _snapshot_db(db_path: Path, dest: Path) -> None:
    """Copie cohérente de la base, même si elle est écrite pendant la copie."""
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
        result = dst.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError(f"copie de la base corrompue : {result}")
    finally:
        dst.close()
        src.close()


def create_archive(
    *, db_path: Path, logos_dir: Path, dest_dir: Path, now: datetime, kind: str
) -> Path:
    """Crée l'archive dans `dest_dir`. Écrite sous un nom temporaire puis
    renommée : une archive listée est toujours complète."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    final = dest_dir / archive_name(now, kind)
    staging = Path(tempfile.mkdtemp(prefix="bk-stage-"))
    tmp_out = dest_dir / f".{final.name}.tmp"
    try:
        _snapshot_db(Path(db_path), staging / "db.sqlite")
        (staging / "manifest.json").write_text(
            json.dumps(build_manifest(now, kind), indent=2), encoding="utf-8"
        )
        with tarfile.open(tmp_out, "w:gz") as tar:
            tar.add(staging / "db.sqlite", arcname="db.sqlite")
            tar.add(staging / "manifest.json", arcname="manifest.json")
            if Path(logos_dir).is_dir():
                tar.add(logos_dir, arcname="logos")
        os.replace(tmp_out, final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        tmp_out.unlink(missing_ok=True)
    return final


def extract_archive(archive_path: Path, dest_dir: Path) -> None:
    """Extraction sûre (filtre "data" : ni chemin absolu, ni remontée, ni lien
    sortant). Lève tarfile.TarError / OSError si l'archive est illisible."""
    with tarfile.open(archive_path, "r:gz") as tar:
        tar.extractall(dest_dir, filter="data")
