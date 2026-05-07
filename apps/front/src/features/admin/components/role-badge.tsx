import type { Role } from '@tikora/core';
import { Badge } from '../../../components/ui/badge';

const ROLE_LABELS: Record<Role, string> = {
  empleado: 'Empleado',
  agente: 'Agente',
  lider: 'Líder',
  admin: 'Admin',
};

const ROLE_TONE: Record<Role, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted'> = {
  empleado: 'muted',
  agente: 'info',
  lider: 'success',
  admin: 'warning',
};

// El prop se llama `value` en vez de `role` para evitar el clash con el
// atributo ARIA `role` (algunos linters jsx-a11y lo confunden con un rol
// ARIA y reportan falsos positivos).
export function RoleBadge({ value }: { value: Role }) {
  return <Badge tone={ROLE_TONE[value]}>{ROLE_LABELS[value]}</Badge>;
}
