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