import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg'],
          manifest: {
            name: 'RICO nessa vida',
            short_name: 'RICO',
            description: 'Organize suas finanças e enriqueça com estratégia.',
            theme_color: '#ca8a04',
            background_color: '#050505',
            display: 'standalone',
            start_url: '/',
            orientation: 'portrait-primary',
            lang: 'pt-BR',
            icons: [
              { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
            ]
          },
          workbox: {
            // Não faz precache do HTML — sempre busca do servidor para garantir headers HTTP atualizados (CSP, etc.)
            globPatterns: ['**/*.{js,css,svg}'],
            navigateFallback: null,
            runtimeCaching: [
              {
                // HTML: sempre busca do servidor (NetworkFirst) — garante CSP e headers atualizados
                urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
                handler: 'NetworkFirst',
                options: { cacheName: 'html-cache', networkTimeoutSeconds: 5 },
              },
              {
                urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
                handler: 'CacheFirst',
                options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } }
              },
              {
                urlPattern: /^https:\/\/cdnjs\.cloudflare\.com/,
                handler: 'CacheFirst',
                options: { cacheName: 'cdn-assets', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 } }
              },
              {
                urlPattern: /^https:\/\/cdn\.jsdelivr\.net/,
                handler: 'CacheFirst',
                options: { cacheName: 'cdn-assets', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 } }
              }
            ]
          }
        }),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
