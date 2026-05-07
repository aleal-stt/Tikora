import { z } from 'zod';

export const prioridadSchema = z.enum(['alta', 'media', 'baja']);
export type Prioridad = z.infer<typeof prioridadSchema>;

export const estadoTicketSchema = z.enum([
  'recibido',
  'clasificado',
  'requiere_revision_clasificacion',
  'escalado',
  'en_progreso',
  'cerrado',
  'reabierto',
  'cancelado',
]);
export type EstadoTicket = z.infer<typeof estadoTicketSchema>;

const trimmedRange = (label: string, min: number, max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(min, `${label} debe tener al menos ${min} caracteres`)
        .max(max, `${label} no puede superar los ${max} caracteres`),
    );

/** Forma completa del ticket en respuestas. Fechas como ISO-8601. */
export const ticketSchema = z.object({
  id: z.string(),
  shortCode: z.string(),
  requesterId: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
  estado: estadoTicketSchema,
  prioridad: prioridadSchema.nullable(),
  areaId: z.string().nullable(),
  assignedAgentId: z.string().nullable(),
  lastAssignedAgentId: z.string().nullable(),
  tags: z.array(z.string()),
  slaDeadline: z.string().nullable(),
  resolutionType: z.enum(['manual', 'auto']).nullable(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  reopenCount: z.number().int(),
  closedDefinitivelyAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** Forma reducida para listados (sin `cuerpo` para no inflar respuestas). */
export const ticketListItemSchema = ticketSchema.pick({
  id: true,
  shortCode: true,
  requesterId: true,
  asunto: true,
  estado: true,
  prioridad: true,
  areaId: true,
  assignedAgentId: true,
  slaDeadline: true,
  resolutionType: true,
  reopenCount: true,
  createdAt: true,
  updatedAt: true,
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

export const ticketListResponseSchema = z.object({
  items: z.array(ticketListItemSchema),
  nextCursor: z.string().nullable(),
});
export type TicketListResponse = z.infer<typeof ticketListResponseSchema>;

// -------- bodies de mutación --------

export const createTicketSchema = z.object({
  asunto: trimmedRange('El asunto', 5, 120),
  cuerpo: trimmedRange('El cuerpo', 10, 5000),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const classifyTicketSchema = z.object({
  areaId: z.string().min(1, 'El área es obligatoria'),
  prioridad: prioridadSchema,
  motivo: z.string().optional(),
});
export type ClassifyTicket = z.infer<typeof classifyTicketSchema>;

export const resolveTicketSchema = z.object({
  nota: trimmedRange('La nota', 1, 5000),
  enviarPorCorreo: z.boolean().default(false),
});
export type ResolveTicket = z.infer<typeof resolveTicketSchema>;

export const cancelTicketSchema = z.object({
  motivo: trimmedRange('El motivo', 1, 1000),
});
export type CancelTicket = z.infer<typeof cancelTicketSchema>;

export const reopenTicketSchema = z.object({
  motivo: trimmedRange('El motivo', 1, 1000),
});
export type ReopenTicket = z.infer<typeof reopenTicketSchema>;

export const assignAgentSchema = z.object({
  agentId: z.string().min(1, 'agentId es obligatorio'),
});
export type AssignAgent = z.infer<typeof assignAgentSchema>;

export const assignAreaSchema = z.object({
  areaId: z.string().min(1, 'areaId es obligatorio'),
  motivo: trimmedRange('El motivo', 1, 1000),
});
export type AssignArea = z.infer<typeof assignAreaSchema>;
