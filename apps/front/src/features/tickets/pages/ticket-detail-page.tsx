import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';
import { useTicketAiResponse } from '../api/use-ai-responses';
import {
  useAddInteraction,
  useCancelTicket,
  useInteractions,
  useReopenTicket,
  useResolveTicket,
  useTakeTicket,
  useTicket,
} from '../api/use-tickets';
import { AiSuggestionPanel } from '../components/ai-suggestion-panel';
import { EstadoBadge } from '../components/estado-badge';
import { PrioridadBadge } from '../components/prioridad-badge';
import { SlaIndicator } from '../components/sla-indicator';

const PRE_TAKEN_STATES = new Set([
  'recibido',
  'clasificado',
  'requiere_revision_clasificacion',
  'escalado',
]);

export function TicketDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const ticketQ = useTicket(id);
  const interactionsQ = useInteractions(id);
  const aiResponseQ = useTicketAiResponse(id);
  const me = useAuthStore((s) => s.user);

  if (ticketQ.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (ticketQ.isError || !ticketQ.data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-red-600">
          No pudimos cargar el ticket: {(ticketQ.error as Error)?.message}
        </CardContent>
      </Card>
    );
  }

  const ticket = ticketQ.data;
  const isOwner = me?.id === ticket.requesterId;
  const isAdmin = me?.role === 'admin';
  const operatesOnArea = isAdmin || (ticket.areaId && me?.areaIds.includes(ticket.areaId)) || false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-700">{ticket.shortCode}</span>
            <span>·</span>
            <span>
              creado hace {formatDistanceToNow(new Date(ticket.createdAt), { locale: es })}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{ticket.asunto}</h1>
        </div>
        <div className="flex items-center gap-2">
          <PrioridadBadge prioridad={ticket.prioridad} />
          <EstadoBadge estado={ticket.estado} />
          <SlaIndicator deadline={ticket.slaDeadline} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Descripción</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{ticket.cuerpo}</p>
        </CardContent>
      </Card>

      {aiResponseQ.data && aiResponseQ.data.estado === 'sugerida' && (
        <AiSuggestionPanel
          ticketId={ticket.id}
          aiResponse={aiResponseQ.data}
          canAct={operatesOnArea}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Conversación</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {interactionsQ.isPending && <Skeleton className="h-20 w-full" />}
          {interactionsQ.data?.items.length === 0 && (
            <p className="text-sm text-slate-500">Sin interacciones todavía.</p>
          )}
          {interactionsQ.data?.items.map((it) => (
            <div key={it.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium uppercase tracking-wide">{it.type}</span>
                <span>·</span>
                <span>
                  {format(new Date(it.createdAt), "d MMM yyyy 'a las' HH:mm", {
                    locale: es,
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{it.content}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <ActionsPanel
        ticketId={ticket.id}
        estado={ticket.estado}
        isOwner={isOwner}
        operatesOnArea={operatesOnArea}
        canResolve={
          ticket.estado === 'en_progreso' &&
          (ticket.assignedAgentId === me?.id || me?.role === 'lider' || isAdmin)
        }
        resolvedAt={ticket.resolvedAt}
        closedDefinitivelyAt={ticket.closedDefinitivelyAt}
      />
    </div>
  );
}

// Días de gracia para reabrir un ticket cerrado, alineado con
// `SLA_REOPEN_GRACE_DAYS` del back (default 5). Cron de SLA marca
// `closedDefinitivelyAt` al pasar este plazo; el front replica la
// regla para esconder el botón antes de la marca y evitar el 409.
// TODO: exponer este valor desde la config del tenant cuando exista
// el endpoint de settings públicos.
const REOPEN_GRACE_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ActionsPanelProps {
  ticketId: string;
  estado: string;
  isOwner: boolean;
  operatesOnArea: boolean;
  canResolve: boolean;
  resolvedAt: string | null;
  closedDefinitivelyAt: string | null;
}

function ActionsPanel({
  ticketId,
  estado,
  isOwner,
  operatesOnArea,
  canResolve,
  resolvedAt,
  closedDefinitivelyAt,
}: ActionsPanelProps) {
  const [interactionContent, setInteractionContent] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNota, setResolveNota] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState('');

  const take = useTakeTicket(ticketId);
  const resolve = useResolveTicket(ticketId);
  const cancel = useCancelTicket(ticketId);
  const reopen = useReopenTicket(ticketId);
  const addInteraction = useAddInteraction(ticketId);

  const isDefinitivelyClosed =
    closedDefinitivelyAt !== null ||
    (resolvedAt !== null &&
      Date.now() - new Date(resolvedAt).getTime() > REOPEN_GRACE_DAYS * MS_PER_DAY);

  const canTake = operatesOnArea && estado === 'escalado';
  const canCancel = isOwner && PRE_TAKEN_STATES.has(estado);
  const canReopen = isOwner && estado === 'cerrado' && !isDefinitivelyClosed;
  const canAddInteraction = (isOwner && estado !== 'cancelado') || operatesOnArea;

  const interactionType = isOwner && !operatesOnArea ? 'usuario' : 'agente';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acciones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canAddInteraction && (
          <div className="flex flex-col gap-2">
            <Textarea
              placeholder="Agregá una nota o respuesta…"
              rows={3}
              value={interactionContent}
              onChange={(e) => setInteractionContent(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!interactionContent.trim() || addInteraction.isPending}
                onClick={async () => {
                  try {
                    await addInteraction.mutateAsync({
                      type: interactionType,
                      content: interactionContent,
                    });
                    setInteractionContent('');
                    toast.success('Nota agregada.');
                  } catch (err) {
                    toast.error(
                      err instanceof ApiError ? err.message : 'No pudimos agregar la nota.',
                    );
                  }
                }}
              >
                {addInteraction.isPending ? 'Enviando…' : 'Agregar nota'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canTake && (
            <Button
              onClick={async () => {
                try {
                  await take.mutateAsync();
                  toast.success('Ticket tomado.');
                } catch (err) {
                  toast.error(
                    err instanceof ApiError ? err.message : 'No pudimos tomar el ticket.',
                  );
                }
              }}
              disabled={take.isPending}
            >
              {take.isPending ? 'Tomando…' : 'Tomar ticket'}
            </Button>
          )}
          {canResolve && (
            <Button variant="secondary" onClick={() => setResolveOpen((v) => !v)}>
              Resolver
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => setCancelOpen((v) => !v)}>
              Cancelar
            </Button>
          )}
          {canReopen && (
            <Button variant="secondary" onClick={() => setReopenOpen((v) => !v)}>
              Reabrir
            </Button>
          )}
        </div>

        {isOwner && estado === 'cerrado' && isDefinitivelyClosed && (
          <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Pasaron más de {REOPEN_GRACE_DAYS} días desde el cierre, así que ya no podés reabrir
            este ticket. Si necesitás continuar, abrí uno nuevo.
          </p>
        )}

        {resolveOpen && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">
              Resolver ticket — agregá una nota de cierre
            </p>
            <Textarea
              rows={3}
              value={resolveNota}
              onChange={(e) => setResolveNota(e.target.value)}
              placeholder="Detalle de la resolución (visible al solicitante)"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setResolveOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!resolveNota.trim() || resolve.isPending}
                onClick={async () => {
                  try {
                    await resolve.mutateAsync({
                      nota: resolveNota,
                      enviarPorCorreo: false,
                    });
                    setResolveOpen(false);
                    setResolveNota('');
                    toast.success('Ticket resuelto.');
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : 'No pudimos resolver.');
                  }
                }}
              >
                {resolve.isPending ? 'Resolviendo…' : 'Confirmar resolución'}
              </Button>
            </div>
          </div>
        )}

        {cancelOpen && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Motivo de la cancelación</p>
            <Textarea
              rows={2}
              value={cancelMotivo}
              onChange={(e) => setCancelMotivo(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)}>
                Volver
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!cancelMotivo.trim() || cancel.isPending}
                onClick={async () => {
                  try {
                    await cancel.mutateAsync({ motivo: cancelMotivo });
                    setCancelOpen(false);
                    setCancelMotivo('');
                    toast.success('Ticket cancelado.');
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : 'No pudimos cancelar.');
                  }
                }}
              >
                {cancel.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
              </Button>
            </div>
          </div>
        )}

        {reopenOpen && (
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Motivo de la reapertura</p>
            <p className="text-xs text-slate-500">
              Contanos por qué necesitás retomar este ticket — el área asignada lo verá.
            </p>
            <Textarea
              rows={2}
              value={reopenMotivo}
              onChange={(e) => setReopenMotivo(e.target.value)}
              placeholder="Ej.: la solución no funcionó tras el reinicio."
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReopenOpen(false)}>
                Volver
              </Button>
              <Button
                size="sm"
                disabled={!reopenMotivo.trim() || reopen.isPending}
                onClick={async () => {
                  try {
                    await reopen.mutateAsync({ motivo: reopenMotivo });
                    setReopenOpen(false);
                    setReopenMotivo('');
                    toast.success('Ticket reabierto.');
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : 'No pudimos reabrir.');
                  }
                }}
              >
                {reopen.isPending ? 'Reabriendo…' : 'Confirmar reapertura'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
