import { Router } from 'express';
import { deployTheme } from '../controllers/deploymentController';
import { deploymentQueue, getDeploymentJobStatus } from '../services/deploymentQueue';

const router = Router();

/**
 * @swagger
 * /deploy:
 *   post:
 *     summary: Queue a deployment job for a theme to a business
 *     requestBody:
 *       $ref: '#/components/requestBodies/DeployTheme'
 *     responses:
 *       202:
 *         description: Deployment job accepted and queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Deployment job queued
 *                 job:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: ecom-001-1
 *                     status:
 *                       type: string
 *                       example: waiting
 *                     result:
 *                       type: object
 *                       nullable: true
 *                     failedReason:
 *                       type: string
 *                       nullable: true
 *                     progress:
 *                       type: number
 *                       nullable: true
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Internal server error
 */
router.post('/deploy', deployTheme);

/**
 * @swagger
 * /deploy/status:
 *   get:
 *     summary: Get deployment job status by themeId and businessId
 *     parameters:
 *       - in: query
 *         name: themeId
 *         schema:
 *           type: string
 *         required: true
 *         description: Theme ID
 *       - in: query
 *         name: businessId
 *         schema:
 *           type: string
 *         required: true
 *         description: Business ID
 *     responses:
 *       200:
 *         description: Deployment job status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 job:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                     result:
 *                       type: object
 *                       nullable: true
 *                     failedReason:
 *                       type: string
 *                       nullable: true
 *                     progress:
 *                       type: number
 *                       nullable: true
 *       400:
 *         description: Missing query parameters
 *       404:
 *         description: Job not found
 */
router.get('/deploy/status', async (req, res) => {
  const { themeId, businessId } = req.query;
  if (!themeId || !businessId) {
    return res.status(400).json({ error: 'themeId and businessId are required as query params.' });
  }
  const status = await getDeploymentJobStatus(String(themeId), String(businessId));
  if (!status) {
    return res.status(404).json({ error: 'Deployment job not found.' });
  }
  res.json({ job: status });
});

/**
 * @swagger
 * /deploy/queue:
 *   get:
 *     summary: Get BullMQ deployment queue status and jobs
 *     responses:
 *       200:
 *         description: Queue status and jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queue:
 *                   type: object
 *                 jobs:
 *                   type: object
 *                   properties:
 *                     waiting:
 *                       type: array
 *                       items:
 *                         type: object
 *                     active:
 *                       type: array
 *                       items:
 *                         type: object
 *                     completed:
 *                       type: array
 *                       items:
 *                         type: object
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                     delayed:
 *                       type: array
 *                       items:
 *                         type: object
 *                     paused:
 *                       type: array
 *                       items:
 *                         type: object
 */
router.get('/deploy/queue', async (req, res) => {
  try {
    const queue = deploymentQueue;
    const waiting = await queue.getJobs(['waiting']);
    const active = await queue.getJobs(['active']);
    const completed = await queue.getJobs(['completed'], 0, 10, false);
    const failed = await queue.getJobs(['failed'], 0, 10, false);
    const delayed = await queue.getJobs(['delayed']);
    const paused = await queue.getJobs(['paused']);
    const queueInfo = await queue.getJobCounts();
    res.json({
      queue: queueInfo,
      jobs: {
        waiting: waiting.map(j => ({ id: j.id, data: j.data, status: 'waiting' })),
        active: active.map(j => ({ id: j.id, data: j.data, status: 'active' })),
        completed: completed.map(j => ({ id: j.id, data: j.data, status: 'completed', returnvalue: j.returnvalue })),
        failed: failed.map(j => ({ id: j.id, data: j.data, status: 'failed', failedReason: j.failedReason })),
        delayed: delayed.map(j => ({ id: j.id, data: j.data, status: 'delayed' })),
        paused: paused.map(j => ({ id: j.id, data: j.data, status: 'paused' })),
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch queue info', details: err instanceof Error ? err.message : String(err) });
  }
});

export default router;