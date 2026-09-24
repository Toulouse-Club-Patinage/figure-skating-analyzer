import asyncio

import pytest

from app.mcp.loopback import (
    api_post, current_principal, is_allowed_path, is_allowed_write_path, require_scope,
)
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver.exceptions import ToolError


@pytest.fixture
def set_token():
    """Positionne auth_context_var pour le test, puis le réinitialise (évite la
    fuite du principal vers les tests suivants, y compris asynchrones)."""
    reset_token = None

    def _set(claims: dict | None) -> None:
        nonlocal reset_token
        token = AccessToken(token="t", client_id="c", scopes=["skatelab:read"], subject="42", claims=claims)
        reset_token = auth_context_var.set(AuthenticatedUser(token))

    yield _set
    if reset_token is not None:
        auth_context_var.reset(reset_token)


def test_current_principal_rejects_missing_role(set_token):
    set_token(claims={})
    with pytest.raises(ToolError, match="non authentifiée"):
        current_principal()


def test_current_principal_rejects_none_claims(set_token):
    set_token(claims=None)
    with pytest.raises(ToolError, match="non authentifiée"):
        current_principal()


def test_current_principal_accepts_role(set_token):
    set_token(claims={"role": "admin"})
    assert current_principal() == ("42", "admin")


@pytest.mark.parametrize("path,expected", [
    ("/api/skaters/1\n", False),
    ("/api/training/x", False),
    ("/api/skaters/1/scores", True),
])
def test_is_allowed_path(path, expected):
    assert is_allowed_path(path) is expected


@pytest.mark.parametrize("path,expected", [
    ("/api/competitions/bulk-import", True),
    ("/api/competitions/bulk-import\n", False),
    ("/api/competitions/bulk-action", False),
    ("/api/competitions/1/import", False),
])
def test_is_allowed_write_path(path, expected):
    assert is_allowed_write_path(path) is expected


def test_require_scope(set_token):
    set_token(claims={"role": "admin"})  # jeton de test : skatelab:read seulement
    require_scope("skatelab:read")
    with pytest.raises(ToolError, match="reconnectez"):
        require_scope("skatelab:import")


def test_api_post_rejects_unlisted_path(set_token):
    set_token(claims={"role": "admin"})
    with pytest.raises(ToolError, match="non autorisée"):
        asyncio.run(api_post("/api/competitions/1", {}, scope="skatelab:read"))
