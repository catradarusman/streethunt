const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development", // disable in dev to avoid caching issues
  runtimeCaching: [
    {
      // Cache Google Fonts
      urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts",
        expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
      },
    },
    {
      // Cache Leaflet tiles (OSM)
      urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org/,
      handler: "CacheFirst",
      options: {
        cacheName: "map-tiles",
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    {
      // Cache Supabase Storage avatars
      urlPattern: /^https:\/\/.*\.supabase\.co\/storage/,
      handler: "CacheFirst",
      options: {
        cacheName: "supabase-storage",
        expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      // Network-first for API calls
      urlPattern: /^https:\/\/.*\/api\//,
      handler: "NetworkFirst",
      options: {
        cacheName: "api-cache",
        expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow images from Supabase Storage
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/**",
      },
    ],
  },
};

module.exports = withPWA(nextConfig);
