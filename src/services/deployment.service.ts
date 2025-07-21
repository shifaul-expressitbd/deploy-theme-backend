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
  const inProgress: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: 'in_progress', logs: ['Deployment started'] };
  await fs.promises.writeFile(deploymentFile, JSON.stringify(inProgress, null, 2));

  // Only support local for now
  if (business.ssh) {
    logs.push('Remote SSH deployment via bash script not yet implemented.');
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: 'failed', logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  }

  try {
    logs.push('Calling deploy_theme.sh script...');
    const scriptPath = path.resolve(__dirname, '../../scripts/deploy_theme.sh');
    const args = [
      theme.themeId,
      theme.repoUrl,
      business.businessId,
      business.userId,
      business.gtmId,
      business.domain,
    ];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bash', [scriptPath, ...args]);
      proc.stdout.on('data', (data) => logs.push(data.toString()));
      proc.stderr.on('data', (data) => logs.push(data.toString()));
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`deploy_theme.sh exited with code ${code}`));
        }
      });
    });
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: 'success', logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  } catch (error: any) {
    logs.push('Deployment failed: ' + error.toString());
    // Call rollback script
    try {
      logs.push('Calling rollback_deploy.sh script...');
      const rollbackScript = path.resolve(__dirname, '../../scripts/rollback_deploy.sh');
      const rollbackArgs = [theme.themeId, business.businessId, business.domain];
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('bash', [rollbackScript, ...rollbackArgs]);
        proc.stdout.on('data', (data) => logs.push('[rollback] ' + data.toString()));
        proc.stderr.on('data', (data) => logs.push('[rollback] ' + data.toString()));
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            logs.push(`[rollback] rollback_deploy.sh exited with code ${code}`);
            resolve(); // Don't reject, just log
          }
        });
      });
    } catch (rollbackError) {
      logs.push('Rollback script failed: ' + String(rollbackError));
    }
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: 'failed', logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  }
} 