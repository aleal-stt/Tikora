import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

interface ReopenTokenPayload {
  ticketId: string;
  shortCode: string;
}

/**
 * Página pública (sin auth) que abre el botón "Esto no resolvió mi
 * problema" del correo de auto-respuesta. Match con `tikora-ia.md` §7.7.
 *
 * Flujo:
 *  1. Lee `?token=…` del query.
 *  2. Decodifica el payload del JWT (sin verificar firma — solo para
 *     mostrar el `shortCode`; el back valida la firma al confirmar).
 *  3. Botón "Reabrir" → `POST /api/v1/tickets/:ticketId/reopen-from-email`.
 *  4. Toast inline + invitación a logear si quiere ver el ticket.
 *
 * Usamos `fetch` nativo (no `apiFetch`) porque ese cliente intenta
 * refresh automático en 401, lo cual confunde el caso "token de email
 * inválido" con "sesión expirada".
 */
export function ReopenConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const payload = token ? decodeJwtPayload(token) : null;

  if (!token || !payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Link inválido</CardTitle>
          <CardDescription>
            El link que abriste no incluye un token válido. Volvé a abrir el botón desde el correo
            más reciente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/login" className="text-sm text-blue-700 hover:underline">
            Ir a iniciar sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function onConfirm(ticketId: string) {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/tickets/${encodeURIComponent(ticketId)}/reopen-from-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
          code?: string;
        } | null;
        throw new Error(body?.message ?? `Error ${res.status}`);
      }
      setStatus('ok');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Error inesperado.');
    }
  }

  if (status === 'ok') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ticket reabierto</CardTitle>
          <CardDescription>
            Marcamos {payload.shortCode} como reabierto y un agente lo va a retomar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            Iniciá sesión para ver el detalle y agregar contexto si lo necesitás.
          </p>
          <div className="mt-3">
            <Link
              to="/login"
              className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Ir a Tikora
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{payload.shortCode} — ¿Retomar este ticket?</CardTitle>
        <CardDescription>
          Si la respuesta automática no resolvió tu consulta, podemos reabrir el ticket para que un
          agente lo retome donde quedó.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">
          Al confirmar, marcamos el ticket como reabierto con motivo
          <em> &ldquo;Auto-respuesta insuficiente — reapertura desde correo&rdquo;</em>. No hace
          falta iniciar sesión.
        </p>
        {status === 'error' && errorMessage && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {errorMessage}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Link
            to="/login"
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            No, gracias
          </Link>
          <Button onClick={() => onConfirm(payload.ticketId)} disabled={status === 'loading'}>
            {status === 'loading' ? 'Reabriendo…' : 'Sí, reabrir el ticket'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Decodifica un JWT *sin verificar* la firma. Esto es seguro acá porque
 * el payload sólo se usa para mostrar el `shortCode` al usuario; el
 * back valida la firma al confirmar la reapertura.
 */
function decodeJwtPayload(token: string): ReopenTokenPayload | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    // base64url → base64 estándar.
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    const data = JSON.parse(json) as Partial<ReopenTokenPayload>;
    if (!data.ticketId || !data.shortCode) return null;
    return { ticketId: data.ticketId, shortCode: data.shortCode };
  } catch {
    return null;
  }
}
