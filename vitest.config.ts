import { defineConfig } from 'vitest/config';

// One Vitest run covers every workspace package and tools/ (each has its own vitest.config.ts)
// plus repo-wide guard tests under tests/guards/.
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'tools',
      {
        test: {
          name: 'repo',
          include: ['tests/guards/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
