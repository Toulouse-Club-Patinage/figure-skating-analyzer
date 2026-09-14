"""Tests pour l'adresse de support et son encodage anti-moissonnage.

La propriété qui compte : l'adresse ne doit JAMAIS transiter en clair par
`GET /api/config/`, qui est public. Le front la décode au clic seulement.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.club_config import _obfuscate_email


def _settings(**kw):
    from app.models.app_settings import AppSettings

    return AppSettings(
        club_name="Test Club", club_short="TC", current_season="2025-2026", **kw
    )


def test_obfuscate_is_reversible_rot13():
    """ROT13 est involutif : encoder deux fois redonne l'original."""
    once = _obfuscate_email("support@monclub.fr")
    assert once == "fhccbeg(at)zbapyho.se"
    assert _obfuscate_email(once.replace("(at)", "@")) == "support(at)monclub.fr"


def test_obfuscate_hides_the_address():
    """Ni le `@` ni aucun fragment lisible ne subsistent."""
    encoded = _obfuscate_email("support@monclub.fr")
    assert "@" not in encoded
    assert "support" not in encoded
    assert "monclub" not in encoded


def test_obfuscate_preserves_digits_and_punctuation():
    """Chiffres, points, tirets et `+` doivent traverser intacts."""
    encoded = _obfuscate_email("aide.club+42@ex-sport.fr")
    assert _obfuscate_email(encoded.replace("(at)", "@")) == "aide.club+42(at)ex-sport.fr"
    assert "42" in encoded
    assert "+" in encoded


def test_obfuscate_handles_empty_and_none():
    assert _obfuscate_email("") == ""
    assert _obfuscate_email(None) == ""


@pytest.mark.asyncio
async def test_public_config_never_leaks_plaintext(
    client: AsyncClient, db_session: AsyncSession
):
    """GET /api/config/ renvoie l'adresse encodée, jamais en clair."""
    db_session.add(_settings(support_email="support@monclub.fr"))
    await db_session.commit()

    res = await client.get("/api/config/")
    assert res.status_code == 200
    data = res.json()

    assert data["support_email_encoded"] == "fhccbeg(at)zbapyho.se"
    assert "support_email" not in data
    # Même en inspectant le corps brut, l'adresse est introuvable.
    assert "support@monclub.fr" not in res.text


@pytest.mark.asyncio
async def test_public_config_empty_when_unset(
    client: AsyncClient, db_session: AsyncSession
):
    """Sans adresse configurée, le champ est vide (le front masque le lien)."""
    db_session.add(_settings())
    await db_session.commit()

    res = await client.get("/api/config/")
    assert res.json()["support_email_encoded"] == ""


@pytest.mark.asyncio
async def test_admin_can_set_support_email(
    client: AsyncClient, admin_token: str, db_session: AsyncSession
):
    """PATCH /api/config/ enregistre l'adresse et la ressert encodée."""
    db_session.add(_settings())
    await db_session.commit()

    res = await client.patch(
        "/api/config/",
        json={"support_email": "  aide@club.fr  "},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200
    # Réponse admin : en clair, pour réafficher le formulaire.
    assert res.json()["support_email"] == "aide@club.fr"

    # Mais l'endpoint public reste encodé.
    public = await client.get("/api/config/")
    assert public.json()["support_email_encoded"] == _obfuscate_email("aide@club.fr")


@pytest.mark.asyncio
async def test_blank_support_email_clears_it(
    client: AsyncClient, admin_token: str, db_session: AsyncSession
):
    """Une chaîne vide efface l'adresse et masque donc le lien."""
    db_session.add(_settings(support_email="aide@club.fr"))
    await db_session.commit()

    res = await client.patch(
        "/api/config/",
        json={"support_email": "   "},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200
    assert res.json()["support_email"] == ""

    public = await client.get("/api/config/")
    assert public.json()["support_email_encoded"] == ""


@pytest.mark.asyncio
async def test_smtp_endpoint_exposes_plaintext_to_admin(
    client: AsyncClient, admin_token: str, db_session: AsyncSession
):
    """L'endpoint admin sert l'adresse en clair pour préremplir le formulaire."""
    db_session.add(_settings(support_email="aide@club.fr"))
    await db_session.commit()

    res = await client.get(
        "/api/config/smtp", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200
    assert res.json()["support_email"] == "aide@club.fr"


@pytest.mark.asyncio
async def test_smtp_patch_saves_support_email(
    client: AsyncClient, admin_token: str, db_session: AsyncSession
):
    """Le champ s'enregistre depuis le formulaire e-mail où il est affiché."""
    db_session.add(_settings())
    await db_session.commit()

    res = await client.patch(
        "/api/config/smtp",
        json={"support_email": "aide@club.fr"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200
    assert res.json()["support_email"] == "aide@club.fr"


@pytest.mark.asyncio
async def test_smtp_endpoint_requires_admin(client: AsyncClient, reader_token: str):
    """Un non-admin ne doit pas pouvoir lire l'adresse en clair."""
    res = await client.get(
        "/api/config/smtp", headers={"Authorization": f"Bearer {reader_token}"}
    )
    assert res.status_code in (401, 403)
