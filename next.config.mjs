/** @type {import('next').NextConfig} */
const isMobile = process.env.IS_MOBILE === 'true';

const nextConfig = {
    output: isMobile ? 'export' : 'standalone',
    images: {
        unoptimized: isMobile,
    },
    async rewrites() {
        if (isMobile) return [];
        return [
            {
                // Exclude /api/auth/* from being rewritten to the backend (handled by Next.js)
                source: '/api/:path((?!auth).*)',
                destination: process.env.BACKEND_URL
                    ? `${process.env.BACKEND_URL}/api/:path*`
                    : (process.env.IS_CLOUD_RUN === 'true'
                        ? 'https://genai-app-backend-yg7yzstuza-uc.a.run.app/api/:path*'
                        : 'http://localhost:8000/api/:path*'),
            },
        ];
    },
};

export default nextConfig;