import type { AreaMetricsResponse } from '@tikora/core';
import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { useAuthStore } from '../../../stores/auth.store';
import { useAreas } from '../api/use-areas';
import { useAreaMetrics } from '../api/use-metrics';
import { AiMetricsSection } from '../components/ai-metrics-section';

const RANGE_OPTIONS = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
] as const;

const ESTADO_LABELS: Record<keyof AreaMetricsResponse['tickets']['byEstado'], string> = {
  recibido: 'Recibidos',
  clasificado: 'Clasificados',
  requiere_revision_clasificacion: 'Revisión',
  escalado: 'Escalados',
  en_progreso: 'En progreso',
  cerrado: 'Cerrados',
  reabierto: 'Reabiertos',
  cancelado: 'Cancelados',
};

const PRIORIDAD_LABELS: Record<keyof AreaMetricsResponse['tickets']['byPrioridad'], string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

/**
 * Dashboard de métricas para LID/ADM. El back ya filtra el scope por
 * permiso (un líder solo ve áreas que lidera), así que acá usamos los
 * `areaIds` del usuario para acotar el selector cuando es líder y
 * dejamos todas las áreas activas cuando es admin.
 */
export function MetricasPage() {
  const role = useAuthStore((s) => s.user?.role);
  const myAreaIds = useAuthStore((s) => s.user?.areaIds ?? []);

  // El back capa `limit` a 100 (MAX_PAGE_SIZE). Si en el futuro hay más
  // áreas que eso, paginar; por ahora un solo fetch alcanza.
  const areasQuery = useAreas({ limit: 100 });

  const visibleAreas = useMemo(() => {
    const all = areasQuery.data?.items ?? [];
    if (role === 'admin') return all.filter((a) => a.active);
    if (role === 'lider') return all.filter((a) => a.active && myAreaIds.includes(a.id));
    return [];
  }, [areasQuery.data, role, myAreaIds]);

  const [areaId, setAreaId] = useState<string | undefined>(undefined);
  const [rangeDays, setRangeDays] = useState<'7' | '30' | '90'>('30');

  // Auto-seleccionar la primera área disponible cuando llega el listado.
  const effectiveAreaId = areaId ?? visibleAreas[0]?.id;

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(rangeDays) * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangeDays]);

  const metricsQuery = useAreaMetrics(effectiveAreaId, range);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Métricas</h1>
          <p className="text-sm text-slate-500">Volumen, SLA y tiempos de resolución por área.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Elegí un área y rango temporal.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                Área
              </label>
              {areasQuery.isLoading ? (
                <Skeleton className="mt-1 h-9 w-full" />
              ) : visibleAreas.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No hay áreas visibles para tu rol.</p>
              ) : (
                <Select value={effectiveAreaId} onValueChange={(v) => setAreaId(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccioná un área" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleAreas.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="w-full sm:w-56">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                Rango
              </label>
              <Select value={rangeDays} onValueChange={(v) => setRangeDays(v as '7' | '30' | '90')}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {effectiveAreaId && (
        <MetricsView
          loading={metricsQuery.isLoading}
          error={metricsQuery.isError}
          data={metricsQuery.data}
        />
      )}

      {/* Métricas de IA — sólo admin. El back rechaza si no es admin, pero
          además evitamos montarlo para no disparar la query con un 403. */}
      {role === 'admin' && <AiMetricsSection range={range} />}
    </div>
  );
}

function MetricsView({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: boolean;
  data: AreaMetricsResponse | undefined;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-sm text-red-600">No pudimos cargar las métricas del área.</p>;
  }

  const slaPct =
    data.sla.complianceRate === null ? null : Math.round(data.sla.complianceRate * 100);
  const avgHours =
    data.avgResolutionHours === null ? null : Math.round(data.avgResolutionHours * 10) / 10;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title="Tickets en rango"
          value={data.tickets.total.toString()}
          subtitle={`${data.tickets.byEstado.cerrado} cerrados`}
        />
        <KpiCard
          title="Cumplimiento SLA"
          value={slaPct === null ? '—' : `${slaPct}%`}
          subtitle={
            data.sla.complianceRate === null
              ? 'Sin tickets cerrados con SLA'
              : `${data.sla.breachedTotal} fuera de plazo`
          }
          tone={slaPct !== null && slaPct < 80 ? 'warning' : 'default'}
        />
        <KpiCard
          title="Tiempo medio de resolución"
          value={avgHours === null ? '—' : `${avgHours} h`}
          subtitle={
            avgHours === null ? 'Sin tickets cerrados en el rango' : 'Sobre tickets cerrados'
          }
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Por estado</CardTitle>
            <CardDescription>Distribución de los tickets del rango.</CardDescription>
          </CardHeader>
          <CardContent>
            <BucketTable
              labels={ESTADO_LABELS}
              counts={data.tickets.byEstado}
              total={data.tickets.total}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por prioridad</CardTitle>
            <CardDescription>Tickets clasificados con prioridad asignada.</CardDescription>
          </CardHeader>
          <CardContent>
            <BucketTable
              labels={PRIORIDAD_LABELS}
              counts={data.tickets.byPrioridad}
              total={
                data.tickets.byPrioridad.alta +
                data.tickets.byPrioridad.media +
                data.tickets.byPrioridad.baja
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>IA</CardTitle>
          <CardDescription>
            Calidad de la clasificación y tasa de aprobación de auto-respuesta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <AiKpi
              label="Precisión de clasificación"
              value={data.ai.classificationAccuracy}
              hint="Disponible cuando haya feedback humano sobre clasificaciones."
            />
            <AiKpi
              label="Aprobación de auto-respuesta"
              value={data.ai.autoResponseApprovalRate}
              hint="Disponible cuando se acumulen sugerencias resueltas."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  tone = 'default',
}: {
  title: string;
  value: string;
  subtitle: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle
          className={
            tone === 'warning' ? 'text-3xl tabular-nums text-amber-600' : 'text-3xl tabular-nums'
          }
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function BucketTable<K extends string>({
  labels,
  counts,
  total,
}: {
  labels: Record<K, string>;
  counts: Record<K, number>;
  total: number;
}) {
  const entries = (Object.keys(labels) as K[]).map((key) => ({
    key,
    label: labels[key],
    count: counts[key] ?? 0,
  }));

  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((e) => {
        const pct = total > 0 ? Math.round((e.count / total) * 100) : 0;
        return (
          <li key={e.key} className="flex items-center justify-between py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-slate-700">{e.label}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums text-slate-600">{e.count}</span>
              <span className="w-12 text-right text-xs tabular-nums text-slate-400">
                {total > 0 ? `${pct}%` : '—'}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AiKpi({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value === null ? '—' : `${Math.round(value * 100)}%`}
      </p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
