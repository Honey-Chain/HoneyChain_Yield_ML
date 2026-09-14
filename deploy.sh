#!/bin/bash
set -e

echo "==> Pulling and synchronizing latest changes from git origin main..."
cd /opt/services/honeychain-yield-ml
git fetch origin main
git checkout -B main origin/main
git reset --hard origin/main

echo "==> Installing Python dependencies..."
./venv/bin/pip install -r requirements.txt

echo "==> Restarting honeychain-yield-ml systemd service..."
systemctl restart honeychain-yield-ml.service

echo "==> HoneyChain Yield ML deployment successful! Service status:"
systemctl status honeychain-yield-ml.service --no-pager
