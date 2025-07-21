# Deploy Theme Backend

Automates deployment of e-commerce themes to Ubuntu VPS for multiple businesses.

## Features
- Deploys selected theme to a business
- Clones theme repo, generates .env, builds, starts with PM2
- Sets up NGINX for each business domain
- TypeScript, Express, async/await, error handling

## Setup
```bash
cd backend
npm install
```

## Development
```bash
npm run dev
```

## Build & Start
```bash
npm run build
npm start
```

## API
### POST /deploy
Deploy a theme to a business.

**Request Body:**
```
{
  "themeId": "ecom-001",
  "businessId": "1",
  "userId": "1",
  "gtmId": "dsfs",
  "domain": "dsfsd.com"
}
```

**Response:**
```
{
  "deployment": {
    "themeId": "ecom-001",
    "businessId": "1",
    "status": "success",
    "logs": ["..."]
  }
}
```

## API Authentication

All `/api/v1` endpoints require authentication via API key and secret.

### How to Use

- Set the following environment variables in your deployment environment:
  - `API_KEY`: Your API key
  - `API_SECRET`: Your API secret

- For every request to `/api/v1/*`, include these headers:
  - `x-api-key`: Your API key
  - `x-api-secret`: Your API secret

If either header is missing or invalid, the API will return a 401 or 403 error. 

## Deployment Flow (Bash Script Orchestration)

This project now uses robust bash scripts for all system-level deployment and rollback logic. Node.js orchestrates these scripts and captures logs and errors.

### Requirements
- Bash shell (Linux, macOS, or WSL on Windows)
- Node.js and npm
- pm2 (installed globally)
- nginx (with /etc/nginx/sites-available and /etc/nginx/sites-enabled)
- git

### Scripts
- `scripts/deploy_theme.sh`: Deploys a theme for a business (clone, build, PM2, NGINX, etc.)
- `scripts/rollback_deploy.sh`: Rolls back a deployment (stops PM2, removes files/configs, reloads NGINX)

### How the API Works
- When a deployment is triggered, Node.js calls `deploy_theme.sh` with all required arguments.
- If deployment fails, Node.js calls `rollback_deploy.sh` to clean up.
- All logs from the scripts are captured and returned in the deployment result.

### Running Scripts Manually
You can test the scripts directly from the command line:

```bash
bash scripts/deploy_theme.sh <themeId> <repoUrl> <businessId> <userId> <gtmId> <domain>
bash scripts/rollback_deploy.sh <themeId> <businessId> <domain>
```

### Example
```bash
bash scripts/deploy_theme.sh ecom-001 git@github.com:example/repo.git 123 456 GTM-XXXX example.com
bash scripts/rollback_deploy.sh ecom-001 123 example.com
```

### Notes
- Scripts are idempotent and safe to re-run.
- All system-level actions (clone, build, PM2, NGINX) are handled by bash for maximum reliability and transparency.
- Node.js only orchestrates and logs. 