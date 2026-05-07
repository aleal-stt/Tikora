import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { loginRequestSchema } from '@tikora/core';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
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
import { ApiError } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';
import { login } from '../api/auth-api';

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  const navigate = useNavigate();

  // Tipo inferido del resolver — el `loginRequestSchema` aplica `preprocess`
  // sobre `email`, lo que confunde al genérico explícito de `useForm`.
  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      const state = location.state as LocationState | undefined;
      navigate(state?.from?.pathname ?? '/', { replace: true });
    },
    onError: (err) => {
      // Mensaje genérico para no leak; el código exacto se loggea en consola
      // para debugging del usuario.
      const message =
        err instanceof ApiError && err.code !== 'API_ERROR'
          ? err.message
          : 'No pudimos iniciar la sesión. Verificá el email y la contraseña.';
      toast.error(message);
    },
  });

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Ingresá con tu cuenta corporativa.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="text-xs text-red-600">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="text-xs text-red-600">{form.formState.errors.password.message}</p>
            )}
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
