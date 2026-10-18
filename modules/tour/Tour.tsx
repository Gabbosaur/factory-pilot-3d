'use client';
/**
 * Guided first-run tour. Pure DOM: highlights elements by their [data-tour] attribute with a
 * spotlight + tooltip, no external deps. Some steps wait for a real user action (await).
 * Starts automatically on first visit (localStorage), re-openable from the header button.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStore } from '@/modules/store';

const SEEN_KEY = 'fp.tour.seen.v2';

interface Step {
  target?: string; // data-tour value; undefined = centered modal
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Wait for this before enabling Next: a store predicate polled over time. */
  await?: () => boolean;
  awaitHint?: string;
  /** Fires as soon as the action starts (e.g. fault injected); moves the spotlight to revealTarget. Defaults to await. */
  reveal?: () => boolean;
  /** Once the action fires, move the spotlight here (e.g. to the map) so the result is visible. */
  revealTarget?: string;
  revealPlacement?: 'top' | 'bottom' | 'left' | 'right';
  revealTitle?: string;
  revealBody?: string;
  /** Keep the card in the bottom-right corner (e.g. when the target opens a menu the card would cover). */
  corner?: boolean;
  /** Navigate to this route before highlighting (so the target is on screen). */
  route?: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to FactoryPilot 3D',
    body: 'An AI copilot for production, quality and maintenance engineers. The plant is always producing; sensors, costs and history are simulated. This tour takes about two minutes.',
  },
  {
    target: 'plant',
    route: '/',
    title: 'Pick the plant',
    body: 'The plant selector is the global filter: every page shows the selected plant. Genova has two water lines, Imperia a juice line.',
    placement: 'bottom',
  },
  {
    target: 'kpis',
    route: '/',
    title: 'How is the plant doing?',
    body: 'Plant KPIs for this shift: OEE (availability × performance × quality), good bottles, first pass yield, downtime and its cost in euros.',
    placement: 'bottom',
  },
  {
    target: 'lines',
    route: '/',
    title: 'One card per line',
    body: 'Each line shows state, throughput, OEE and its bottleneck. Click a line to drill down to its clusters and machines.',
    placement: 'top',
  },
  {
    target: 'map',
    route: '/lines/L1',
    title: 'The line, live',
    body: 'A digital twin of the line: green is healthy, amber is an early warning, red is an alarm. Switch 3D / 2D, click a machine for its sensors, right-click for history, details and faults.',
    placement: 'left',
  },
  {
    target: 'inject',
    route: '/lines/L1',
    title: 'Simulate a fault',
    body: 'Open the menu and pick "L1 · Pump P1 bearing wear". Then watch FactoryPilot react.',
    placement: 'right',
    corner: true,
    // Continue as soon as a fault is injected: the warning builds up over the next seconds while you read.
    await: () => useStore.getState().arming.length > 0 || useStore.getState().activeFaultIds.length > 0 || Object.keys(useStore.getState().incidents).length > 0,
    awaitHint: 'Open "Simulate fault" and pick a fault to continue',
    revealTarget: 'map',
    revealPlacement: 'left',
    revealTitle: 'Watch it react',
    revealBody: 'Fault injected. In a few seconds the machine turns amber on a statistical early warning, before any limit is crossed, and an incident opens on the map. Press Next.',
  },
  {
    target: 'map',
    route: '/lines/L1',
    title: 'Root cause, manual page, decision',
    body: 'FactoryPilot walks the line upstream to the machine that caused it, diagnoses it citing the exact manual page, prices it in euros and either acts on its own (safe, reversible actions) or asks you to approve. Above the real limit only this line stops; a machine with a standby twin is bypassed automatically.',
    placement: 'left',
  },
  {
    target: 'ask',
    route: '/',
    title: 'Ask FactoryPilot',
    body: 'Ask anything about the plant: why OEE is low, what to look at first, how to replace a part. Answers use the live data, the manuals and past repairs, with sources marked ✓ when verified.',
    placement: 'bottom',
  },
  {
    target: 'recovery',
    route: '/',
    title: 'Win back lost output',
    body: 'When a line loses output, the Recovery planner agent compares options (repair now or later, boost the other line, overtime) with deterministic simulations and proposes a plan in bottles and euros for you to approve.',
    placement: 'top',
  },
  {
    target: 'holds',
    route: '/',
    title: 'Quality holds',
    body: 'Bottles made while a product characteristic was out of spec are quarantined. Photograph a few samples: the AI inspects each one and suggests release or scrap. A person decides.',
    placement: 'top',
  },
  {
    target: 'machine-tabs',
    route: '/machines/P1',
    title: 'Every machine in depth',
    body: 'Station KPIs on top, then tabs: Live (incidents, SPC and Cpk, condition and time to trip), History (48 h and past repairs), Configuration (thresholds and autonomy levels).',
    placement: 'bottom',
  },
  {
    target: 'replay',
    title: 'Live or replay',
    body: 'AI runs live on AMD Token Factory. Replay serves recorded answers, useful if the network is slow.',
    placement: 'bottom',
  },
  {
    title: 'Your turn',
    body: 'Try the other faults, "Simulate solved" to clear them, or "+ New plant" to build a line from a manual PDF and a sensor CSV. Replay this tour anytime from the Tour button.',
  },
];

