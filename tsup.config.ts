import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/server/index.ts', mcp: 'src/integrations/mcp.ts' },
  format: ['esm'],
  outDir: 'dist/server',
  external: ['better-sqlite3'],
  clean: true,
});
