import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Keep Fastify's strict Host/Origin checks; translate only a request that was
// same-origin at Vite's boundary. Never launder an arbitrary browser Origin.
const localApiProxy: ProxyOptions = {
  target: 'http://127.0.0.1:4317',
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
  plugins: [react()],
  build: { outDir: 'dist/web' },
  server: { host: '127.0.0.1', proxy: { '/api': localApiProxy, '/health': localApiProxy } },
});
