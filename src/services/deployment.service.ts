import { exec } from 'child_process';
import { promisify } from 'util';
import { Business } from '../interfaces/business.interface';
import { Theme } from '../interfaces/theme.interface';
import { Deployment } from '../interfaces/deployment.interface';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);
const DEPLOYMENTS_DIR = path.resolve(__dirname, '../../deployments');

async function ensureDeploymentsDir() {
  try {
    await fs.mkdir(DEPLOYMENTS_DIR, { recursive: true });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      if ((err as any).code !== 'EEXIST') throw err;
    } else {
      throw err;
    }
  }
}

export async function deployThemeToBusiness(theme: Theme, business: Business): Promise<Deployment> {
  await ensureDeploymentsDir();
  const deploymentFile = path.join(DEPLOYMENTS_DIR, `${theme.themeId}-${business.businessId}.json`);
  const logs: string[] = [];
  
  // Idempotency check
  try {
    const existing = JSON.parse(await fs.readFile(deploymentFile, 'utf-8'));
    if (existing.status === 'in_progress' || existing.status === 'success') {
      logs.push('Using existing deployment result');
      return existing;
    }
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      if ((err as any).code !== 'ENOENT') throw err;
    } else {
      throw err;
    }
  }

  // Write in-progress status
  const inProgress: Deployment = {
    themeId: theme.themeId,
    businessId: business.businessId,
    status: 'in_progress',
    logs: ['Deployment started']
  };
  await fs.writeFile(deploymentFile, JSON.stringify(inProgress, null, 2));

  try {
    // 1. Run deployment script
    const scriptPath = '/root/deploy-theme-backend/scripts/deploy_theme.sh';
    const { stdout: deployOutput } = await execAsync(
      `bash ${scriptPath} ${theme.themeId} ${theme.repoUrl} ${business.businessId} ${business.userId} ${business.gtmId} ${business.domain}`,
      { 
        env: { 
          ...process.env,
          PATH: `/root/.nvm/versions/node/v22.15.0/bin:${process.env.PATH}`
        } 
      }
    );
    logs.push(deployOutput);

    // 2. Install PM2 if not exists
    try {
      await execAsync('pm2 -v || npm install -g pm2');
    } catch (err: any) {
      logs.push(`PM2 installation check: ${err?.message ?? err}`);
    }

    // 3. Start application with PM2
    const appDir = `/var/www/${theme.themeId}-${business.businessId}`;
    const pm2Name = `${theme.themeId}-${business.businessId}`;
    
    const { stdout: pm2Output } = await execAsync(
      `cd ${appDir} && pm2 start npm --name "${pm2Name}" -- start`,
      { 
        env: { 
          ...process.env,
          PATH: `/root/.nvm/versions/node/v22.15.0/bin:${process.env.PATH}`
        } 
      }
    );
    logs.push(pm2Output);

    // Save PM2 process list
    await execAsync('pm2 save');

    const successResult: Deployment = {
      themeId: theme.themeId,
      businessId: business.businessId,
      status: 'success',
      logs
    };
    await fs.writeFile(deploymentFile, JSON.stringify(successResult, null, 2));
    return successResult;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logs.push(`Deployment failed: ${errorMsg}`);
    
    const failedResult: Deployment = {
      themeId: theme.themeId,
      businessId: business.businessId,
      status: 'failed',
      logs
    };
    await fs.writeFile(deploymentFile, JSON.stringify(failedResult, null, 2));
    return failedResult;
  }
}