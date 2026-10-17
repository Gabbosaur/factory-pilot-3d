'use client';
import { Component, type ReactNode } from 'react';

/** Req 5.8: if WebGL / the R3F scene fails, show a message; the text list stays available. */
export class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="flex h-full items-center justify-center p-6 text-center text-slate-300">
          The 3D map cannot be displayed in this browser. Use the machine list on the side.
        </div>
      );
    return this.props.children;
  }
}
