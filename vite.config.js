import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'fonts/*.ttf'],
      manifest: {
        name: 'かたちづくり',
        short_name: 'かたちづくり',
        description: '子供向け 3Dプリント用 かんたんモデリング',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f7f9fb',
        theme_color: '#1565c0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,ttf,png,svg}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
});
