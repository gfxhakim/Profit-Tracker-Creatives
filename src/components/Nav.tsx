'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useState } from 'react';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/creatives', label: 'Creatives' },
  { href: '/products', label: 'Products' },
  { href: '/orders', label: 'Orders' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/settings', label: 'Settings' },
];

export function Nav({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="border-b border-edge bg-panel/60 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white">
          COD<span className="text-accent"> Profit Tracker</span>
        </Link>
        <nav className="flex flex-1 flex-wrap gap-1">
          {LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-sm transition',
                  active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-slate-100',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {email ? (
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="hidden sm:inline">{email}</span>
            <button type="button" onClick={logout} disabled={busy} className="btn-ghost px-3 py-1 text-xs">
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
