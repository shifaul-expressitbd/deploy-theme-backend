import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Business } from '../interfaces/business.interface';
import { Theme } from '../interfaces/theme.interface';
import { io } from '../server';
import { deployThemeToBusiness } from './deployment.service';

const connection = new IORedis({ maxRetriesPerRequest: null });

export const deploymentQueue = new Queue('deployment', { connection });

// Store deployment logs in memory (in production, use Redis or database)
const deploymentLogs = new Map<string, string[]>();

// TODO: Ensure the worker is running in the same process as the queue, or start a separate worker process if needed.
// The worker below will automatically execute jobs as soon as they are added to the queue.
const worker = new Worker('deployment', async (job: Job) => {
  const { theme, business } = job.data as { theme: Theme; business: Business };
  const deploymentId = `${theme.themeId}-${business.businessId}`;
  
  // Initialize logs for this deployment
  deploymentLogs.set(deploymentId, []);
  // TODO: Log job execution start
  console.log(`[Worker] Executing deployment job: ${deploymentId}`);
  
  // Add log function
  const addLog = (message: string) => {
    const logs = deploymentLogs.get(deploymentId) || [];
    logs.push(`[${new Date().toISOString()}] ${message}`);
    deploymentLogs.set(deploymentId, logs);
    
    // Emit log to connected clients
    const room = job.id ? String(job.id) : '';
    if (room) {
      io.to(room).emit('deployment-log', { 
        message, 
        timestamp: new Date().toISOString() 
      });
    }
  };
  
  try {
    addLog('Starting deployment...');
    // TODO: You can add more granular logs here for each deployment step if needed
    const result = await deployThemeToBusiness(theme, business);
    addLog('Deployment completed successfully');
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    addLog(`Deployment failed: ${errorMessage}`);
    throw error;
  }
}, { connection });

worker.on('completed', (job, result) => {
  if (!job) return;
  const room = job.id ? String(job.id) : '';
  if (room) io.to(room).emit('deployment-status', { status: 'completed', result });
});

worker.on('failed', (job, err) => {
  if (!job) return;
  const room = job.id ? String(job.id) : '';
  if (room) io.to(room).emit('deployment-status', { status: 'failed', error: err.message });
});

export async function addDeploymentJob(
  theme: Theme, 
  business: Business, 
  options?: { priority?: string; timeout?: number }
) {
  const jobOptions: any = {
    jobId: `${theme.themeId}-${business.businessId}`,
    removeOnComplete: false,
    removeOnFail: false,
  };

  // Add priority if specified
  if (options?.priority) {
    const priorityMap: { [key: string]: number } = {
      'low': 1,
      'normal': 5,
      'high': 10
    };
    jobOptions.priority = priorityMap[options.priority] || 5;
  }

  // Add timeout if specified
  if (options?.timeout) {
    jobOptions.delay = 0; // Start immediately
    jobOptions.attempts = 1; // Don't retry on timeout
  }

  // TODO: Log job addition
  console.log(`[Queue] Adding deployment job: ${jobOptions.jobId}`);
  const job = await deploymentQueue.add('deploy', { theme, business }, jobOptions);
  // TODO: Optionally, you can trigger job processing here if you want manual control (not needed for BullMQ default)
  return job;
}

export async function getDeploymentJobStatus(themeId: string, businessId: string) {
  const job = await deploymentQueue.getJob(`${themeId}-${businessId}`);
  if (!job) return null;
  
  return {
    id: job.id,
    status: await job.getState(),
    result: job.returnvalue,
    failedReason: job.failedReason,
    progress: job.progress,
  };
}

export async function getDeploymentLogs(themeId: string, businessId: string): Promise<string[] | null> {
  const deploymentId = `${themeId}-${businessId}`;
  return deploymentLogs.get(deploymentId) || null;
}

// Clean up old logs (call this periodically)
export function cleanupOldLogs(maxAge: number = 24 * 60 * 60 * 1000) { // 24 hours default
  const cutoff = Date.now() - maxAge;
  // In a real implementation, you'd check log timestamps and remove old entries
  // For now, we'll keep this simple
}

// Clean the deployment queue and logs
export async function cleanDeploymentQueue() {
  // Empty the BullMQ queue (waiting, delayed, active, completed, failed jobs)
  await deploymentQueue.drain();
  await deploymentQueue.clean(0, 1000, 'completed');
  await deploymentQueue.clean(0, 1000, 'failed');
  await deploymentQueue.clean(0, 1000, 'delayed');
  await deploymentQueue.clean(0, 1000, 'wait');
  await deploymentQueue.clean(0, 1000, 'active');
  // Clear in-memory logs
  deploymentLogs.clear();
}