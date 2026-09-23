import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
PDF_DIR = Path(os.environ.get("PDF_DIR", str(DATA_DIR / "pdfs")))
LOGOS_DIR = Path(os.environ.get("LOGOS_DIR", str(DATA_DIR / "logos")))

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{DATA_DIR / 'skating.db'}",
)

# Auth
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "true").lower() == "true"
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# URL publique de l'instance (sans slash final). Sert d'issuer OAuth et de base
# à l'URL MCP ({PUBLIC_BASE_URL}/mcp) : elle doit correspondre EXACTEMENT à
# l'URL que les utilisateurs saisissent dans Claude. HTTPS obligatoire hors localhost.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:5173").rstrip("/")

# Bootstrap (optional — used on first run if set)
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
CLUB_NAME = os.environ.get("CLUB_NAME", "")
CLUB_SHORT = os.environ.get("CLUB_SHORT", "")

# CORS
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

# SMTP (optional — email notifications disabled if SMTP_HOST is empty)
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")

# Ensure data directories exist
DATA_DIR.mkdir(exist_ok=True)
PDF_DIR.mkdir(exist_ok=True)
LOGOS_DIR.mkdir(exist_ok=True)
