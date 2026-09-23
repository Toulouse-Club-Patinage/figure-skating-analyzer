import pytest

from app.mcp.loopback import current_principal, is_allowed_path
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken


def _set_token(claims: dict | None) -> None:
    token = AccessToken(token="t", client_id="c", scopes=["skatelab:read"], subject="42", claims=claims)
    auth_context_var.set(AuthenticatedUser(token))


def test_current_principal_rejects_missing_role():
    _set_token(claims={})
    with pytest.raises(Exception, match="non authentifiée"):
        current_principal()


def test_current_principal_rejects_none_claims():
    _set_token(claims=None)
    with pytest.raises(Exception, match="non authentifiée"):
        current_principal()


def test_current_principal_accepts_role():
    _set_token(claims={"role": "admin"})
    assert current_principal() == ("42", "admin")


@pytest.mark.parametrize("path,expected", [
    ("/api/skaters/1\n", False),
    ("/api/training/x", False),
    ("/api/skaters/1/scores", True),
])
def test_is_allowed_path(path, expected):
    assert is_allowed_path(path) is expected
