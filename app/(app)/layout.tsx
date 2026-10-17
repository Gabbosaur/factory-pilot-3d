import type { ReactNode } from 'react';
import { AppShell } from '@/modules/shell/AppShell';

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
