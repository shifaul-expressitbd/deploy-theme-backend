#!/bin/bash
# Absolute paths for all required binaries
NODE_BIN="/root/.nvm/versions/node/v22.15.0/bin/node"
NPM_BIN="/root/.nvm/versions/node/v22.15.0/bin/npm"
PM2_BIN="/root/.nvm/versions/node/v22.15.0/bin/pm2"
GIT_BIN="/usr/bin/git"
NGINX_BIN="/usr/sbin/nginx"

# Verify all binaries exist
[ -f "$NODE_BIN" ] || { echo "Node binary missing at $NODE_BIN"; exit 1; }
[ -f "$NPM_BIN" ] || { echo "npm binary missing at $NPM_BIN"; exit 1; }
[ -f "$PM2_BIN" ] || { echo "pm2 binary missing at $PM2_BIN"; exit 1; }
[ -f "$GIT_BIN" ] || { echo "git binary missing at $GIT_BIN"; exit 1; }
[ -f "$NGINX_BIN" ] || { echo "nginx binary missing at $NGINX_BIN"; exit 1; }

# Arguments
THEME_ID="$1"
REPO_URL="$2"
BUSINESS_ID="$3"
USER_ID="$4"
GTM_ID="$5"
DOMAIN="$6"

# Configuration
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

log "=== Starting Deployment ==="
log "Theme: $THEME_ID"
log "Business: $BUSINESS_ID"
log "Domain: $DOMAIN"
log "Using Node: $($NODE_BIN --version)"
log "Using npm: $($NPM_BIN --version)"
log "Using pm2: $($PM2_BIN --version)"

# 1. Prepare deployment directory
if [ -d "$DEPLOY_DIR" ]; then
  log "Removing existing deployment directory..."
  rm -rf "$DEPLOY_DIR" || error_exit "Failed to remove $DEPLOY_DIR"
fi

# 2. Clone repository
log "Cloning repository from $REPO_URL..."
"$GIT_BIN" clone "$REPO_URL" "$DEPLOY_DIR" || error_exit "Git clone failed"

# 3. Create environment file
log "Creating environment configuration..."
cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BUSINESS_ID=$BUSINESS_ID
NEXT_PUBLIC_USER_ID=$USER_ID
NEXT_PUBLIC_GTM_ID=$GTM_ID
NEXT_PUBLIC_DOMAIN=$DOMAIN
EOF

# 4. Install dependencies
log "Installing dependencies..."
cd "$DEPLOY_DIR"
"$NPM_BIN" install || error_exit "npm install failed"

# 5. Build project
log "Building project..."
"$NPM_BIN" run build || error_exit "Build failed"

# 6. Start application with PM2
log "Starting application with PM2..."
"$PM2_BIN" start "$NPM_BIN" --name "$PM2_NAME" -- start || error_exit "PM2 start failed"
"$PM2_BIN" save || error_exit "PM2 save failed"

# 7. Configure NGINX
log "Configuring NGINX..."
cat > "$NGINX_CONF_PATH" <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

ln -sf "$NGINX_CONF_PATH" "$NGINX_SYMLINK_PATH"
"$NGINX_BIN" -t && "$NGINX_BIN" -s reload || error_exit "NGINX reload failed"

log "=== Deployment Completed Successfully ==="
log "Application is now running and accessible at http://$DOMAIN"