export function dataDirLocations(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  home?: string;
}): { current: string; legacy: { path: string; requiresDatabase: boolean }[] };
export function resolveDataDir(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  home?: string;
  exists?: (path: string) => boolean;
}): string;
