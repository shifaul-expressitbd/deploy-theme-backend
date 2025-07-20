import { Request, Response } from 'express';
import { getThemeById } from '../services/theme.service';
import { deployThemeToBusiness } from '../services/deployment.service';

export async function deployTheme(req: Request, res: Response) {
  try {
    console.log('Received deploy request:', req.body);
    const { themeId, businessId, userId, gtmId, domain } = req.body;
    if (!themeId || !businessId || !userId || !gtmId || !domain) {
      console.log('Invalid request body:', req.body);
      return res.status(400).json({ error: 'themeId, businessId, userId, gtmId, and domain are required.' });
    }

    const theme = await getThemeById(themeId);
    console.log('Fetched theme:', theme);
    const business = { businessId, userId, gtmId, domain };
    console.log('Business object:', business);

    const result = await deployThemeToBusiness(theme, business);
    console.log('Deployment result:', result);
    res.json({ deployment: result });
  } catch (error: any) {
    console.log('Deployment error:', error);
    res.status(500).json({ error: error.message || 'Deployment failed.' });
  }
} 