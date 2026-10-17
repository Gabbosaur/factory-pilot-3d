'use client';
/** Plant ▸ Line ▸ Cluster ▸ Machine navigation trail. */
import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-slate-400">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="text-slate-600">▸</span>}
          {c.href && i < items.length - 1 ? (
            <Link href={c.href} className="truncate hover:text-sky-300 hover:underline">
              {c.label}
            </Link>
          ) : (
            <span className="truncate font-semibold text-slate-200" aria-current={i === items.length - 1 ? 'page' : undefined}>
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
