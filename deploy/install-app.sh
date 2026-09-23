#!/usr/bin/env bash
# install-app.sh — Installe ou met à jour une application dans /opt/stacks.
#
# Idempotent : premier appel = clone, appels suivants = git pull.
# À exécuter EN TANT QUE `deploy` sur le VPS :
#   ./install-app.sh ligue git@github.com:AbelThorne/ligue-app-competitions.git
#   ./install-app.sh skatelab git@github.com:Toulouse-Club-Patinage/figure-skating-analyzer.git deploy/compose.vps.yml
#
# Le 3e argument, optionnel, est un fichier compose de surcouche relatif à
# la racine du dépôt. Il sert aux dépôts dont le compose racine cible un
# autre environnement (SkateLab : compose racine = développement local,
# surcouche = VPS).
#
# Ce script ne lance JAMAIS de migration de base de données : sur une base
# déjà peuplée, l'ordre des migrations est une décision humaine.

set -euo pipefail

STACKS_DIR="/opt/stacks"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; NC='\033[0m'
info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $*"; }
die()  { echo -e "${RED}[ERREUR]${NC} $*" >&2; exit 1; }

[[ $# -ge 2 && $# -le 3 ]] || die "Usage : $0 <nom-app> <url-depot-git> [fichier-surcouche]"
APP_NAME="$1"
REPO_URL="$2"
OVERLAY="${3:-}"
APP_DIR="$STACKS_DIR/$APP_NAME"

[[ $EUID -ne 0 ]] || die "À exécuter en tant que 'deploy', pas en root."
docker network inspect web &>/dev/null \
    || die "Le réseau Docker 'web' est absent. Lance d'abord bootstrap-vps.sh."
[[ -d "$STACKS_DIR" ]] || die "$STACKS_DIR est absent. Lance d'abord bootstrap-vps.sh."

# --- 1. Récupérer le code ------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
    info "Mise à jour de $APP_NAME..."
    git -C "$APP_DIR" pull --ff-only
    ok "Code à jour ($(git -C "$APP_DIR" rev-parse --short HEAD))"
else
    info "Clonage de $APP_NAME..."
    git clone "$REPO_URL" "$APP_DIR"
    ok "Cloné dans $APP_DIR"
fi

cd "$APP_DIR"

# --- 2. Composer la commande (avec surcouche éventuelle) -----------------
COMPOSE=(docker compose -f docker-compose.yml)
if [[ -n "$OVERLAY" ]]; then
    [[ -f "$OVERLAY" ]] || die "Surcouche introuvable : $APP_DIR/$OVERLAY"
    COMPOSE+=(-f "$OVERLAY")
    ok "Surcouche appliquée : $OVERLAY"
fi

# --- 3. Vérifier la configuration ---------------------------------------
if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        cp .env.example .env
        warn "Aucun .env : copié depuis .env.example."
        warn "  ÉDITE $APP_DIR/.env AVANT de continuer, puis relance ce script."
        exit 1
    fi
    die "Aucun .env ni .env.example dans $APP_DIR."
fi
# Garde-fou : refuse de démarrer si .env contient encore une valeur d'exemple
# manifeste (ex. le SECRET_KEY par défaut de Ligue, dev-insecure-secret-change-me).
# Générique : ce script sert plusieurs apps, on ne connaît pas leurs variables.
if grep -qE 'change-me|changeme|CHANGE_ME|insecure|<[A-Za-z_-]+>' .env; then
    die "$APP_DIR/.env contient encore une valeur d'exemple (motif type 'change-me' détecté). Édite-le avec de vraies valeurs avant de continuer."
fi
ok ".env présent"

# --- 4. Préparer les dossiers d'état ------------------------------------
# Les conteneurs tournent en 1000:1000. Si ces dossiers appartiennent à un
# autre uid, SQLite échoue au démarrage (SQLITE_CANTOPEN).
for d in data var/uploads var/backups; do
    [[ -e "$d" ]] || { mkdir -p "$d"; info "Créé : $d"; }
done
ok "Dossiers d'état prêts (propriétaire : $(id -un), uid $(id -u))"

# --- 5. Garde-fou : aucun port ne doit être publié ----------------------
# Sur ce VPS, seul le routeur de bordure publie des ports. Une app qui en
# publie entrerait en conflit avec lui (ou l'empêcherait de démarrer).
if "${COMPOSE[@]}" config | grep -q 'published:'; then
    warn "Cette configuration publie des ports sur l'hôte :"
    "${COMPOSE[@]}" config | grep -B2 'published:' | head -12
    die "Conflit probable avec le routeur de bordure. Vérifie la surcouche."
fi
ok "Aucun port publié — compatible avec le routeur de bordure"

# --- 6. Construire et démarrer ------------------------------------------
info "Construction des images (peut prendre plusieurs minutes)..."
"${COMPOSE[@]}" build
info "Démarrage du stack..."
"${COMPOSE[@]}" up -d
ok "Stack '$APP_NAME' démarré"

echo
"${COMPOSE[@]}" ps
echo
warn "MIGRATIONS : ce script n'en lance aucune."
warn "  Sur une base DÉJÀ PEUPLÉE, joue les migrations dans l'ordre imposé"
warn "  AVANT de considérer le déploiement terminé — voir la documentation"
warn "  de déploiement du dépôt ($APP_DIR/docs/)."
echo
if [[ -n "$OVERLAY" ]]; then
    warn "Ce stack utilise une surcouche. Pour toute commande ultérieure :"
    warn "  cd $APP_DIR && docker compose -f docker-compose.yml -f $OVERLAY <cmd>"
fi
ok "Vérifie maintenant : ${COMPOSE[*]} logs -f"
