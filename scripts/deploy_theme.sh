#!/bin/bash
set -euo pipefail

# Enable debug mode if DEBUG env var is set
if [ "${DEBUG:-}" = "true" ]; then
    set -x
fi

# Arguments validation
if [ "$#" -ne 6 ]; then
    echo "Error: Invalid number of arguments"
    echo "Usage: $0 THEME_ID REPO_URL BUSINESS_ID USER_ID GTM_ID DOMAIN"
    exit 1
fi

# Arguments
THEME_ID="$1"
REPO_URL="$2"
BUSINESS_ID="$3"
USER_ID="$4"
GTM_ID="$5"
DOMAIN="$6"

# Script start timestamp
START_TIME=$(date +%s)

DEPLOY_BASE_PATH="/var/www"
DEPLOY_DIR="$DEPLOY_BASE_PATH/${THEME_ID}-${BUSINESS_ID}"
PM2_NAME="${THEME_ID}-${BUSINESS_ID}"
ENV_FILE="$DEPLOY_DIR/.env.local"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
NGINX_CONF_PATH="$NGINX_SITES_AVAILABLE/$DOMAIN"
NGINX_SYMLINK_PATH="$NGINX_SITES_ENABLED/$DOMAIN"

log() {
  local level="INFO"
  if [ "$#" -eq 2 ]; then
    level="$1"
    shift
  fi
  local timestamp=$(date +'%Y-%m-%dT%H:%M:%S%z')
  local message="$1"
  echo "[$timestamp] [$level] [$$] $message"
}

log_debug() {
  if [ "${DEBUG:-}" = "true" ]; then
    log "DEBUG" "$1"
  fi
}

log_error() {
  log "ERROR" "$1"
}

log_info() {
  log "INFO" "$1"
}

# Function to measure and log execution time
time_command() {
  local start_time=$(date +%s%N)
  "$@"
  local exit_code=$?
  local end_time=$(date +%s%N)
  local duration=$((($end_time - $start_time)/1000000))
  log_debug "Command '$1' completed in ${duration}ms with exit code $exit_code"
  return $exit_code
}

error_exit() {
  log "ERROR: $1"
  exit 1
}

# Check pm2 availability
log "Checking pm2 availability..."
if ! command -v pm2 >/dev/null 2>&1; then
  error_exit "pm2 is not installed or not in PATH."
fi
log "pm2 path: $(command -v pm2)"
pm2 --version || error_exit "pm2 is not working."

log "Starting deployment for $THEME_ID to $DOMAIN"

# 1. Clone repo (idempotent)
log_info "Starting repository clone phase"
log_debug "Parameters:"
log_debug "  DEPLOY_DIR: $DEPLOY_DIR"
log_debug "  REPO_URL: $REPO_URL"

if [ -d "$DEPLOY_DIR" ]; then
  log_info "Removing existing deploy directory"
  time_command rm -rf "$DEPLOY_DIR" || error_exit "Failed to remove $DEPLOY_DIR"
fi

log_info "Cloning repository"
log_debug "Git version: $(git --version)"
log_debug "Git config: $(git config --list)"

time_command git clone --progress "$REPO_URL" "$DEPLOY_DIR" 2>&1 | while read -r line; do
  log_debug "git: $line"
done || error_exit "Git clone failed"

if [ ! -d "$DEPLOY_DIR/.git" ]; then
  error_exit "Git clone completed but .git directory not found"
fi

log_info "Repository clone completed successfully"
cd "$DEPLOY_DIR" || error_exit "Failed to change to deploy directory"
log_debug "Current git status: $(git status --short)"
log_debug "Current git branch: $(git branch --show-current)"

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
log_info "Starting dependency installation phase"
log_debug "Node version: $(node --version)"
log_debug "NPM version: $(npm --version)"

# Check package.json exists
if [ ! -f "package.json" ]; then
  error_exit "package.json not found in $DEPLOY_DIR"
fi
log_debug "Package.json contents:"
log_debug "$(cat package.json)"

# Clear npm cache if DEBUG is true
if [ "${DEBUG:-}" = "true" ]; then
  log_debug "Clearing npm cache"
  time_command npm cache clean --force
fi

# Install dependencies with detailed logging
log_info "Installing npm dependencies"
time_command npm install --verbose 2>&1 | while read -r line; do
  log_debug "npm: $line"
done || error_exit "npm install failed"

log_info "Verifying node_modules"
if [ ! -d "node_modules" ]; then
  error_exit "node_modules directory not found after npm install"
fi

# 4. Build project
log_info "Starting build phase"
log_debug "Checking available scripts:"
log_debug "$(npm run | grep -A 999 'Scripts available')"

log_info "Running build command"
time_command npm run build 2>&1 | while read -r line; do
  log_debug "build: $line"
done || error_exit "npm run build failed"

# Verify build output
if [ ! -d "dist" ] && [ ! -d ".next" ]; then
  error_exit "Build output directory not found"
fi

log_info "Build completed successfully"

# 5. Start with PM2
log "Starting app with PM2 as $PM2_NAME"
pm2 start npm --name "$PM2_NAME" -- start || error_exit "PM2 start failed"
# /root/.nvm/versions/node/v22.15.0/bin/pm2 start npm --name "$PM2_NAME" -- start || error_exit "PM2 start failed"
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

# Calculate total execution time
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

# Deployment summary
log_info "=== Deployment Summary ==="
log_info "Theme ID: $THEME_ID"
log_info "Business ID: $BUSINESS_ID"
log_info "Domain: $DOMAIN"
log_info "Total execution time: ${TOTAL_TIME} seconds"
log_info "PM2 process status:"
pm2 show "$PM2_NAME" || log_error "Failed to get PM2 status"
log_info "NGINX config check:"
nginx -t || log_error "NGINX config check failed"
log_info "Current system resources:"
log_debug "Memory usage: $(free -h)"
log_debug "Disk usage: $(df -h $DEPLOY_DIR)"
log_info "=== End Summary ==="

log_info "Deployment completed successfully for $THEME_ID to $DOMAIN"

# Clean up temp files if DEBUG is not enabled
if [ "${DEBUG:-}" != "true" ]; then
    find "$DEPLOY_DIR" -type f -name "*.log" -delete
    find "$DEPLOY_DIR" -type f -name "*.tmp" -delete
fi 