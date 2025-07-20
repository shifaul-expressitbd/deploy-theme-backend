import { Business } from '../interfaces/business.interface';

// Mock function to fetch business data
export async function getBusinessById(businessId: string): Promise<Business> {
  console.log('Looking up business by id:', businessId);
  // Replace with real DB/API call
  const business = {
    businessId: businessId,
    userId: 'user_' + businessId,
    gtmId: 'GTM-XXXXXX',
    domain: `business${businessId}.example.com`,
  };
  console.log('Found business:', business);
  return business;
}

// Mock function to fetch multiple businesses
export async function getBusinessesByIds(businessIds: string[]): Promise<Business[]> {
  console.log('Looking up businesses by ids:', businessIds);
  const businesses = await Promise.all(businessIds.map(getBusinessById));
  console.log('Found businesses:', businesses);
  return businesses;
} 