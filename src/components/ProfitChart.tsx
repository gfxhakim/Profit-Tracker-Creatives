'use client';

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyPoint } from '@/lib/reporting';
import { formatCompactMoney, formatMoney } from '@/lib/format';

const AXIS = { stroke: '#8ea0c4', fontSize: 11 };

export function ProfitChart({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) {
    return <p className="py-16 text-center text-sm text-muted">No activity in this period yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#4f8cff" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#233150" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: '#233150' }} tickFormatter={(value: string) => value.slice(5)} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={formatCompactMoney} width={48} />
        <Tooltip
          contentStyle={{ background: '#131a2e', border: '1px solid #233150', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#8ea0c4' }}
          formatter={(value: number, name: string) => [formatMoney(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8ea0c4' }} />
        <Area type="monotone" dataKey="revenue" name="Collected revenue" stroke="#4f8cff" fill="url(#revenueFill)" strokeWidth={2} />
        <Bar dataKey="spend" name="Ad spend" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={28} opacity={0.8} />
        <Line type="monotone" dataKey="netProfit" name="Net profit" stroke="#22c55e" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
