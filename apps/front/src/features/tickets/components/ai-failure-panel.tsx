import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { AiResponse } from '@tikora/core';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';

const REASON_LABELS: Record<NonNullable<AiResponse['failureReason']>, string> = {
  api_error: 'Error transitorio del LLM (retries agotados)',
  validation_error: 'El modelo respondió fuera de schema tras los reintentos',
};

/**
 * Panel admin-only que muestra el detalle de la última generación de
 * auto-respuesta que terminó en `fallida`. Es informativo: no expone
 * acciones (no hay reintento manual todavía). El admin lee el motivo
 * y, si corresponde, escala con su proveedor de LLM o ajusta config.
 */
export function AiFailurePanel({ aiResponse }: { aiResponse: AiResponse }) {
  return (
    <Card className="border-red-200 bg-red-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-900">
          <ExclamationTriangleIcon className="h-5 w-5" />
          Auto-respuesta fallida
        </CardTitle>
        <CardDescription className="text-red-800/80">
          La generación automática para este ticket no pudo completarse. Solo admins ven este panel;
          el flujo del ticket sigue normal (escalada manual).
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-red-900">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-red-700">Motivo</dt>
            <dd className="font-medium">
              {aiResponse.failureReason
                ? REASON_LABELS[aiResponse.failureReason]
                : 'Falla sin clasificar'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-red-700">Cuándo</dt>
            <dd className="font-medium">
              {format(new Date(aiResponse.createdAt), "d MMM yyyy 'a las' HH:mm", {
                locale: es,
              })}
            </dd>
          </div>
        </dl>

        {aiResponse.failureDetail && (
          <div className="mt-3">
            <dt className="text-xs uppercase tracking-wide text-red-700">Detalle del error</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-md border border-red-200 bg-white p-2 font-mono text-xs text-slate-800">
              {aiResponse.failureDetail}
            </dd>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
