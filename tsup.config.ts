import { defineConfig } from 'tsup';
import { copyFile } from 'node:fs/promises';
export default defineConfig({
  onSuccess: async () => {
    await copyFile('src/server/insights/embedding-worker.mjs', 'dist/server/embedding-worker.mjs');
  },
  entry: {
    index: 'src/server/core/index.ts',
    mcp: 'src/integrations/mcp.ts',
    desktop: 'src/server/core/desktop.ts',
  },
  format: ['esm'],
  outDir: 'dist/server',
  external: ['better-sqlite3'],
  clean: true,
});
