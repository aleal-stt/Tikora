import { z } from 'zod';
import { estadoTicketSchema, prioridadSchema } from './tickets';

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

const objectIdField = (label: string) =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, `${label} debe ser un ObjectId válido`);

// -------- crear_ticket --------

export const crearTicketInputSchema = z.object({
  asunto: trimmedRange('El asunto', 5, 120),
  cuerpo: trimmedRange('El cuerpo', 10, 5000),
});
export type CrearTicketInput = z.infer<typeof crearTicketInputSchema>;

export const crearTicketOutputSchema = z.object({
  ticketId: z.string(),
  shortCode: z.string(),
  estado: estadoTicketSchema,
  mensaje: z.string(),
});
export type CrearTicketOutput = z.infer<typeof crearTicketOutputSchema>;

// -------- listar_mis_tickets --------

export const listarMisTicketsInputSchema = z.object({
  estado: estadoTicketSchema.optional(),
  limite: z.number().int().min(1).max(20).optional().default(10),
});
export type ListarMisTicketsInput = z.infer<typeof listarMisTicketsInputSchema>;

export const ticketResumenSchema = z.object({
  ticketId: z.string(),
  shortCode: z.string(),
  asunto: z.string(),
  estado: estadoTicketSchema,
  prioridad: prioridadSchema.nullable(),
  createdAt: z.string(),
});
export type TicketResumen = z.infer<typeof ticketResumenSchema>;

export const listarMisTicketsOutputSchema = z.object({
  tickets: z.array(ticketResumenSchema),
});
export type ListarMisTicketsOutput = z.infer<typeof listarMisTicketsOutputSchema>;

// -------- obtener_ticket --------

export const obtenerTicketInputSchema = z.object({
  ticketId: objectIdField('ticketId'),
});
export type ObtenerTicketInput = z.infer<typeof obtenerTicketInputSchema>;

export const ticketDetalleSchema = z.object({
  ticketId: z.string(),
  shortCode: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
  estado: estadoTicketSchema,
  prioridad: prioridadSchema.nullable(),
  areaId: z.string().nullable(),
  createdAt: z.string(),
});
export type TicketDetalle = z.infer<typeof ticketDetalleSchema>;

export const ultimaRespuestaAgenteSchema = z.object({
  contenido: z.string(),
  agenteNombre: z.string(),
  enviadaEn: z.string(),
});
export type UltimaRespuestaAgente = z.infer<typeof ultimaRespuestaAgenteSchema>;

export const eventoHistorialSchema = z.object({
  tipo: z.enum(['mensaje', 'cambio_estado']),
  contenido: z.string(),
  fecha: z.string(),
});
export type EventoHistorial = z.infer<typeof eventoHistorialSchema>;

export const obtenerTicketOutputSchema = z.object({
  ticket: ticketDetalleSchema,
  ultimaRespuestaAgente: ultimaRespuestaAgenteSchema.nullable(),
  historial: z.array(eventoHistorialSchema),
});
export type ObtenerTicketOutput = z.infer<typeof obtenerTicketOutputSchema>;

// -------- agregar_mensaje_a_ticket --------

export const agregarMensajeATicketInputSchema = z.object({
  ticketId: objectIdField('ticketId'),
  texto: trimmedRange('El texto', 1, 2000),
});
export type AgregarMensajeATicketInput = z.infer<typeof agregarMensajeATicketInputSchema>;

export const agregarMensajeATicketOutputSchema = z.object({
  ok: z.literal(true),
  mensaje: z.string(),
});
export type AgregarMensajeATicketOutput = z.infer<typeof agregarMensajeATicketOutputSchema>;
