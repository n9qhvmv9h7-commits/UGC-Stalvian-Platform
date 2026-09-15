import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Breaking News and Movers merged into Daily Scripts. Creators bookmark
  // these, and scripts get shared by link, so the old paths keep resolving.
  async redirects() {
    return [
      { source: "/breaking-news", destination: "/daily-scripts?type=breaking", permanent: false },
      { source: "/movers", destination: "/daily-scripts?type=movers", permanent: false },
    ];
  },
};

export default nextConfig;
