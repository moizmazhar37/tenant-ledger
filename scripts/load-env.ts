import nextEnv from '@next/env';

/** Load .env files with the same precedence rules Next.js uses at runtime. */
nextEnv.loadEnvConfig(process.cwd());
