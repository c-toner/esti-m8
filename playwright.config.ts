import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite --config vite.browser.config.ts",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: "list",
});
