import app from './app';
import logger from './utils/logger';
import os from 'os';
import { Server as SocketIOServer } from 'socket.io';

const HOST = '0.0.0.0';
const PORT = process.env.PORT || '4444';
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(Number(PORT), HOST, () => {
  let addresses: string[] = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  if (NODE_ENV === 'production') {
    logger.info(`Server running in production mode.`);
    addresses.forEach(ip => logger.info(`Accessible at: http://${ip}:${PORT}`));
  } else {
    logger.info(`Server running in development mode.`);
    logger.info(`Accessible at: http://localhost:${PORT}`);
    addresses.forEach(ip => logger.info(`Also accessible at: http://${ip}:${PORT}`));
  }
});

export const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Allow clients to join a room for deployment logs
io.on('connection', (socket) => {
  socket.on('join', (room) => {
    socket.join(room);
  });
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