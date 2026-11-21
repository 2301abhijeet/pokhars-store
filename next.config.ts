import type { NextConfig } from "next";

const firebaseProjectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "pokhars-store";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Keep Firebase's redirect helper on the storefront origin while routing it
  // to the Firebase project configured for this deployment (staging or production).
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${firebaseProjectId}.firebaseapp.com/__/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
