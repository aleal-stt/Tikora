import type { Prioridad } from '@tikora/core';
import { Badge } from '../../../components/ui/badge';

const TONES: Record<Prioridad, 'danger' | 'warning' | 'success'> = {
  alta: 'danger',
  media: 'warning',
  baja: 'success',
};

const LABELS: Record<Prioridad, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

export function PrioridadBadge({ prioridad }: { prioridad: Prioridad | null | undefined }) {
  if (!prioridad) return <Badge tone="muted">—</Badge>;
  return <Badge tone={TONES[prioridad]}>{LABELS[prioridad]}</Badge>;
}
