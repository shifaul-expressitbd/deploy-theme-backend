import { spawn } from "child_process";
import path from "path";
import { Business } from "../interfaces/business.interface";
import { Deployment } from "../interfaces/deployment.interface";
import { Theme } from "../interfaces/theme.interface";
import logger from "../utils/logger";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../../deployments");
const DEPLOYMENT_PORT = 3001;
const DEPLOY_BASE_PATH = "/var/www";
const NGINX_SITES_AVAILABLE = "/etc/nginx/sites-available";
const NGINX_SITES_ENABLED = "/etc/nginx/sites-enabled";

async function ensureDeploymentsDir() {
  const fs = await import("fs/promises");
  try {
    await fs.mkdir(DEPLOYMENTS_DIR, { recursive: true });
    logger.debug(`Created deployments directory at ${DEPLOYMENTS_DIR}`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code !== 'EEXIST') {
      logger.error(`Failed to create deployments directory: ${err.message}`);
      throw err;
    }
    logger.debug(`Deployments directory already exists at ${DEPLOYMENTS_DIR}`);
  }
}

function getDeploymentFilePath(themeId: string, businessId: string) {
  return path.join(DEPLOYMENTS_DIR, `${themeId}-${businessId}.json`);
}

export async function deployThemeToBusiness(theme: Theme, business: Business): Promise<Deployment> {
  const deploymentId = `${theme.themeId}-${business.businessId}`;
  const startTime = Date.now();
  
  logger.info(`Starting deployment ${deploymentId}`, {
    theme: theme.themeId,
    business: business.businessId,
    domain: business.domain,
    port: DEPLOYMENT_PORT,
    repoUrl: theme.repoUrl
  });

  logger.debug(`Initializing deployment environment`, {
    deploymentsDir: DEPLOYMENTS_DIR,
    currentDir: process.cwd(),
    nodeEnv: process.env.NODE_ENV
  });

  await ensureDeploymentsDir();
  const deploymentFile = getDeploymentFilePath(theme.themeId, business.businessId);
  let logs: string[] = [];
  const fs = await import("fs/promises");

  // Idempotency check
  try {
    if (await fileExists(deploymentFile)) {
      const existing = JSON.parse(await fs.readFile(deploymentFile, "utf-8")) as Deployment;
      if (existing.status === "in_progress") {
        const ageMinutes = existing.createdAt ? 
          (Date.now() - new Date(existing.createdAt).getTime()) / (1000 * 60) : 
          Infinity;
        if (ageMinutes < 30) {
          logger.warn(`Returning existing in-progress deployment (${ageMinutes.toFixed(1)} minutes old)`);
          return existing;
        }
      } else if (existing.status === "success") {
        logger.info(`Returning existing successful deployment`);
        return existing;
      }
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn(`Failed to read existing deployment file: ${error.message}`);
  }

  // Write in_progress status
  const inProgress: Deployment = {
    themeId: theme.themeId,
    businessId: business.businessId,
    status: "in_progress",
    logs: ["Deployment started"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    port: DEPLOYMENT_PORT,
    domain: business.domain
  };

  await writeDeploymentFile(deploymentFile, inProgress);

  if (business.ssh) {
    const errorMsg = "Remote SSH deployment not implemented";
    logger.error(errorMsg);
    return await failDeployment(deploymentFile, {
      ...inProgress,
      logs: [errorMsg],
      error: errorMsg
    });
  }

  try {
    const debug = process.env.NODE_ENV !== "production";
    const env = {
      ...process.env,
      DEBUG: debug ? "true" : "false",
      NODE_ENV: process.env.NODE_ENV || "development",
      PATH: process.env.PATH,
      PORT: DEPLOYMENT_PORT.toString()
    };

    logger.debug("Prepared environment variables", { 
      env: {
        DEBUG: env.DEBUG,
        NODE_ENV: env.NODE_ENV,
        PORT: env.PORT
      }
    });

    // Validate system dependencies
    await validateDependencies(logs);

    // Check repository access
    await checkRepoAccess(theme.repoUrl, logs);

    // Execute deployment steps
    await executeDeployment({
      theme,
      business,
      env,
      deploymentId,
      onLog: (msg) => logs.push(msg)
    });

    const successResult: Deployment = {
      ...inProgress,
      status: "success",
      logs,
      completedAt: new Date().toISOString(),
      duration: Date.now() - startTime
    };

    await writeDeploymentFile(deploymentFile, successResult);
    (logger as any).success(`Deployment completed successfully in ${successResult.duration}ms`);
    return successResult;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Deployment failed: ${errorMessage}`, { error });
    logs.push(`Deployment failed: ${errorMessage}`);

    try {
      await attemptRollback(theme, business, logs);
    } catch (rollbackError: unknown) {
      const rollbackErrorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      logger.error(`Rollback failed: ${rollbackErrorMessage}`, { error: rollbackError });
      logs.push(`Rollback failed: ${rollbackErrorMessage}`);
    }

    return await failDeployment(deploymentFile, {
      ...inProgress,
      logs,
      error: errorMessage,
      failedAt: new Date().toISOString(),
      duration: Date.now() - startTime
    });
  }
}

async function validateDependencies(logs: string[]): Promise<void> {
  logs.push("Validating system dependencies...");
  
  const requiredCommands = ['git', 'node', 'npm', 'pm2', 'nginx', 'npx'];
  const missing: string[] = [];

  for (const cmd of requiredCommands) {
    try {
      await executeCommand(`command -v ${cmd}`, {}, "dependency-check");
      logs.push(`✓ ${cmd} found`);
    } catch {
      missing.push(cmd);
      logs.push(`✗ ${cmd} not found`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing dependencies: ${missing.join(', ')}`);
  }
  
  logs.push("All dependencies validated successfully");
}

async function checkRepoAccess(repoUrl: string, logs: string[]): Promise<void> {
  logs.push(`Checking repository access: ${repoUrl}`);
  
  try {
    await executeCommand(`git ls-remote --quiet "${repoUrl}"`, {}, "repo-check");
    logs.push("Repository access verified");
  } catch (error) {
    throw new Error(`Failed to access repository: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeDeployment(options: {
  theme: Theme;
  business: Business;
  env: NodeJS.ProcessEnv;
  deploymentId: string;
  onLog: (msg: string) => void;
}): Promise<void> {
  const { theme, business, env, deploymentId, onLog } = options;
  const deployDir = `${DEPLOY_BASE_PATH}/${theme.themeId}-${business.businessId}`;
  const pm2Name = `${theme.themeId}-${business.businessId}`;
  const envFile = `${deployDir}/.env`;
  const nginxConfPath = `${NGINX_SITES_AVAILABLE}/${business.domain}`;
  const nginxSymlinkPath = `${NGINX_SITES_ENABLED}/${business.domain}`;

  // Step 1: Clone repository
  onLog("Cloning repository...");
  if (await directoryExists(deployDir)) {
    onLog("Removing existing deploy directory");
    await executeCommand(`rm -rf "${deployDir}"`, env, deploymentId);
  }

  await executeCommand(`git clone --progress "${theme.repoUrl}" "${deployDir}"`, env, deploymentId);
  onLog("Repository cloned successfully");

  // Step 2: Create environment file
  onLog("Creating environment configuration...");
  const envContent = [
    `NEXT_PUBLIC_BUSINESS_ID=${business.businessId}`,
    `NEXT_PUBLIC_USER_ID=${business.userId}`,
    `NEXT_PUBLIC_GTM_ID=${business.gtmId}`,
    `NEXT_PUBLIC_DOMAIN=${business.domain}`,
    `PORT=${DEPLOYMENT_PORT}`
  ].join('\n');

  await executeCommand(`cat > "${envFile}" << 'EOF'\n${envContent}\nEOF`, env, deploymentId);
  onLog("Environment file created");

  // Step 3: Install dependencies
  onLog("Installing dependencies...");
  await executeCommand(`cd "${deployDir}" && npm install`, env, deploymentId);
  onLog("Dependencies installed");

  // Step 4: Build project
  onLog("Building project...");
  await executeCommand(`cd "${deployDir}" && npx next build`, env, deploymentId);
  onLog("Project built successfully");

  // Step 5: Stop existing PM2 process if running
  onLog("Managing PM2 process...");
  try {
    await executeCommand(`pm2 stop "${pm2Name}" && pm2 delete "${pm2Name}"`, env, deploymentId);
    onLog("Stopped existing PM2 process");
  } catch {
    onLog("No existing PM2 process found");
  }

  // Step 6: Start with PM2
  await executeCommand(`cd "${deployDir}" && pm2 start "npm" --name "${pm2Name}" -- start -- -p ${DEPLOYMENT_PORT}`, env, deploymentId);
  await executeCommand(`pm2 save`, env, deploymentId);
  onLog("PM2 process started");

  // Step 7: Setup NGINX configuration
  onLog("Configuring NGINX...");
  const nginxConfig = `server {
  listen 80;
  server_name ${business.domain};
  
  access_log /var/log/nginx/${business.domain}.access.log;
  error_log /var/log/nginx/${business.domain}.error.log;
  
  location / {
    proxy_pass http://localhost:${DEPLOYMENT_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \\$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \\$host;
    proxy_set_header X-Real-IP \\$remote_addr;
    proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \\$scheme;
    proxy_cache_bypass \\$http_upgrade;
    proxy_read_timeout 300s;
  }
}`;

  await executeCommand(`cat > "${nginxConfPath}" << 'EOF'\n${nginxConfig}\nEOF`, env, deploymentId);
  await executeCommand(`ln -sf "${nginxConfPath}" "${nginxSymlinkPath}"`, env, deploymentId);
  await executeCommand(`nginx -t`, env, deploymentId);
  await executeCommand(`systemctl reload nginx`, env, deploymentId);
  onLog("NGINX configured and reloaded");

  onLog("Deployment completed successfully");
}

async function executeCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  deploymentId: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.debug(`Executing command: ${command}`);

    const proc = spawn("bash", ["-c", command], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      
      output.split('\n').forEach((line: string) => {
        if (line.trim()) {
          emitDeployLog(deploymentId, line);
          logger.debug(`[${deploymentId}] ${line}`);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;

      output.split('\n').forEach((line: string) => {
        if (line.trim()) {
          emitDeployLog(deploymentId, `[STDERR] ${line}`);
          logger.debug(`[${deploymentId}] [STDERR] ${line}`);
        }
      });
    });

    proc.on('error', (err) => {
      logger.error(`Process spawn error: ${err.message}`);
      reject(err);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const errorMsg = `Command failed with exit code ${code}${stderr ? ': ' + stderr : ''}`;
        logger.error(errorMsg);
        reject(new Error(errorMsg));
      }
    });
  });
}

async function attemptRollback(theme: Theme, business: Business, logs: string[]): Promise<void> {
  const deploymentId = `${theme.themeId}-${business.businessId}`;
  const deployDir = `${DEPLOY_BASE_PATH}/${theme.themeId}-${business.businessId}`;
  const pm2Name = `${theme.themeId}-${business.businessId}`;
  const nginxConfPath = `${NGINX_SITES_AVAILABLE}/${business.domain}`;
  const nginxSymlinkPath = `${NGINX_SITES_ENABLED}/${business.domain}`;

  logger.warn(`Attempting rollback for ${deploymentId}`);
  logs.push("[ROLLBACK] Starting rollback process");

  const env = {
    ...process.env,
    DEBUG: process.env.NODE_ENV !== "production" ? "true" : "false",
    PORT: DEPLOYMENT_PORT.toString()
  };

  try {
    // Stop and delete PM2 process
    try {
      await executeCommand(`pm2 stop "${pm2Name}" && pm2 delete "${pm2Name}"`, env, deploymentId);
      logs.push("[ROLLBACK] Stopped PM2 process");
    } catch {
      logs.push("[ROLLBACK] No PM2 process to stop");
    }

    // Remove deploy directory
    if (await directoryExists(deployDir)) {
      await executeCommand(`rm -rf "${deployDir}"`, env, deploymentId);
      logs.push("[ROLLBACK] Removed deploy directory");
    } else {
      logs.push("[ROLLBACK] Deploy directory not found");
    }

    // Remove NGINX configuration
    try {
      await executeCommand(`rm -f "${nginxSymlinkPath}"`, env, deploymentId);
      await executeCommand(`rm -f "${nginxConfPath}"`, env, deploymentId);
      logs.push("[ROLLBACK] Removed NGINX configuration");
    } catch {
      logs.push("[ROLLBACK] NGINX configuration not found");
    }

    // Reload NGINX
    try {
      await executeCommand(`nginx -s reload`, env, deploymentId);
      logs.push("[ROLLBACK] NGINX reloaded");
    } catch (error) {
      logs.push(`[ROLLBACK] NGINX reload failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    logs.push("[ROLLBACK] Rollback completed successfully");
    (logger as any).success(`Rollback completed for ${deploymentId}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logs.push(`[ROLLBACK] Rollback failed: ${errorMessage}`);
    logger.error(`Rollback failed for ${deploymentId}: ${errorMessage}`);
    throw error;
  }
}

// Helper functions
async function fileExists(path: string): Promise<boolean> {
  try {
    await import("fs").then(fs => fs.promises.access(path));
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function writeDeploymentFile(path: string, data: Deployment): Promise<void> {
  const fs = await import("fs/promises");
  await fs.writeFile(path, JSON.stringify(data, null, 2));
  logger.debug(`Updated deployment file at ${path}`);
}

async function failDeployment(
  deploymentFile: string,
  deployment: Deployment
): Promise<Deployment> {
  const failedDeployment: Deployment = {
    ...deployment,
    status: "failed",
    updatedAt: new Date().toISOString()
  };

  await writeDeploymentFile(deploymentFile, failedDeployment);
  return failedDeployment;
}

function emitDeployLog(deploymentId: string, message: string): void {
  try {
    const io = require("../server").io;
    if (io) {
      io.to(deploymentId).emit("deploy-log", { message });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.debug(`Failed to emit deploy log: ${errorMessage}`);
  }
}