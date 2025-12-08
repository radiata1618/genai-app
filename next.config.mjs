/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    async rewrites() {
        return [
            {
                // Exclude /api/auth/* from being rewritten to the backend (handled by Next.js)
                source: '/api/:path((?!auth).*)',
                destination: process.env.BACKEND_URL
                    ? `${process.env.BACKEND_URL}/api/:path*`
                    : 'http://localhost:8000/api/:path*',
            },
        ];
    },
};

export default nextConfig;