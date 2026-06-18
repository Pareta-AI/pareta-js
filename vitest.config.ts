import { defineConfig } from "vitest/config";

// Node env so the real fetch/Response/ReadableStream/Blob/FormData/AbortSignal
// globals back the tests (we inject a mock fetch, but build real Response objects).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
