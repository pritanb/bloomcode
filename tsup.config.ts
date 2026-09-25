import { defineConfig } from 'tsup';
import { randomUUID } from 'node:crypto';
import { writeFile, copyFile } from 'node:fs/promises';
const buildId = randomUUID();
export default defineConfig({
  define: { __TUTOR_BUILD_ID__: JSON.stringify(buildId) },
  onSuccess: async () => {
    await writeFile('dist/server/build-id', buildId);
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
