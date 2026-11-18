#!/usr/bin/env bash
# Deploy the ORVYN API (+Redis, Caddy) to a free-tier Compute Engine VM. Run from the repo root in Git Bash:
#   bash infra/gcp/deploy.sh            # first run creates everything; later runs just rebuild + redeploy
# Needs: gcloud logged in, billing enabled on the project, and ./.env.prod filled in.
set -euo pipefail
PROJECT=${PROJECT:-codescrybe-ai}
ZONE=${ZONE:-us-central1-a}          # free-tier e2-micro regions: us-west1, us-central1, us-east1
REGION=${ZONE%-*}
VM=orvyn-api
REPO=orvyn
TAG=${TAG:-$(date +%Y%m%d-%H%M%S)}
IMAGE=$REGION-docker.pkg.dev/$PROJECT/$REPO/api:$TAG

[ -f .env.prod ] || { echo ".env.prod missing"; exit 1; }
API_URL=$(grep -E '^API_URL=' .env.prod | cut -d= -f2-)
API_HOST=${API_URL#https://}; API_HOST=${API_HOST%%/*}
case "$API_URL" in https://*) ;; *) echo "API_URL in .env.prod must be https://api.<domain>"; exit 1;; esac
g() { gcloud --project "$PROJECT" "$@"; }

echo "== APIs"; g services enable compute.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
g artifacts repositories describe $REPO --location "$REGION" >/dev/null 2>&1 || \
  g artifacts repositories create $REPO --repository-format=docker --location "$REGION"

echo "== Build $IMAGE"
g builds submit . --config infra/gcp/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE"

if ! g compute instances describe $VM --zone "$ZONE" >/dev/null 2>&1; then
  echo "== Create VM"
  g compute addresses describe orvyn-ip --region "$REGION" >/dev/null 2>&1 || g compute addresses create orvyn-ip --region "$REGION"
  IP=$(g compute addresses describe orvyn-ip --region "$REGION" --format='value(address)')
  g compute instances create $VM --zone "$ZONE" --machine-type e2-micro --address "$IP" \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard \
    --tags http-server,https-server --scopes cloud-platform
  g compute firewall-rules describe orvyn-web >/dev/null 2>&1 || \
    g compute firewall-rules create orvyn-web --allow tcp:80,tcp:443 --target-tags https-server
  echo "== Waiting for SSH"; sleep 40
  g compute ssh $VM --zone "$ZONE" --command '
    set -e
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    sudo mkdir -p /opt/orvyn && sudo chown $USER /opt/orvyn'
fi
IP=$(g compute addresses describe orvyn-ip --region "$REGION" --format='value(address)')

echo "== Ship config"
g compute scp --zone "$ZONE" infra/gcp/docker-compose.yml infra/gcp/Caddyfile .env.prod $VM:/opt/orvyn/
g compute ssh $VM --zone "$ZONE" --command "
  set -e; cd /opt/orvyn; chmod 600 .env.prod
  printf 'IMAGE=$IMAGE\nAPI_HOST=$API_HOST\n' > .env.deploy
  cat .env.prod .env.deploy > .env.compose
  TOKEN=\$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | sed 's/.*\"access_token\":\"\([^\"]*\)\".*//')
  echo \$TOKEN | sudo docker login -u oauth2accesstoken --password-stdin https://$REGION-docker.pkg.dev
  sudo docker compose --env-file .env.compose pull api
  sudo docker compose --env-file .env.compose run --rm migrate
  sudo docker compose --env-file .env.compose up -d
  sleep 15; sudo docker compose --env-file .env.compose ps"

cat <<MSG

== Done. Point DNS:  A  $API_HOST  ->  $IP   (Cloudflare: set to DNS only / grey cloud so Caddy can get the certificate)
Then check:  curl https://$API_HOST/health   (expect status ok, db ok, redis ok)
MSG
