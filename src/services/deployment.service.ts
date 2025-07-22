import { spawn } from "child_process";
import path from "path";
import { Business } from "../interfaces/business.interface";
import { Deployment } from "../interfaces/deployment.interface";
import { Theme } from "../interfaces/theme.interface";
import logger from "../utils/logger";

const DEPLOYMENTS_DIR = path.resolve(__dirname, "../../deployments");

async function ensureDeploymentsDir() {
  const fs = await import("fs");
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
  const fs = await import("fs");

  // Idempotency check
  if (fs.existsSync(deploymentFile)) {
    const existing = JSON.parse(await fs.promises.readFile(deploymentFile, "utf-8"));
    if (existing.status === "in_progress" || existing.status === "success") {
      logs.push("Idempotency: Returning existing deployment result.");
      return existing;
    }
  }

  // Write in_progress status
  const inProgress: Deployment = {
    themeId: theme.themeId,
    businessId: business.businessId,
    status: "in_progress",
    logs: ["Deployment started"],
  };
  await fs.promises.writeFile(deploymentFile, JSON.stringify(inProgress, null, 2));

  // Only support local for now
  if (business.ssh) {
    logs.push("Remote SSH deployment via bash script not yet implemented.");
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: "failed", logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  }

  try {
    const debug = process.env.NODE_ENV !== "production";
    const env = {
      ...process.env,
      DEBUG: debug ? "true" : "false",
      NODE_ENV: process.env.NODE_ENV || "development",
      PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      SHELL: "/bin/bash",
    };

    logger.info("Starting deployment process", {
      themeId: theme.themeId,
      businessId: business.businessId,
      domain: business.domain,
      debug,
    });

    logs.push("Initializing deployment process...");
    // Use absolute paths for Ubuntu VPS
    console.log(`[DEPLOY][${theme.themeId}-${business.businessId}] Starting deployment...`);
    logs.push("Starting deployment...");
    // Use __dirname to get correct script path relative to current file
    const scriptPath = path.resolve(__dirname, "../../scripts/deploy_theme.sh");

    // Log script path and check if it exists
    const scriptExists = await fs.promises
      .access(scriptPath)
      .then(() => true)
      .catch(() => false);
    logger.info(`Checking deploy script:`, {
      scriptPath,
      exists: scriptExists,
      cwd: process.cwd(),
      dirname: __dirname,
    });

    if (!scriptExists) {
      throw new Error(`Deploy script not found at ${scriptPath}`);
    }

    // Make script executable
    await fs.promises.chmod(scriptPath, "755");

    const args = [theme.themeId, theme.repoUrl, business.businessId, business.userId, business.gtmId, business.domain];

    // Log command that will be executed
    logger.info(`Executing deployment command:`, {
      command: "bash",
      script: scriptPath,
      args,
      env: {
        DEBUG: env.DEBUG,
        NODE_ENV: env.NODE_ENV,
        PATH: env.PATH,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("bash", [scriptPath, ...args], {
        env,
        cwd: path.dirname(scriptPath), // Run from scripts directory
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.stdout.on("data", (data) => {
        const msg = data.toString();
        logs.push(msg);
        const jobId = `${theme.themeId}-${business.businessId}`;

        // Enhanced logging with timestamps and process info
        logger.info(`[DEPLOY][${jobId}] Output`, {
          type: "stdout",
          message: msg.trim(),
          timestamp: new Date().toISOString(),
          pid: proc.pid,
        });

        // Emit to Socket.io room for real-time logs
        try {
          require("../server").io.to(jobId).emit("deploy-log", {
            message: msg,
            type: "stdout",
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          logger.error(`Failed to emit socket message`, { error: err });
        }
      });
      proc.stderr.on("data", (data) => {
        const msg = data.toString();
        logs.push(msg);
        const jobId = `${theme.themeId}-${business.businessId}`;

        // Enhanced error logging
        logger.error(`[DEPLOY][${jobId}] Error output`, {
          type: "stderr",
          message: msg.trim(),
          timestamp: new Date().toISOString(),
          pid: proc.pid,
        });

        // Emit to Socket.io room for real-time logs
        try {
          require("../server").io.to(jobId).emit("deploy-log", {
            message: msg,
            type: "stderr",
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          logger.error(`Failed to emit socket message`, { error: err });
        }
      });
      proc.on("error", (err) => {
        const jobId = `${theme.themeId}-${business.businessId}`;
        const errorMsg = `[DEPLOY][${jobId}] Failed to start deploy_theme.sh: ${err.message}`;
        logs.push(errorMsg);
        try {
          require("../server").io.to(jobId).emit("deploy-log", { message: errorMsg });
        } catch {}
        console.error(errorMsg);
        reject(err);
      });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          const jobId = `${theme.themeId}-${business.businessId}`;
          const errorMsg = `[DEPLOY][${jobId}] deploy_theme.sh exited with code ${code}`;
          logs.push(errorMsg);
          try {
            require("../server").io.to(jobId).emit("deploy-log", { message: errorMsg });
          } catch {}
          console.error(errorMsg);
          reject(new Error(errorMsg));
        }
      });
    });
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: "success", logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  } catch (error: any) {
    logs.push("Deployment failed: " + error.toString());
    // Call rollback script
    try {
      logs.push("Calling rollback_deploy.sh script...");
      const rollbackScript = "/root/deploy-theme-backend/scripts/rollback_deploy.sh";
      const rollbackArgs = [theme.themeId, business.businessId, business.domain];
      await new Promise<void>((resolve, reject) => {
        const proc = spawn("bash", [rollbackScript, ...rollbackArgs]);
        proc.stdout.on("data", (data) => {
          const msg = "[rollback] " + data.toString();
          logs.push(msg);
          const jobId = `${theme.themeId}-${business.businessId}`;
          try {
            require("../server").io.to(jobId).emit("deploy-log", { message: msg });
          } catch {}
          console.log(`[ROLLBACK][${jobId}]`, msg.trim());
        });
        proc.stderr.on("data", (data) => {
          const msg = "[rollback] " + data.toString();
          logs.push(msg);
          const jobId = `${theme.themeId}-${business.businessId}`;
          try {
            require("../server").io.to(jobId).emit("deploy-log", { message: msg });
          } catch {}
          console.log(`[ROLLBACK][${jobId}]`, msg.trim());
        });
        proc.on("error", (err) => {
          const jobId = `${theme.themeId}-${business.businessId}`;
          const errorMsg = `[ROLLBACK][${jobId}] Failed to start rollback_deploy.sh: ${err.message}`;
          logs.push(errorMsg);
          try {
            require("../server").io.to(jobId).emit("deploy-log", { message: errorMsg });
          } catch {}
          console.error(errorMsg);
          reject(err);
        });
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            const jobId = `${theme.themeId}-${business.businessId}`;
            const errorMsg = `[ROLLBACK][${jobId}] rollback_deploy.sh exited with code ${code}`;
            logs.push(errorMsg);
            try {
              require("../server").io.to(jobId).emit("deploy-log", { message: errorMsg });
            } catch {}
            console.error(errorMsg);
            resolve(); // Don't reject, just log
          }
        });
      });
    } catch (rollbackError) {
      logs.push("Rollback script failed: " + String(rollbackError));
    }
    const result: Deployment = { themeId: theme.themeId, businessId: business.businessId, status: "failed", logs };
    await fs.promises.writeFile(deploymentFile, JSON.stringify(result, null, 2));
    return result;
  }
}
