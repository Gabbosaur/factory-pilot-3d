'use client';
/** Metrics page: measured impact of the copilot. */
import { MetricsPanel } from '@/modules/incidents/ui/MetricsPanel';

export default function MetricsPage() {
  return (
    <div className="mx-auto h-full max-w-3xl overflow-auto p-4" data-tour="metrics">
      <h1 className="mb-3 text-lg font-bold">Metrics</h1>
      <MetricsPanel />
    </div>
  );
}
