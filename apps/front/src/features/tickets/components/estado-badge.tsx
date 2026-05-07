import type { EstadoTicket } from '@tikora/core';
import { Badge } from '../../../components/ui/badge';

const ESTADO_LABELS: Record<EstadoTicket, string> = {
  recibido: 'Recibido',
  clasificado: 'Clasificado',
  requiere_revision_clasificacion: 'Revisión',
  escalado: 'Escalado',
  en_progreso: 'En progreso',
  cerrado: 'Cerrado',
  reabierto: 'Reabierto',
  cancelado: 'Cancelado',
};

const ESTADO_TONES: Record<
  EstadoTicket,
  'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted'
> = {
  recibido: 'muted',
  clasificado: 'info',
  requiere_revision_clasificacion: 'warning',
  escalado: 'info',
  en_progreso: 'info',
  cerrado: 'success',
  reabierto: 'warning',
  cancelado: 'danger',
};

export function EstadoBadge({ estado }: { estado: EstadoTicket }) {
  return <Badge tone={ESTADO_TONES[estado]}>{ESTADO_LABELS[estado]}</Badge>;
}
