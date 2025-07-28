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

# Constants
PORT=3001
DEPLOY_BASE_PATH="/var/www"
DEPLOY_DIR="$DEPLOY_BASE_PATH/${THEME_ID}-${BUSINESS_ID}"
PM2_NAME="${THEME_ID}-${BUSINESS_ID}"
ENV_FILE="$DEPLOY_DIR/.env"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
NGINX_CONF_PATH="$NGINX_SITES_AVAILABLE/$DOMAIN"
NGINX_SYMLINK_PATH="$NGINX_SITES_ENABLED/$DOMAIN"
TMP_DIR="/tmp/deploy-${THEME_ID}-${BUSINESS_ID}-$(date +%s)"
LOCK_FILE="/tmp/deploy-${THEME_ID}-${BUSINESS_ID}.lock"

# Script start timestamp
START_TIME=$(date +%s)

# Logging functions
log() {
  local level="${1:-INFO}"
  local message="$2"
  local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
  local script_name=$(basename "$0")
  local pid=$$
  
  # Color codes
  local color_reset="\033[0m"
  local color_red="\033[31m"
  local color_green="\033[32m"
  local color_yellow="\033[33m"
  local color_blue="\033[34m"
  local color_magenta="\033[35m"
  local color_cyan="\033[36m"
  
  # Set color based on log level
  case "$level" in
    ERROR) local color="$color_red" ;;
    WARN) local color="$color_yellow" ;;
    SUCCESS) local color="$color_green"; level="INFO" ;;
    DEBUG) local color="$color_blue" ;;
    INFO) local color="$color_cyan" ;;
    *) local color="$color_magenta" ;;
  esac
  
  # Format the log message
  printf "${color}[%s] [%s] [%s] [pid:%d] %s${color_reset}\n" \
    "$timestamp" "$level" "$script_name" "$pid" "$message"
}

log_debug() {
  if [ "${DEBUG:-}" = "true" ]; then
    log "DEBUG" "$1"
  fi
}

log_error() {
  log "ERROR" "$1"
}

log_warn() {
  log "WARN" "$1"
}

log_success() {
  log "SUCCESS" "$1"
}

log_info() {
  log "INFO" "$1"
}

# Function to measure and log execution time
time_command() {
  local command_name="$1"
  shift
  local start_time=$(date +%s%N)
  
  log_info "Starting: $command_name"
  log_debug "Command: $*"
  
  # Execute the command with output handling
  if [ "${DEBUG:-}" = "true" ]; then
    "$@" 2>&1 | while read -r line; do
      log_debug "$command_name: $line"
    done
    local exit_code="${PIPESTATUS[0]}"
  else
    "$@" >/dev/null 2>&1
    local exit_code=$?
  fi
  
  local end_time=$(date +%s%N)
  local duration=$((($end_time - $start_time)/1000000))
  
  if [ $exit_code -eq 0 ]; then
    log_success "Completed: $command_name (${duration}ms)"
  else
    log_error "Failed: $command_name (${duration}ms) with exit code $exit_code"
  fi
  
  return $exit_code
}

error_exit() {
  log_error "$1"
  # Attempt cleanup if we're in the middle of deployment
  if [ -f "${TMP_DIR}/deploy_in_progress" ]; then
    rollback
  fi
  exit 1
}

print_header() {
  log_info "================================================"
  log_info " $1"
  log_info "================================================"
}

print_footer() {
  log_info "------------------------------------------------"
  log_info "$1"
  log_info "------------------------------------------------"
}

