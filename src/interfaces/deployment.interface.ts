export interface Deployment {
  themeId: string;
  businessId: string;
  status: 'in_progress' | 'success' | 'failed';
  logs: string[];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  failedAt?: string;
  duration?: number;
  port?: number;
  domain?: string;
  error?: string;
}