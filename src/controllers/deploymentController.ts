import { Request, Response } from 'express';
import { z } from 'zod';
import { deployThemeToBusiness } from '../services/deployment.service';
import { addDeploymentJob, getDeploymentJobStatus, getDeploymentLogs } from '../services/deploymentQueue';
import { getThemeById } from '../services/theme.service';
import logger from '../utils/logger';

const deployThemeSchema = z.object({
  themeId: z.string().min(1, "Theme ID is required"),
  businessId: z.string().min(1, "Business ID is required"),
  userId: z.string().min(1, "User ID is required"),
  gtmId: z.string().min(1, "GTM ID is required"),
  domain: z.string().min(1, "Domain is required").regex(
    /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/,
    "Invalid domain format"
  ),
  ssh: z
    .object({
      host: z.string().min(1, "SSH host is required"),
      port: z.number().int().min(1).max(65535).optional().default(22),
      username: z.string().min(1, "SSH username is required"),
      privateKeyPath: z.string().min(1, "SSH private key path is required"),
    })
    .optional(),
  // Optional deployment configuration
  config: z.object({
    useQueue: z.boolean().optional().default(true),
    priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
    timeout: z.number().int().min(60).max(1800).optional().default(600), // 10 minutes default
  }).optional().default({ useQueue: true, priority: 'normal', timeout: 600 }),
});

const getDeploymentStatusSchema = z.object({
  themeId: z.string().min(1),
  businessId: z.string().min(1),
});

