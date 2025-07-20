import express from 'express';
import routes from './routes';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';
import cors from 'cors';
import helmet from 'helmet';
import logger from './utils/logger';
import type { Request, Response, NextFunction } from 'express';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://calquick.app',
    'https://frontend.calquick.app'
  ],
  credentials: true
}));
app.use(helmet());

app.get('/', (req, res) => {
  if (req.accepts('html')) {
    res.send('<h1>Server is running</h1><p>Status: OK</p><p>Uptime: ' + process.uptime().toFixed(2) + ' seconds</p>');
  } else {
    res.json({ status: 'ok', message: 'Server is running', uptime: process.uptime() });
  }
});

app.use(express.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

routes.forEach(route => app.use('/api/v1', route));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app; 