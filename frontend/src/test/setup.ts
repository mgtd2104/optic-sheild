import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Ensure each test starts with a clean DOM and clean localStorage,
// since AuthContext reads/writes localStorage directly.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
