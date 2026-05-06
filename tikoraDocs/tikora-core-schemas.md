# Tikora — Schemas compartidos (`@tikora/core`)

> Inventario de los schemas Zod que viven en el paquete `packages/core` y se consumen desde frontend (RHF + zodResolver) y backend (`createZodDto` + `ZodValidationPipe`). Es el **único lugar** donde se definen tipos y validaciones compartidos.

---

## 1. Estructura del paquete

```
packages/core/
├── src/
│   ├── auth/
│   │   ├── login.schema.ts
│   │   ├── refresh.schema.ts
│   │   ├── change-password.schema.ts
│   │   └── index.ts
│   ├── users/
│   │   ├── user.schema.ts
│   │   ├── create-user.schema.ts
│   │   ├── update-user.schema.ts
│   │   └── index.ts
│   ├── areas/
│   │   ├── area.schema.ts
│   │   ├── create-area.schema.ts
│   │   ├── update-area.schema.ts
│   │   ├── area-slas.schema.ts
│   │   └── index.ts
│   ├── tickets/
│   │   ├── ticket.schema.ts
│   │   ├── ticket-list-item.schema.ts
│   │   ├── ticket-filters.schema.ts
│   │   ├── create-ticket.schema.ts
│   │   ├── resolve-ticket.schema.ts
│   │   ├── cancel-ticket.schema.ts
│   │   ├── reopen-ticket.schema.ts
│   │   ├── reassign.schema.ts
│   │   ├── classification-override.schema.ts
│   │   └── index.ts
│   ├── interactions/
│   │   ├── interaction.schema.ts
│   │   ├── create-interaction.schema.ts
│   │   └── index.ts
│   ├── attachments/
│   │   ├── attachment.schema.ts
│   │   └── index.ts
│   ├── kb/
│   │   ├── kb-document.schema.ts
│   │   ├── create-kb-document.schema.ts
│   │   ├── update-kb-document.schema.ts
│   │   └── index.ts
│   ├── ai/
│   │   ├── classification-output.schema.ts
│   │   ├── auto-response-output.schema.ts
│   │   ├── ai-response.schema.ts
│   │   ├── approve-with-changes.schema.ts
│   │   ├── discard-response.schema.ts
│   │   └── index.ts
│   ├── notifications/
│   │   ├── notification.schema.ts
│   │   └── index.ts
│   ├── feedback/
│   │   ├── classification-feedback.schema.ts
│   │   └── index.ts
│   ├── admin/
│   │   ├── thresholds.schema.ts
│   │   ├── sla-config.schema.ts
│   │   └── index.ts
│   ├── shared/
│   │   ├── pagination.schema.ts
│   │   ├── sort.schema.ts
│   │   ├── id.schema.ts
│   │   ├── enums.ts
│   │   └── index.ts
│   └── index.ts                         # re-export root
├── package.json
└── tsconfig.json
```

**Imports desde apps:**

```typescript
import { CreateTicketSchema, TicketSchema } from '@tikora/core';
```

Ningún import profundo (`@tikora/core/tickets/...`); todo se re-exporta por el `index.ts` raíz.

---

## 2. Convenciones

- **Nombres:** `<Recurso>Schema` para entidades visibles, `Create<Recurso>Schema` / `Update<Recurso>Schema` para inputs.
- **Tipos inferidos:** cada schema exporta también su tipo TypeScript: `export type CreateTicket = z.infer<typeof CreateTicketSchema>;`.
- **IDs:** todos los IDs se validan como `IdSchema` (string, regex `^[0-9a-fA-F]{24}$` para ObjectId).
- **Mensajes:** los schemas no incluyen mensajes en español inline salvo cuando la regla es específica del negocio. Los mensajes genéricos vienen del `errorMap` global instalado en cada lado.
- **Estricto:** todos los object schemas usan `.strict()` para rechazar campos extra (anti tampering).
- **Fechas:** entradas como string ISO; outputs también string ISO. La conversión a `Date` se hace en backend al persistir.

---

## 3. Schemas compartidos

### 3.1 `shared/`

