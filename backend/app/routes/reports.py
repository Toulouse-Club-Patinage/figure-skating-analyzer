from __future__ import annotations

import base64
import logging
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from litestar import Request, Router, get, post
from litestar.di import Provide
from litestar.exceptions import NotFoundException
from litestar.response import Response
from sqlalchemy.ext.asyncio import AsyncSession
from jinja2 import Environment, FileSystemLoader

from app.auth.guards import reject_skater_role, require_skater_access
from app.database import get_session
from app.services.report_data import get_skater_report_data, get_club_report_data

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)))


def _load_logo_base64(logo_path: str | None) -> str | None:
    if not logo_path:
        return None
    p = Path(logo_path)
    if not p.is_file():
        return None
    return base64.b64encode(p.read_bytes()).decode()


@get("/skater/{skater_id:int}/pdf")
async def skater_report_pdf(
    skater_id: int,
    season: str,
    request: Request,
    session: AsyncSession,
) -> Response:
    await require_skater_access(request, skater_id, session)
    import weasyprint

    data = await get_skater_report_data(skater_id, season, session)
    if not data.results:
        raise NotFoundException(detail="Aucun résultat pour cette saison")

    logo_b64 = _load_logo_base64(None)
    template = _jinja_env.get_template("reports/skater_season.html")
    html = template.render(data=data, logo_base64=logo_b64)
    pdf_bytes = weasyprint.HTML(string=html).write_pdf()

    safe_name = data.skater_name.replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="rapport-{safe_name}-{season}.pdf"'
        },
    )


@get("/club/pdf")
async def club_report_pdf(
    season: str,
    request: Request,
    session: AsyncSession,
) -> Response:
    reject_skater_role(request)
    import weasyprint

    data = await get_club_report_data(season, session)
    if not data.skaters_summary:
        raise NotFoundException(detail="Aucun résultat pour cette saison")

    logo_b64 = _load_logo_base64(data.club_logo_path)
    template = _jinja_env.get_template("reports/club_season.html")
    html = template.render(data=data, logo_base64=logo_b64)
    pdf_bytes = weasyprint.HTML(string=html).write_pdf()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="rapport-club-{season}.pdf"'
        },
    )


_TYPE_LABELS = {
    "jump": "Saut",
    "spin": "Pirouette",
    "pair_spin": "Pirouette",
    "step": "Pas",
    "choreo": "Chorégraphique",
    "lift": "Levée",
    "throw": "Lancer",
    "twist": "Twist",
    "death_spiral": "Spirale",
    "pivot": "Pivot",
}


def _build_program_pdf(data: dict[str, Any]) -> bytes:
    """Render program data dict into PDF bytes."""
    import weasyprint

    elements = data.get("elements", [])
    category = data.get("category")
    validation = data.get("validation", [])
    # Optional: {"total": float, "lines": [{"label": str, "points": float, "earned": bool}]}
    bonus = data.get("bonus")

    # Build template-ready element list
    tpl_elements = []
    total_bv = 0.0
    counts = {"jumps": 0, "spins": 0, "steps": 0, "choreo": 0, "combos": 0}

    for el in elements:
        el_type = el.get("type", "")
        code = el.get("baseCode", "")
        markers = el.get("markers", [])
        bv = el.get("bv", 0.0)
        combo_jumps = el.get("comboJumps")

        # Display code for combos
        if combo_jumps and len(combo_jumps) > 1:
            display_code = "+".join(j["code"] for j in combo_jumps)
            # Collect per-jump markers
            jump_markers = []
            for j in combo_jumps:
                jump_markers.extend(j.get("markers", []))
            marker_str = " ".join(jump_markers + [m for m in markers if m not in jump_markers])
        else:
            display_code = code
            marker_str = " ".join(markers)

        # Determine display markers (exclude "x" from markers string, show as suffix)
        display_markers = [m for m in markers if m == "x"]
        if combo_jumps and len(combo_jumps) > 1:
            all_jump_markers = []
            for j in combo_jumps:
                all_jump_markers.extend(j.get("markers", []))
            marker_str = " ".join(all_jump_markers + display_markers)
        else:
            marker_str = " ".join(markers)

        tpl_elements.append({
            "code": display_code,
            "markers": marker_str,
            "type_label": _TYPE_LABELS.get(el_type, el_type),
            "bv": bv,
        })
        total_bv += bv

        # Counts
        if el_type == "jump":
            counts["jumps"] += 1
            if combo_jumps and len(combo_jumps) > 1:
                counts["combos"] += 1
        elif el_type in ("spin", "pair_spin"):
            counts["spins"] += 1
        elif el_type == "step":
            counts["steps"] += 1
        elif el_type == "choreo":
            counts["choreo"] += 1

    segment_label = data.get("segmentLabel", "Programme")
    logo_b64 = _load_logo_base64(None)

    template = _jinja_env.get_template("reports/program.html")
    html = template.render(
        elements=tpl_elements,
        total_bv=total_bv,
        counts=counts,
        category=category,
        segment_label=segment_label,
        validation=validation,
        bonus=bonus,
        logo_base64=logo_b64,
        generated_at=datetime.now().strftime("%d/%m/%Y %H:%M"),
    )
    return weasyprint.HTML(string=html).write_pdf()


@post("/program/pdf")
async def program_pdf(request: Request, data: dict) -> Response:
    """Generate a PDF from program builder data (POST with JSON body)."""
    pdf_bytes = _build_program_pdf(data)
    category = data.get("category", "programme")
    safe_name = category.replace(" ", "_").replace("—", "-").encode("ascii", "ignore").decode()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="programme-{safe_name}.pdf"'
        },
    )


@post("/program/email")
async def program_email(
    request: Request,
    data: dict,
    session: AsyncSession,
) -> dict:
    """Generate a PDF and email it to the current user."""
    import aiosmtplib
    from app.services.email_service import get_smtp_config

    # Get user email from JWT
    user_email = request.user.get("email", "") if hasattr(request, "user") and request.user else ""
    if not user_email:
        return {"ok": False, "message": "Adresse email introuvable."}

    smtp_cfg = await get_smtp_config(session)
    if not smtp_cfg:
        return {"ok": False, "message": "SMTP non configuré."}

    pdf_bytes = _build_program_pdf(data)
    category = data.get("category", "Programme")

    # Build email with PDF attachment
    msg = MIMEMultipart()
    msg["From"] = smtp_cfg["from_addr"]
    msg["To"] = user_email
    msg["Subject"] = f"Programme — {category}"

    body = MIMEText(
        f"<p>Bonjour,</p><p>Veuillez trouver en pièce jointe le programme <b>{category}</b>.</p><p>— SkateLab</p>",
        "html",
        "utf-8",
    )
    msg.attach(body)

    attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
    attachment.add_header("Content-Disposition", "attachment", filename=f"programme-{category}.pdf")
    msg.attach(attachment)

    try:
        await aiosmtplib.send(
            msg,
            hostname=smtp_cfg["host"],
            port=smtp_cfg["port"],
            username=smtp_cfg["user"] or None,
            password=smtp_cfg["password"] or None,
            start_tls=True,
        )
        logger.info("Program PDF emailed to %s", user_email)
        return {"ok": True, "message": f"Email envoyé à {user_email}"}
    except Exception:
        logger.exception("Failed to email program PDF to %s", user_email)
        return {"ok": False, "message": "Erreur lors de l'envoi de l'email."}


router = Router(
    path="/api/reports",
    route_handlers=[skater_report_pdf, club_report_pdf, program_pdf, program_email],
    dependencies={"session": Provide(get_session)},
)
