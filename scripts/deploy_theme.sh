#!/bin/bash
# Absolute paths for required binaries
NODE_BIN="/root/.nvm/versions/node/v22.15.0/bin/node"
NPM_BIN="/root/.nvm/versions/node/v22.15.0/bin/npm"
GIT_BIN="/usr/bin/git"
NGINX_BIN="/usr/sbin/nginx"

# Verify binaries
[ -f "$NODE_BIN" ] || { echo "Node missing at $NODE_BIN"; exit 1; }
[ -f "$NPM_BIN" ] || { echo "npm missing at $NPM_BIN"; exit 1; }
[ -f "$GIT_BIN" ] || { echo "git missing at $GIT_BIN"; exit 1; }
[ -f "$NGINX_BIN" ] || { echo "nginx missing at $NGINX_BIN"; exit 1; }

# Arguments
THEME_ID="$1"
REPO_URL="$2"
BUSINESS_ID="$3"
USER_ID="$4"
GTM_ID="$5"
DOMAIN="$6"

# Config
DEPLOY_DIR="/var/www/${THEME_ID}-${BUSINESS_ID}"
ENV_FILE="$DEPLOY_DIR/.env.local"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

log() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

# Clean existing deployment
if [ -d "$DEPLOY_DIR" ]; then
  log "Removing existing deployment..."
  rm -rf "$DEPLOY_DIR" || exit 1
fi

# Clone repo
log "Cloning repository..."
"$GIT_BIN" clone "$REPO_URL" "$DEPLOY_DIR" || exit 1

# Create .env
log "Creating environment file..."
cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BUSINESS_ID=$BUSINESS_ID
NEXT_PUBLIC_USER_ID=$USER_ID
NEXT_PUBLIC_GTM_ID=$GTM_ID
NEXT_PUBLIC_DOMAIN=$DOMAIN
EOF

# Install dependencies
log "Installing dependencies..."
cd "$DEPLOY_DIR"
"$NPM_BIN" install || exit 1

# Build project
log "Building project..."
"$NPM_BIN" run build || exit 1

# Configure NGINX
log "Configuring NGINX..."
cat > "$NGINX_CONF" <<EOF
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

# Enable site
ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
"$NGINX_BIN" -t && "$NGINX_BIN" -s reload || exit 1

log "Deployment setup complete. Application ready to start."
exit 0