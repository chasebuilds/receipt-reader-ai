import { defineConfig } from "@playwright/test";

const live = process.env.BASE_URL;
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  expect: { timeout: 240_000 },
  use: { baseURL: live ?? "http://localhost:4319/", viewport: { width: 1280, height: 900 } },
  webServer: live ? undefined : { command: "node e2e/serve.mjs", url: "http://localhost:4319/", reuseExistingServer: false },
});
