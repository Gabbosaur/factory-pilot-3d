'use client';
/** Settings page: autonomy levels per machine type and action. */
import { AutonomyEditor } from '@/modules/incidents/ui/AutonomyEditor';

export default function SettingsPage() {
  return (
    <div className="mx-auto h-full max-w-3xl overflow-auto p-4">
      <h1 className="mb-3 text-lg font-bold">Settings</h1>
      <AutonomyEditor />
    </div>
  );
}
