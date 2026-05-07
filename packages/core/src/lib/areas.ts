import { z } from 'zod';

// SLA en horas hábiles. El máximo (720h ≈ 30 días) es deliberadamente
// generoso — la regla de negocio fina debe vivir en config del tenant.
const slaHours = z
  .number()
  .int('Las horas SLA deben ser un entero')
  .min(1, 'Las horas SLA deben ser mayores a 0')
  .max(720, 'Las horas SLA no pueden exceder 720');

export const slasSchema = z.object({
  alta: slaHours,
  media: slaHours,
  baja: slaHours,
});
export type Slas = z.infer<typeof slasSchema>;

const trimmedNonEmpty = (label: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, `${label} es obligatorio`));

const trimmedString = z.string().transform((v) => v.trim());

/** Forma completa del área. La devuelven los endpoints para LID/ADM. */
export const areaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  agentIds: z.array(z.string()),
  leaderIds: z.array(z.string()),
  slas: slasSchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Area = z.infer<typeof areaSchema>;

/** Vista limitada para EMP/AGE: solo lo necesario para listar áreas en formularios. */
export const areaPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type AreaPublic = z.infer<typeof areaPublicSchema>;

export const createAreaSchema = z.object({
  name: trimmedNonEmpty('El nombre'),
  description: trimmedString.default(''),
  leaderIds: z.array(z.string()).default([]),
  slas: slasSchema,
});
export type CreateArea = z.infer<typeof createAreaSchema>;

export const updateAreaSchema = z
  .object({
    name: trimmedNonEmpty('El nombre').optional(),
    description: trimmedString.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Hay que enviar al menos un campo a actualizar',
  });
export type UpdateArea = z.infer<typeof updateAreaSchema>;

export const updateSlasSchema = z.object({
  slas: slasSchema,
});
export type UpdateSlas = z.infer<typeof updateSlasSchema>;

export const areaMemberRefSchema = z.object({
  userId: z.string().min(1, 'userId es obligatorio'),
});
export type AreaMemberRef = z.infer<typeof areaMemberRefSchema>;

export const areaListResponseFullSchema = z.object({
  items: z.array(areaSchema),
  nextCursor: z.string().nullable(),
});
export type AreaListResponseFull = z.infer<typeof areaListResponseFullSchema>;

export const areaListResponsePublicSchema = z.object({
  items: z.array(areaPublicSchema),
  nextCursor: z.string().nullable(),
});
export type AreaListResponsePublic = z.infer<typeof areaListResponsePublicSchema>;