const PAD = 8;

export function Tour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [canAdvance, setCanAdvance] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const raf = useRef<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const step = STEPS[i]!;

  // Navigate to the step's page before it highlights its target.
  useEffect(() => {
    if (open && step.route && pathname !== step.route) router.push(step.route);
  }, [open, i, step.route, pathname, router]);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-start on first visit; listen for the header "Tour" button (custom event).
  useEffect(() => {
    const start = () => {
      setI(0);
      setOpen(true);
    };
    let seen = '1';
    try {
      seen = localStorage.getItem(SEEN_KEY) ?? '';
    } catch {
      /* ignore */
    }
    if (!seen) {
      const t = setTimeout(start, 700); // let the 3D canvas mount first
      window.addEventListener('fp:start-tour', start);
      return () => {
        clearTimeout(t);
        window.removeEventListener('fp:start-tour', start);
      };
    }
    window.addEventListener('fp:start-tour', start);
    return () => window.removeEventListener('fp:start-tour', start);
  }, []);

  // After the action starts, spotlight the result (revealTarget) instead of the button.
  const done = revealed;
  const activeTarget = done && step.revealTarget ? step.revealTarget : step.target;
  const activePlacement = done && step.revealTarget ? (step.revealPlacement ?? step.placement) : step.placement;

  // Track the highlighted element's position (handles resize / layout changes).
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      if (!activeTarget) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${activeTarget}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    update();
    const id = window.setInterval(update, 400); // follow layout while the scene animates
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, i, activeTarget]);

  // Poll the step predicates: `await` gates Next, `reveal` (defaults to await) moves the spotlight.
  useEffect(() => {
    if (!open) return;
    if (!step.await) {
      setCanAdvance(true);
      setRevealed(false);
      return;
    }
    const revealFn = step.reveal ?? step.await;
    const sample = () => {
      setCanAdvance(step.await!());
      setRevealed(revealFn());
    };
    sample();
    const tick = () => {
      sample();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [open, i, step]);

  if (!open) return null;

  const last = i === STEPS.length - 1;
  const next = () => (last ? finish() : setI((n) => Math.min(STEPS.length - 1, n + 1)));
  const prev = () => setI((n) => Math.max(0, n - 1));

  // Tooltip placement: pick a side with enough room, then clamp fully inside the viewport.
  const tipW = 320;
  const tipH = 260; // generous estimate; used only for clamping
  let tipStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (step.corner && !(revealed && step.revealTarget)) {
    tipStyle = { right: 24, bottom: 24 };
  } else if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 14;
    const gap = 16; // keep off the screen edges
    const room = { left: rect.left, right: vw - rect.right, top: rect.top, bottom: vh - rect.bottom };
    let place = activePlacement ?? 'bottom';
    // Fall back to another side if the preferred one can't fit the card.
    if ((place === 'left' && room.left < tipW + m) || (place === 'right' && room.right < tipW + m)) {
      place = room.right >= room.left ? 'right' : 'left';
    }
    if ((place === 'left' && room.left < tipW + m) || (place === 'right' && room.right < tipW + m)) {
      place = room.bottom >= room.top ? 'bottom' : 'top';
    }
    if ((place === 'bottom' && room.bottom < tipH + m) || (place === 'top' && room.top < tipH + m)) {
      if (place === 'bottom' || place === 'top') place = room.bottom >= room.top ? 'bottom' : 'top';
    }

    let left: number;
    let top: number;
    if (place === 'left') {
      left = rect.left - m - tipW;
      top = rect.top;
    } else if (place === 'right') {
      left = rect.right + m;
      top = rect.top;
    } else if (place === 'top') {
      left = rect.left + rect.width / 2 - tipW / 2;
      top = rect.top - m - tipH;
    } else {
      left = rect.left + rect.width / 2 - tipW / 2;
      top = rect.bottom + m;
    }
    // Clamp fully inside the viewport.
    left = Math.min(Math.max(gap, left), vw - tipW - gap);
    top = Math.min(Math.max(gap, top), vh - tipH - gap);
    tipStyle = { left, top };
  }

  // Dim the page with 4 panels around the target so the highlighted element stays clickable.
  // pointer-events-auto: the panels block clicks everywhere EXCEPT the uncovered hole.
  // On action steps the dim is click-through too: menus opened by the highlighted button fall outside the hole.
  const dim = `${step.await ? 'pointer-events-none' : 'pointer-events-auto'} fixed bg-slate-950/55 transition-all duration-300`;
  const hole = rect ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;

  return (
    // Root is click-through; only the dim panels and the card capture clicks, so the hole stays live.
    <div className="pointer-events-none fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Product tour">
      {hole && step.corner && !(revealed && step.revealTarget) ? (
        // The highlighted button opens a menu: no dim, so the menu stays readable; only the ring shows the target.
        <div className="pointer-events-none fixed rounded-xl ring-2 ring-sky-400" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }} />
      ) : hole ? (
        <>
          <div className={dim} style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className={dim} style={{ left: 0, top: hole.top + hole.height, right: 0, bottom: 0 }} />
          <div className={dim} style={{ left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height }} />
          <div className={dim} style={{ left: hole.left + hole.width, top: hole.top, right: 0, height: hole.height }} />
          {/* ring around the hole (click-through) */}
          <div className="pointer-events-none fixed rounded-xl ring-2 ring-sky-400" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }} />
        </>
      ) : (
        <div className={`${dim} inset-0`} />
      )}

      {/* Tooltip card */}
      <div className="card pointer-events-auto absolute w-80 p-4 shadow-2xl" style={tipStyle}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
            Step {i + 1} / {STEPS.length}
          </span>
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-200">
            Skip
          </button>
        </div>
        <h3 className="text-base font-bold">{done && step.revealTarget ? (step.revealTitle ?? step.title) : step.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{done && step.revealTarget ? (step.revealBody ?? step.body) : step.body}</p>
        {step.await && !canAdvance && <p className="mt-2 animate-pulse text-xs font-medium text-amber-300">↑ {step.awaitHint}</p>}
        <div className="mt-3 flex items-center justify-between">
          <button type="button" onClick={prev} disabled={i === 0} className="btn-ghost disabled:opacity-30">
            ← Back
          </button>
          <div className="flex gap-1">
            {STEPS.map((_, n) => (
              <span key={n} className={`h-1.5 w-1.5 rounded-full ${n === i ? 'bg-sky-400' : 'bg-slate-600'}`} />
            ))}
          </div>
          <button type="button" onClick={next} disabled={!canAdvance} className="btn-primary disabled:opacity-40">
            {last ? 'Done' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fire from anywhere (e.g. the header button) to (re)start the tour. */
export function startTour() {
  window.dispatchEvent(new Event('fp:start-tour'));
}
