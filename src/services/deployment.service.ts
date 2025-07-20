import { Business } from '../interfaces/business.interface';
import { Theme } from '../interfaces/theme.interface';
import { Deployment } from '../interfaces/deployment.interface';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { DEPLOY_BASE_PATH, PM2_PATH, NGINX_SITES_AVAILABLE, NGINX_SITES_ENABLED } from '../config/constants';

function execAsync(cmd: string, cwd?: string): Promise<string> {
  console.log('Executing command:', cmd, 'in', cwd);
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (error) {
        console.log('Command error:', stderr || error.message);
        reject(stderr || error.message);
      } else {
        console.log('Command output:', stdout);
        resolve(stdout);
      }
    });
  });
}

export async function deployThemeToBusiness(theme: Theme, business: Business): Promise<Deployment> {
  const deployDir = path.join(DEPLOY_BASE_PATH, `${theme.themeId}-${business.businessId}`);
  const pm2Name = `${theme.themeId}-${business.businessId}`;
  const envFile = path.join(deployDir, '.env.local');
  let logs: string[] = [];

  try {
    console.log('Starting deployment for', theme.themeId, business.businessId);
    // 1. Clone repo
    await fs.remove(deployDir);
    logs.push(await execAsync(`git clone ${theme.repoUrl} ${deployDir}`));
    console.log('Cloned repo to', deployDir);

    // 2. Generate .env.local
    const envContent = `NEXT_PUBLIC_BUSINESS_ID=${business.businessId}\nNEXT_PUBLIC_USER_ID=${business.userId}\nNEXT_PUBLIC_GTM_ID=${business.gtmId}\nNEXT_PUBLIC_DOMAIN=${business.domain}\n`;
    await fs.writeFile(envFile, envContent);
    logs.push('Generated .env.local');
    console.log('Generated .env.local at', envFile);

    // 3. Install dependencies
    logs.push(await execAsync('npm install', deployDir));
    console.log('Installed dependencies');

    // 4. Build project
    logs.push(await execAsync('npm run build', deployDir));
    console.log('Built project');

    // 5. Start with PM2
    logs.push(await execAsync(`${PM2_PATH} start npm --name ${pm2Name} -- start`, deployDir));
    console.log('Started app with PM2 as', pm2Name);

    // 6. Setup NGINX config
    const nginxConf = `server {\n  listen 80;\n  server_name ${business.domain};\n  location / {\n    proxy_pass http://localhost:3000;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n  }\n}`;
    const nginxConfPath = path.join(NGINX_SITES_AVAILABLE, business.domain);
    await fs.writeFile(nginxConfPath, nginxConf);
    await fs.symlink(nginxConfPath, path.join(NGINX_SITES_ENABLED, business.domain));
    logs.push('NGINX config created');
    logs.push(await execAsync('nginx -s reload'));
    console.log('NGINX config created and reloaded for', business.domain);

    console.log('Deployment success for', theme.themeId, business.businessId);
    return { themeId: theme.themeId, businessId: business.businessId, status: 'success', logs };
  } catch (error: any) {
    console.log('Deployment failed for', theme.themeId, business.businessId, 'Error:', error);
    logs.push(error.toString());
    return { themeId: theme.themeId, businessId: business.businessId, status: 'failed', logs };
  }
} 