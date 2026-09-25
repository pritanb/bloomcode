import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Keep Fastify's strict Host/Origin checks; translate only a request that was
// same-origin at Vite's boundary. Never launder an arbitrary browser Origin.
const localApiProxy: ProxyOptions = {
  target: `http://127.0.0.1:${process.env.TUTOR_DEV_API_PORT || '4317'}`,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (upstreamRequest, request) => {
      if (request.headers.origin === `http://${request.headers.host}`) {
        upstreamRequest.setHeader('origin', `http://${upstreamRequest.getHeader('host')}`);
      }
    });
  },
};
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: 'dist/web' },
  server: { host: '127.0.0.1', proxy: { '/api': localApiProxy, '/health': localApiProxy } },
});
