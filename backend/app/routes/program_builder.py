from __future__ import annotations

import json
from pathlib import Path

from litestar import Router, get, Request

from app.auth.guards import require_coach_or_admin

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

_sov_cache: dict | None = None
_rules_cache: dict | None = None


def _load_sov() -> dict:
    global _sov_cache
    if _sov_cache is None:
        with open(_DATA_DIR / "sov_2026_2027.json") as f:
            _sov_cache = json.load(f)
    return _sov_cache


def _load_rules() -> dict:
    global _rules_cache
    if _rules_cache is None:
        with open(_DATA_DIR / "program_rules_2026_2027.json") as f:
            _rules_cache = json.load(f)
    return _rules_cache


@get("/sov")
async def get_sov(request: Request) -> dict:
    require_coach_or_admin(request)
    return _load_sov()


@get("/rules")
async def get_rules(request: Request) -> dict:
    require_coach_or_admin(request)
    return _load_rules()


router = Router(
    path="/api/program-builder",
    route_handlers=[get_sov, get_rules],
)
