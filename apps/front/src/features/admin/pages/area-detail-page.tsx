import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { useAuthStore } from '../../../stores/auth.store';
import {
  useAddAreaAgent,
  useAddAreaLeader,
  useArea,
  useRemoveAreaAgent,
  useRemoveAreaLeader,
} from '../api/use-areas';
import { useUsers } from '../api/use-users';
import { MembersPanel } from '../components/members-panel';
import { SlasForm } from '../components/slas-form';

export function AreaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const callerRole = useAuthStore((s) => s.user?.role);
  const callerAreaIds = useAuthStore((s) => s.user?.areaIds ?? []);
  const isAdmin = callerRole === 'admin';

  const areaQuery = useArea(id);
  const usersQuery = useUsers({ limit: 200 });

  const addAgent = useAddAreaAgent();
  const removeAgent = useRemoveAreaAgent();
  const addLeader = useAddAreaLeader();
  const removeLeader = useRemoveAreaLeader();

  if (areaQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (areaQuery.isError || !areaQuery.data) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-red-600">No pudimos cargar el área.</p>
        <Button variant="ghost" onClick={() => navigate('/admin/areas')}>
          Volver al listado
        </Button>
      </div>
    );
  }

  const area = areaQuery.data;
  const allUsers = usersQuery.data?.items ?? [];

  // Líder solo puede mutar agentes en áreas que él lidera. Admin todo.
  const isLeaderOfThisArea = callerRole === 'lider' && callerAreaIds.includes(area.id);
  const canMutateAgents = isAdmin || isLeaderOfThisArea;
  const canMutateLeaders = isAdmin;
  const canEditSlas = isAdmin || isLeaderOfThisArea;

  const agents = allUsers.filter((u) => area.agentIds.includes(u.id));
  const leaders = allUsers.filter((u) => area.leaderIds.includes(u.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/admin/areas"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            Áreas
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{area.name}</h1>
          <p className="text-sm text-slate-500">{area.description || 'Sin descripción.'}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SLAs por prioridad</CardTitle>
          <CardDescription>
            Tiempos objetivo en horas hábiles. Aplican a tickets que se ruteen a esta área.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEditSlas ? (
            <SlasForm areaId={area.id} initialSlas={area.slas} />
          ) : (
            <SlasReadonly slas={area.slas} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Miembros</CardTitle>
          <CardDescription>Agentes y líderes asociados al área.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <MembersPanel
            title="Agentes"
            acceptedRoles={['agente']}
            members={agents}
            allUsers={allUsers}
            canMutate={canMutateAgents}
            loading={addAgent.isPending || removeAgent.isPending}
            onAdd={(userId) => addAgent.mutateAsync({ id: area.id, userId })}
            onRemove={(userId) => removeAgent.mutateAsync({ id: area.id, userId })}
          />
          <MembersPanel
            title="Líderes"
            acceptedRoles={['lider']}
            members={leaders}
            allUsers={allUsers}
            canMutate={canMutateLeaders}
            loading={addLeader.isPending || removeLeader.isPending}
            onAdd={(userId) => addLeader.mutateAsync({ id: area.id, userId })}
            onRemove={(userId) => removeLeader.mutateAsync({ id: area.id, userId })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SlasReadonly({ slas }: { slas: { alta: number; media: number; baja: number } }) {
  return (
    <dl className="grid grid-cols-3 gap-4 text-sm">
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Alta</dt>
        <dd className="font-medium tabular-nums">{slas.alta} h</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Media</dt>
        <dd className="font-medium tabular-nums">{slas.media} h</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-slate-500">Baja</dt>
        <dd className="font-medium tabular-nums">{slas.baja} h</dd>
      </div>
    </dl>
  );
}
