#!/usr/bin/env bash
# =========================================================================
# Bootstrap inicial del VPS Hetzner para Aibenchef.
# Ejecutar UNA SOLA VEZ tras conectarte por SSH la primera vez.
# Idempotente: se puede correr de nuevo sin romper nada.
# =========================================================================

set -euo pipefail

echo "==> Verificar que somos root o sudo"
if [ "$EUID" -ne 0 ]; then
    echo "Correr con sudo: sudo bash bootstrap.sh"
    exit 1
fi

echo "==> Actualizar sistema"
apt-get update
apt-get upgrade -y

echo "==> Instalar utilidades base"
apt-get install -y curl git ufw fail2ban ca-certificates gnupg lsb-release htop ncdu

echo "==> Instalar Docker (si no esta)"
if ! command -v docker &> /dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
fi

echo "==> Crear usuario aibenchef sin privilegios (deploy)"
if ! id aibenchef &>/dev/null; then
    useradd -m -s /bin/bash -G docker aibenchef
fi

echo "==> Firewall (mantener puertos 22, 80, 443 y los que ya use CRM Palma Rio)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP3'
# Si CRM Palma Rio usa puertos extra, agregar aqui antes de --force
ufw --force enable

echo "==> Habilitar fail2ban con jail SSH"
systemctl enable fail2ban
systemctl start fail2ban

echo "==> Clonar repo si no existe"
if [ ! -d /home/aibenchef/aibenchef ]; then
    sudo -u aibenchef git clone https://github.com/gussbrav/aibenchef.git /home/aibenchef/aibenchef
fi

echo "==> Bootstrap listo."
echo
echo "Proximos pasos manuales:"
echo "  1. su - aibenchef"
echo "  2. cd ~/aibenchef/infrastructure/hetzner"
echo "  3. cp .env.production.example .env.production"
echo "  4. nano .env.production  (rellenar secrets)"
echo "  5. bash deploy.sh"
echo
echo "Tras el primer deploy, verificar:"
echo "  - https://aibenchef.azoramind.com (landing)"
echo "  - https://api.aibenchef.azoramind.com/v1/health"
