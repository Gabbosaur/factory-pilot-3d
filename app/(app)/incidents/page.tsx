'use client';
/** Incidents page: compact list, click a row for full detail. */
import { IncidentPanel } from '@/modules/incidents/ui/IncidentPanel';

export default function IncidentsPage() {
  return (
    <div className="mx-auto h-full max-w-3xl overflow-auto p-4" data-tour="incidents">
      <h1 className="mb-3 text-lg font-bold">Incidents</h1>
      <IncidentPanel />
    </div>
  );
}
