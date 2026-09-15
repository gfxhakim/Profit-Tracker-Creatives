import type { Metadata } from 'next';
import './globals.css';
import { getSession } from '@/lib/auth';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'COD Profit Tracker',
  description: 'Real-time COD unit economics and Meta creative winner attribution',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A missing NEXTAUTH_SECRET must not blank the whole app; the middleware
  // still guards every protected route.
  const session = await getSession().catch(() => null);

  return (
    <html lang="en">
      <body className="min-h-screen bg-ink">
        {session ? <Nav email={session.email} /> : null}
        <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
