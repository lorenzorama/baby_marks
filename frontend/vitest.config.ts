import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", setupFiles: ["./src/test/setup.ts"], hookTimeout: 30000, testTimeout: 30000 },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
