import { Request, Response } from 'express';
import { z } from 'zod';
import { getThemeById } from '../services/theme.service';
import logger from '../utils/logger';
import { addDeploymentJob, getDeploymentJobStatus } from '../services/deploymentQueue';

const deployThemeSchema = z.object({
  themeId: z.string().min(1),
  businessId: z.string().min(1),
  userId: z.string().min(1),
  gtmId: z.string().min(1),
  domain: z.string().min(1),
  ssh: z
    .object({
      host: z.string(),
      port: z.number().optional(),
      username: z.string(),
      privateKeyPath: z.string(),
    })
    .optional(),
});

export async function deployTheme(req: Request, res: Response) {
  try {
    logger.info(`Received deploy request: ${JSON.stringify(req.body)}`);
    const parseResult = deployThemeSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn(`Invalid request body: ${JSON.stringify(parseResult.error.issues)}`);
      return res.status(400).json({ error: 'Invalid request body', details: parseResult.error.issues });
    }
    const { themeId, businessId, userId, gtmId, domain, ssh } = parseResult.data;

    // Fetch theme info
    const theme = await getThemeById(themeId);
    logger.info(`Fetched theme: ${JSON.stringify(theme)}`);
    const business = { businessId, userId, gtmId, domain, ssh };
    logger.info(`Business object: ${JSON.stringify(business)}`);

    // Add deployment job to queue
    await addDeploymentJob(theme, business);
    const jobStatus = await getDeploymentJobStatus(themeId, businessId);
    res.status(202).json({ message: 'Deployment job queued', job: jobStatus });
  } catch (error: any) {
    logger.error(`Deployment error: ${error.stack || error}`);
    res.status(500).json({ error: error.message || 'Deployment failed.' });
  }
} 