# Validate system dependencies
validate_dependencies() {
  print_header "Validating System Dependencies"
  
  local missing_deps=()
  
  # Check required commands
  for cmd in git node npm pm2 nginx npx jq; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing_deps+=("$cmd")
      log_error "$cmd not found in PATH"
    else
      log_debug "$cmd path: $(command -v "$cmd")"
      log_debug "$cmd version: $("$cmd" --version 2>/dev/null || echo "N/A")"
    fi
  done
  
  if [ ${#missing_deps[@]} -gt 0 ]; then
    error_exit "Missing dependencies: ${missing_deps[*]}"
  fi
  
  print_footer "Dependency validation completed"
}

# Check repository access
check_repo_access() {
  print_header "Verifying Repository Access"
  
  log_info "Testing access to repository: $REPO_URL"
  
  # Create temporary directory
  mkdir -p "$TMP_DIR"
  touch "${TMP_DIR}/deploy_in_progress"
  
  # Test git clone in temporary directory
  if ! time_command git ls-remote --quiet "$REPO_URL" >/dev/null; then
    error_exit "Failed to access repository. Check permissions and URL."
  fi
  
  log_success "Repository access verified"
  print_footer "Repository check completed"
}

# Rollback function
rollback() {
  print_header "Initiating Rollback"
  
  # 1. Stop PM2 process if exists
  if pm2 list | grep -q "$PM2_NAME"; then
    log_warn "Stopping PM2 process: $PM2_NAME"
    time_command pm2 stop "$PM2_NAME" || log_warn "Failed to stop PM2 process"
    time_command pm2 delete "$PM2_NAME" || log_warn "Failed to delete PM2 process"
  fi
  
  # 2. Remove deploy directory if exists
  if [ -d "$DEPLOY_DIR" ]; then
    log_warn "Removing deploy directory: $DEPLOY_DIR"
    time_command rm -rf "$DEPLOY_DIR" || log_warn "Failed to remove deploy directory"
  fi
  
  # 3. Remove NGINX symlink if exists
  if [ -L "$NGINX_SYMLINK_PATH" ]; then
    log_warn "Removing NGINX symlink: $NGINX_SYMLINK_PATH"
    time_command rm -f "$NGINX_SYMLINK_PATH" || log_warn "Failed to remove NGINX symlink"
  fi
  
  # 4. Remove NGINX config if exists
  if [ -f "$NGINX_CONF_PATH" ]; then
    log_warn "Removing NGINX config: $NGINX_CONF_PATH"
    time_command rm -f "$NGINX_CONF_PATH" || log_warn "Failed to remove NGINX config"
  fi
  
  # 5. Reload NGINX
  log_warn "Reloading NGINX"
  if time_command nginx -t; then
    time_command systemctl reload nginx || log_warn "NGINX reload failed"
  else
    log_warn "Skipping NGINX reload due to configuration errors"
  fi
  
  # 6. Cleanup temporary files
  if [ -d "$TMP_DIR" ]; then
    log_warn "Cleaning up temporary files"
    time_command rm -rf "$TMP_DIR" || log_warn "Failed to clean up temporary files"
  fi
  
  print_footer "Rollback completed"
}

# Main deployment function
deploy() {
  print_header "Starting Deployment"
  log_info "Theme ID: $THEME_ID"
  log_info "Business ID: $BUSINESS_ID"
  log_info "Domain: $DOMAIN"
  log_info "Port: $PORT"
  log_info "Deploy Directory: $DEPLOY_DIR"
  
  # Check for existing deployment lock
  if [ -f "$LOCK_FILE" ]; then
    error_exit "Another deployment is already in progress (lock file exists: $LOCK_FILE)"
  fi
  
  # Create lock file
  touch "$LOCK_FILE"
  
  # 1. Clone repository
  print_header "Cloning Repository"
  if [ -d "$DEPLOY_DIR" ]; then
    log_warn "Removing existing deploy directory"
    time_command rm -rf "$DEPLOY_DIR" || error_exit "Failed to remove $DEPLOY_DIR"
  fi
  
  log_info "Cloning from $REPO_URL to $DEPLOY_DIR"
  time_command git clone --progress "$REPO_URL" "$DEPLOY_DIR" || error_exit "Git clone failed"
  
  if [ ! -d "$DEPLOY_DIR/.git" ]; then
    error_exit "Git clone completed but .git directory not found"
  fi
  
  cd "$DEPLOY_DIR" || error_exit "Failed to change to deploy directory"
  log_debug "Git status: $(git status --short)"
  log_debug "Git branch: $(git branch --show-current)"
  print_footer "Repository clone completed"
  
  # 2. Create environment file
  print_header "Creating Environment Configuration"
  log_info "Creating .env file at $ENV_FILE"
  
  cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_BUSINESS_ID=$BUSINESS_ID
NEXT_PUBLIC_USER_ID=$USER_ID
NEXT_PUBLIC_GTM_ID=$GTM_ID
NEXT_PUBLIC_DOMAIN=$DOMAIN
PORT=$PORT
EOF
  
  log_debug "Environment file contents:"
  log_debug "$(cat "$ENV_FILE")"
  print_footer "Environment configuration completed"
  
  # 3. Install dependencies
  print_header "Installing Dependencies"
  
  if [ ! -f "package.json" ]; then
    error_exit "package.json not found in $DEPLOY_DIR"
  fi
  
  log_debug "Package.json dependencies:"
  log_debug "$(jq '.dependencies' package.json)"
  log_debug "Package.json scripts:"
  log_debug "$(jq '.scripts' package.json)"
  
  if [ "${DEBUG:-}" = "true" ]; then
    log_debug "Clearing npm cache"
    time_command npm cache clean --force
  fi
  
  log_info "Installing npm dependencies"
  time_command npm install --verbose || error_exit "npm install failed"
  
  if [ ! -d "node_modules" ]; then
    error_exit "node_modules directory not found after npm install"
  fi
  print_footer "Dependency installation completed"
  
  # 4. Build project
  print_header "Building Project"
  log_info "Running Next.js build"
  
  time_command npx next build || error_exit "Next.js build failed"
  
  if [ ! -d ".next" ]; then
    error_exit ".next directory not found after build"
  fi
  print_footer "Build completed"
  
  # 5. Start with PM2
  print_header "Starting Application with PM2"
  
  # Check if the app is already running
  if pm2 list | grep -q "$PM2_NAME"; then
    log_warn "Stopping existing PM2 process"
    time_command pm2 stop "$PM2_NAME" || log_warn "Failed to stop existing process"
    time_command pm2 delete "$PM2_NAME" || log_warn "Failed to delete existing process"
  fi
  
  log_info "Starting new PM2 process"
  time_command pm2 start "npm" --name "$PM2_NAME" -- start -- -p $PORT || error_exit "PM2 start failed"
  
  log_info "Saving PM2 process list"
  time_command pm2 save || log_warn "Failed to save PM2 process list"
  
  log_info "Current PM2 status:"
  pm2 show "$PM2_NAME" | while read -r line; do
    log_info "$line"
  done
  print_footer "PM2 startup completed"
  
  # 6. Setup NGINX config
  print_header "Configuring NGINX"
  
  # Check for conflicting server names
  log_info "Checking for conflicting server names"
  if grep -qr "server_name $DOMAIN" /etc/nginx/sites-available/; then
    log_warn "Found existing server_name $DOMAIN in NGINX configs"
    log_warn "This may cause conflicts if the domain is already in use"
  fi
  
  log_info "Creating NGINX config at $NGINX_CONF_PATH"
  cat > "$NGINX_CONF_PATH" <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  
  access_log /var/log/nginx/$DOMAIN.access.log;
  error_log /var/log/nginx/$DOMAIN.error.log;
  
  location / {
    proxy_pass http://localhost:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache_bypass \$http_upgrade;
    proxy_read_timeout 300s;
  }
}
EOF
  
  log_info "Creating symlink in sites-enabled"
  ln -sf "$NGINX_CONF_PATH" "$NGINX_SYMLINK_PATH" || error_exit "Failed to create NGINX symlink"
  
  log_info "Testing NGINX configuration"
  time_command nginx -t || error_exit "NGINX configuration test failed"
  
  log_info "Reloading NGINX"
  time_command systemctl reload nginx || error_exit "NGINX reload failed"
  print_footer "NGINX configuration completed"
  
  # Deployment summary
  print_header "Deployment Summary"
  log_success "Deployment completed successfully!"
  
  # Calculate total execution time
  END_TIME=$(date +%s)
  TOTAL_TIME=$((END_TIME - START_TIME))
  
  log_info "Theme ID: $THEME_ID"
  log_info "Business ID: $BUSINESS_ID"
  log_info "Domain: $DOMAIN"
  log_info "Port: $PORT"
  log_info "Total execution time: ${TOTAL_TIME} seconds"
  
  log_info "System Resources:"
  log_info "Memory usage: $(free -h | awk '/Mem:/ {print $3 "/" $2}')"
  log_info "Disk usage: $(df -h $DEPLOY_DIR | awk 'NR==2 {print $5 " of " $2}')"
  
  log_info "PM2 Status:"
  pm2 show "$PM2_NAME" | grep -E 'status|pid|path|uptime|memory' | while read -r line; do
    log_info "$line"
  done
  
  print_footer "Deployment to $DOMAIN completed"
}

# Cleanup function
cleanup() {
  # Remove lock file
  if [ -f "$LOCK_FILE" ]; then
    rm -f "$LOCK_FILE"
  fi
  
  if [ "${DEBUG:-}" != "true" ]; then
    print_header "Cleaning Up Temporary Files"
    find "$DEPLOY_DIR" -type f \( -name "*.log" -o -name "*.tmp" \) -delete
    print_footer "Cleanup completed"
  fi
}

# Main execution
validate_dependencies
check_repo_access
deploy
cleanup

exit 0