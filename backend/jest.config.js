/* eslint-disable @typescript-eslint/no-require-imports */
const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;


module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(nanoid)/)",
  ],
  moduleNameMapper: {
    "^@/app/api/(.*)$": "<rootDir>/src/api/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@prisma/client$": "<rootDir>/src/lib/prisma-client-mock.ts",
  },
  modulePathIgnorePatterns: [
    "<rootDir>/dist/",
  ],
};
