#!/usr/bin/env bash

# postCreateCommand.sh

# This script runs after the Dev Container is created to set up the dev container environment.

set -euo pipefail

echo "Welcome to Matterbridge Dev Container"
DISTRO=$(awk -F= '/^PRETTY_NAME=/{gsub(/"/, "", $2); print $2}' /etc/os-release)
CODENAME=$(awk -F= '/^VERSION_CODENAME=/{print $2}' /etc/os-release)
echo "Distro: $DISTRO ($CODENAME)"
echo "User: $(whoami)"
echo "Hostname: $(hostname)"
echo "Architecture: $(uname -m)"
echo "Kernel Version: $(uname -r)"
echo "Uptime: $(uptime -p || echo 'unavailable')"
echo "Date: $(date)"
echo "Node.js version: $(node -v)"
echo "Npm version: $(npm -v)"
echo ""

echo "1 - Installing updates and scripts packages..."
# npm install --global --no-fund --no-audit npm-check-updates shx cross-env 

echo "2 - Setting permissions..."
# sudo chown -R node:node .
# Set permissions for additional mounts for the node_modules of the library, monorepo, plugin and tool packages to improve performance when working on them.
sudo chown -R node:node .cache node_modules vendor/library/.cache vendor/library/node_modules vendor/monorepo/.cache vendor/monorepo/node_modules vendor/plugin/.cache vendor/plugin/node_modules vendor/tool/.cache vendor/tool/node_modules

echo "3 - Installing package dependencies..."
npm install --no-fund --no-audit

echo "4 - Building the package..."
npm run build

echo "5 - Checking for outdated packages..."
npm outdated || true

echo "6 - Setup completed!"
