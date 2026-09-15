import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession().catch(() => null);
  if (session) redirect('/');

  const { next } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-center text-xl font-semibold text-white">
        COD<span className="text-accent"> Profit Tracker</span>
      </h1>
      <p className="mt-2 text-center text-sm text-muted">Sign in to view live unit economics.</p>
      <div className="panel mt-6">
        <LoginForm next={next ?? '/'} />
      </div>
    </div>
  );
}
