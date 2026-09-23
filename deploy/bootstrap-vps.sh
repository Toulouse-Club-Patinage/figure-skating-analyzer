#!/usr/bin/env bash
# bootstrap-vps.sh — Provisionne un VPS Debian 12 vierge pour héberger
# plusieurs applications Docker derrière un reverse proxy de bordure.
#
# Idempotent : relançable sans dégât.
# À exécuter EN ROOT, une seule fois au départ :
#   ssh vps-tcp 'bash -s' < deploy/bootstrap-vps.sh
#
# Ce script ne déploie AUCUNE application. Il prépare le terrain :
# Docker, l'utilisateur `deploy`, le pare-feu, le durcissement SSH,
# le réseau Docker partagé `web` et la clé de déploiement GitHub.

set -euo pipefail

DEPLOY_USER="deploy"
DEPLOY_UID=1000
STACKS_DIR="/opt/stacks"
DOCKER_NETWORK="web"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; NC='\033[0m'
info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $*"; }
die()  { echo -e "${RED}[ERREUR]${NC} $*" >&2; exit 1; }

# --- 0. Vérifications préalables ---------------------------------------
[[ $EUID -eq 0 ]] || die "Ce script doit être exécuté en root."
[[ -f /etc/os-release ]] || die "OS non reconnu (pas de /etc/os-release)."
. /etc/os-release
[[ "$ID" == "debian" || "$ID" == "ubuntu" ]] || die "Debian/Ubuntu requis. Détecté : $ID"
ok "Système : $PRETTY_NAME"

# --- 1. Mise à jour et paquets de base ----------------------------------
info "Mise à jour du système (peut prendre quelques minutes)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades
ok "Paquets de base installés"

# --- 2. Docker CE + plugin compose --------------------------------------
if command -v docker &>/dev/null; then
    ok "Docker déjà présent ($(docker --version))"
else
    info "Installation de Docker (dépôt officiel)..."
    curl -fsSL https://get.docker.com | sh
    ok "Docker installé ($(docker --version))"
fi
docker compose version &>/dev/null || die "Le plugin 'docker compose' est absent."
ok "Plugin compose : $(docker compose version --short)"

# --- 3. Rotation des logs Docker ----------------------------------------
# Sans cela, les logs des conteneurs grossissent sans limite et finissent
# par saturer le disque. À poser AVANT que des conteneurs ne tournent.
if [[ ! -f /etc/docker/daemon.json ]]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
    systemctl restart docker
    ok "Rotation des logs Docker configurée (10 Mo × 3)"
else
    warn "/etc/docker/daemon.json existe déjà — laissé tel quel"
    grep -q 'max-size' /etc/docker/daemon.json \
        || warn "  ... et il ne contient pas de limite de taille de log. À vérifier."
fi

# --- 4. Utilisateur non-root `deploy` -----------------------------------
# uid 1000 IMPÉRATIF : les conteneurs tournent en 1000:1000 et écrivent
# dans les volumes montés. Un uid différent = SQLITE_CANTOPEN au démarrage.
if id -u "$DEPLOY_USER" &>/dev/null; then
    ok "Utilisateur '$DEPLOY_USER' déjà présent (uid $(id -u "$DEPLOY_USER"))"
    [[ "$(id -u "$DEPLOY_USER")" == "$DEPLOY_UID" ]] \
        || warn "uid ≠ $DEPLOY_UID : pense à aligner PUID/PGID dans les .env des apps."
else
    if getent passwd "$DEPLOY_UID" &>/dev/null; then
        die "L'uid $DEPLOY_UID est déjà pris par '$(getent passwd $DEPLOY_UID | cut -d: -f1)'."
    fi
    adduser --disabled-password --gecos "" --uid "$DEPLOY_UID" "$DEPLOY_USER"
    ok "Utilisateur '$DEPLOY_USER' créé (uid $DEPLOY_UID)"
