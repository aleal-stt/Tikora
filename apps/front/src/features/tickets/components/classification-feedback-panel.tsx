import type {
  ClassificationFeedback,
  CreateClassificationFeedback,
  FeedbackVeredicto,
  Prioridad,
} from '@tikora/core';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
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
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api-client';
import { useAreas } from '../../admin/api/use-areas';
import { useUpsertClassificationFeedback } from '../api/use-feedback';

const VEREDICTO_OPTIONS: { value: FeedbackVeredicto; label: string; description: string }[] = [
  { value: 'correcta', label: 'Correcta', description: 'Área y prioridad están bien.' },
  {
    value: 'area_incorrecta',
    label: 'Área incorrecta',
    description: 'La prioridad estuvo bien, pero el área no.',
  },
  {
    value: 'prioridad_incorrecta',
    label: 'Prioridad incorrecta',
    description: 'El área estuvo bien, pero la prioridad no.',
  },
  {
    value: 'ambas_incorrectas',
    label: 'Ambas incorrectas',
    description: 'Tanto el área como la prioridad están mal.',
  },
];

const PRIORIDAD_OPTIONS: { value: Prioridad; label: string }[] = [
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' },
  { value: 'baja', label: 'Baja' },
];

/**
 * Panel para que AGE/LID/ADM marquen si la clasificación que hizo la IA
 * fue correcta. Si ya hay feedback, lo muestra como estado actual y
 * permite sobrescribirlo (back hace upsert por `{tenantId, ticketId}`).
 *
 * El feedback no cambia la clasificación ni el área del ticket — es
 * señal para el ciclo de mejora continua. Para reasignar el ticket se
 * usa el flujo existente de `PATCH /tickets/:id/area`.
 */
export function ClassificationFeedbackPanel({
  ticketId,
  existing,
}: {
  ticketId: string;
  existing: ClassificationFeedback | null;
}) {
  const [veredicto, setVeredicto] = useState<FeedbackVeredicto>(existing?.veredicto ?? 'correcta');
  const [areaCorrectaId, setAreaCorrectaId] = useState<string | null>(
    existing?.areaCorrectaId ?? null,
  );
  const [prioridadCorrecta, setPrioridadCorrecta] = useState<Prioridad | null>(
    existing?.prioridadCorrecta ?? null,
  );
  const [comentario, setComentario] = useState<string>(existing?.comentario ?? '');

  // El back capa `limit` a 100 (MAX_PAGE_SIZE).
  const areasQuery = useAreas({ limit: 100 });
  const upsert = useUpsertClassificationFeedback();

  const requiresArea = veredicto === 'area_incorrecta' || veredicto === 'ambas_incorrectas';
  const requiresPrioridad =
    veredicto === 'prioridad_incorrecta' || veredicto === 'ambas_incorrectas';
  const canSubmit =
    !upsert.isPending &&
    (!requiresArea || Boolean(areaCorrectaId)) &&
    (!requiresPrioridad || Boolean(prioridadCorrecta));

  async function onSubmit() {
    const payload: CreateClassificationFeedback = {
      veredicto,
      areaCorrectaId: requiresArea ? areaCorrectaId : null,
      prioridadCorrecta: requiresPrioridad ? prioridadCorrecta : null,
      comentario: comentario.trim() ? comentario.trim() : null,
    };
    try {
      await upsert.mutateAsync({ ticketId, input: payload });
      toast.success(existing ? 'Feedback actualizado.' : 'Feedback guardado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No pudimos guardar el feedback.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback de clasificación</CardTitle>
        <CardDescription>
          ¿La IA acertó con el área y la prioridad? Tu respuesta alimenta el ciclo de mejora; no
          reasigna el ticket por sí sola.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Veredicto
          </label>
          <Select value={veredicto} onValueChange={(v) => setVeredicto(v as FeedbackVeredicto)}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VEREDICTO_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            {VEREDICTO_OPTIONS.find((o) => o.value === veredicto)?.description}
          </p>
        </div>

        {requiresArea && (
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Área correcta
            </label>
            <Select value={areaCorrectaId ?? undefined} onValueChange={(v) => setAreaCorrectaId(v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Elegí el área que correspondía" />
              </SelectTrigger>
              <SelectContent>
                {(areasQuery.data?.items ?? [])
                  .filter((a) => a.active)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {requiresPrioridad && (
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Prioridad correcta
            </label>
            <Select
              value={prioridadCorrecta ?? undefined}
              onValueChange={(v) => setPrioridadCorrecta(v as Prioridad)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Elegí la prioridad que correspondía" />
              </SelectTrigger>
              <SelectContent>
                {PRIORIDAD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Comentario (opcional)
          </label>
          <Textarea
            rows={2}
            maxLength={1000}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Notas adicionales para el equipo de IA…"
          />
        </div>

        <div className="flex justify-end">
          <Button size="sm" disabled={!canSubmit} onClick={onSubmit}>
            {upsert.isPending ? 'Guardando…' : existing ? 'Actualizar feedback' : 'Enviar feedback'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
