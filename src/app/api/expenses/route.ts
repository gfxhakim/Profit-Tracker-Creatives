import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { dailyExpenseAmount } from '@/lib/profit-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES = ['AI Tool', 'Employee Payroll', 'Additional Fee', 'Software', 'Rent', 'Other'] as const;
const CYCLES = ['Daily', 'Weekly', 'Monthly', 'Yearly', 'One-time'] as const;

const expenseSchema = z.object({
  category: z.enum(CATEGORIES),
  name: z.string().min(1),
  planDetails: z.string().optional().nullable(),
  amount: z.number().min(0),
  billingCycle: z.enum(CYCLES),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional().nullable(),
});

export async function GET() {
  try {
    const expenses = await prisma.operationalExpense.findMany({ orderBy: { createdAt: 'desc' } });
    const monthlyRunRate = expenses
      .filter((expense) => expense.endedAt === null)
      .reduce((sum, expense) => sum + dailyExpenseAmount(expense.amount, expense.billingCycle, 30) * 30, 0);

    return ok({
      expenses,
      summary: {
        monthlyRunRate: Math.round(monthlyRunRate * 100) / 100,
        dailyRunRate: Math.round((monthlyRunRate / 30) * 100) / 100,
        activeCount: expenses.filter((expense) => expense.endedAt === null).length,
      },
      categories: CATEGORIES,
      billingCycles: CYCLES,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = expenseSchema.parse(await request.json());
    const expense = await prisma.operationalExpense.create({ data: body });
    return ok({ expense }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
