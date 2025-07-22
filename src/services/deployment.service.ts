import { Business } from '../interfaces/business.interface';
import { Theme } from '../interfaces/theme.interface';
import { Deployment } from '../interfaces/deployment.interface';
import path from 'path';
import { spawn } from 'child_process';

const DEPLOYMENTS_DIR = path.resolve(__dirname, '../../deployments');

async function ensureDeploymentsDir() {
  const fs = await import('fs');
  if (!fs.existsSync(DEPLOYMENTS_DIR)) {
    await fs.promises.mkdir(DEPLOYMENTS_DIR);
  }
}

function getDeploymentFilePath(themeId: string, businessId: string) {
  return path.join(DEPLOYMENTS_DIR, `${themeId}-${businessId}.json`);
}

export async function deployThemeToBusiness(theme: Theme, business: Business): Promise<Deployment> {
  await ensureDeploymentsDir();
  const deploymentFile = getDeploymentFilePath(theme.themeId, business.businessId);
  let logs: string[] = [];
  const fs = await import('fs');

  // Idempotency check
  if (fs.existsSync(deploymentFile)) {
    const existing = JSON.parse(await fs.promises.readFile(deploymentFile, 'utf-8'));
    if (existing.status === 'in_progress' || existing.status === 'success') {
      logs.push('Idempotency: Returning existing deployment result.');
      return existing;
    }
  }

  // Write in_progress status
  const inProgress: Deployment = { 
    themeId: theme.themeId, 
    businessId: business.businessId, 
    status: 'in_progress', 
    logs: ['Deployment started'] 
  };
  await fs.promises.writeFile(deploymentFile, JSON.stringify(inProgress, null, 2));

  try {
    const scriptPath = '/root/deploy-theme-backend/scripts/deploy_theme.sh';
    const args = [
      theme.themeId,
      theme.repoUrl,
      business.businessId,
      business.userId,
      business.gtmId,
      business.domain,
    ];

    // Custom environment with correct PATH
    const env = {
      ...process.env,
      PATH: `/root/.nvm/versions/node/v22.15.0/bin:${process.env.PATH}`
    };

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bash', [scriptPath, ...args], {
        env: env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      proc.stdout.on('data', (data) => {
        const msg = data.toString();
        logs.push(msg);
        const jobId = `${theme.themeId}-${business.businessId}`;
        console.log(`[DEPLOY][${jobId}]`, msg.trim());
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        logs.push(msg);
        const jobId = `${theme.themeId}-${business.businessId}`;
        console.error(`[DEPLOY][${jobId}]`, msg.trim());
      });

      proc.on('error', (err) => {
        const jobId = `${theme.themeId}-${business.businessId}`;
        const errorMsg = `Failed to start deployment: ${err.message}`;
        logs.push(errorMsg);
        console.error(`[DEPLOY][${jobId}]`, errorMsg);
        reject(err);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const jobId = `${theme.themeId}-${business.businessId}`;
          const errorMsg = `Deployment script exited with code ${code}`;
          logs.push(errorMsg);
          console.error(`[DEPLOY][${jobId}]`, errorMsg);
          reject(new Error(errorMsg));
        }
      });
    });

    const result: Deployment = { 
      themeId: theme.themeId, 
      businessId: business.businessId, 
      status: 'success', 
      logs 
    };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  } catch (error: any) {
    logs.push(`Deployment failed: ${error.message}`);
    
    const result: Deployment = { 
      themeId: theme.themeId, 
      businessId: business.businessId, 
      status: 'failed', 
      logs 
    };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  }
}