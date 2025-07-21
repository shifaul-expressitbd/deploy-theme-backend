#!/bin/bash
set -euo pipefail

THEME_ID="$1"
BUSINESS_ID="$2"
DOMAIN="$3"

DEPLOY_BASE_PATH="/var/www"
DEPLOY_DIR="$DEPLOY_BASE_PATH/${THEME_ID}-${BUSINESS_ID}"
PM2_NAME="${THEME_ID}-${BUSINESS_ID}"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
NGINX_CONF_PATH="$NGINX_SITES_AVAILABLE/$DOMAIN"
NGINX_SYMLINK_PATH="$NGINX_SITES_ENABLED/$DOMAIN"

log() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

error_exit() {
  log "ERROR: $1"
  exit 1
}

# Check pm2 availability
if ! command -v pm2 >/dev/null 2>&1; then
  error_exit "pm2 is not installed or not in PATH."
fi
log "pm2 path: $(command -v pm2)"
pm2 --version || error_exit "pm2 is not working."

log "Starting rollback for $THEME_ID to $DOMAIN"

# 1. Stop and delete PM2 process
if pm2 list | grep -q "$PM2_NAME"; then
  log "Stopping PM2 process $PM2_NAME"
  pm2 stop "$PM2_NAME" || true
  pm2 delete "$PM2_NAME" || true
else
  log "PM2 process $PM2_NAME not found, skipping"
fi

# 2. Remove deploy dir
if [ -d "$DEPLOY_DIR" ]; then
  log "Removing deploy dir $DEPLOY_DIR"
  rm -rf "$DEPLOY_DIR" || error_exit "Failed to remove $DEPLOY_DIR"
else
  log "Deploy dir $DEPLOY_DIR not found, skipping"
fi

# 3. Remove NGINX config and symlink
if [ -L "$NGINX_SYMLINK_PATH" ]; then
  log "Removing NGINX symlink $NGINX_SYMLINK_PATH"
  rm -f "$NGINX_SYMLINK_PATH" || error_exit "Failed to remove symlink"
else
  log "NGINX symlink $NGINX_SYMLINK_PATH not found, skipping"
fi
if [ -f "$NGINX_CONF_PATH" ]; then
  log "Removing NGINX config $NGINX_CONF_PATH"
  rm -f "$NGINX_CONF_PATH" || error_exit "Failed to remove config"
else
  log "NGINX config $NGINX_CONF_PATH not found, skipping"
fi

log "Reloading NGINX"
nginx -s reload || error_exit "NGINX reload failed"

log "Rollback completed for $THEME_ID to $DOMAIN" 