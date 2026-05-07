import { InboxIcon, PlusIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { useMisTickets } from '../api/use-tickets';
import { EstadoBadge } from '../components/estado-badge';
import { PrioridadBadge } from '../components/prioridad-badge';
import { SlaIndicator } from '../components/sla-indicator';

export function MisTicketsPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useMisTickets({ limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Mis tickets</h1>
          <p className="text-sm text-slate-500">Tickets que creaste, con su estado y SLA.</p>
        </div>
        <Button asChild>
          <Link to="/mis-tickets/nuevo">
            <PlusIcon className="h-5 w-5" />
            Nuevo ticket
          </Link>
        </Button>
      </div>

      {isPending && (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">
            No pudimos cargar tus tickets: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <InboxIcon className="h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-900">Todavía no creaste tickets</h3>
            <p className="text-sm text-slate-500">
              Cuando crees uno aparecerá acá con su estado y prioridad.
            </p>
            <Button onClick={() => navigate('/mis-tickets/nuevo')}>
              <PlusIcon className="h-5 w-5" />
              Crear el primero
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.items.length > 0 && (
        <div className="grid gap-3">
          {data.items.map((ticket) => (
            <Card
              key={ticket.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/tickets/${ticket.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/tickets/${ticket.id}`);
              }}
              className="cursor-pointer transition-colors hover:border-slate-300"
            >
              <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-700">
                      {ticket.shortCode}
                    </span>
                    <span>·</span>
                    <span>
                      hace{' '}
                      {formatDistanceToNow(new Date(ticket.createdAt), {
                        locale: es,
                      })}
                    </span>
                  </div>
                  <CardTitle className="text-base">{ticket.asunto}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <PrioridadBadge prioridad={ticket.prioridad} />
                  <EstadoBadge estado={ticket.estado} />
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0 text-xs">
                <SlaIndicator deadline={ticket.slaDeadline} />
                <span className="text-slate-400">
                  {ticket.assignedAgentId ? 'Asignado' : 'Sin asignar'}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
