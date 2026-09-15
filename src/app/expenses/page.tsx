import { prisma } from '@/lib/db';
import { safeLoad } from '@/lib/safe';
import { dailyExpenseAmount } from '@/lib/profit-engine';
import { ErrorPanel } from '@/components/ErrorPanel';
import { ExpenseManager } from './ExpenseManager';

export const dynamic = 'force-dynamic';

export default async function ExpensesPage() {
  const loaded = await safeLoad(() =>
    prisma.operationalExpense.findMany({ orderBy: [{ category: 'asc' }, { createdAt: 'desc' }] }),
  );

  if (!loaded.ok) return <ErrorPanel title="Could not load expenses" detail={loaded.error} />;

  const expenses = loaded.data.map((expense) => ({
    id: expense.id,
    category: expense.category,
    name: expense.name,
    planDetails: expense.planDetails,
    amount: expense.amount,
    billingCycle: expense.billingCycle,
    endedAt: expense.endedAt ? expense.endedAt.toISOString() : null,
    dailyAmount: dailyExpenseAmount(expense.amount, expense.billingCycle, 30),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Operational expenses</h1>
        <p className="mt-1 text-sm text-muted">
          Fixed costs are converted to a daily run rate and allocated across products and creatives by their
          share of collected revenue, so net profit reflects the whole business, not just ad maths.
        </p>
      </div>
      <ExpenseManager initialExpenses={expenses} />
    </div>
  );
}
