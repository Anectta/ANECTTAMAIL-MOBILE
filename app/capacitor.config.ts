import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anectta.mail',
  appName: 'Anectta MAIL',
  webDir: 'dist',
  backgroundColor: '#060a12',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060a12',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
    },
  },
};

export default config;
