import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

export function BandejaPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Bandeja</h1>
        <p className="text-sm text-slate-500">
          Tickets escalados a las áreas a las que pertenecés.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Bandeja del agente</CardTitle>
          <CardDescription>
            La tabla densa con filtros y SLA semáforo se implementa en el próximo sprint del
            frontend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            Por ahora la conexión al back está validada por el login.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