```typescript
// id.schema.ts
import { z } from 'zod';
export const IdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');

// enums.ts
export const RoleSchema = z.enum(['empleado', 'agente', 'lider', 'admin']);
export const PrioridadSchema = z.enum(['alta', 'media', 'baja']);
export const TicketEstadoSchema = z.enum([
  'recibido',
  'clasificado',
  'requiere_revision_clasificacion',
  'escalado',
  'en_progreso',
  'cerrado',
  'reabierto',
  'cancelado',
]);
export const InteractionTypeSchema = z.enum(['usuario', 'agente', 'ia', 'sistema']);
export const KbScopeSchema = z.enum(['global', 'area']);
export const AiResponseEstadoSchema = z.enum([
  'sugerida',
  'aprobada',
  'editada',
  'enviada',
  'descartada',
]);

// pagination.schema.ts
export const PaginationQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable(),
    })
    .strict();

// sort.schema.ts
export const TicketSortSchema = z.enum(['slaAsc', 'slaDesc', 'createdAtDesc', 'priorityDesc']);
```

---

### 3.2 `auth/`

```typescript
// login.schema.ts
export const LoginSchema = z
  .object({
    email: z.string().email('Email inválido').toLowerCase().trim(),
    password: z.string().min(1, 'La contraseña es obligatoria'),
  })
  .strict();

export const LoginResponseSchema = z
  .object({
    accessToken: z.string(),
    user: UserPublicSchema,
  })
  .strict();

// change-password.schema.ts
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(10, 'La contraseña debe tener al menos 10 caracteres')
      .max(128)
      .regex(/[a-z]/, 'Debe incluir al menos una minúscula')
      .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
      .regex(/[0-9]/, 'Debe incluir al menos un número'),
  })
  .strict()
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'La nueva contraseña debe ser distinta de la actual',
    path: ['newPassword'],
  });
```

`refresh.schema.ts` no tiene body; se documenta `RefreshResponseSchema = z.object({ accessToken: z.string() })`.

---

### 3.3 `users/`

```typescript
// user.schema.ts
export const UserPublicSchema = z
  .object({
    id: IdSchema,
    email: z.string().email(),
    fullName: z.string(),
    role: RoleSchema,
    areaIds: z.array(IdSchema),
    active: z.boolean(),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.string().datetime().nullable(),
  })
  .strict();

// create-user.schema.ts
export const CreateUserSchema = z
  .object({
    email: z.string().email().toLowerCase().trim(),
    fullName: z.string().min(2).max(120).trim(),
    role: RoleSchema,
    areaIds: z.array(IdSchema).default([]),
    temporaryPassword: z.string().min(10).max(128),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.role === 'empleado' && d.areaIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaIds'],
        message: 'Un empleado no puede tener áreas asignadas',
      });
    }
    if ((d.role === 'agente' || d.role === 'lider') && d.areaIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaIds'],
        message: 'Agentes y líderes requieren al menos un área',
      });
    }
  });

// update-user.schema.ts
export const UpdateUserSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    role: RoleSchema.optional(),
    areaIds: z.array(IdSchema).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const UpdateMeSchema = z
  .object({
    fullName: z.string().min(2).max(120),
  })
  .strict();
```

---

### 3.4 `areas/`

```typescript
// area.schema.ts
export const AreaSlasSchema = z
  .object({
    alta: z.number().min(0.5).max(720), // horas hábiles
    media: z.number().min(0.5).max(720),
    baja: z.number().min(0.5).max(720),
  })
  .strict();

export const AreaSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    description: z.string(),
    agentIds: z.array(IdSchema),
    leaderIds: z.array(IdSchema),
    slas: AreaSlasSchema,
    active: z.boolean(),
  })
  .strict();

// create-area.schema.ts
export const CreateAreaSchema = z
  .object({
    name: z.string().min(2).max(80).trim(),
    description: z.string().min(0).max(500).trim(),
    leaderIds: z.array(IdSchema).default([]),
    slas: AreaSlasSchema,
  })
  .strict();

// update-area.schema.ts
export const UpdateAreaSchema = CreateAreaSchema.partial();
```

---

### 3.5 `tickets/`

