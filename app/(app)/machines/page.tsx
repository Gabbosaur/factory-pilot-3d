'use client';
/** Machines page: every machine grouped by type, with status summaries. */
import { MachinesByType } from '@/modules/monitoring/panels/MachinesByType';

export default function MachinesPage() {
  return (
    <div className="mx-auto h-full max-w-3xl overflow-auto p-4" data-tour="nav-machines">
      <h1 className="mb-3 text-lg font-bold">Machines</h1>
      <MachinesByType />
    </div>
  );
}
