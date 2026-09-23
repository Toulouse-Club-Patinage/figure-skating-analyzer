# Migration SkateLab : GCP → VPS

Bascule de l'application SkateLab depuis la VM GCP (`skatelab-vm`, projet
`skating-analyzer`) vers le VPS mutualisé qui héberge déjà l'application Ligue,
**avec reprise des données** (base SQLite, PDF, logos).

> ## ✅ **MIGRATION EFFECTUÉE LE 2026-08-30**
>
> SkateLab tourne sur le VPS et sert le trafic de production sur
> `https://skatelab.toulouseclubpatinage.com`. Certificat Let's Encrypt émis
> (valide jusqu'au 2026-11-28, renouvellement automatique).
>
> **Reprise des données vérifiée** — compteurs identiques des deux côtés :
> `competitions` 127, `skaters` 3299, `scores` 18488, `category_results` 14935,
> `users` 12 ; `PRAGMA integrity_check` = `ok`.
>
> **Étapes 1 à 8 : faites.** Écart au plan rencontré : la deploy key SkateLab
> n'existait pas sur le VPS (bootstrap antérieur à la gestion de deux dépôts) —
> générée, enregistrée en lecture seule sur le dépôt, vérifiée.
>
> **Étape 9 (CI) : faite** — les workflows `.github/workflows/ci-*.yml` qui
> poussaient vers Artifact Registry ont été supprimés.
>
> **Étape 11 (décommissionnement GCP) : faite le 2026-09-13.** Voir §11.
> ⚠️ **Le retour arrière n'est plus possible** : la VM, son disque, le load
> balancer et l'IP statique `34.8.236.77` sont supprimés définitivement.
>
> ---
>
> **État au 2026-08-27 (avant bascule)** — le VPS (`192.162.69.191`) tourne avec son routeur de
> bordure (`edge-caddy`) et l'application Ligue en production sur
> `competitions-ligue.toulouseclubpatinage.com`. Le bloc SkateLab du Caddyfile
> socle est **écrit mais commenté**, prêt à être activé. Tout ce que décrit ce
> document reste à faire.
>
> **Côté GCP, relevé sur la VM elle-même** (pas déduit de la doc) : `skatelab-vm`
> tourne depuis 6 semaines dans `europe-west9-a`, déploiement dans
> `/opt/skatelab`, volume Docker **`skatelab_app-data`** (nom exact), load
> balancer sur **34.8.236.77**. Volume : **387 Mo** — `pdfs/` 347 Mo,
> `skating.db` 41 Mo, `logos/` 20 Ko. Fichiers appartenant à **root**.

---

## 1. Ce qui doit être migré

Tout l'état de SkateLab vit dans **un seul volume Docker nommé** : `app-data`,
monté sur `/data` dans le conteneur backend (`docker-compose.yml:6-7`). Il
contient :

| Chemin dans le volume | Contenu | Source |
|---|---|---|
| `/data/skating.db` | Base SQLite complète — **41 Mo** | `DATABASE_URL` |
| `/data/pdfs/` | Feuilles de notes téléchargées — **347 Mo**, ~129 dossiers | `PDF_DIR` (`backend/app/config.py:6`) |
| `/data/logos/` | Logos de clubs — 20 Ko | `LOGOS_DIR` (`backend/app/config.py:7`) |

**Total : 387 Mo.** L'archive compressée tiendra largement dans le `/tmp` de la VM
comme dans les 145 Go libres du VPS.

> **Un fichier parasite existe dans le volume** : `skating.db^C` (64 Ko, avec un
> caractère de contrôle littéral dans le nom), vestige d'un `Ctrl+C` lors d'une
> opération passée. **Ce n'est pas un fichier WAL et ce n'est pas la base.** Il
> sera copié avec le reste, sans conséquence. On peut le supprimer une fois la
> migration validée — mais ne pas s'en occuper pendant la bascule, ce n'est pas
> le moment de manipuler des noms de fichiers exotiques.
>
> Vérifié également : **aucun fichier `-wal` ni `-shm`** ne traîne dans le volume,
> la base est proprement checkpointée. L'arrêt du backend avant copie (§3) reste
> néanmoins la bonne pratique — rien ne garantit que ce sera encore le cas le
> jour J.

Il n'y a **rien d'autre à reprendre** : pas de bind-mount hôte, pas de fichier de
configuration à part le `.env` (que l'on recrée, voir §4).

> **Le schéma n'a pas de migrations.** `backend/app/database.py:31` applique
> `Base.metadata.create_all`. La base copiée arrive donc avec son schéma ; aucune
> commande de migration n'est à jouer. En contrepartie, **la version du code
> déployée sur le VPS doit être au moins celle qui tournait sur GCP** — un code
> plus ancien ne saurait pas lire une base plus récente.

---

## 2. Prérequis

- [ ] **Accès GCP fonctionnel** : `gcloud compute instances list
      --project=skating-analyzer` doit lister `skatelab-vm` en `RUNNING`. Si la
      commande réclame une ré-authentification, lancer `gcloud auth login`
      (interactif). ⚠️ Vérifier `$SHELL_PROFILE` = `tcp` avant toute opération
      gcloud — ce poste jongle avec plusieurs profils.
- [ ] **Accès VPS** : `ssh deploy@192.162.69.191` répond.
- [ ] **Deploy key SkateLab** déjà en place sur le VPS (`ssh -T git@github-skatelab`
      doit répondre « Hi Toulouse-Club-Patinage/figure-skating-analyzer! »). Posée par
      `deploy/bootstrap-vps.sh`.
- [ ] **Espace disque** : vérifier `df -h /` sur le VPS (145 Go libres au
      2026-08-27 — largement suffisant, la base fait quelques Mo).
- [ ] **Une fenêtre de maintenance** : la copie doit se faire **base à l'arrêt**
      (voir §3), donc l'application est indisponible le temps de l'opération.
      Compter 15 à 30 minutes en tout, dont l'essentiel en build d'images.

---

## 3. Extraire les données de GCP

⚠️ **Arrêter le backend avant de copier la base.** SQLite en WAL peut avoir des
écritures en attente dans `skating.db-wal` ; copier à chaud donne une base
potentiellement incohérente. C'est le point le plus important de cette migration.

```bash
# Se connecter à la VM GCP
gcloud compute ssh skatelab-vm --zone=europe-west9-a --project=skating-analyzer
```

Sur la VM :

```bash
cd /opt/skatelab

# 1. Arrêter le backend (le frontend peut rester, il ne touche pas la base)
docker compose stop backend

# 2. Archiver tout le volume depuis un conteneur jetable qui le monte.
#    On passe par un conteneur car le volume Docker n'est pas directement
#    lisible depuis l'hôte de façon fiable.
docker run --rm \
  -v skatelab_app-data:/data:ro \
  -v /tmp:/backup \
  alpine tar czf /backup/skatelab-data.tar.gz -C /data .

# 3. Vérifier le contenu de l'archive AVANT de quitter
tar tzf /tmp/skatelab-data.tar.gz | head -20
ls -lh /tmp/skatelab-data.tar.gz
```

> **Nom du volume vérifié le 2026-08-27** : `skatelab_app-data` (Docker Compose
> le préfixe du nom du dossier de projet). Le confirmer tout de même par
> `docker volume ls` le jour J — un redéploiement depuis un autre dossier
> changerait le préfixe.

Vérifier que l'archive contient bien `./skating.db`, `./pdfs/` et `./logos/`.

```bash
# 4. Redémarrer le backend : GCP reste la production tant que le DNS n'a pas
#    basculé. Ne PAS laisser le service arrêté.
docker compose start backend
```

Puis, depuis le poste local :

```bash
# 5. Rapatrier l'archive
gcloud compute scp skatelab-vm:/tmp/skatelab-data.tar.gz /tmp/ \
  --zone=europe-west9-a --project=skating-analyzer

# 6. Envoyer sur le VPS
scp /tmp/skatelab-data.tar.gz deploy@192.162.69.191:/tmp/
```

---

## 4. Installer l'application sur le VPS

```bash
ssh deploy@192.162.69.191 '/opt/stacks/install-app.sh \
    skatelab git@github-skatelab:Toulouse-Club-Patinage/figure-skating-analyzer.git \
    deploy/compose.vps.yml'
```

⚠️ Noter les deux particularités : l'URL passe par l'**alias SSH**
`git@github-skatelab:` (une deploy key ne vaut que pour un dépôt), et le
troisième argument applique la **surcouche VPS** (retire les ports publiés, pose
`container_name: skatelab-frontend`, rejoint le réseau `web`).

Le premier appel s'arrête sur le `.env` manquant. Le renseigner en **reprenant
les valeurs de la VM GCP** (`/opt/skatelab/.env`), à trois exceptions près :

Le `.env` de GCP contient exactement ces neuf clés (relevé le 2026-08-27) :
`SECRET_KEY`, `SECURE_COOKIES`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CLUB_NAME`,
`CLUB_SHORT`, `ALLOWED_ORIGINS`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`.

**Le plus simple et le plus sûr est de le recopier tel quel depuis la VM** plutôt
que de le retaper — cela évite d'oublier une variable ou d'altérer le
`SECRET_KEY` :

```bash
# Depuis le poste local : récupérer le .env de GCP...
gcloud compute scp skatelab-vm:/opt/skatelab/.env /tmp/skatelab.env \
  --zone=europe-west9-a --project=skating-analyzer

# ...puis le déposer sur le VPS
scp /tmp/skatelab.env deploy@192.162.69.191:/opt/stacks/skatelab/.env
rm /tmp/skatelab.env       # ne pas laisser traîner un fichier de secrets
```

⚠️ **`DATABASE_URL` doit impérativement être conservée.** Contrairement à
l'application Ligue (où cette variable est un piège à éviter), SkateLab en
**dépend** :

```
DATABASE_URL=sqlite+aiosqlite:////data/skating.db
```

Sans elle, `config.py` retombe sur son défaut `DATA_DIR = backend/data/` —
c'est-à-dire **`/app/data` dans le conteneur, hors du volume monté sur `/data`**.
L'application créerait alors une base vide et ignorerait purement et simplement
les données migrées, sans lever la moindre erreur. Vérifié sur la VM en
production : le conteneur résout bien `DB : sqlite+aiosqlite:////data/skating.db`
alors que `DATA_DIR` vaut `/app/data`.

De même, `PDF_DIR=/data/pdfs` et `LOGOS_DIR=/data/logos` sont résolus correctement
dans le conteneur GCP **alors qu'ils sont absents du `.env`** : ils sont donc
fournis par l'image elle-même (`Dockerfile.backend` ou `render.yaml`). Après
démarrage sur le VPS, **le vérifier explicitement** :

```bash
docker exec skatelab-backend-1 python -c \
  "from app.config import PDF_DIR, LOGOS_DIR, DATABASE_URL; print(PDF_DIR, LOGOS_DIR, DATABASE_URL)"
```

Attendu : `/data/pdfs /data/logos sqlite+aiosqlite:////data/skating.db`. Si les
deux premiers pointaient ailleurs, ajouter `PDF_DIR=/data/pdfs` et
`LOGOS_DIR=/data/logos` au `.env`.

> **Ne jamais régénérer le `SECRET_KEY`** : il signe les JWT. En changer
> déconnecterait tous les utilisateurs. La copie du `.env` le préserve.
>
> **`ADMIN_PASSWORD` peut rester** : il ne sert qu'à créer le premier admin sur
> une base vierge, et la base migrée a déjà ses comptes. Inoffensif.
>
> **`ALLOWED_ORIGINS`** vaut déjà `https://skatelab.toulouseclubpatinage.com` —
> correct puisque le domaine ne change pas. À adapter en cas de changement de
> domaine.

Relancer la même commande `install-app.sh` pour construire et démarrer.

---

## 5. Restaurer les données

⚠️ L'étape précédente a démarré l'application avec une base **vierge** (créée par
`create_all`). Il faut l'écraser par celle de GCP, **application arrêtée**.

```bash
ssh deploy@192.162.69.191
cd /opt/stacks/skatelab
COMPOSE="docker compose -f docker-compose.yml -f deploy/compose.vps.yml"

# 1. Arrêter l'application (le volume survit)
$COMPOSE down

# 2. Identifier le nom réel du volume
docker volume ls | grep app-data     # attendu : skatelab_app-data

# 3. Vider le volume puis y déverser l'archive
docker run --rm \
  -v skatelab_app-data:/data \
  -v /tmp:/backup \
  alpine sh -c 'rm -rf /data/* /data/..?* 2>/dev/null; \
                tar xzf /backup/skatelab-data.tar.gz -C /data && ls -la /data'

# 4. Redémarrer
$COMPOSE up -d
```

Vérifier que la base est bien celle de GCP :

```bash
docker exec skatelab-frontend true   # le conteneur existe
$COMPOSE logs backend | tail -20      # aucun 'no such table', aucune erreur
```

> **Les permissions** : le conteneur backend de SkateLab tourne en root (son
> `Dockerfile.backend` ne déclare pas d'utilisateur non-root, contrairement à
> Ligue). L'archive extraite lui appartient donc, sans réglage d'uid à prévoir.
> Si un jour l'image passe en non-root, il faudra un `chown -R` dans le
> conteneur d'extraction.

---

## 6. Activer le routage

Le bloc SkateLab du Caddyfile socle est écrit mais commenté
(`/opt/stacks/proxy/Caddyfile`, ligne ~30). Le décommenter :

```bash
ssh deploy@192.162.69.191
cd /opt/stacks/proxy
cp Caddyfile Caddyfile.bak          # filet de sécurité
micro Caddyfile                      # retirer les '#' du bloc SkateLab
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose restart caddy
```

Le bloc doit redevenir :

```
{$SKATELAB_DOMAIN} {
	encode gzip
	reverse_proxy skatelab-frontend:80
}
```

⚠️ **Tant que le DNS pointe encore vers GCP**, Caddy ne pourra pas obtenir de
certificat pour ce domaine (le challenge HTTP-01 arriverait sur GCP). C'est
attendu : les tentatives échouent, Caddy réessaie. **Ne pas s'acharner** — le
quota Let's Encrypt est de 5 échecs par domaine et par heure. Enchaîner
rapidement sur §7.

---

## 7. Basculer le DNS

Chez le registrar, modifier l'enregistrement **A** de
`skatelab.toulouseclubpatinage.com` :

| | Avant | Après |
|---|---|---|
| A | `34.8.236.77` (load balancer GCP) | `192.162.69.191` (VPS) |

Abaisser le TTL à 300 s **quelques heures avant** la bascule facilite un retour
arrière rapide.

Attendre la propagation :

```bash
dig +short skatelab.toulouseclubpatinage.com     # doit rendre 192.162.69.191
```

Dès que le DNS résout vers le VPS, Caddy obtient le certificat automatiquement :

```bash
ssh deploy@192.162.69.191 'docker logs edge-caddy 2>&1 | grep -i "certificate obtained" | tail -2'
```

---

## 8. Vérifier

```bash
D=https://skatelab.toulouseclubpatinage.com
curl -sS -o /dev/null -w 'SPA : %{http_code} (TLS %{ssl_verify_result})\n' $D/
curl -sS -o /dev/null -w 'API : %{http_code}\n' $D/api/health

# L'app Ligue ne doit pas avoir bougé
curl -sS -o /dev/null -w 'Ligue : %{http_code}\n' https://competitions-ligue.toulouseclubpatinage.com/
```

Puis **au navigateur**, ce que `curl` ne teste pas :

- [ ] La connexion **Google OAuth** fonctionne (voir l'avertissement §9).
- [ ] Les **données sont là** : compétitions, patineurs, avis de coachs.
- [ ] Un **PDF déjà téléchargé** s'ouvre (valide la reprise de `/data/pdfs/`).
- [ ] Un **logo de club** s'affiche (valide `/data/logos/`).
- [ ] Une **session existante** fonctionne encore (valide la reprise du `SECRET_KEY`).

Et en ligne de commande, la vérification qui attrape l'erreur la plus vicieuse —
une application qui tourne parfaitement sur une base vide :

```bash
ssh deploy@192.162.69.191 'docker exec skatelab-backend-1 python -c \
  "from app.config import DATABASE_URL; print(DATABASE_URL)"'
# attendu : sqlite+aiosqlite:////data/skating.db  (PAS un chemin sous /app/data)
```

---

## 9. ⚠️ Google OAuth — à faire AVANT la bascule

`VITE_GOOGLE_CLIENT_ID` est injecté **au build de l'image frontend**
(`Dockerfile.frontend`), et Google vérifie l'origine de la requête.

Le domaine ne changeant pas (`skatelab.toulouseclubpatinage.com` des deux côtés),
**aucune modification n'est nécessaire** dans la console Google Cloud : l'origine
autorisée reste valable.

En revanche, si tu profitais de cette migration pour **changer de domaine**, il
faudrait alors :

1. ajouter le nouveau domaine aux **origines JavaScript autorisées** de l'ID
   client OAuth (console Google Cloud → API et services → Identifiants) ;
2. **reconstruire l'image frontend** avec le bon `GOOGLE_CLIENT_ID` — un simple
   redémarrage ne suffit pas, la valeur est figée dans le bundle.

---

## 10. Retour arrière

Tant que la VM GCP n'est pas supprimée, le retour est immédiat :

1. **Repointer le DNS** vers `34.8.236.77`.
2. Vérifier que la VM tourne toujours (`docker compose ps` sur la VM).

C'est la raison pour laquelle §3 fait **redémarrer** le backend GCP après la
copie : la production GCP reste opérationnelle et prête à reprendre la main.

⚠️ **Les écritures faites sur le VPS après la bascule seraient perdues** en cas
de retour arrière — la base GCP est figée à l'instant de la copie. Ne pas laisser
traîner : soit on valide et on décommissionne GCP, soit on revient vite.

---

## 11. Décommissionner GCP (après validation)

> ## ✅ **FAIT LE 2026-09-13**
>
> Sauvegarde rapatriée avant suppression :
> `~/backups/skatelab-data-gcp-2026-08-30.tar.gz` (243 Mo, archive du jour de la
> bascule, intégrité `gzip -t` vérifiée, contient `skating.db` 41 Mo + `pdfs/` +
> `logos/`). C'est l'état de GCP au 2026-08-30 16h34 — **pas** les écritures
> faites sur le VPS depuis.
>
> **Supprimé** : `skatelab-https-rule`, `skatelab-http-rule`,
> `skatelab-https-proxy`, `skatelab-http-proxy`, `skatelab-lb`,
> `skatelab-http-redirect`, `skatelab-cert`, `skatelab-backend`, `skatelab-hc`,
> `skatelab-ig`, `skatelab-vm` (+ son disque de 20 Go), `skatelab-ip`
> (`34.8.236.77`), les règles de pare-feu `allow-http` / `allow-https` /
> `allow-health-check`, et le dépôt **Artifact Registry** `skating-analyzer`
> (5,7 Go d'images Docker — la CI qui y poussait était déjà retirée, le VPS
> construit ses images localement).
>
> **Conservé délibérément — le support OAuth du déploiement VPS en dépend** :
> le projet `skating-analyzer` lui-même, son client OAuth
> `231127361333-qr38k9….apps.googleusercontent.com` et son écran de consentement,
> le compte de service `github-deployer-sa`, le pool Workload Identity
> `github-actions-pool`, le réseau `default` et ses règles par défaut.
> Vérifié après suppression : `GET /api/config` sur la prod VPS renvoie toujours
> ce `google_client_id`, et `skatelab.toulouseclubpatinage.com` répond 200 (SPA
> et API), tout comme l'application Ligue.
>
> Le projet ne facture donc plus aucune ressource de calcul, de réseau ni de
> stockage : un client OAuth est gratuit.

**À ne faire qu'après plusieurs jours de fonctionnement nominal sur le VPS**, et
après avoir constitué une sauvegarde de la base migrée.

```bash
P="--project=skating-analyzer"

# Conserver une dernière archive hors ligne AVANT toute suppression
gcloud compute scp skatelab-vm:/tmp/skatelab-data.tar.gz ~/backups/ \
  --zone=europe-west9-a $P

# Puis, dans cet ordre (les règles de transfert référencent les proxys, etc.)
gcloud compute forwarding-rules delete skatelab-https-rule --global $P
gcloud compute forwarding-rules delete skatelab-http-rule --global $P
gcloud compute target-https-proxies delete skatelab-https-proxy $P
gcloud compute target-http-proxies delete skatelab-http-proxy $P
gcloud compute url-maps delete skatelab-lb $P
gcloud compute url-maps delete skatelab-http-redirect --global $P
gcloud compute ssl-certificates delete skatelab-cert --global $P
gcloud compute backend-services delete skatelab-backend --global $P
gcloud compute health-checks delete skatelab-hc $P
gcloud compute instance-groups unmanaged delete skatelab-ig --zone=europe-west9-a $P
gcloud compute instances delete skatelab-vm --zone=europe-west9-a $P
gcloud compute addresses delete skatelab-ip --global $P
```

> Garder l'IP statique (`skatelab-ip`) **en dernier** : tant qu'elle existe, un
> retour arrière reste théoriquement possible. La supprimer la libère
> définitivement.

⚠️ Ne pas oublier de retirer les **workflows CI** qui poussent encore des images
vers Artifact Registry (`.github/workflows/ci-*.yml`) si le registre est
supprimé, sinon la CI échouera à chaque push.

---

## Récapitulatif de l'ordre

| # | Étape | Interruption de service ? |
|---|---|---|
| 2 | Prérequis | non |
| 3 | Extraction des données (backend GCP arrêté puis relancé) | **oui, quelques minutes** |
| 4 | Installation sur le VPS | non (GCP sert toujours) |
| 5 | Restauration des données | non (GCP sert toujours) |
| 6 | Activation du bloc Caddy | non |
| 7 | Bascule DNS | **coupure le temps de la propagation** |
| 8 | Vérifications | non |
| 11 | Décommissionnement GCP | non |

Les étapes 4 à 6 se font **pendant que GCP sert encore** : seule la fenêtre
d'extraction (§3) et la propagation DNS (§7) sont visibles des utilisateurs.