```typescript
// ticket.schema.ts
export const TicketSchema = z
  .object({
    id: IdSchema,
    shortCode: z.string(),
    requesterId: IdSchema,
    asunto: z.string(),
    cuerpo: z.string(),
    estado: TicketEstadoSchema,
    prioridad: PrioridadSchema.nullable(),
    areaId: IdSchema.nullable(),
    classificationId: IdSchema.nullable(),
    autoResponseId: IdSchema.nullable(),
    assignedAgentId: IdSchema.nullable(),
    attachmentIds: z.array(IdSchema),
    tags: z.array(z.string()),
    slaDeadline: z.string().datetime().nullable(),
    resolutionType: z.enum(['manual', 'auto']).nullable(),
    resolvedBy: IdSchema.nullable(),
    resolvedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

// ticket-list-item.schema.ts (vista compacta para listados)
export const TicketListItemSchema = TicketSchema.pick({
  id: true,
  shortCode: true,
  asunto: true,
  estado: true,
  prioridad: true,
  areaId: true,
  assignedAgentId: true,
  slaDeadline: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    requesterName: z.string(),
    requesterEmail: z.string().email(),
    unreadCount: z.number().int().min(0).default(0),
  })
  .strict();

// ticket-filters.schema.ts
export const TicketFiltersSchema = z
  .object({
    estado: z.array(TicketEstadoSchema).optional(),
    prioridad: z.array(PrioridadSchema).optional(),
    areaId: z.array(IdSchema).optional(),
    tags: z.array(z.string()).optional(),
    assignedToMe: z.coerce.boolean().optional(),
    requesterId: IdSchema.optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    q: z.string().min(1).max(200).optional(),
    sort: TicketSortSchema.default('slaAsc'),
  })
  .strict()
  .merge(PaginationQuerySchema);

// create-ticket.schema.ts
export const CreateTicketSchema = z
  .object({
    asunto: z
      .string()
      .min(5, 'El asunto debe tener al menos 5 caracteres')
      .max(120, 'El asunto debe tener máximo 120 caracteres')
      .trim(),
    cuerpo: z
      .string()
      .min(10, 'El cuerpo debe tener al menos 10 caracteres')
      .max(5000, 'El cuerpo debe tener máximo 5000 caracteres')
      .trim(),
  })
  .strict();

// resolve-ticket.schema.ts
export const ResolveTicketSchema = z
  .object({
    nota: z.string().min(1).max(5000).trim(),
    enviarPorCorreo: z.boolean().default(true),
  })
  .strict();

// cancel-ticket.schema.ts
export const CancelTicketSchema = z
  .object({
    motivo: z.string().min(1).max(500).trim(),
  })
  .strict();

// reopen-ticket.schema.ts
export const ReopenTicketSchema = z
  .object({
    motivo: z.string().min(1).max(500).trim(),
  })
  .strict();

// reassign.schema.ts
export const ReassignAgentSchema = z
  .object({
    agentId: IdSchema,
  })
  .strict();

export const ReassignAreaSchema = z
  .object({
    areaId: IdSchema,
    motivo: z.string().min(1).max(500).trim(),
  })
  .strict();

// classification-override.schema.ts
export const ClassificationOverrideSchema = z
  .object({
    areaId: IdSchema,
    prioridad: PrioridadSchema,
    motivo: z.string().min(0).max(500).trim().optional(),
  })
  .strict();
```

> El input multipart para `POST /tickets` usa `CreateTicketSchema` para los campos de texto y validación de archivo aparte (multer + custom validator) por límites de tipo y tamaño. Los límites concretos viven en una constante exportada `ATTACHMENT_LIMITS` en `@tikora/core/attachments`.

---

### 3.6 `interactions/`

```typescript
// interaction.schema.ts
export const InteractionSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    type: InteractionTypeSchema,
    authorId: IdSchema.nullable(),
    authorName: z.string().nullable(), // poblado por backend al responder
    content: z.string(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: z.string().datetime(),
  })
  .strict();

// create-interaction.schema.ts
export const CreateInteractionSchema = z
  .object({
    type: z.enum(['usuario', 'agente']), // solo estos dos los crea un humano
    content: z.string().min(1).max(5000).trim(),
  })
  .strict();
```

---

### 3.7 `attachments/`

```typescript
export const AttachmentSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    uploaderId: IdSchema,
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().min(0),
    createdAt: z.string().datetime(),
  })
  .strict();

export const ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10 MB
  maxPerTicket: 5,
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;
```

---

### 3.8 `kb/`

