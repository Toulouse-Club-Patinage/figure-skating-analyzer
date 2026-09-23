"""I-1 : avertissement de démarrage si PUBLIC_BASE_URL pointe vers localhost
alors que SECURE_COOKIES=true (signe d'un oubli en production)."""
import logging

from app.config import _warn_if_localhost_issuer_in_production


def test_warns_on_localhost_with_secure_cookies(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        _warn_if_localhost_issuer_in_production("http://localhost:5173", True)
    assert any("PUBLIC_BASE_URL" in r.message and "localhost" in r.message for r in caplog.records)


def test_no_warning_on_localhost_without_secure_cookies(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        _warn_if_localhost_issuer_in_production("http://localhost:5173", False)
    assert caplog.records == []


def test_no_warning_on_https_domain_with_secure_cookies(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        _warn_if_localhost_issuer_in_production("https://skatelab.toulouseclubpatinage.com", True)
    assert caplog.records == []
