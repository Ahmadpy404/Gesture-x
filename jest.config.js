/**
 * @fileoverview Jest configuration for Gesture X unit tests.
 *
 * Runs ES module tests via Node's experimental VM modules.
 * Module aliases map internal shared imports to lightweight stubs.
 *
 * Run: npm test
 */

export default {
  testEnvironment: 'node',
  transform: {},                      // No transform — pass ESM directly
  testMatch: ['**/tests/unit/**/*.test.js'],
  // Map chrome-dependent shared modules to stubs
  moduleNameMapper: {
    '^../../shared/Logger\\.js$':     '<rootDir>/tests/__mocks__/Logger.js',
    '^../shared/Logger\\.js$':        '<rootDir>/tests/__mocks__/Logger.js',
    '^../../shared/MessageBus\\.js$': '<rootDir>/tests/__mocks__/MessageBus.js',
    '^../shared/MessageBus\\.js$':    '<rootDir>/tests/__mocks__/MessageBus.js',
    '^../../shared/ErrorHandler\\.js$':'<rootDir>/tests/__mocks__/ErrorHandler.js',
    '^../shared/ErrorHandler\\.js$':  '<rootDir>/tests/__mocks__/ErrorHandler.js',
  },
  // Coverage thresholds for core logic modules
  coverageThreshold: {
    global: { lines: 70, functions: 70, branches: 60 },
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/src/assets/',
    '/src/popup/',
    '/src/settings/',
    '/src/offscreen/camera/',
    '/src/offscreen/gesture/GestureEngine\\.js',
  ],
};
