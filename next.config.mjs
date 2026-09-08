/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/ai-engineer-career.html' }],
    }
  },
}

export default nextConfig
