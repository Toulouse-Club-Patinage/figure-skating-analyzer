from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.models.notification import Notification
from app.models.user import User
from app.models.user_skater import UserSkater
from app.models.skater import Skater
from app.models.app_settings import AppSettings
from app.services.email_service import send_email, get_smtp_config

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def _is_training_enabled(session: AsyncSession) -> bool:
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    return bool(settings and settings.training_enabled)

INCIDENT_TYPE_LABELS = {
    "injury": "Blessure",
    "behavior": "Comportement",
    "other": "Autre",
}


async def _get_skater_name(session: AsyncSession, skater_id: int) -> str:
    skater = await session.get(Skater, skater_id)
    if not skater:
        return "Patineur inconnu"
    if skater.first_name:
        return f"{skater.first_name} {skater.last_name}"
    return skater.last_name


async def _get_linked_skater_users(session: AsyncSession, skater_id: int) -> list[User]:
    """Return skater-role users linked to this skater."""
    stmt = (
        select(User)
        .join(UserSkater, UserSkater.user_id == User.id)
        .where(
            UserSkater.skater_id == skater_id,
            User.role == "skater",
            User.is_active == True,  # noqa: E712
        )
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def notify_competition_update(
    session: AsyncSession,
    competition,
    import_log: dict,
    app_base_url: str = "",
) -> None:
    """Notify admin users when a polled competition has new results."""
    scores = import_log.get("scores_imported", 0)
    cat_results = import_log.get("category_results_imported", 0)
    if scores == 0 and cat_results == 0:
        return

    stmt = select(User).where(User.role == "admin", User.is_active == True)  # noqa: E712
    admins = (await session.execute(stmt)).scalars().all()
    if not admins:
        return

    parts = []
    if scores:
        parts.append(f"{scores} score{'s' if scores > 1 else ''}")
    if cat_results:
        parts.append(f"{cat_results} classement{'s' if cat_results > 1 else ''}")
    detail = " et ".join(parts)

    title = f"Mise à jour : {competition.name}"
    message = f"{detail} importé{'s' if (scores + cat_results) > 1 else ''}"
    link = f"/competitions/{competition.id}"

    smtp_cfg = await get_smtp_config(session)
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    club_name = settings.club_name if settings else "SkateLab"

    for admin in admins:
        notif = Notification(
            user_id=admin.id,
            type="competition",
            title=title,
            message=message,
            link=link,
        )
        session.add(notif)

        if admin.email_notifications and smtp_cfg:
            app_url = f"{app_base_url}{link}" if app_base_url else ""
            await send_email(
                to=admin.email,
                subject=f"Mise à jour : {competition.name}",
                template_name="competition_update_notification.html",
                context={
                    "club_name": club_name,
                    "competition_name": competition.name,
                    "detail": detail,
                    "app_url": app_url,
                },
                smtp_config=smtp_cfg,
            )

    await session.flush()


SEGMENT_LABELS = {"SP": "Programme court", "FS": "Programme libre"}


def _fmt_score(value: float) -> str:
    return f"{value:.2f}".replace(".", ",")


def _fmt_rank(rank: int) -> str:
    return "1er" if rank == 1 else f"{rank}e"


def _describe_change(change: dict) -> str:
    segment = SEGMENT_LABELS.get(change["segment"] or "", change["segment"] or "")
    total, rank = change["total_score"], change["rank"]
    if change["kind"] == "sheet_available":
        return f"feuille de score disponible ({segment})"
    if change["kind"] == "final_result":
        text = "Classement général :"
        if rank is not None:
            text += f" {_fmt_rank(rank)}"
        if total is not None:
            text += f" ({_fmt_score(total)})"
        return text
    text = segment
    if total is not None:
        text += f" {_fmt_score(total)}"
    if rank is not None:
        text += f" ({_fmt_rank(rank)})"
    if change["kind"] == "score_corrected":
        text += " — score corrigé"
    return text


def format_skater_changes(skater_name: str, changes: list[dict]) -> str:
    """One notification line for one skater, e.g. "Ilan Dupont : Programme court 42,31 (3e)"."""
    return f"{skater_name} : " + ", ".join(_describe_change(c) for c in changes)


async def notify_competition_changes(
    session: AsyncSession,
    competition,
    changes: list[dict],
    app_base_url: str = "",
) -> None:
    """Notify skater-role users about result changes of their linked skaters.

    One notification (and one email) per user and call, listing each of their
    skaters concerned. Only for competitions being followed (polling enabled).
    """
    if not changes or not competition.polling_enabled:
        return

    changes_by_skater: dict[int, list[dict]] = {}
    for change in changes:
        changes_by_skater.setdefault(change["skater_id"], []).append(change)

    stmt = (
        select(User, UserSkater.skater_id)
        .join(UserSkater, UserSkater.user_id == User.id)
        .where(
            UserSkater.skater_id.in_(changes_by_skater),
            User.role == "skater",
            User.is_active == True,  # noqa: E712
        )
    )
    rows = (await session.execute(stmt)).all()
    if not rows:
        return

    skaters_by_user: dict[str, tuple[User, list[int]]] = {}
    for user, skater_id in rows:
        skaters_by_user.setdefault(user.id, (user, []))[1].append(skater_id)

    names = {sid: await _get_skater_name(session, sid) for sid in changes_by_skater}
    title = f"Résultats : {competition.name}"
    link = f"/competitions/{competition.id}"

    smtp_cfg = await get_smtp_config(session)
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    club_name = settings.club_name if settings else "SkateLab"

    for user, skater_ids in skaters_by_user.values():
        lines = [
            format_skater_changes(names[sid], changes_by_skater[sid])
            for sid in sorted(skater_ids, key=lambda sid: names[sid])
        ]
        session.add(Notification(
            user_id=user.id,
            type="competition",
            title=title,
            message="\n".join(lines),
            link=link,
        ))

        if user.email_notifications and smtp_cfg:
            await send_email(
                to=user.email,
                subject=title,
                template_name="skater_competition_notification.html",
                context={
                    "club_name": club_name,
                    "competition_name": competition.name,
                    "lines": lines,
                    "app_url": f"{app_base_url}{link}" if app_base_url else "",
                },
                smtp_config=smtp_cfg,
            )

    await session.flush()


async def notify_review(session: AsyncSession, review, app_base_url: str = "") -> None:
    """Create in-app notifications and queue emails for a visible review."""
    if not review.visible_to_skater:
        return
    if not await _is_training_enabled(session):
        return

    skater_name = await _get_skater_name(session, review.skater_id)
    users = await _get_linked_skater_users(session, review.skater_id)

    title = f"Nouveau retour pour {skater_name}"
    message = f"Semaine du {review.week_start.isoformat()} — Engagement {review.engagement}/5, Progression {review.progression}/5, Attitude {review.attitude}/5"
    link = f"/patineurs/{review.skater_id}/analyse"

    smtp_cfg = await get_smtp_config(session)
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    club_name = settings.club_name if settings else "SkateLab"

    for user in users:
        notif = Notification(
            user_id=user.id,
            type="review",
            title=title,
            message=message,
            link=link,
        )
        session.add(notif)

        if user.email_notifications and smtp_cfg:
            app_url = f"{app_base_url}{link}" if app_base_url else ""

            await send_email(
                to=user.email,
                subject=f"Nouveau retour d'entraînement pour {skater_name}",
                template_name="review_notification.html",
                context={
                    "club_name": club_name,
                    "skater_name": skater_name,
                    "week_start": review.week_start.strftime("%d/%m/%Y"),
                    "engagement": review.engagement,
                    "progression": review.progression,
                    "attitude": review.attitude,
                    "strengths": review.strengths or "",
                    "improvements": review.improvements or "",
                    "app_url": app_url,
                },
                smtp_config=smtp_cfg,
            )

    await session.flush()


async def notify_incident(session: AsyncSession, incident, app_base_url: str = "") -> None:
    """Create in-app notifications and queue emails for a visible incident."""
    if not incident.visible_to_skater:
        return
    if not await _is_training_enabled(session):
        return

    skater_name = await _get_skater_name(session, incident.skater_id)
    users = await _get_linked_skater_users(session, incident.skater_id)

    type_label = INCIDENT_TYPE_LABELS.get(incident.incident_type, incident.incident_type)
    title = f"Incident signalé pour {skater_name}"
    message = f"{type_label} — {incident.description[:100]}" if incident.description else type_label
    link = f"/patineurs/{incident.skater_id}/analyse"

    smtp_cfg = await get_smtp_config(session)
    settings = (await session.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    club_name = settings.club_name if settings else "SkateLab"

    for user in users:
        notif = Notification(
            user_id=user.id,
            type="incident",
            title=title,
            message=message,
            link=link,
        )
        session.add(notif)

        if user.email_notifications and smtp_cfg:
            app_url = f"{app_base_url}{link}" if app_base_url else ""

            await send_email(
                to=user.email,
                subject=f"Nouvel incident signalé pour {skater_name}",
                template_name="incident_notification.html",
                context={
                    "club_name": club_name,
                    "skater_name": skater_name,
                    "date": incident.date.strftime("%d/%m/%Y"),
                    "incident_type_label": type_label,
                    "description": incident.description or "",
                    "app_url": app_url,
                },
                smtp_config=smtp_cfg,
            )

    await session.flush()
