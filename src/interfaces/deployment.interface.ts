export interface Deployment {
  themeId: string;
  businessId: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed';
  logs?: string[];
} 