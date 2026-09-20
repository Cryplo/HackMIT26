import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.RECONCILIATION_DEV_ORIGINS || "")
  .split(",")
  .map(entry => entry.trim())
  .filter(Boolean);

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};
export default config;
