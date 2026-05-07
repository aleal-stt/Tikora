import { cn } from '../../../lib/utils';

interface SlaIndicatorProps {
  /** ISO-8601 deadline. Si es null, no se muestra. */
  deadline: string | null;
  /** Tiempo de referencia para tests (default `Date.now()`). */
  now?: number;
  className?: string;
}

interface SlaState {
  color: 'emerald' | 'amber' | 'red';
  label: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buildState(deadlineMs: number, nowMs: number): SlaState {
  const remaining = deadlineMs - nowMs;
  if (remaining <= 0) {
    return { color: 'red', label: `Vencido ${formatDelta(-remaining)} atrás` };
  }

  // Sin saber el SLA total exacto, aproximamos los thresholds usando
  // la magnitud del tiempo restante en horas: < 6h = rojo (urgente),
  // < 24h = amarillo, ≥ 24h = verde. Es un heurístico simple para
  // dar señal visual sin requerir el `slaHoursTotal` del área.
  if (remaining < 6 * HOUR) return { color: 'red', label: formatDelta(remaining) };
  if (remaining < DAY) return { color: 'amber', label: formatDelta(remaining) };
  return { color: 'emerald', label: formatDelta(remaining) };
}

function formatDelta(ms: number): string {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / HOUR);
  const minutes = Math.floor((abs % HOUR) / (60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const dotColorClass: Record<SlaState['color'], string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

const textColorClass: Record<SlaState['color'], string> = {
  emerald: 'text-slate-700',
  amber: 'text-amber-700',
  red: 'text-red-700',
};

/**
 * Semáforo de SLA: punto coloreado + etiqueta con tiempo restante.
 * Sin auto-tick por ahora — el componente calcula al mount con el
 * `now` provisto (default `Date.now()`). El refresh real llega cuando
 * se invalidan las queries de la bandeja vía SSE.
 */
export function SlaIndicator({ deadline, now, className }: SlaIndicatorProps) {
  if (!deadline) {
    return <span className={cn('text-xs text-slate-400', className)}>—</span>;
  }
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) {
    return <span className={cn('text-xs text-slate-400', className)}>—</span>;
  }
  const state = buildState(deadlineMs, now ?? Date.now());

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        textColorClass[state.color],
        className,
      )}
      title={new Date(deadlineMs).toLocaleString()}
    >
      <span className={cn('h-2 w-2 rounded-full', dotColorClass[state.color])} />
      {state.label}
    </span>
  );
}
