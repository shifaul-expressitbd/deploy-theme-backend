export interface Business {
  businessId: string;
  userId: string;
  gtmId: string;
  domain: string;
  ssh?: {
    host: string;
    port?: number;
    username: string;
    privateKeyPath: string;
  };
} 