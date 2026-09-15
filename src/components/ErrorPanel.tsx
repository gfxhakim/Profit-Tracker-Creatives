export function ErrorPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel border-loss/40">
      <h2 className="text-base font-semibold text-loss">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{detail}</p>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel text-center">
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">{detail}</p>
    </div>
  );
}
