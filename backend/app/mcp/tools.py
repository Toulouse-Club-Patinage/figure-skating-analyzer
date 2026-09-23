"""Outils MCP (lecture seule, données de compétition)."""
from __future__ import annotations

import app.database as db_mod
from app.mcp.loopback import current_principal
from app.models.user import User
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=False)


def register_tools(server: MCPServer) -> None:
    @server.tool(annotations=READ_ONLY)
    async def whoami() -> dict:
        """Identité du compte SkateLab connecté (nom, email, rôle).

        Rôles : admin et reader/coach voient les données du club ; skater ne voit
        que ses patineurs rattachés (voir list_my_skaters).
        """
        user_id, _ = current_principal()
        async with db_mod.async_session_factory() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise ToolError("Utilisateur introuvable")
            return {"id": user.id, "display_name": user.display_name, "email": user.email, "role": user.role}
