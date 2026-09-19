import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 60000,
  reporter: "list",
  webServer: {
    command:
      "python3 -m http.server 8768 --bind 127.0.0.1 --directory ../hackmit26/server",
    url: "http://127.0.0.1:8768/fixture.html",
    reuseExistingServer: false,
  },
  use: { trace: "retain-on-failure" },
});
