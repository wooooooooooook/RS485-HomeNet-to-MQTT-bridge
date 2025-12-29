import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [svelte()],
  base: './',
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0', // Allow external access for Docker
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://app:3000', // Use Docker service name by default
        changeOrigin: true,
        ws: true, // WebSocket 프록시 활성화 (MQTT 스트림용)
        configure: (proxy) => {
          // 백엔드 연결 오류 시 502 Bad Gateway 반환 (브라우저가 자동으로 재시도 가능)
          proxy.on('error', (err, _req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('Backend server is unavailable. Please wait and refresh.');
            }
          });
        },
      },
    },
  },
});
