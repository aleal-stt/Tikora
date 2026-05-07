import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

export function MisTicketsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Mis tickets</h1>
        <p className="text-sm text-slate-500">
          Listado de los tickets que creaste, con su estado y SLA.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Lista de tickets</CardTitle>
          <CardDescription>
            La tabla con tickets se implementa en el próximo sprint del frontend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            Pronto vas a poder crear, ver y reabrir tus tickets desde acá.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
