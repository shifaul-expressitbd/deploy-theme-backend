// Middleware to authenticate API key and secret from headers
import { Request, Response, NextFunction } from 'express';

const API_KEY = process.env.API_KEY || 'your_api_key_here';
const API_SECRET = process.env.API_SECRET || 'your_api_secret_here';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');
  const apiSecret = req.header('x-api-secret');

  // Debug logging for troubleshooting
  // console.log('Received:', apiKey, apiSecret);
  // console.log('Expected:', API_KEY, API_SECRET);

  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: 'API key and secret required.' });
  }
  if (apiKey !== API_KEY || apiSecret !== API_SECRET) {
    return res.status(403).json({ error: 'Invalid API key or secret.' });
  }
  next();
} 