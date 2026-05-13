import type {
  AiMetricsByModelRow,
  AiMetricsByPurposeRow,
  AiMetricsQuery,
  AiMetricsResponse,
} from '@tikora/core';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { useAdminAiMetrics } from '../api/use-admin-ai-metrics';

/**
 * Sección de métricas de uso de IA. Solo se monta cuando el rol es admin
 * (la responsabilidad de filtrar por rol vive en el caller). El back hace
 * doble check con `@Roles('admin')`.
 */
export function AiMetricsSection({ range }: { range: AiMetricsQuery }) {
  const query = useAdminAiMetrics(range);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uso de IA</CardTitle>
        <CardDescription>
          Llamadas, tokens y costo estimado del LLM en el rango seleccionado. Los costos en USD se
          calculan con la tabla de precios local; no representan facturación real (free-tiers y
          créditos no aplicados).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <AiMetricsSkeleton />
        ) : query.isError || !query.data ? (
          <p className="text-sm text-red-600">No pudimos cargar las métricas de IA.</p>
        ) : (
          <AiMetricsContent data={query.data} />
        )}
      </CardContent>
    </Card>
  );
}

function AiMetricsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function AiMetricsContent({ data }: { data: AiMetricsResponse }) {
  const hasCalls = data.totals.calls > 0;
  return (
    <div className="flex flex-col gap-6">
      <TotalsRow data={data} />
      {!hasCalls ? (
        <p className="text-sm text-slate-500">Sin llamadas registradas en el rango.</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PurposeTable rows={data.byPurpose} />
            <OutcomeTable counts={data.byOutcome} />
          </div>
          <ModelTable rows={data.byModel} />
          <TimelineChart data={data} />
        </>
      )}
    </div>
  );
}

function TotalsRow({ data }: { data: AiMetricsResponse }) {
  const totals = data.totals;
  const totalTokens = totals.tokens.input + totals.tokens.inputCached + totals.tokens.output;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MiniKpi
        label="Llamadas"
        value={formatNumber(totals.calls)}
        hint={`${totals.retries} retries`}
      />
      <MiniKpi
        label="Tokens"
        value={formatNumber(totalTokens)}
        hint={`${formatNumber(totals.tokens.input)} in · ${formatNumber(
          totals.tokens.inputCached,
        )} cached · ${formatNumber(totals.tokens.output)} out`}
      />
      <MiniKpi
        label="Costo estimado"
        value={formatUsd(totals.costUsd)}
        hint="USD a precio de tier pago"
      />
      <MiniKpi
        label="Latencia"
        value={formatLatency(totals.latency.avgMs)}
        hint={totals.latency.p95Ms === null ? '—' : `p95 ${formatLatency(totals.latency.p95Ms)}`}
      />
    </div>
  );
}

function PurposeTable({ rows }: { rows: AiMetricsByPurposeRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Por propósito</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-1.5">Propósito</th>
              <th className="py-1.5 text-right">Llamadas</th>
              <th className="py-1.5 text-right">Tokens</th>
              <th className="py-1.5 text-right">Costo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const tokens = row.tokens.input + row.tokens.inputCached + row.tokens.output;
              return (
                <tr key={row.purpose}>
                  <td className="py-1.5 text-slate-700">{PURPOSE_LABELS[row.purpose]}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {formatNumber(row.calls)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {formatNumber(tokens)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">
                    {formatUsd(row.costUsd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function OutcomeTable({ counts }: { counts: AiMetricsResponse['byOutcome'] }) {
  const total = counts.ok + counts.validation_failure + counts.api_error;
  const successPct = total > 0 ? Math.round((counts.ok / total) * 100) : 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Resultado</CardTitle>
        <CardDescription>
          Tasa de éxito {total > 0 ? `${successPct}%` : '—'} sobre {formatNumber(total)} llamadas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100 text-sm">
          <OutcomeRow label="OK" value={counts.ok} total={total} tone="ok" />
          <OutcomeRow
            label="Validación fallida"
            value={counts.validation_failure}
            total={total}
            tone="warn"
          />
          <OutcomeRow label="Error de API" value={counts.api_error} total={total} tone="err" />
        </ul>
      </CardContent>
    </Card>
  );
}

function OutcomeRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: 'ok' | 'warn' | 'err';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const dotColor =
    tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <li className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-slate-700">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        {label}
      </span>
      <span className="flex items-center gap-3">
        <span className="tabular-nums text-slate-700">{formatNumber(value)}</span>
        <span className="w-10 text-right text-xs tabular-nums text-slate-400">
          {total > 0 ? `${pct}%` : '—'}
        </span>
      </span>
    </li>
  );
}

function ModelTable({ rows }: { rows: AiMetricsByModelRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Por modelo</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-1.5">Modelo</th>
              <th className="py-1.5 text-right">Llamadas</th>
              <th className="py-1.5 text-right">Input</th>
              <th className="py-1.5 text-right">Cached</th>
              <th className="py-1.5 text-right">Output</th>
              <th className="py-1.5 text-right">Costo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.modelo}>
                <td className="py-1.5 text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{row.modelo}</span>
                    {!row.pricingKnown && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                        sin pricing
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {formatNumber(row.calls)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {formatNumber(row.tokens.input)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {formatNumber(row.tokens.inputCached)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {formatNumber(row.tokens.output)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {row.pricingKnown ? formatUsd(row.costUsd) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function TimelineChart({ data }: { data: AiMetricsResponse }) {
  // Recharts no rellena días vacíos del rango. Si solo hay 1-2 puntos el bar
  // chart queda apretado pero se entiende. Si se vuelve un caso frecuente,
  // hidratar el rango en el back o acá con días con valor 0.
  const chartData = useMemo(
    () =>
      data.timeline.map((p) => ({
        date: p.date.slice(5), // 'MM-DD' para que el eje no sea ancho
        Llamadas: p.calls,
        Tokens: p.tokens.input + p.tokens.inputCached + p.tokens.output,
      })),
    [data.timeline],
  );

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Evolución diaria</CardTitle>
        <CardDescription>Llamadas por día en el rango (UTC).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
                formatter={(value) => formatNumber(Number(value))}
              />
              <Bar dataKey="Llamadas" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniKpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

// -------- formatters --------

const numberFormatter = new Intl.NumberFormat('es-AR');
function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

const PURPOSE_LABELS: Record<AiMetricsByPurposeRow['purpose'], string> = {
  classification: 'Clasificación',
  'auto-response': 'Auto-respuesta',
  review: 'Revisión',
};