export async function deployTheme(req: Request, res: Response) {
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
  
  try {
    logger.info(`[${requestId}] Received deploy request`, {
      body: req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    });

    // Validate request body
    const parseResult = deployThemeSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn(`[${requestId}] Invalid request body`, {
        errors: parseResult.error.issues,
        receivedData: req.body
      });
      return res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.issues,
        requestId
      });
    }

    const { themeId, businessId, userId, gtmId, domain, ssh, config } = parseResult.data;
    const deploymentId = `${themeId}-${businessId}`;

    logger.info(`[${requestId}] Processing deployment request`, {
      deploymentId,
      themeId,
      businessId,
      domain,
      hasSSH: !!ssh,
      config
    });

    // Fetch theme information
    let theme;
    try {
      theme = await getThemeById(themeId);
      if (!theme) {
        logger.error(`[${requestId}] Theme not found: ${themeId}`);
        return res.status(404).json({
          error: 'Theme not found',
          themeId,
          requestId
        });
      }
      logger.info(`[${requestId}] Theme fetched successfully`, {
        themeId: theme.themeId,
        themeName: theme.name,
        repoUrl: theme.repoUrl
      });
    } catch (error) {
      logger.error(`[${requestId}] Failed to fetch theme`, {
        themeId,
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to fetch theme information',
        themeId,
        requestId
      });
    }

    const business = {
      businessId,
      userId,
      gtmId,
      domain,
      ssh
    };

    logger.info(`[${requestId}] Business configuration`, { business });

    // Check if deployment should use queue or direct execution
    if (config?.useQueue === false) {
      logger.info(`[${requestId}] Direct deployment requested (bypassing queue)`);
      
      // Execute deployment directly (for immediate deployment scenarios)
      try {
        const deployment = await deployThemeToBusiness(theme, business);
        
        logger.info(`[${requestId}] Direct deployment completed`, {
          deploymentId,
          status: deployment.status,
          duration: deployment.duration
        });

        return res.status(200).json({
          message: 'Deployment completed',
          deployment,
          requestId
        });
      } catch (error) {
        logger.error(`[${requestId}] Direct deployment failed`, {
          deploymentId,
          error: error instanceof Error ? error.message : String(error)
        });
        
        return res.status(500).json({
          error: 'Deployment failed',
          details: error instanceof Error ? error.message : String(error),
          requestId
        });
      }
    }

    // Default: Use deployment queue
    try {
      // Check if deployment is already in progress or completed
      const existingJobStatus = await getDeploymentJobStatus(themeId, businessId);
      
      if (existingJobStatus && existingJobStatus.status === 'in_progress') {
        logger.info(`[${requestId}] Deployment already in progress`, {
          deploymentId,
          existingStatus: existingJobStatus
        });
        
        return res.status(409).json({
          message: 'Deployment already in progress',
          job: existingJobStatus,
          requestId
        });
      }

      if (existingJobStatus && existingJobStatus.status === 'success') {
        logger.info(`[${requestId}] Deployment already completed`, {
          deploymentId,
          existingStatus: existingJobStatus
        });
        
        return res.status(200).json({
          message: 'Deployment already completed',
          job: existingJobStatus,
          requestId
        });
      }

      // Add deployment job to queue
      const jobOptions = {
        priority: config?.priority || 'normal',
        timeout: (config?.timeout || 600) * 1000, // Convert to milliseconds
      };

      await addDeploymentJob(theme, business, jobOptions);
      const jobStatus = await getDeploymentJobStatus(themeId, businessId);

      logger.info(`[${requestId}] Deployment job queued successfully`, {
        deploymentId,
        jobId: jobStatus?.id,
        priority: jobOptions.priority,
        timeout: jobOptions.timeout
      });

      res.status(202).json({
        message: 'Deployment job queued successfully',
        job: jobStatus,
        requestId,
        estimated: {
          startTime: new Date(Date.now() + 5000).toISOString(), // Estimated 5 seconds
          maxDuration: jobOptions.timeout / 1000 // seconds
        }
      });

    } catch (error) {
      logger.error(`[${requestId}] Failed to queue deployment job`, {
        deploymentId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return res.status(500).json({
        error: 'Failed to queue deployment job',
        details: error instanceof Error ? error.message : String(error),
        requestId
      });
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error(`[${requestId}] Unexpected deployment error`, {
      error: errorMessage,
      stack: errorStack,
      body: req.body
    });
    
    res.status(500).json({
      error: 'Internal server error during deployment',
      details: errorMessage,
      requestId
    });
  }
}

export async function getDeploymentStatus(req: Request, res: Response) {
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
  
  try {
    const parseResult = getDeploymentStatusSchema.safeParse(req.params);
    if (!parseResult.success) {
      logger.warn(`[${requestId}] Invalid status request parameters`, {
        params: req.params,
        errors: parseResult.error.issues
      });
      
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: parseResult.error.issues,
        requestId
      });
    }

    const { themeId, businessId } = parseResult.data;
    const deploymentId = `${themeId}-${businessId}`;

    logger.info(`[${requestId}] Fetching deployment status`, { deploymentId });

    const jobStatus = await getDeploymentJobStatus(themeId, businessId);
    
    if (!jobStatus) {
      logger.warn(`[${requestId}] Deployment status not found`, { deploymentId });
      return res.status(404).json({
        error: 'Deployment not found',
        deploymentId,
        requestId
      });
    }

    logger.info(`[${requestId}] Deployment status retrieved`, {
      deploymentId,
      status: jobStatus.status,
      progress: jobStatus.progress
    });

    res.status(200).json({
      deployment: jobStatus,
      requestId
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(`[${requestId}] Failed to get deployment status`, {
      error: errorMessage,
      params: req.params
    });
    
    res.status(500).json({
      error: 'Failed to retrieve deployment status',
      details: errorMessage,
      requestId
    });
  }
}

export async function getDeploymentLogStream(req: Request, res: Response) {
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
  
  try {
    const parseResult = getDeploymentStatusSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: parseResult.error.issues,
        requestId
      });
    }

    const { themeId, businessId } = parseResult.data;
    const deploymentId = `${themeId}-${businessId}`;

    logger.info(`[${requestId}] Streaming deployment logs`, { deploymentId });

    // Check if logs exist
    const logs = await getDeploymentLogs(themeId, businessId);
    if (!logs) {
      return res.status(404).json({
        error: 'Deployment logs not found',
        deploymentId,
        requestId
      });
    }

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send existing logs
    logs.forEach((log, index) => {
      res.write(`data: ${JSON.stringify({ 
        id: index, 
        message: log, 
        timestamp: new Date().toISOString() 
      })}\n\n`);
    });

    // Set up real-time log streaming if deployment is in progress
    const jobStatus = await getDeploymentJobStatus(themeId, businessId);
    if (jobStatus?.status === 'in_progress') {
      // Set up WebSocket or polling mechanism for real-time logs
      // This would connect to the deployment service's log emission
      const logInterval = setInterval(async () => {
        try {
          const currentLogs = await getDeploymentLogs(themeId, businessId);
          if (currentLogs) {
            const newLogs = currentLogs.slice(logs.length);
            
            newLogs.forEach((log, index) => {
              res.write(`data: ${JSON.stringify({ 
                id: logs.length + index, 
                message: log, 
                timestamp: new Date().toISOString() 
              })}\n\n`);
            });
            
            logs.push(...newLogs);
          }
          
          // Check if deployment is complete
          const currentStatus = await getDeploymentJobStatus(themeId, businessId);
          if (currentStatus?.status !== 'in_progress') {
            clearInterval(logInterval);
            res.write(`data: ${JSON.stringify({ 
              id: 'final', 
              message: `Deployment ${currentStatus?.status}`, 
              timestamp: new Date().toISOString(),
              final: true 
            })}\n\n`);
            res.end();
          }
        } catch (error) {
          logger.error(`[${requestId}] Error streaming logs`, {
            deploymentId,
            error: error instanceof Error ? error.message : String(error)
          });
          clearInterval(logInterval);
          res.end();
        }
      }, 1000); // Poll every second

      // Clean up on client disconnect
      req.on('close', () => {
        clearInterval(logInterval);
        logger.info(`[${requestId}] Log stream closed by client`, { deploymentId });
      });
    } else {
      // Deployment is complete, close the stream
      res.write(`data: ${JSON.stringify({ 
        id: 'final', 
        message: `Deployment ${jobStatus?.status || 'unknown'}`, 
        timestamp: new Date().toISOString(),
        final: true 
      })}\n\n`);
      res.end();
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(`[${requestId}] Failed to stream deployment logs`, {
      error: errorMessage,
      params: req.params
    });
    
    res.status(500).json({
      error: 'Failed to stream deployment logs',
      details: errorMessage,
      requestId
    });
  }
}

