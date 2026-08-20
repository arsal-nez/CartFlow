const fs = require('node:fs');
const path = require('node:path');

/**
 * The `@middy/*` packages ship as ESM-only, with an `exports` map that only
 * defines an `import` condition. Jest's CJS resolver can't resolve a bare
 * `require('@middy/core')` at all in that case (not even a transform issue —
 * resolution itself fails with ERR_PACKAGE_PATH_NOT_EXPORTED). This walks the
 * same node_modules directories Node would search, without going through the
 * `exports` field, to find the `@middy` scope directory, then maps every
 * `@middy/*` import (including the packages' own cross-imports, e.g.
 * `@middy/http-cors` importing `@middy/util`) straight to its entry file.
 */
function findMiddyScopeDir() {
  const candidateDirs = require.resolve.paths('@middy/core') ?? [];
  for (const dir of candidateDirs) {
    if (fs.existsSync(path.join(dir, '@middy', 'core', 'index.js'))) {
      return path.join(dir, '@middy');
    }
  }
  throw new Error('Could not locate the @middy scope under any node_modules directory');
}

const middyScopeDir = findMiddyScopeDir();

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts'],
  testMatch: ['**/*.test.ts'],
  transform: {
    // tsconfig targets ESNext modules for the bundler; Jest runs CommonJS.
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'CommonJS' } }],
    // The mapped @middy entry files are still ESM syntax; rewrite
    // import/export to CJS before Jest's runtime requires them.
    '^.+\\.js$': ['babel-jest', { plugins: ['@babel/plugin-transform-modules-commonjs'] }],
  },
  moduleNameMapper: {
    '^@middy/(.*)$': path.join(middyScopeDir, '$1', 'index.js'),
  },
  // Jest ignores node_modules for transform by default; carve out an
  // exception so the mapped @middy entry files above still go through babel.
  transformIgnorePatterns: ['node_modules/(?!(@middy)/)'],
};
