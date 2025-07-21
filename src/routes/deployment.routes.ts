import { Router } from 'express';
import { deployTheme } from '../controllers/deploymentController';
import { getDeploymentJobStatus } from '../services/deploymentQueue';

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

export default router; 