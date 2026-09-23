import pytest
from mcp.shared.auth import InvalidRedirectUriError
from pydantic import AnyUrl

from app.mcp.redirects import SkatelabClient, is_allowed_redirect, is_loopback


@pytest.mark.parametrize("uri", [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:3118/callback",
    "http://127.0.0.1:50000/callback",
    "http://localhost/callback",
])
def test_allowed(uri):
    assert is_allowed_redirect(uri)


@pytest.mark.parametrize("uri", [
    "https://evil.example/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "https://claude.ai.evil.example/api/mcp/auth_callback",
    "http://claude.ai/api/mcp/auth_callback",
    "http://localhost:3118/other",
    "https://localhost:3118/callback",
    "http://user@localhost:3118/callback",
    "http://192.168.1.2:3118/callback",
])
def test_rejected(uri):
    assert not is_allowed_redirect(uri)


def test_is_loopback():
    assert is_loopback("http://127.0.0.1:1/callback")
    assert not is_loopback("https://claude.ai/api/mcp/auth_callback")


def _client(*uris):
    return SkatelabClient(client_id="c", redirect_uris=[AnyUrl(u) for u in uris], token_endpoint_auth_method="none")


def test_loopback_port_is_ignored():
    c = _client("http://localhost:3118/callback")
    assert str(c.validate_redirect_uri(AnyUrl("http://localhost:4000/callback"))) == "http://localhost:4000/callback"


def test_loopback_host_must_match():
    c = _client("http://localhost:3118/callback")
    with pytest.raises(InvalidRedirectUriError):
        c.validate_redirect_uri(AnyUrl("http://127.0.0.1:4000/callback"))


def test_https_redirect_stays_exact():
    c = _client("https://claude.ai/api/mcp/auth_callback")
    assert c.validate_redirect_uri(AnyUrl("https://claude.ai/api/mcp/auth_callback"))
    with pytest.raises(InvalidRedirectUriError):
        c.validate_redirect_uri(AnyUrl("https://claude.com/api/mcp/auth_callback"))
