import { InboxIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { useBandeja } from '../api/use-tickets';
import { EstadoBadge } from '../components/estado-badge';
import { PrioridadBadge } from '../components/prioridad-badge';
import { SlaIndicator } from '../components/sla-indicator';

export function BandejaPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useBandeja({ limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Bandeja</h1>
        <p className="text-sm text-slate-500">
          Tickets escalados a las áreas a las que pertenecés.
        </p>
      </div>

      {isPending && <Skeleton className="h-64 w-full" />}

      {isError && (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">
            No pudimos cargar la bandeja: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <InboxIcon className="h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-900">No hay tickets en tu bandeja</h3>
            <p className="text-sm text-slate-500">
              Cuando se asigne un ticket a tus áreas aparecerá acá.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Asunto</th>
                <th className="px-4 py-2">Prioridad</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">SLA</th>
                <th className="px-4 py-2">Asignado</th>
                <th className="px-4 py-2">Actualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => navigate(`/tickets/${ticket.id}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{ticket.shortCode}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-slate-900">{ticket.asunto}</td>
                  <td className="px-4 py-2">
                    <PrioridadBadge prioridad={ticket.prioridad} />
                  </td>
                  <td className="px-4 py-2">
                    <EstadoBadge estado={ticket.estado} />
                  </td>
                  <td className="px-4 py-2">
                    <SlaIndicator deadline={ticket.slaDeadline} />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {ticket.assignedAgentId ? 'Asignado' : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    hace{' '}
                    {formatDistanceToNow(new Date(ticket.updatedAt), {
                      locale: es,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
