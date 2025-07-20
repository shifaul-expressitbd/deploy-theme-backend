import app from './app';
import logger from './utils/logger';

const HOST = '0.0.0.0';
const PORT = process.env.PORT || '4444';

const server = app.listen(Number(PORT), HOST, () => {
  logger.info(`Server running on http://${HOST}:${PORT}`);
});

const shutdown = () => {
  logger.info('Received shutdown signal, closing server...');
  server.close(() => {
    logger.info('Server closed. Exiting process.');
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown); 