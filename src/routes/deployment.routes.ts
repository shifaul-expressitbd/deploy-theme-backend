import { Router } from 'express';
import { deployTheme } from '../controllers/deploymentController';

const router = Router();

/**
 * @swagger
 * /deploy:
 *   post:
 *     summary: Deploy a theme to a business
 *     requestBody:
 *       $ref: '#/components/requestBodies/DeployTheme'
 *     responses:
 *       200:
 *         $ref: '#/components/responses/DeploymentResult'
 */
router.post('/deploy', deployTheme);

export default router; 