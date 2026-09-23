"""I-1 : une PUBLIC_BASE_URL invalide ne doit pas empêcher app.main de démarrer.

Le dispatcher doit répondre 503 sur les chemins MCP/OAuth (pas de crash), et
`app.main._create_mcp_app_safe` doit transformer un `create_mcp_app()` en échec
en `(None, None)` plutôt que laisser l'exception remonter.
"""
import pytest

from litestar import Litestar, get

from app.mcp.dispatcher import McpDispatcher


@get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


litestar_stub = Litestar(route_handlers=[health])


@pytest.mark.parametrize("path", ["/mcp", "/authorize", "/token", "/register", "/revoke",
                                  "/.well-known/oauth-authorization-server"])
async def test_dispatcher_503_body_and_status(path):
    from httpx import ASGITransport, AsyncClient

    dispatcher = McpDispatcher(litestar_stub, None)
    transport = ASGITransport(app=dispatcher)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        r = await client.get(path)
    assert r.status_code == 503
    assert r.json() == {
        "error": "temporarily_unavailable",
        "error_description": "Serveur MCP désactivé : PUBLIC_BASE_URL invalide",
    }


async def test_dispatcher_still_serves_litestar_when_mcp_app_missing():
    from httpx import ASGITransport, AsyncClient

    dispatcher = McpDispatcher(litestar_stub, None)
    transport = ASGITransport(app=dispatcher)
    async with AsyncClient(transport=transport, base_url="http://localhost") as client:
        r = await client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_create_mcp_app_safe_handles_invalid_public_base_url(monkeypatch):
    import app.main as main_module

    def _raise(*args, **kwargs):
        raise ValueError("Issuer URL must be HTTPS")

    monkeypatch.setattr(main_module, "create_mcp_app", _raise)
    assert main_module._create_mcp_app_safe() == (None, None)


def test_create_mcp_app_safe_passes_through_on_success(monkeypatch):
    import app.main as main_module

    sentinel = object(), object()
    monkeypatch.setattr(main_module, "create_mcp_app", lambda: sentinel)
    assert main_module._create_mcp_app_safe() is sentinel
