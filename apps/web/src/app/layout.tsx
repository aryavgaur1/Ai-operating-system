import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexora OS',
  description: 'Nexora OS is an active intelligence layer across Slack, Jira, Gmail, Salesforce and Notion.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body min-h-screen bg-bg text-white overflow-x-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[10%] top-[-10%] h-[420px] w-[420px] rounded-full bg-accent/10 blur-3xl" />
          <div className="absolute right-[5%] top-[20%] h-[520px] w-[520px] rounded-full bg-accent2/10 blur-3xl" />
          <div className="absolute left-1/2 top-[40%] h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-[#6f7bf0]/5 blur-3xl" />
        </div>
        <Nav />
        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
