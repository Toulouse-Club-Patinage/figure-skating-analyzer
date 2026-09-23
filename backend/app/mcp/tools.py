"""Outils MCP (lecture seule, données de compétition).

Chaque outil appelle une route GET existante via `api_get` : les droits sont
ceux de l'application web (un compte skater ne voit que ses patineurs).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import app.database as db_mod
from app.mcp.loopback import api_get, current_principal
from app.models.user import User
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)
MAX_LIMIT = 200
DEFAULT_LIMIT = 50
_UI_ONLY_KEYS = frozenset({"pdf_url", "pdf_path"})
GLOSSARY = (Path(__file__).parent / "glossary.md").read_text(encoding="utf-8")


def _slim(value: Any, drop: frozenset[str] = _UI_ONLY_KEYS) -> Any:
    if isinstance(value, dict):
        return {k: _slim(v, drop) for k, v in value.items() if k not in drop}
    if isinstance(value, list):
        return [_slim(v, drop) for v in value]
    return value


def _page(rows: list, limit: int, drop: frozenset[str] = _UI_ONLY_KEYS) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    return {"total": len(rows), "returned": min(len(rows), limit), "items": _slim(rows[:limit], drop)}


def register_tools(server: MCPServer) -> None:
    @server.resource("skatelab://glossaire", name="glossaire", title="Glossaire de notation",
                     mime_type="text/markdown")
    def glossary() -> str:
        """Vocabulaire de notation (TES, PCS, GOE, codes d'éléments, catégories FFSG)."""
        return GLOSSARY

    @server.tool(annotations=READ_ONLY)
    async def whoami() -> dict:
        """Identité du compte SkateLab connecté (nom, email, rôle).

        Rôles : admin, coach et reader voient les données du club ; skater ne voit
        que ses patineurs rattachés (voir list_my_skaters).
        """
        user_id, _ = current_principal()
        async with db_mod.async_session_factory() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise ToolError("Utilisateur introuvable")
            return {"id": user.id, "display_name": user.display_name, "email": user.email, "role": user.role}

    @server.tool(annotations=READ_ONLY)
    async def list_my_skaters() -> list[dict]:
        """Patineurs rattachés au compte (rôle skater). Liste vide pour les autres rôles."""
        return await api_get("/api/me/skaters")

    @server.tool(annotations=READ_ONLY)
    async def search_skaters(query: str = "", club: str | None = None, limit: int = DEFAULT_LIMIT) -> dict:
        """Recherche des patineurs par prénom/nom (sous-chaîne), éventuellement par club."""
        rows = await api_get("/api/skaters/", {"search": query or None, "club": club})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater(skater_id: int) -> dict:
        """Fiche d'un patineur (identité, club, licence, date de naissance si connue)."""
        return _slim(await api_get(f"/api/skaters/{skater_id}"))

    @server.tool(annotations=READ_ONLY)
    async def get_skater_scores(skater_id: int, season: str | None = None, include_elements: bool = False,
                                limit: int = DEFAULT_LIMIT) -> dict:
        """Scores d'un patineur par compétition et segment (TES, PCS, déductions, rang).

        `season` au format 2025-2026. Les éléments détaillés sont omis sauf si
        include_elements=true (préférer get_skater_elements ou get_score_elements).
        """
        rows = await api_get(f"/api/skaters/{skater_id}/scores", {"season": season})
        drop = _UI_ONLY_KEYS if include_elements else _UI_ONLY_KEYS | {"elements"}
        return _page(rows, limit, drop)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_elements(skater_id: int, element_type: str | None = None, season: str | None = None,
                                  limit: int = MAX_LIMIT) -> dict:
        """Historique des éléments d'un patineur (valeur de base, GOE, score) ; filtre par type."""
        rows = await api_get(f"/api/skaters/{skater_id}/elements",
                             {"element_type": element_type, "season": season})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_category_results(skater_id: int, season: str | None = None,
                                          limit: int = DEFAULT_LIMIT) -> dict:
        """Classements finaux d'un patineur par catégorie et compétition."""
        rows = await api_get(f"/api/skaters/{skater_id}/category-results", {"season": season})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_skater_seasons(skater_id: int) -> list[str]:
        """Saisons pendant lesquelles le patineur a des résultats."""
        return await api_get(f"/api/skaters/{skater_id}/seasons")

    @server.tool(annotations=READ_ONLY)
    async def list_seasons() -> list[str]:
        """Saisons disponibles dans SkateLab."""
        return await api_get("/api/competitions/seasons")

    @server.tool(annotations=READ_ONLY)
    async def list_competitions(season: str | None = None, club: str | None = None, my_club: bool = False,
                                limit: int = DEFAULT_LIMIT) -> dict:
        """Compétitions importées (nom, dates, lieu, type), filtrables par saison ou club."""
        rows = await api_get("/api/competitions/", {"season": season, "club": club,
                                                    "my_club": "true" if my_club else None})
        return _page(rows, limit)

    @server.tool(annotations=READ_ONLY)
    async def get_competition(competition_id: int) -> dict:
        """Détail d'une compétition et de ses catégories."""
        return _slim(await api_get(f"/api/competitions/{competition_id}"))

    @server.tool(annotations=READ_ONLY)
    async def get_score_elements(score_id: int) -> list[dict]:
        """Éléments détaillés d'un score (code, valeur de base, GOE, notes des juges)."""
        return _slim(await api_get(f"/api/scores/{score_id}/elements"))

    @server.tool(annotations=READ_ONLY)
    async def get_team_scores(competition_id: int) -> dict:
        """Points d'équipe d'une compétition France Clubs."""
        return _slim(await api_get(f"/api/competitions/{competition_id}/team-scores"))

    @server.tool(annotations=READ_ONLY)
    async def club_progression_ranking(season: str | None = None, club: str | None = None,
                                       skating_level: str | None = None, age_group: str | None = None,
                                       gender: str | None = None, limit: int = DEFAULT_LIMIT) -> Any:
        """Classement de progression des patineurs du club sur une saison."""
        data = await api_get("/api/stats/progression-ranking", {
            "season": season, "club": club, "skating_level": skating_level,
            "age_group": age_group, "gender": gender})
        return _page(data, limit) if isinstance(data, list) else _slim(data)

    @server.tool(annotations=READ_ONLY)
    async def club_benchmarks(skating_level: str, age_group: str, gender: str, season: str | None = None) -> dict:
        """Repères de score (médianes, quartiles) pour une catégorie donnée."""
        return _slim(await api_get("/api/stats/benchmarks", {
            "skating_level": skating_level, "age_group": age_group, "gender": gender, "season": season}))

    @server.tool(annotations=READ_ONLY)
    async def club_element_mastery(season: str | None = None, club: str | None = None,
                                   skating_level: str | None = None, age_group: str | None = None,
                                   gender: str | None = None) -> Any:
        """Taux de réussite par élément pour le club (GOE moyen, fréquence, erreurs)."""
        return _slim(await api_get("/api/stats/element-mastery", {
            "season": season, "club": club, "skating_level": skating_level,
            "age_group": age_group, "gender": gender}))

    @server.tool(annotations=READ_ONLY)
    async def competition_club_analysis(competition_id: int, club: str | None = None) -> dict:
        """Analyse des résultats du club sur une compétition (progressions, records)."""
        return _slim(await api_get("/api/stats/competition-club-analysis",
                                   {"competition_id": competition_id, "club": club}))
