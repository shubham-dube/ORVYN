#!/bin/sh
# One-time server setup (Ubuntu 24.04 on Hetzner). Run as root:  sh provision.sh <github-repo-url>
# Docker, a non-root deploy user, firewall closed to everything but SSH (Cloudflare Tunnel needs no inbound ports),
# automatic security updates, swap, and the repo checked out at /opt/orvyn.
set -eu
REPO="${1:?usage: sh provision.sh <git url>}"

apt-get update -q
apt-get install -y -q ca-certificates curl git ufw unattended-upgrades fail2ban age
curl -fsSL https://get.docker.com | sh

id deploy > /dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
[ -f /root/.ssh/authorized_keys ] && cp /root/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh

# SSH: keys only, no root login
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/orvyn && chown deploy:deploy /opt/orvyn
[ -d /opt/orvyn/.git ] || su deploy -c "git clone $REPO /opt/orvyn"
install -d -m 700 -o deploy -g deploy /opt/orvyn/infra/secrets
echo "Done. Next (as deploy): create /opt/orvyn/infra/.env from .env.production.example, then infra/deploy.sh."
