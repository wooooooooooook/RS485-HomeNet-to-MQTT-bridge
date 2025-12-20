import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@rs485-homenet/core',
        replacement: path.resolve(__dirname, 'packages/core/src/index.ts'),
      },
      {
        find: /^@rs485-homenet\/core\/(.*)$/,
        replacement: path.resolve(__dirname, 'packages/core/src/$1'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
  },
});
