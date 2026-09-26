/**
 * The repository root, for files the server reads at runtime (migrations/, dist/web/,
 * src/integrations/manifests/). Keep this module directly under src/server: tsup
 * bundles it into dist/server/*.js, and both locations sit two levels below the root,
 * so the same relative URL works from source (tsx) and from the bundle.
 */
export const repoRoot = new URL('../../', import.meta.url);
