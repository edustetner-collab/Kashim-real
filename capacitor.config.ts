import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kashim.app',
  appName: 'Kashim',
  webDir: 'dist',
  // Serve bundled web app with HTTPS scheme so Clerk auth works correctly
  server: {
    hostname: 'app.kashim.com.br',
    iosScheme: 'https',
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#050505',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0f0f0f',
    },
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    allowsLinkPreview: false,
  },
};

export default config;