```typescript
// kb-document.schema.ts
export const KbDocumentSchema = z
  .object({
    id: IdSchema,
    parentDocumentId: IdSchema,
    title: z.string(),
    content: z.string(),
    scope: KbScopeSchema,
    areaIds: z.array(IdSchema),
    version: z.number().int().min(1),
    active: z.boolean(),
    uploadedBy: IdSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

// create-kb-document.schema.ts
const KB_MAX_BYTES = 200 * 1024;

export const CreateKbDocumentSchema = z
  .object({
    title: z.string().min(3).max(200).trim(),
    content: z
      .string()
      .min(1)
      .refine(
        (s) => new TextEncoder().encode(s).byteLength <= KB_MAX_BYTES,
        'El documento excede el tamaño máximo de 200 KB',
      ),
    scope: KbScopeSchema,
    areaIds: z.array(IdSchema).default([]),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.scope === 'area' && d.areaIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaIds'],
        message: 'Documentos de scope área requieren al menos un área',
      });
    }
  });

// update-kb-document.schema.ts (no permite cambiar scope)
export const UpdateKbDocumentSchema = z
  .object({
    title: z.string().min(3).max(200).trim(),
    content: z
      .string()
      .min(1)
      .refine(
        (s) => new TextEncoder().encode(s).byteLength <= KB_MAX_BYTES,
        'El documento excede el tamaño máximo de 200 KB',
      ),
    areaIds: z.array(IdSchema).optional(),
  })
  .strict();
```

---

### 3.9 `ai/`

```typescript
// classification-output.schema.ts
export const ClassificationOutputSchema = z
  .object({
    area: z.string().min(1),
    prioridad: PrioridadSchema,
    confianza: z.number().min(0).max(1),
    resumen: z.string().min(1).max(200),
    tags: z.array(z.string().min(1)).max(5),
  })
  .strict();

// auto-response-output.schema.ts
const SourceSchema = z
  .object({
    chunkIndex: z.number().int().min(1),
    usedFor: z.string().min(1).max(200),
  })
  .strict();

export const AutoResponseOutputSchema = z.discriminatedUnion('respondable', [
  z
    .object({
      respondable: z.literal(true),
      respuesta: z.string().min(1),
      confianza: z.number().min(0).max(1),
      sources: z.array(SourceSchema).min(1),
    })
    .strict(),
  z
    .object({
      respondable: z.literal(false),
      motivo: z.string().min(1).max(500),
      confianza: z.number().min(0).max(1),
    })
    .strict(),
]);

// ai-response.schema.ts (la entidad expuesta al cliente)
export const AiResponseSourceSchema = z
  .object({
    chunkId: IdSchema,
    documentId: IdSchema,
    parentDocumentId: IdSchema,
    position: z.number().int().min(0),
    score: z.number(),
    usedFor: z.string(),
    documentTitle: z.string(), // populated por backend
    contentSnippet: z.string(), // primeros 280 chars del chunk
  })
  .strict();

export const AiResponseSchema = z
  .object({
    id: IdSchema,
    ticketId: IdSchema,
    estado: AiResponseEstadoSchema,
    respondable: z.boolean(),
    motivoNoRespondable: z.string().nullable(),
    originalAiContent: z.string().nullable(),
    content: z.string().nullable(),
    confianza: z.number(),
    sources: z.array(AiResponseSourceSchema),
    approvedBy: IdSchema.nullable(),
    approvedAt: z.string().datetime().nullable(),
    editedBy: IdSchema.nullable(),
    editedAt: z.string().datetime().nullable(),
    discardedBy: IdSchema.nullable(),
    discardedAt: z.string().datetime().nullable(),
    discardReason: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

// approve-with-changes.schema.ts
export const ApproveWithChangesSchema = z
  .object({
    respuestaFinal: z.string().min(1).max(10000).trim(),
  })
  .strict();

// discard-response.schema.ts
export const DiscardResponseSchema = z
  .object({
    motivo: z.string().min(1).max(500).trim(),
  })
  .strict();
```

---

### 3.10 `notifications/`

```typescript
export const NotificationSchema = z
  .object({
    id: IdSchema,
    type: z.string(), // EventName de tikora-events.md
    ticketId: IdSchema.nullable(),
    payload: z.record(z.unknown()),
    read: z.boolean(),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const UnreadCountSchema = z
  .object({
    count: z.number().int().min(0),
  })
  .strict();
```

---

### 3.11 `feedback/`

