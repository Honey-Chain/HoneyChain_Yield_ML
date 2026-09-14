#!/bin/bash
set -e

echo "==> Restarting honeychain-yield-ml service..."
systemctl restart honeychain-yield-ml.service

echo "==> Service reloaded successfully!"
systemctl status honeychain-yield-ml.service --no-pager
