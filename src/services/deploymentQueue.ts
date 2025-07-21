import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { deployThemeToBusiness } from './deployment.service';
import { Theme } from '../interfaces/theme.interface';
import { Business } from '../interfaces/business.interface';
import { Deployment } from '../interfaces/deployment.interface';
import { io } from '../server';

const connection = new IORedis({ maxRetriesPerRequest: null });

export const deploymentQueue = new Queue('deployment', { connection });
// new QueueScheduler('deployment', { connection }); // Removed for compatibility

const worker = new Worker('deployment', async (job: Job) => {
  const { theme, business } = job.data as { theme: Theme; business: Business };
  return await deployThemeToBusiness(theme, business);
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

export async function addDeploymentJob(theme: Theme, business: Business) {
  return deploymentQueue.add('deploy', { theme, business }, {
    jobId: `${theme.themeId}-${business.businessId}`,
    removeOnComplete: false,
    removeOnFail: false,
  });
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