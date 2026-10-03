from __future__ import annotations

from sqlalchemy import Integer, String, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    club_name: Mapped[str] = mapped_column(String(255), nullable=False)
    club_short: Mapped[str] = mapped_column(String(50), nullable=False)
    logo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_season: Mapped[str] = mapped_column(
        String(20), nullable=False, default="2025-2026"
    )
    training_enabled: Mapped[bool] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    smtp_user: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    smtp_from: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_team_medians: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    french_ranking_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    account_requests_enabled: Mapped[bool] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    french_ranking_club_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    support_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Sauvegarde automatique (cf. app/services/backup). Le dossier n'est PAS ici :
    # il vient de BACKUP_DIR (environnement), jamais de l'UI.
    auto_backup_enabled: Mapped[bool] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    auto_backup_time: Mapped[str] = mapped_column(
        String(5), nullable=False, default="03:00", server_default="03:00"
    )
    auto_backup_retention: Mapped[int] = mapped_column(
        Integer, nullable=False, default=14, server_default="14"
    )
    auto_backup_last_run_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    auto_backup_last_status: Mapped[str | None] = mapped_column(String(10), nullable=True)
    auto_backup_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
