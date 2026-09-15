'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatMoney } from '@/lib/format';

const CATEGORIES = ['AI Tool', 'Employee Payroll', 'Additional Fee', 'Software', 'Rent', 'Other'] as const;
const CYCLES = ['Daily', 'Weekly', 'Monthly', 'Yearly', 'One-time'] as const;

export interface ExpenseView {
  id: string;
  category: string;
  name: string;
  planDetails: string | null;
  amount: number;
  billingCycle: string;
  endedAt: string | null;
  dailyAmount: number;
}

export function ExpenseManager({ initialExpenses }: { initialExpenses: ExpenseView[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    category: CATEGORIES[0] as string,
    name: '',
    planDetails: '',
    amount: 0,
    billingCycle: 'Monthly' as string,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeExpenses = initialExpenses.filter((expense) => expense.endedAt === null);
  const dailyRunRate = activeExpenses.reduce((sum, expense) => sum + expense.dailyAmount, 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, planDetails: form.planDetails || null }),
    }).catch(() => null);

    if (!response || !response.ok) {
      const body = await response?.json().catch(() => null);
      setError(body?.error ?? 'Could not save the expense.');
      setBusy(false);
      return;
    }

    setForm({ ...form, name: '', planDetails: '', amount: 0 });
    setBusy(false);
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    router.refresh();
  };

  const stop = async (id: string) => {
    setBusy(true);
    await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel">
          <p className="label">Daily run rate</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(dailyRunRate)}</p>
        </div>
        <div className="panel">
          <p className="label">Monthly run rate</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(dailyRunRate * 30)}</p>
        </div>
        <div className="panel">
          <p className="label">Active expenses</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{activeExpenses.length}</p>
        </div>
      </div>

      <form onSubmit={submit} className="panel grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div>
          <label className="label">Category</label>
          <select
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            className="input mt-1"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="input mt-1"
            placeholder="Call centre agent"
          />
        </div>
        <div>
          <label className="label">Plan details</label>
          <input
            value={form.planDetails}
            onChange={(event) => setForm({ ...form, planDetails: event.target.value })}
            className="input mt-1"
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="label">Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            required
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
            className="input mt-1"
          />
        </div>
        <div>
          <label className="label">Billing cycle</label>
          <select
            value={form.billingCycle}
            onChange={(event) => setForm({ ...form, billingCycle: event.target.value })}
            className="input mt-1"
          >
            {CYCLES.map((cycle) => (
              <option key={cycle} value={cycle}>{cycle}</option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Add expense'}
        </button>
        {error ? <p className="text-sm text-loss lg:col-span-6">{error}</p> : null}
      </form>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-edge">
              <th className="table-head">Category</th>
              <th className="table-head">Name</th>
              <th className="table-head">Plan</th>
              <th className="table-head">Amount</th>
              <th className="table-head">Cycle</th>
              <th className="table-head">Per day</th>
              <th className="table-head">State</th>
              <th className="table-head" />
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {initialExpenses.map((expense) => (
              <tr key={expense.id} className="hover:bg-ink/40">
                <td className="table-cell text-muted">{expense.category}</td>
                <td className="table-cell font-medium text-slate-100">{expense.name}</td>
                <td className="table-cell text-muted">{expense.planDetails ?? '—'}</td>
                <td className="table-cell tabular-nums">{formatMoney(expense.amount)}</td>
                <td className="table-cell text-muted">{expense.billingCycle}</td>
                <td className="table-cell tabular-nums">{formatMoney(expense.dailyAmount)}</td>
                <td className="table-cell">
                  {expense.endedAt ? (
                    <span className="text-xs text-muted">Ended</span>
                  ) : (
                    <span className="text-xs text-profit">Active</span>
                  )}
                </td>
                <td className="table-cell text-right">
                  {expense.endedAt ? null : (
                    <button type="button" onClick={() => stop(expense.id)} disabled={busy} className="text-xs text-warn hover:underline">
                      End
                    </button>
                  )}
                  <button type="button" onClick={() => remove(expense.id)} disabled={busy} className="ml-3 text-xs text-loss hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {initialExpenses.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-cell text-center text-muted">
                  No operating expenses recorded. Payroll, tooling and platform fees belong here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