export async function cancelDeployment(req: Request, res: Response) {
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;
  
  try {
    const parseResult = getDeploymentStatusSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: parseResult.error.issues,
        requestId
      });
    }

    const { themeId, businessId } = parseResult.data;
    const deploymentId = `${themeId}-${businessId}`;

    logger.info(`[${requestId}] Cancellation requested`, { deploymentId });

    // Check current status
    const jobStatus = await getDeploymentJobStatus(themeId, businessId);
    if (!jobStatus) {
      return res.status(404).json({
        error: 'Deployment not found',
        deploymentId,
        requestId
      });
    }

    if (jobStatus.status !== 'in_progress') {
      return res.status(400).json({
        error: 'Deployment cannot be cancelled',
        reason: `Deployment is ${jobStatus.status}`,
        deploymentId,
        requestId
      });
    }

    // TODO: Implement actual job cancellation logic
    // This would involve stopping the deployment process and performing cleanup
    
    logger.warn(`[${requestId}] Deployment cancellation not fully implemented`, {
      deploymentId,
      currentStatus: jobStatus.status
    });

    res.status(501).json({
      error: 'Deployment cancellation not implemented',
      deploymentId,
      requestId
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(`[${requestId}] Failed to cancel deployment`, {
      error: errorMessage,
      params: req.params
    });
    
    res.status(500).json({
      error: 'Failed to cancel deployment',
      details: errorMessage,
      requestId
    });
  }
}