import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

export function UsuariosPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Gestión de usuarios</h1>
        <p className="text-sm text-slate-500">Alta, baja y edición de usuarios del tenant.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>
            La tabla de usuarios + form de alta se implementa en el próximo sprint del frontend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            La pantalla actual valida que el rol admin redirige acá tras login.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
