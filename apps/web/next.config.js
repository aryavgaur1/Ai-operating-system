/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/dashboard', destination: '/app/dashboard', permanent: true },
      { source: '/chat', destination: '/app/chat', permanent: true },
      { source: '/chat/:conversationId', destination: '/app/chat/:conversationId', permanent: true },
      { source: '/approvals', destination: '/app/approvals', permanent: true },
      { source: '/admin', destination: '/app/admin', permanent: true },
      { source: '/settings', destination: '/app/settings', permanent: true },
      { source: '/onboarding', destination: '/app/onboarding', permanent: true },
    ];
  },
};

module.exports = nextConfig;
