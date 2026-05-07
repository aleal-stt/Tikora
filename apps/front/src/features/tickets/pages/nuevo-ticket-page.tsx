import { zodResolver } from '@hookform/resolvers/zod';
import { createTicketSchema } from '@tikora/core';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api-client';
import { useCreateTicket } from '../api/use-tickets';

export function NuevoTicketPage() {
  const navigate = useNavigate();
  const mutation = useCreateTicket();

  const form = useForm({
    resolver: zodResolver(createTicketSchema),
    defaultValues: { asunto: '', cuerpo: '' },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Nuevo ticket</h1>
        <p className="text-sm text-slate-500">
          Describí el problema o consulta. La IA va a clasificar tu ticket y asignarlo al área
          correspondiente.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Detalles</CardTitle>
          <CardDescription>
            Asunto entre 5 y 120 caracteres. Cuerpo entre 10 y 5000.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit(async (data) => {
              try {
                const ticket = await mutation.mutateAsync(data);
                toast.success(`Ticket ${ticket.shortCode} creado.`);
                navigate(`/tickets/${ticket.id}`);
              } catch (err) {
                const message =
                  err instanceof ApiError
                    ? err.message
                    : 'No pudimos crear el ticket. Intentá de nuevo.';
                toast.error(message);
              }
            })}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="asunto">Asunto</Label>
              <Input id="asunto" autoFocus {...form.register('asunto')} />
              {form.formState.errors.asunto && (
                <p className="text-xs text-red-600">{form.formState.errors.asunto.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cuerpo">Cuerpo</Label>
              <Textarea
                id="cuerpo"
                rows={6}
                {...form.register('cuerpo')}
                placeholder="Describí qué pasa, cuándo empezó, qué probaste, etc."
              />
              {form.formState.errors.cuerpo && (
                <p className="text-xs text-red-600">{form.formState.errors.cuerpo.message}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => navigate('/mis-tickets')}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creando…' : 'Crear ticket'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
