import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexora OS — AI Operating System for Gmail, Slack, Notion & Jira',
  description:
    'Nexora OS is an AI Operating System that connects Gmail, Slack, Notion, and Jira. Search email, send messages, and run approved team actions from one workspace.',
  verification: {
    google: 'BhLKa_C6zSqokDt3bsGkxHFTcEvQrDaFOct-2iEiZfo',
  },
  icons: {
    icon: [{ url: '/favicon.png', type: 'image/png' }],
    apple: [{ url: '/favicon.png' }],
    shortcut: ['/favicon.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body min-h-screen bg-bg text-white antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
