# GCP Setup — SkateHub

> ⚠️ **DOCUMENT HISTORIQUE — ce déploiement n'est plus la production.**
>
> Depuis le **2026-08-30**, SkateLab tourne sur le VPS mutualisé
> (`192.162.69.191`), aux côtés de l'application Ligue. Voir
> [migration-gcp-vers-vps.md](migration-gcp-vers-vps.md).
>
> Les workflows CI qui poussaient les images vers Artifact Registry
> (`.github/workflows/ci-*.yml`) ont été **supprimés** : le VPS construit les
> images depuis les sources via `/opt/stacks/install-app.sh`.
>
> La VM GCP est **conservée quelques jours** comme filet de retour arrière
> (repointer le DNS vers `34.8.236.77`). Ce document reste la référence tant
> qu'elle existe ; il sera à supprimer avec elle — voir §11 du plan de
> migration pour la procédure de décommissionnement.

**Project:** `skating-analyzer`
**Domain:** `skatelab.toulouseclubpatinage.com`
**Region:** `europe-west9` (Paris)

## 1. Static IP

```bash
gcloud compute addresses create skatelab-ip --project=skating-analyzer --global
gcloud compute addresses describe skatelab-ip --project=skating-analyzer --global --format="get(address)"
```

## 2. DNS

Add an A record at your domain registrar for `toulouseclubpatinage.com`:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `skatelab` | (static IP from step 1) | 300 |

## 3. VM

```bash
gcloud compute instances create skatelab-vm \
  --project=skating-analyzer \
  --zone=europe-west9-a \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=http-server,https-server \
  --scopes=cloud-platform \
  --boot-disk-size=20GB
```

### Install Docker on the VM

SSH in:

```bash
gcloud compute ssh skatelab-vm --zone=europe-west9-a --project=skating-analyzer
```

Then install Docker from official repo:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
sudo bash -c 'echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list'
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in, then configure Artifact Registry access:

```bash
gcloud auth configure-docker europe-west9-docker.pkg.dev --quiet
```

## 4. Firewall Rules

```bash
gcloud compute firewall-rules create allow-http \
  --project=skating-analyzer \
  --allow=tcp:80 --target-tags=http-server

gcloud compute firewall-rules create allow-https \
  --project=skating-analyzer \
  --allow=tcp:443 --target-tags=https-server

gcloud compute firewall-rules create allow-health-check \
  --project=skating-analyzer \
  --allow=tcp:80 \
  --source-ranges=130.211.0.0/22,35.191.0.0/16 \
  --target-tags=http-server
```

## 5. HTTPS Load Balancer

### Instance group

```bash
gcloud compute instance-groups unmanaged create skatelab-ig \
  --project=skating-analyzer --zone=europe-west9-a

gcloud compute instance-groups unmanaged add-instances skatelab-ig \
  --project=skating-analyzer --zone=europe-west9-a --instances=skatelab-vm

gcloud compute instance-groups unmanaged set-named-ports skatelab-ig \
  --project=skating-analyzer --zone=europe-west9-a --named-ports=http:80
```

### Health check

```bash
gcloud compute health-checks create http skatelab-hc \
  --project=skating-analyzer --port=80 --request-path=/api/health
```

### Backend service

```bash
gcloud compute backend-services create skatelab-backend \
  --project=skating-analyzer --protocol=HTTP --port-name=http \
  --health-checks=skatelab-hc --global

gcloud compute backend-services add-backend skatelab-backend \
  --project=skating-analyzer --instance-group=skatelab-ig \
  --instance-group-zone=europe-west9-a --global
```

### URL map + SSL + HTTPS proxy

```bash
gcloud compute url-maps create skatelab-lb \
  --project=skating-analyzer --default-service=skatelab-backend

gcloud compute ssl-certificates create skatelab-cert \
  --project=skating-analyzer \
  --domains=skatelab.toulouseclubpatinage.com --global

gcloud compute target-https-proxies create skatelab-https-proxy \
  --project=skating-analyzer --url-map=skatelab-lb \
  --ssl-certificates=skatelab-cert

gcloud compute forwarding-rules create skatelab-https-rule \
  --project=skating-analyzer --global --address=skatelab-ip \
  --target-https-proxy=skatelab-https-proxy --ports=443
```

### HTTP → HTTPS redirect

Create a file `redirect.yaml`:

```yaml
name: skatelab-http-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
```

Then:

```bash
gcloud compute url-maps import skatelab-http-redirect \
  --project=skating-analyzer --global --source=redirect.yaml --quiet

gcloud compute target-http-proxies create skatelab-http-proxy \
  --project=skating-analyzer --url-map=skatelab-http-redirect

gcloud compute forwarding-rules create skatelab-http-rule \
  --project=skating-analyzer --global --address=skatelab-ip \
  --target-http-proxy=skatelab-http-proxy --ports=80
```

## 6. Deploy

On the VM, in `/opt/skatelab`:

### .env

```bash
SECRET_KEY=<openssl rand -hex 32>
SECURE_COOKIES=true
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD=<initial-admin-password>
CLUB_NAME=Toulouse Club Patinage
CLUB_SHORT=TOUCP
ALLOWED_ORIGINS=https://skatelab.toulouseclubpatinage.com
DATABASE_URL=sqlite+aiosqlite:////data/skating.db
PUBLIC_BASE_URL=https://skatelab.toulouseclubpatinage.com
```

### docker-compose.yml

```yaml
services:
  backend:
    image: europe-west9-docker.pkg.dev/skating-analyzer/skating-analyzer/backend:TAG
    restart: unless-stopped
    env_file: .env
    volumes:
      - app-data:/data
    ports:
      - "8000:8000"

  frontend:
    image: europe-west9-docker.pkg.dev/skating-analyzer/skating-analyzer/frontend:TAG
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  app-data:
```

Replace `TAG` with the image tag from CI (e.g. `main-c7496fe`).

```bash
docker compose pull && docker compose up -d
```

## 7. GitHub Actions Secrets

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | `skating-analyzer` |
| `WIF_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions-pool/providers/github-figure-skating` |
| `WIF_SERVICE_ACCOUNT` | `figure-skating-ci@skating-analyzer.iam.gserviceaccount.com` |
| `GAR_LOCATION` | `europe-west9` |
| `GAR_REPO` | `figure-skating` |

## 8. Workload Identity Federation

Provider (in existing `github-actions-pool`):

```bash
gcloud iam workload-identity-pools providers create-oidc github-figure-skating \
  --project=skating-analyzer --location=global \
  --workload-identity-pool=github-actions-pool \
  --display-name="GitHub - Figure Skating Analyzer" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository == 'AbelThorne/figure-skating-analyzer'"
```

Service account:

```bash
gcloud iam service-accounts create figure-skating-ci \
  --project=skating-analyzer --display-name="Figure Skating CI"

gcloud projects add-iam-policy-binding skating-analyzer \
  --member="serviceAccount:figure-skating-ci@skating-analyzer.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud iam service-accounts add-iam-policy-binding \
  figure-skating-ci@skating-analyzer.iam.gserviceaccount.com \
  --project=skating-analyzer \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/AbelThorne/figure-skating-analyzer"
```

Replace `PROJECT_NUMBER` with the output of:

```bash
gcloud projects describe skating-analyzer --format="value(projectNumber)"
```
