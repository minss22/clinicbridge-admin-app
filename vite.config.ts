import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',          // 새 배포 시 서비스워커 자동 갱신
      injectRegister: 'auto',
      includeAssets: ['favicon-32x32.png', 'favicon-64x64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'ClinicBridge 예약 관리자',
        short_name: '예약 관리자',
        description: '클리닉 예약 관리자 대시보드',
        lang: 'ko',
        theme_color: '#1D9E75',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 빌드된 앱 셸만 프리캐시. Supabase API(다른 오리진)는 캐시하지 않아 항상 최신.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 3001 },
})
