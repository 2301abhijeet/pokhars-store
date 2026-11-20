import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Firebase's redirect helper is served on the same origin as the storefront.
  // This avoids third-party storage restrictions in Chrome and other browsers.
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://pokhars-store.firebaseapp.com/__/auth/:path*",
      },
    ];
  },
};

export default nextConfig;
