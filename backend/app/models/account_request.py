# backend/app/models/account_request.py
"""Trace d'une demande de création de compte : audit et notification admin.

`status` : created | pending_admin | rejected | expired
`archived_at` : renseigné quand l'admin retire la demande de la liste courante
(elle reste consultable dans l'historique).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AccountRequest(Base):
    __tablename__ = "account_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    licence_numbers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
