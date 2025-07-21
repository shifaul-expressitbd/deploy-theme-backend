#!/bin/bash
export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH"
set -euo pipefail

# Arguments
THEME_ID="$1"
REPO_URL="$2"
BUSINESS_ID="$3"
USER_ID="$4"
GTM_ID="$5"
DOMAIN="$6"

DEPLOY_BASE_PATH="/var/www"
DEPLOY_DIR="$DEPLOY_BASE_PATH/${THEME_ID}-${BUSINESS_ID}"
PM2_NAME="${THEME_ID}-${BUSINESS_ID}"
ENV_FILE="$DEPLOY_DIR/.env.local"
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
log "Checking pm2 availability..."
PM2_PATH="/root/.nvm/versions/node/v22.15.0/bin/pm2"
if [ ! -x "$PM2_PATH" ]; then
  echo "ERROR: pm2 is not installed at $PM2_PATH"
  exit 1
fi
log "pm2 path: $PM2_PATH"
$PM2_PATH --version || error_exit "pm2 is not working."

log "Starting deployment for $THEME_ID to $DOMAIN"

# 1. Clone repo (idempotent)
log "Checking if $DEPLOY_DIR exists..."
if [ -d "$DEPLOY_DIR" ]; then
  log "Removing existing deploy dir $DEPLOY_DIR"
  rm -rf "$DEPLOY_DIR" || error_exit "Failed to remove $DEPLOY_DIR"
fi
log "About to clone repo: $REPO_URL to $DEPLOY_DIR"
git --version
git clone "$REPO_URL" "$DEPLOY_DIR" || error_exit "Git clone failed"
log "Git clone completed."

# 2. Create .env.local
log "Creating .env.local at $ENV_FILE"
cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BUSINESS_ID=$BUSINESS_ID
NEXT_PUBLIC_USER_ID=$USER_ID
NEXT_PUBLIC_GTM_ID=$GTM_ID
NEXT_PUBLIC_DOMAIN=$DOMAIN
EOF
log "Created .env.local at $ENV_FILE"

# 3. Install dependencies
cd "$DEPLOY_DIR"
log "Running npm install in $DEPLOY_DIR"
npm --version
npm install || error_exit "npm install failed"
log "npm install completed."

# 4. Build project
log "Running npm run build in $DEPLOY_DIR"
npm run build || error_exit "npm run build failed"
log "npm run build completed."

# 5. Start with PM2
log "Starting app with PM2 as $PM2_NAME"
$PM2_PATH start npm --name "$PM2_NAME" -- start || error_exit "PM2 start failed"
log "PM2 start completed."

# 6. Setup NGINX config
log "Creating NGINX config at $NGINX_CONF_PATH"
cat > "$NGINX_CONF_PATH" <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
ln -sf "$NGINX_CONF_PATH" "$NGINX_SYMLINK_PATH"
log "NGINX config created and symlinked"
log "Reloading NGINX"
nginx -s reload || error_exit "NGINX reload failed"

log "Deployment completed successfully for $THEME_ID to $DOMAIN" 