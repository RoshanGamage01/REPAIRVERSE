import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', worker: 'src/worker.ts', migrate: 'src/cli/migrate.ts', seed: 'src/cli/seed.ts' },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Native modules stay external; the workspace's shared TypeScript package is bundled in.
  external: ['sharp', 'pg-native', '@node-rs/argon2'],
  noExternal: ['@repairverse/shared'],
});
