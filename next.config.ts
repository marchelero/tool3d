import type { NextConfig } from "next";

// En GitHub Pages el sitio se sirve bajo https://<usuario>.github.io/<repo>/,
// por lo que los assets necesitan el prefijo "/tool3d" y hay que generar un
// sitio estático (output: "export"). El workflow de Pages define GITHUB_PAGES=1.
// En local se mantiene la configuración normal (dev/build con cacheComponents).
const isGhPages = process.env.GITHUB_PAGES === "1";
const basePath = isGhPages ? "/tool3d" : "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // PPR (partialPrefetching/cacheComponents) no puede combinarse con export.
  ...(isGhPages
    ? { output: "export" as const }
    : { cacheComponents: true, partialPrefetching: true }),
};

export default nextConfig;