```typescript
export const ClassificationFeedbackSchema = z
  .object({
    veredicto: z.enum(['correcta', 'area_incorrecta', 'prioridad_incorrecta', 'ambas_incorrectas']),
    areaCorrectaId: IdSchema.optional(),
    prioridadCorrecta: PrioridadSchema.optional(),
    comentario: z.string().max(1000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.veredicto === 'area_incorrecta' || d.veredicto === 'ambas_incorrectas') {
      if (!d.areaCorrectaId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['areaCorrectaId'],
          message: 'Indicá el área correcta',
        });
      }
    }
    if (d.veredicto === 'prioridad_incorrecta' || d.veredicto === 'ambas_incorrectas') {
      if (!d.prioridadCorrecta) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prioridadCorrecta'],
          message: 'Indicá la prioridad correcta',
        });
      }
    }
  });
```

---

### 3.12 `admin/`

```typescript
// thresholds.schema.ts
export const ThresholdsSchema = z
  .object({
    umbralConfianzaClasificacion: z.number().min(0).max(1),
    umbralRelevanciaKb: z.number().min(0).max(1),
    umbralAutoAutonoma: z.number().min(0).max(1),
    autoAutonomaSampleRate: z.number().min(0).max(1),
  })
  .strict();

export const UpdateThresholdsSchema = ThresholdsSchema.partial().superRefine((d, ctx) => {
  if (
    d.umbralAutoAutonoma !== undefined &&
    d.umbralConfianzaClasificacion !== undefined &&
    d.umbralAutoAutonoma < d.umbralConfianzaClasificacion
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['umbralAutoAutonoma'],
      message: 'umbralAutoAutonoma no puede ser menor que umbralConfianzaClasificacion',
    });
  }
});

// sla-config.schema.ts
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SlaConfigSchema = z
  .object({
    timezone: z.string().min(1),
    businessHoursStart: z.string().regex(HHMM, 'Formato HH:mm requerido'),
    businessHoursEnd: z.string().regex(HHMM, 'Formato HH:mm requerido'),
    slaReopenGraceDays: z.number().int().min(1).max(60),
    slaAutoCloseDays: z.number().int().min(1).max(365),
  })
  .strict()
  .refine((d) => d.businessHoursStart < d.businessHoursEnd, {
    message: 'businessHoursStart debe ser anterior a businessHoursEnd',
    path: ['businessHoursEnd'],
  });

export const UpdateSlaConfigSchema = SlaConfigSchema.partial();
```

---

## 4. Convenciones de uso

### 4.1 En el backend

```typescript
// users.controller.ts
import { CreateUserSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

class CreateUserDto extends createZodDto(CreateUserSchema) {}

@Post()
@Roles('lider', 'admin')
async create(@Body() dto: CreateUserDto) {
  return this.usersService.create(dto);
}
```

### 4.2 En el frontend

```typescript
// features/users/components/create-user-form.tsx
import { CreateUserSchema, type CreateUser } from '@tikora/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const form = useForm<CreateUser>({
  resolver: zodResolver(CreateUserSchema),
  defaultValues: { email: '', fullName: '', role: 'agente', areaIds: [], temporaryPassword: '' },
});
```

---

## 5. Reglas para implementadores

- **Nada de Zod en `apps/back` o `apps/front`.** Si un schema vive solo en un lado, va dentro de su `apps/<x>/src/...`, pero **nunca** se duplica entre lados.
- **Cambios al schema = breaking change potencial.** Si un campo se renombra o cambia tipo, evaluar si hay clientes que dependan del shape anterior y, si es necesario, lanzar una v2 del schema.
- **Naming consistente:** sustantivo del recurso en singular, sufijo `Schema`. Inputs llevan prefijo `Create`, `Update`, `<Acción>`.
- **`.strict()` por defecto.** Object schemas deben rechazar campos extra. Si se necesita laxitud puntual, justificarlo.
- **Tipos exportados:** cada schema exporta también su tipo inferido. Frontend y backend siempre consumen el tipo, nunca redeclaran.
- **Mensajes de validación:** específicos del negocio van inline en el schema (ya en español); los genéricos los provee el `errorMap` global.
- **Tests del paquete:** `packages/core` tiene tests propios con casos válidos/inválidos para cada schema, ejecutados en el mismo runner Vitest.
