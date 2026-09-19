import type { NextConfig } from "next";
const config: NextConfig = { turbopack: { root: process.cwd() }, distDir: process.env.NEXT_DIST_DIR || ".next" };
export default config;
