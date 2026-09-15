'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { breakevenCostPerDelivered } from '@/lib/profit-engine';
import { formatMoney, formatNumber } from '@/lib/format';

export interface ProductView {
  id: string;
  name: string;
  sku: string;
  cogsUnitPrice: number;
  batchQuantity: number;
  productionLeadTimeDays: number;
  sellingPrice: number;
  deadStockUnits: number;
  orderCount: number;
  campaignCount: number;
  rates: {
    confirmationFee: number;
    deliveryFee: number;
    returnFee: number;
    codGatewayFeePercent: number;
  };
}

type Draft = Omit<ProductView, 'id' | 'orderCount' | 'campaignCount'>;

const EMPTY_DRAFT: Draft = {
  name: '',
  sku: '',
  cogsUnitPrice: 0,
  batchQuantity: 0,
  productionLeadTimeDays: 0,
  sellingPrice: 0,
  deadStockUnits: 0,
  rates: { confirmationFee: 0, deliveryFee: 0, returnFee: 0, codGatewayFeePercent: 0 },
};

export function ProductManager({ initialProducts }: { initialProducts: ProductView[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startCreate = () => {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const startEdit = (product: ProductView) => {
    setEditingId(product.id);
    setError(null);
    setDraft({
      name: product.name,
      sku: product.sku,
      cogsUnitPrice: product.cogsUnitPrice,
      batchQuantity: product.batchQuantity,
      productionLeadTimeDays: product.productionLeadTimeDays,
      sellingPrice: product.sellingPrice,
      deadStockUnits: product.deadStockUnits,
      rates: { ...product.rates },
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name: draft.name,
      sku: draft.sku,
      cogsUnitPrice: draft.cogsUnitPrice,
      batchQuantity: draft.batchQuantity,
      productionLeadTimeDays: draft.productionLeadTimeDays,
      sellingPrice: draft.sellingPrice,
      deadStockUnits: draft.deadStockUnits,
      fulfillmentRates: draft.rates,
    };

    const response = await fetch(
      editingId === 'new' ? '/api/products' : `/api/products/${editingId}`,
      {
        method: editingId === 'new' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    ).catch(() => null);

    if (!response || !response.ok) {
      const body = await response?.json().catch(() => null);
      setError(body?.error ?? 'Save failed.');
      setBusy(false);
      return;
    }

    setBusy(false);
    setEditingId(null);
    router.refresh();
  };

  const remove = async (product: ProductView) => {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    setBusy(true);
    const response = await fetch(`/api/products/${product.id}`, { method: 'DELETE' }).catch(() => null);
    if (!response || !response.ok) {
      const body = await response?.json().catch(() => null);
      setError(body?.error ?? 'Delete failed.');
    }
    setBusy(false);
    router.refresh();
  };

  const numberField = (
    label: string,
    key: keyof Omit<Draft, 'rates' | 'name' | 'sku'>,
    step = '0.01',
  ) => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        min="0"
        required
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
        className="input mt-1"
      />
    </div>
  );

  const rateField = (label: string, key: keyof Draft['rates'], step = '0.01') => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step={step}
        min="0"
        value={draft.rates[key]}
        onChange={(event) => setDraft({ ...draft, rates: { ...draft.rates, [key]: Number(event.target.value) } })}
        className="input mt-1"
      />
    </div>
  );

  const draftBreakeven = breakevenCostPerDelivered({
    cogsUnitPrice: draft.cogsUnitPrice,
    sellingPrice: draft.sellingPrice,
    rates: draft.rates,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={startCreate} className="btn-primary">
          Add product
        </button>
      </div>

      {editingId ? (
        <form onSubmit={save} className="panel space-y-4">
          <h2 className="text-sm font-semibold text-slate-100">
            {editingId === 'new' ? 'New product' : 'Edit product'}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Name</label>
              <input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="input mt-1"
              />
            </div>
            <div>
              <label className="label">SKU</label>
              <input
                required
                value={draft.sku}
                onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                className="input mt-1"
              />
              <p className="mt-1 text-xs text-muted">Must match the Shopify line-item SKU.</p>
            </div>
            {numberField('Selling price', 'sellingPrice')}
            {numberField('COGS per unit', 'cogsUnitPrice')}
            {numberField('Batch quantity', 'batchQuantity', '1')}
            {numberField('Production lead time (days)', 'productionLeadTimeDays', '1')}
            {numberField('Dead stock units', 'deadStockUnits', '1')}
          </div>

          <div>
            <h3 className="label">MDM Express fulfilment rates</h3>
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {rateField('Confirmation fee', 'confirmationFee')}
              {rateField('Delivery fee', 'deliveryFee')}
              {rateField('Return fee', 'returnFee')}
              {rateField('COD gateway fee (%)', 'codGatewayFeePercent', '0.1')}
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-ink/60 px-4 py-3 text-sm">
            <span className="text-muted">Breakeven cost per delivered order at these inputs: </span>
            <span className={draftBreakeven > 0 ? 'font-semibold text-profit' : 'font-semibold text-loss'}>
              {formatMoney(draftBreakeven)}
            </span>
            <p className="mt-1 text-xs text-muted">
              Spend more than this to acquire one delivered order and the product loses money.
            </p>
          </div>

          {error ? <p className="text-sm text-loss">{error}</p> : null}

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Save product'}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="panel overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-edge">
              <th className="table-head">Product</th>
              <th className="table-head">Price</th>
              <th className="table-head">COGS</th>
              <th className="table-head">Fees (conf/del/ret)</th>
              <th className="table-head">COD %</th>
              <th className="table-head">Breakeven CPD</th>
              <th className="table-head">Batch</th>
              <th className="table-head">Lead time</th>
              <th className="table-head">Orders</th>
              <th className="table-head" />
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {initialProducts.map((product) => {
              const breakeven = breakevenCostPerDelivered({
                cogsUnitPrice: product.cogsUnitPrice,
                sellingPrice: product.sellingPrice,
                rates: product.rates,
              });
              return (
                <tr key={product.id} className="hover:bg-ink/40">
                  <td className="table-cell">
                    <span className="font-medium text-slate-100">{product.name}</span>
                    <span className="ml-2 text-xs text-muted">{product.sku}</span>
                  </td>
                  <td className="table-cell tabular-nums">{formatMoney(product.sellingPrice)}</td>
                  <td className="table-cell tabular-nums">{formatMoney(product.cogsUnitPrice)}</td>
                  <td className="table-cell tabular-nums text-muted">
                    {product.rates.confirmationFee} / {product.rates.deliveryFee} / {product.rates.returnFee}
                  </td>
                  <td className="table-cell tabular-nums text-muted">{product.rates.codGatewayFeePercent}%</td>
                  <td className={`table-cell font-semibold tabular-nums ${breakeven > 0 ? 'text-profit' : 'text-loss'}`}>
                    {formatMoney(breakeven)}
                  </td>
                  <td className="table-cell tabular-nums">{formatNumber(product.batchQuantity)}</td>
                  <td className="table-cell tabular-nums">{product.productionLeadTimeDays}d</td>
                  <td className="table-cell tabular-nums">{formatNumber(product.orderCount)}</td>
                  <td className="table-cell text-right">
                    <button type="button" onClick={() => startEdit(product)} className="text-xs text-accent hover:underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(product)}
                      disabled={busy}
                      className="ml-3 text-xs text-loss hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {initialProducts.length === 0 ? (
              <tr>
                <td colSpan={10} className="table-cell text-center text-muted">
                  No products yet. Add the product you are running ads for.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
