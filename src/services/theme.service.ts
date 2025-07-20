import { Theme } from '../interfaces/theme.interface';

const THEMES = [
  {
    themeId: 'ecom-001',
    name: 'Minimalist',
    description: 'Ultra-clean design that puts products front and center with ample white space and elegant typography',
    previewImages: [
      '/images/themes/minimal/minimal1.png',
      '/images/themes/minimal/minimal2.png',
      '/images/themes/minimal/minimal3.png',
      '/images/themes/minimal/minimal4.png',
      '/images/themes/minimal/minimal5.png',
    ],
    demoUrl: 'https://emegadeal.com',
    isPremium: false,
    category: 'Fashion & Apparel',
    features: [
      'Full-screen product imagery with zoom functionality',
      'Interactive size/color swatches with inventory indicators',
      'Lookbook integration with social sharing',
      'Wishlist functionality with reminder emails',
      'Mobile-optimized with PWA support',
      'SEO-optimized product pages',
      'Accessibility compliant (WCAG 2.1 AA)',
      'Fast-loading design (avg. 0.8s page load)',
      'Multi-currency and language support',
      'One-click checkout options',
      'Product quick view modal',
      'Advanced filtering and sorting',
      'Customer review system with photos',
      'Abandoned cart recovery',
      'Newsletter subscription integration',
      'Social media integration',
      'Product badges (New, Sale, Bestseller)',
      'Stock level indicators',
      'Estimated delivery calculator',
      'GDPR compliant cookie consent'
    ],
    colorPalette: ['#ffffff', '#f8f8f8', '#222222'],
    avgRating: 4.8,
    repoUrl: 'git@github.com-work:shaha-expressitbd/e-megadeal-v2.git'
  },
  {
    themeId: 'ecom-002',
    name: 'TechPro',
    description: 'High-tech theme with interactive product displays perfect for electronics and gadgets',
    previewImages: [
      '/images/themes/techpro/techpro1.png',
      '/images/themes/techpro/techpro2.png',
    ],
    demoUrl: 'https://demo-techpro-ecom.example.com',
    isPremium: true,
    category: 'Electronics',
    features: [
      '360° product view',
      'Spec comparison tool',
      'AJAX filtering',
      'Sticky add-to-cart',
      'Warranty calculator'
    ],
    colorPalette: ['#0a2540', '#00d4ff', '#f6f9fc'],
    avgRating: 4.9,
    repoUrl: 'git@github.com-work:shaha-expressitbd/ecom-theme-2.git'
  }
];

export async function getThemeById(themeId: string): Promise<Theme> {
  console.log('Looking up theme by id:', themeId);
  const theme = THEMES.find(t => t.themeId === themeId);
  if (!theme) {
    console.log('Theme not found for id:', themeId);
    throw new Error('Theme not found');
  }
  console.log('Found theme:', theme);
  return theme;
} 