fi
usermod -aG docker "$DEPLOY_USER"
ok "'$DEPLOY_USER' est dans le groupe docker"

# --- 5. Clés SSH : recopier celles de root vers `deploy` -----------------
# GARDE-FOU : sans clé chez `deploy`, désactiver le login root = lock-out.
DEPLOY_SSH="/home/$DEPLOY_USER/.ssh"
mkdir -p "$DEPLOY_SSH"
if [[ -f /root/.ssh/authorized_keys ]]; then
    touch "$DEPLOY_SSH/authorized_keys"
    while IFS= read -r key; do
        [[ -z "$key" || "$key" == \#* ]] && continue
        grep -qxF "$key" "$DEPLOY_SSH/authorized_keys" \
            || echo "$key" >> "$DEPLOY_SSH/authorized_keys"
    done < /root/.ssh/authorized_keys
    ok "Clés SSH de root recopiées vers '$DEPLOY_USER'"
fi
chmod 700 "$DEPLOY_SSH"
[[ -f "$DEPLOY_SSH/authorized_keys" ]] && chmod 600 "$DEPLOY_SSH/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_SSH"

HAS_DEPLOY_KEY=0
if [[ -s "$DEPLOY_SSH/authorized_keys" ]]; then
    HAS_DEPLOY_KEY=1
    ok "'$DEPLOY_USER' dispose de $(wc -l < "$DEPLOY_SSH/authorized_keys") clé(s) autorisée(s)"
else
    warn "'$DEPLOY_USER' n'a AUCUNE clé SSH autorisée."
fi

# --- 6. Pare-feu ufw ----------------------------------------------------
# L'ordre compte : autoriser 22 AVANT d'activer, sinon la session saute.
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw allow 443/udp  >/dev/null   # HTTP/3
ufw default deny incoming  >/dev/null
ufw default allow outgoing >/dev/null
if ufw status | grep -q "Status: active"; then
    ok "ufw déjà actif"
else
    ufw --force enable >/dev/null
    ok "ufw activé (22, 80, 443 ouverts ; reste refusé)"
fi

# --- 7. fail2ban + mises à jour de sécurité automatiques -----------------
systemctl enable --now fail2ban >/dev/null 2>&1 || true
ok "fail2ban actif"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
ok "Mises à jour de sécurité automatiques activées"

# --- 8. Durcissement SSH ------------------------------------------------
# Conditionné à la présence d'une clé chez `deploy` : sans cela, on
# refuse de couper le login root — mieux vaut un VPS moins durci qu'un
# VPS inaccessible.
if [[ "$HAS_DEPLOY_KEY" -eq 1 ]]; then
    cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
# Posé par deploy/bootstrap-vps.sh — connexion par clé uniquement.
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
CONF
    if sshd -t 2>/dev/null; then
        systemctl reload ssh 2>/dev/null || systemctl reload sshd
        ok "SSH durci : login root désactivé, mot de passe refusé"
        warn "AVANT DE FERMER CETTE SESSION : ouvre-en une seconde et vérifie"
        warn "  ssh $DEPLOY_USER@<ip>"
    else
        rm -f /etc/ssh/sshd_config.d/99-hardening.conf
        die "La config sshd générée est invalide — durcissement annulé, sshd intact."
    fi
else
    warn "Durcissement SSH IGNORÉ : '$DEPLOY_USER' n'a pas de clé autorisée."
    warn "  Ajoute ta clé publique dans $DEPLOY_SSH/authorized_keys puis relance."
fi

# --- 9. Répertoire des stacks + réseau Docker partagé -------------------
mkdir -p "$STACKS_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$STACKS_DIR"
ok "$STACKS_DIR prêt (propriétaire : $DEPLOY_USER)"

if docker network inspect "$DOCKER_NETWORK" &>/dev/null; then
    ok "Réseau Docker '$DOCKER_NETWORK' déjà présent"
else
    docker network create "$DOCKER_NETWORK" >/dev/null
    ok "Réseau Docker '$DOCKER_NETWORK' créé"
fi

# --- 10. Clé de déploiement GitHub --------------------------------------
# Les deux dépôts sont privés et clonés en SSH : le VPS a besoin de sa
# propre clé, déclarée en « deploy key » sur chaque dépôt.
# ⚠️ Une deploy key GitHub ne vaut que pour UN SEUL dépôt : la même clé ne
# peut pas être enregistrée sur deux dépôts (GitHub la refuse avec « key is
# already in use »). On génère donc une clé PAR dépôt, plus un alias SSH qui
# force l'usage de la bonne — sans quoi ssh proposerait la première clé et
# GitHub répondrait « Repository not found », message trompeur qui parle d'un
# dépôt inexistant alors que le problème est un droit d'accès.
#
# Alias créés :  github-ligue  -> dépôt Ligue
#                github-skatelab -> dépôt SkateLab
# Les URL de clone deviennent  git@<alias>:<propriétaire>/<dépôt>.git

declare -A REPO_KEYS=(
    [ligue]="AbelThorne/ligue-app-competitions"
    [skatelab]="Toulouse-Club-Patinage/figure-skating-analyzer"
)

SSH_CONFIG="$DEPLOY_SSH/config"
touch "$SSH_CONFIG"

for repo_alias in "${!REPO_KEYS[@]}"; do
    key="$DEPLOY_SSH/id_ed25519_$repo_alias"
    if [[ -f "$key" ]]; then
        ok "Clé de déploiement '$repo_alias' déjà présente"
    else
        sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" \
            -C "vps-tcp-deploy-$repo_alias" -f "$key" >/dev/null
        ok "Clé de déploiement '$repo_alias' générée"
    fi
    if ! grep -q "^Host github-$repo_alias$" "$SSH_CONFIG" 2>/dev/null; then
        cat >> "$SSH_CONFIG" <<CONF

Host github-$repo_alias
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_$repo_alias
  IdentitiesOnly yes
CONF
        ok "Alias SSH 'github-$repo_alias' configuré"
    fi
done
chmod 600 "$SSH_CONFIG"
chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_CONFIG"

sudo -u "$DEPLOY_USER" bash -c "ssh-keyscan -H github.com >> $DEPLOY_SSH/known_hosts 2>/dev/null" || true
sort -u "$DEPLOY_SSH/known_hosts" -o "$DEPLOY_SSH/known_hosts" 2>/dev/null || true
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_SSH/known_hosts" 2>/dev/null || true

echo
echo "======================================================================"
echo " BOOTSTRAP TERMINÉ"
echo "======================================================================"
echo
echo " Étape suivante — AJOUTE CHAQUE CLÉ en « Deploy key » sur SON dépôt."
echo " Une deploy key ne vaut que pour un seul dépôt : ce sont deux clés"
echo " DIFFÉRENTES, à ne pas intervertir. Laisse « Allow write access »"
echo " DÉCOCHÉ — le VPS n'a besoin que de lire."
echo
for repo_alias in "${!REPO_KEYS[@]}"; do
    echo "----------------------------------------------------------------------"
    echo " Dépôt : ${REPO_KEYS[$repo_alias]}"
    echo " https://github.com/${REPO_KEYS[$repo_alias]}/settings/keys"
    echo
    cat "$DEPLOY_SSH/id_ed25519_$repo_alias.pub"
    echo
done
echo "----------------------------------------------------------------------"
echo
echo " Vérifie ensuite depuis le VPS (une commande par dépôt) :"
for repo_alias in "${!REPO_KEYS[@]}"; do
    echo "   sudo -u $DEPLOY_USER ssh -T git@github-$repo_alias"
done
echo
echo " ⚠️ Les URL de clone utilisent l'ALIAS, pas github.com :"
for repo_alias in "${!REPO_KEYS[@]}"; do
    echo "   git@github-$repo_alias:${REPO_KEYS[$repo_alias]}.git"
done
echo
echo "======================================================================"
