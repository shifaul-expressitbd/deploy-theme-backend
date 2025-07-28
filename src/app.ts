import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import client from 'prom-client';
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger";
import routes from "./routes";
import logger from "./utils/logger";

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:4444",
      "http://localhost:3000",
      "https://calquick.app",
      "https://frontend.calquick.app",
    ],
    credentials: true,
  })
);
app.use(helmet());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running",
    uptime: process.uptime(),
  });
});

app.use(express.json());

app.use("/api-docs", (req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "script-src 'self' 'unsafe-eval'; object-src 'self'"
  );
  next();
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Apply API key auth to all /api/v1 routes
// ...existing code...

routes.forEach((route) => app.use('/api/v1', route));

// Prometheus metrics setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
});

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
    end({ status: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;
