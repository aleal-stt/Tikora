# Tikora Frontend

## 1. Descripción General

Frontend de **Tikora**, plataforma interna de gestión de tickets potenciada por IA. Construido como **SPA (Single Page Application)** con **React 18+** y **Vite**, escrito en **TypeScript**. Estilizado con **Tailwind CSS v4** y **shadcn/ui** como base de componentes. Estado del servidor con **TanStack Query**, estado del cliente con **Zustand**. Routing con **React Router v7**. Validación de formularios con **React Hook Form + Zod** (schemas compartidos desde `@tikora/core`). Tablas con **TanStack Table**. Gráficos con **Recharts**. Iconografía con **Heroicons**. Notificaciones efímeras con **sonner**.

La aplicación es mono-tenant en MVP pero está preparada para multi-tenant: el `tenantId` se resuelve siempre desde el JWT del backend y nunca se expone como parámetro de ruta o query del cliente.

Idioma de la interfaz: **español neutro empresarial**.

---

## 2. Stack Tecnológico

- **Runtime y bundler:** Vite, Node.js
- **Lenguaje:** TypeScript (estricto)
- **Framework:** React 18+
- **Routing:** React Router v7 (modo data router)
- **Estilos:** Tailwind CSS v4
- **Componentes base:** shadcn/ui
- **Iconos:** Heroicons v2 (outline, stroke 1.5)
- **Tipografía:** Inter
- **Estado del servidor:** TanStack Query v5
- **Estado del cliente:** Zustand
- **Formularios:** React Hook Form + `@hookform/resolvers/zod`
- **Tablas:** TanStack Table v8 (headless)
- **Gráficos:** Recharts
- **Notificaciones (toast):** sonner
- **Realtime:** EventSource (SSE) con cliente custom
- **HTTP:** fetch nativo + interceptor con refresh automático
- **Testing:** Vitest + Testing Library + Playwright (E2E)
- **i18n:** ninguna en MVP. Solo español.
- **Modo oscuro:** no en MVP (planificado para fase posterior).

---

## 3. Identidad Visual y Marca

### 3.1 Logo (isotipo)

Cuadrado **"TIK"** con gradiente azul→sky.

- Tamaño base: 36×36 px (`rounded-lg`).
- Gradiente: `bg-gradient-to-br from-blue-600 to-sky-500`.
- Texto interno: `TIK` en `text-white font-bold tracking-tight`.
- Sombra suave: `shadow-md shadow-blue-200`.
- Componente: `components/brand/tikora-logo.tsx`.

No se usa wordmark en el header en MVP. El isotipo va solo.

### 3.2 Paleta

#### Primarios (marca)
```
blue-600   (#2563eb)  — primario principal
blue-700   (#1d4ed8)  — hover primario, links activos
blue-50    (#eff6ff)  — fondo suave de info, banners
sky-500    (#0ea5e9)  — accent secundario
sky-400    (#38bdf8)  — hover accent
```

#### Gradiente de marca
```
bg-gradient-to-br from-blue-600 to-sky-500
```
Uso: logo, focus rings opcionales, acentos decorativos. Reservado para zonas con peso de marca; no se aplica indiscriminadamente.

#### Neutros (familia slate)
```
white       (#ffffff)  — superficie principal, cards
slate-50    (#f8fafc)  — fondo de página, hover de filas de tabla
slate-100   (#f1f5f9)  — separadores suaves, tabla zebra
slate-200   (#e2e8f0)  — bordes, divisores, bordes de inputs
slate-400   (#94a3b8)  — texto muted, placeholders, iconos inactivos
slate-500   (#64748b)  — texto secundario
slate-700   (#334155)  — texto en botones secundarios
slate-900   (#0f172a)  — texto principal, títulos
```

#### Estados
```
red-50/200/600/700        — error, destructivo
amber-50/200/600/700      — advertencia, SLA en zona amarilla
emerald-50/200/500/600    — éxito, SLA verde, indicadores activos
slate-200/500             — neutro, deshabilitado
```

### 3.3 Regla absoluta de paleta

NO crear colores fuera de los listados. Cualquier necesidad de tono nuevo se discute y se incorpora a esta sección antes de implementarse.

### 3.4 Tipografía

Fuente: **Inter** (self-hosted vía `@fontsource-variable/inter` para no depender de CDN externo en runtime).

Stack fallback: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

Pesos cargados: 400, 500, 600, 700.

#### Escala
```
text-[11px]  — micro labels (tabla densa, badges compactos)
text-xs      — metadata, mensajes auxiliares, timestamps
text-sm      — body, inputs, botones, filas de tabla
text-base    — párrafos
text-lg      — títulos de card
text-xl      — títulos de sección
text-2xl     — títulos de página (mobile)
text-3xl     — títulos de página (desktop)
```

#### Pesos por uso
```
font-medium    (500)  — labels, items de navegación, badges
font-semibold  (600)  — botones, links activos, subtítulos, números destacados
font-bold      (700)  — títulos, headings, isotipo
```

#### Reglas de tipografía
- Títulos principales: `text-2xl sm:text-3xl font-bold text-slate-900`.
- Subtítulos / descripciones: `text-sm text-slate-500`.
- Body: `text-sm text-slate-700`.
- Muted: `text-xs text-slate-500`.
- Links: `text-blue-600 hover:text-blue-700 font-medium`.
- Mensajes de error: `text-xs text-red-600`.

### 3.5 Iconografía

- Set: **Heroicons v2** (`@heroicons/react/24/outline`).
- Stroke: 1.5 (default del set outline).
- Tamaño estándar: `w-5 h-5`.
- Tamaño compacto (en tabla densa, badges): `w-4 h-4`.
- Color por defecto: `text-slate-500`.
- Re-export centralizado en `components/icons/index.tsx` para los iconos usados con frecuencia.

### 3.6 Densidad visual

La interfaz es **compacta**: bandejas, listados y tablas priorizan ver muchos datos a la vez sobre el aire visual.

Reglas:
- Filas de tabla: altura entre 40 y 44 px (mínimo por accesibilidad de click).
- Padding de cards: `p-4` por defecto, `p-5` solo para cards principales del detalle.
- Espaciado entre items en listas: `space-y-2`.
- Botones de acción dentro de tablas: `size="sm"` (`h-8`, `text-xs`).
- Inputs en formularios: `h-10` por defecto. En filtros y búsqueda inline: `h-9`.

### 3.7 Bordes y radios

```
rounded-md     (0.375rem)  — botones secundarios, badges
rounded-lg     (0.5rem)    — cards internas, filas de timeline
rounded-xl     (0.75rem)   — inputs, botones primarios, alertas, cards principales
rounded-2xl    (1rem)      — modales, popovers grandes
rounded-full   (999px)     — avatares, semáforos SLA, indicadores circulares
```

#### Bordes de input por estado
```
Normal:   border border-slate-200 bg-white
Hover:    border-slate-300
Focus:    border-blue-500 ring-2 ring-blue-500/20
Error:    border-red-300 bg-red-50/50
Disabled: border-slate-200 bg-slate-50 text-slate-400
```

### 3.8 Sombras

```
shadow-sm     — cards de tabla, filas elevadas
shadow-md     — cards flotantes, dropdowns
shadow-lg     — modales, drawers
shadow-xl     — popovers de búsqueda global, command palette
```

Sombras tintadas se reservan para acentos puntuales (`shadow-blue-200/50` en el logo y en hover del botón primario). No se generaliza.

### 3.9 Animaciones

- Transición estándar: `transition-all duration-200`.
- Hover de filas: `hover:bg-slate-50` con la misma transición.
- Modales: fade + scale (default de shadcn `Dialog`).
- Toasts: slide desde abajo (default de sonner).
- Sin animaciones decorativas pesadas. El movimiento siempre comunica algo funcional (entrada/salida de elementos, feedback de acción).

### 3.10 Tono de la interfaz

- **Español neutro empresarial.** Sin voseo, sin tuteo coloquial.
- Mensajes claros y directos: "Crear ticket", "Tomar ticket", "Resolver".
- Errores de auth genéricos: "Credenciales inválidas" (no revelar si el email existe).
- Empty states cordiales pero concisos: "No hay tickets en tu bandeja".
- Sin emojis decorativos en la UI principal. Iconos de Heroicons cumplen ese rol.

---

## 4. Arquitectura y Patrones

### 4.1 SPA con Vite + React Router v7

La app es una SPA: bundle único en cliente, navegación sin recarga. El backend de Tikora sirve solo la API (`/api/v1`); el HTML estático del frontend se sirve por separado (CDN, nginx, etc.).

**React Router v7 en modo data router** habilita:
- Loaders por ruta para fetch paralelos al render (cuando aplique).
- `errorElement` por ruta para errores localizados.
- Nested layouts y outlets.
- Lazy loading de páginas.

Reglas:
- Toda nueva ruta se registra en `pages/routes.tsx` (configuración centralizada).
- Las páginas que requieren autenticación van bajo el layout `AppShell`.
- Las páginas con permisos de rol específico se envuelven con `<RequireRole roles={[...]}>`.

### 4.2 Tailwind v4 + shadcn/ui

Tailwind v4 cambia la configuración a CSS (`@theme` block) y usa Lightning CSS para builds más rápidos. Los tokens de diseño viven como custom properties.

**shadcn/ui** se usa como sistema de componentes base. No es una librería instalada como dependencia: los componentes se copian al repo en `components/ui/` y se modifican según necesidad.

Reglas:
- **No editar primitives de shadcn** salvo cambios menores de estilo. Para variaciones, crear wrappers en `components/atoms` o `molecules` que usen el primitive.
- Toda variación visual se logra por composición + className, no por sobrescribir el primitive.
- El comando `npx shadcn add <component>` se usa para agregar nuevos primitives. Tras agregarse, se reformatean para coincidir con la paleta de Tikora si hace falta.

### 4.3 Estado del servidor con TanStack Query

Toda data del backend pasa por TanStack Query. Cero `useEffect + fetch + setState` para data del servidor.

Convenciones:
- **Query keys jerárquicas**:
  - `['tickets', filters]` — listado.
  - `['ticket', id]` — detalle.
  - `['areas']`, `['area', id]`, `['users']`, `['kb', 'documents', filters]`.
- **Mutaciones invalidan queries específicas** tras éxito.
- **Defaults globales** en `lib/query-client.ts`:
  - `staleTime`: 30 s.
  - `gcTime`: 5 min.
  - `refetchOnWindowFocus`: true para listados, false para detalles abiertos.
  - `placeholderData: keepPreviousData` en listados con paginación.
- **Hooks por feature**: `useTickets()`, `useTicketDetail(id)`, `useCreateTicket()`. Viven en `features/{feature}/api/`.
- **MSW** para mockear el backend en tests de integración.

### 4.4 Estado del cliente con Zustand

Zustand maneja estado de UI no derivado del servidor:

| Store | Contenido |
|---|---|
| `useAuthStore` | Access token (in-memory), usuario actual, rol, áreas. |
| `useNotificationsStore` | Cola de no leídas, contador para la campanita. |
| `useUIStore` | Sidebar abierto, command palette abierto, modal global. |
| `useFiltersStore` | Filtros persistentes de la bandeja (con `persist` middleware). |

Reglas:
- **Nunca duplicar data del servidor** en Zustand. Si viene del backend, vive en TanStack Query.
- Cada store en su archivo. Selectors granulares al lado.
- Los stores que requieren persistencia usan el middleware `persist` con clave prefijada (`tikora.filters`, etc.).

### 4.5 Formularios con React Hook Form + Zod

Toda forma usa React Hook Form con `zodResolver`. Los schemas vienen de `@tikora/core` — los mismos que valida el backend.

```typescript
import { CreateTicketSchema } from '@tikora/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const form = useForm({
  resolver: zodResolver(CreateTicketSchema),
  defaultValues: { asunto: '', cuerpo: '' },
});
```

Esto garantiza que el frontend valida exactamente lo mismo que el backend, sin divergencia.

El componente `Form` de shadcn (`FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`) es el wrapper estándar para todos los formularios.

### 4.6 Auth flow en el cliente

Estrategia: **access token en memoria + refresh token en cookie httpOnly**.

#### Reglas
- El **access token** vive solo en memoria (`useAuthStore`). Nunca toca `localStorage`.
- El **refresh token** se guarda en una cookie `httpOnly`, `Secure`, `SameSite=Lax` emitida por el backend. JavaScript no puede leerla — mitiga XSS.
- Al arrancar la app (`AppShell` mounting), se llama `POST /auth/refresh` automáticamente. Si la cookie sigue válida, se obtiene un nuevo access token y se restaura la sesión. Si no, redirige a `/login`.

#### Interceptor de fetch
- Antes de cada request, inyecta `Authorization: Bearer {accessToken}`.
- Si la respuesta es `401` y el endpoint **no es** `/auth/refresh`:
  1. Llama `POST /auth/refresh` con la cookie.
  2. Si OK: actualiza el store y reintenta el request original (una sola vez).
  3. Si falla: dispara logout y redirige a login.
- Para evitar refrescos concurrentes, el cliente HTTP guarda un `refreshPromise` en vuelo: los demás 401 esperan al mismo promise.
- El interceptor vive en `lib/api-client.ts`. Todo el código del frontend consume `apiClient.get/post/patch/delete`, nunca fetch directo.

#### Logout multi-pestaña
- El logout local hace `localStorage.setItem('tikora.logout', String(Date.now()))`.
- Otras pestañas escuchan el evento `storage` y limpian su sesión.
- El backend invalida el refresh token y limpia la cookie en su lado.

### 4.7 Realtime con SSE — conexión global

Una sola conexión SSE por sesión, establecida en `AppShell` cuando el usuario está autenticado:
- Endpoint: `${VITE_SSE_URL}` (ej. `/api/v1/notifications/stream`).
- Reconexión automática con backoff exponencial.
- Soporta `Last-Event-ID` para reanudar el stream tras desconexión.
- El JWT viaja como query param firmado con vida corta o como header (según lo que el backend exponga; coordinado con la doc del backend).

#### Mapeo de eventos SSE → reacciones del cliente

| Evento del backend | Reacción en el cliente |
|---|---|
| `TicketAssigned` | Toast + `invalidateQueries(['tickets'])` + `invalidateQueries(['notifications'])`. |
| `TicketEscalated` | Badge en bandeja del área (sin toast) + `invalidate(['tickets'])`. |
| `TicketUpdated` | `invalidate(['ticket', id])` si está abierto + `invalidate(['tickets'])`. |
| `TicketReopened` | Toast + `invalidate(['ticket', id])`. |
| `AiResponseSuggested` (Fase 2) | Toast + badge en ticket + `invalidate(['ticket', id])`. |
| `SlaApproaching` | Toast + `invalidate` para refrescar el semáforo. |
| `SlaBreach` | Toast destacado en rojo + `invalidate`. |
| `NotificationCreated` | `useNotificationsStore.add(notif)` + incrementa contador. |

El listener vive en `lib/sse-client.ts`. Dispatcha a:
- `queryClient.invalidateQueries(...)`.
- `useNotificationsStore.getState().add(notification)`.
- `toast.success(...)` / `toast.error(...)` según el evento.

### 4.8 Optimistic updates

| Acción | Optimistic | Justificación |
|---|:---:|---|
| Tomar ticket | ✅ | Feedback inmediato; ante error se revierte. |
| Resolver ticket | ✅ | Igual. |
| Marcar notificación como leída | ✅ | Cambio trivial reversible. |
| Crear ticket | ❌ | El ID y la clasificación dependen del backend. |
| Reasignar a otra área | ❌ | Requiere validación de permisos del backend. |
| Cancelar ticket | ❌ | Acción terminal: esperar confirmación. |
| Aprobar/editar/descartar respuesta IA | ❌ | Acción crítica; esperar confirmación. |
| CRUD de áreas, usuarios, KB | ❌ | Acciones administrativas con efectos compuestos. |

---

## 5. Mapa de Pantallas y Rutas

### 5.1 Públicas
- `/login` — formulario de autenticación.

(En MVP no hay registro abierto ni recuperación de contraseña: los usuarios los crea el admin.)

### 5.2 Protegidas — todos los roles
- `/` — redirección a la vista por defecto del rol (solicitante → `/mis-tickets`, agente/líder → `/bandeja`, admin → `/admin/metricas`).
- `/perfil` — datos del usuario, cambio de contraseña.
- `/notificaciones` — listado completo de notificaciones.
- `/buscar?q=...` — resultado de la búsqueda global.

### 5.3 Solicitante (empleado)
- `/mis-tickets` — listado de tickets que creó el usuario.
- `/mis-tickets/nuevo` — formulario de creación.
- `/tickets/:id` — detalle (vista limitada, sin acciones de agente).

### 5.4 Agente
- `/bandeja` — bandeja de tickets de las áreas a las que pertenece.
- `/tickets/:id` — detalle completo + acciones del agente.

### 5.5 Líder de área
Hereda lo del agente, más:
- `/area/:areaId/metricas` — métricas del área que lidera.
- `/area/:areaId/agentes` — alta/baja de agentes del área.
- `/area/:areaId/kb` — gestión de documentos KB del área.

### 5.6 Administrador
Hereda todo lo anterior, más:
- `/admin/usuarios` — gestión de usuarios del tenant.
- `/admin/areas` — gestión de áreas (crear, editar, asignar líderes).
- `/admin/slas` — configuración de SLAs por área.
- `/admin/umbrales-ia` — configuración de umbrales (clasificación, KB, autónomo).
- `/admin/kb` — gestión de KB global.
- `/admin/metricas` — métricas globales del tenant.
- `/admin/logs-ia` — logs de llamadas a la IA con detalle.

Cada sección de admin es **una página separada** accesible desde el sidebar admin. No hay tabs unificadas: cada concepto vive en su propia URL.

### 5.7 Layouts

| Layout | Uso |
|---|---|
| `RootLayout` | Wrapper de toda la app: providers (QueryClient, Toaster, ThemeProvider). |
| `AuthLayout` | Layout para `/login`. Centrado, sin sidebar ni header. |
| `AppShell` | Layout principal autenticado: header (logo, búsqueda, campanita, perfil) + sidebar de navegación + content area. Inicia la conexión SSE. |
| `AdminLayout` | Extiende AppShell con un sidebar secundario para configuración admin. |

---

## 6. Componentes y Patrones UX Clave

### 6.1 Bandeja de tickets — tabla densa

Vista principal del agente y líder. **TanStack Table** + componentes shadcn `Table`.

#### Columnas estándar
- Checkbox de selección (para acciones bulk en fases posteriores).
- ID corto del ticket (formato `TIK-1234`).
- Asunto (truncado a 60 chars con tooltip al hover).
- Solicitante (nombre + email muted).
- Área (badge con color asignado al área).
- Prioridad (badge: alta / media / baja con color de estado).
- Estado (badge con label corto — ver sección 6.10).
- SLA (semáforo + tiempo restante en texto).
- Asignado (avatar + nombre, o "—" si está libre).
- Última actualización (relativa, ej. "hace 5 min").

#### Filtros
Sidebar lateral o popover en mobile:
- Estado (multi-select).
- Prioridad (multi-select).
- Área (multi-select; solo para líder/admin).
- Etiquetas / tags (multi-select).
- Rango de fecha (creación).
- Búsqueda libre (asunto + cuerpo).
- Toggle "Asignados a mí".

Los filtros activos se reflejan en la URL (querystring) y se persisten en `useFiltersStore` para que el agente recupere su vista al volver.

#### Comportamiento
- Paginación cursor-based (50 ítems por página).
- Sort por columna: SLA (default ascendente), prioridad, fecha.
- Click en fila → navega a `/tickets/:id`.
- Hover de fila: `bg-slate-50`.
- Filas sin asignar tienen un indicador sutil a la izquierda (`border-l-2 border-blue-500`).
- Refresh automático cuando llegan eventos SSE relevantes (no se rompe la sesión del usuario).

### 6.2 Detalle de ticket — split layout

Layout de dos columnas en desktop, apilado en mobile.

#### Columna izquierda (`flex-1`) — Timeline
- Encabezado: ID, asunto, estado actual con badge, semáforo SLA.
- Lista cronológica de **interacciones**:
  - **Sistema** (creación, clasificación, escalado, asignaciones, transiciones de estado).
  - **IA** (clasificación con confianza y tags; respuesta sugerida si Fase 2).
  - **Agente** (notas internas, respuestas enviadas).
  - **Solicitante** (mensajes entrantes).
- Cada entrada con icono de origen, autor, timestamp, contenido.
- Editor inline al final: textarea `text-plain` con botón "Resolver" (manda nota + correo y cierra el ticket) y botón "Guardar nota" (solo persiste internamente, sin correo).

#### Columna derecha (sidebar 320 px) — Metadata + acciones
Cards apiladas:
- **Detalles**: solicitante, área, prioridad, fecha de creación, deadline SLA, agente asignado, etiquetas.
- **Adjuntos**: lista compacta con thumbnails de imágenes / iconos para otros tipos.
- **Clasificación IA** (colapsable): confianza, modelo, prompt version, tags, score top de KB si aplica.
- **Acciones** (visible según rol y estado actual del ticket):
  - **Tomar ticket** (botón único primario, prominente).
  - **Resolver** (con campo de nota + envío de correo desde plataforma).
  - **Reasignar dentro del área** (agente/líder).
  - **Reasignar a otra área** (líder/admin).
  - **Reabrir** (si está cerrado y dentro de la ventana de gracia de 5 días hábiles).

En mobile la sidebar colapsa abajo del timeline.

### 6.3 Crear ticket (solicitante)

Formulario simple. **Sin selección manual de área**: la IA clasifica.

#### Campos
- **Asunto** — input, validación: 5–120 caracteres.
- **Cuerpo** — textarea con auto-resize, mínimo 4 filas. Validación: 10–5000 caracteres.
- **Adjuntos** — drop zone (ver §6.7).

#### UX
- Validación inline con Zod.
- Submit deshabilitado hasta cumplir mínimos.
- Al crear: redirige a `/tickets/:id` con toast "Ticket creado, lo estamos clasificando".
- El detalle muestra estado `Recibido` con un placeholder "Clasificando…" hasta que llega el evento SSE `TicketUpdated` con la clasificación.

#### Visibilidad para el solicitante
Una vez clasificado, el solicitante **ve el área asignada y la prioridad** en el detalle. No ve la confianza ni los tags internos.

### 6.4 Modal de aprobación de respuesta IA (Fase 2)

Cuando hay una `AiResponseSuggested` y el agente abre el ticket, ve un banner: "Respuesta sugerida disponible". Click abre un modal grande (`max-w-3xl`).

#### Contenido del modal
- **Texto sugerido** — textarea editable, **texto plano** (sin rich editor en MVP).
- **Confianza de la respuesta** — badge con color (verde > 0.85, amarillo > 0.7, rojo si menor).
- **Fuentes consultadas** — cards expandibles, una por chunk:
  - Header: documento + posición + score.
  - Body al expandir: contenido completo del chunk.
  - Etiqueta `usedFor` que indica para qué parte de la respuesta se usó.
- **Acciones**:
  - **Aprobar y enviar** (primario) — manda tal cual.
  - **Aprobar con cambios** — manda lo editado, persiste el diff respecto al original.
  - **Descartar** — pide motivo libre, ticket vuelve a `escalado`.

Si el agente edita el texto, "Aprobar y enviar" se reemplaza automáticamente por "Aprobar con cambios".

### 6.5 Indicador de SLA — semáforo + tiempo

Componente `<SlaIndicator deadline={...} />`.

| Tiempo restante | Color | Clase |
|---|---|---|
| > 50 % del SLA total | Verde | `bg-emerald-500` |
| 25 % – 50 % | Amarillo | `bg-amber-500` |
| < 25 % o vencido | Rojo | `bg-red-500` |

#### Render
- Punto circular `w-2.5 h-2.5 rounded-full` con el color del estado.
- Texto al lado: `"2h 15m"` (relativo restante) o `"vencido hace 1h 12m"` (rojo intenso).
- Tooltip al hover: deadline absoluto formateado.

Se actualiza cada minuto vía hook `useSlaTick()` (interval que invalida queries de bandeja con SLA visible).

### 6.6 Búsqueda global — barra fija en el header

Input con icono de lupa visible en el header de `AppShell`. Al escribir 3+ caracteres:

- Dropdown con resultados agrupados:
  - **Tickets** (asunto, ID, snippet del cuerpo).
  - **KB** (título del documento, snippet).
  - **Usuarios** (solo admin/líder).
- Click en resultado → navega.
- Enter sin resultado seleccionado → `/buscar?q=...` (vista completa con todos los matches).

Atajo: `/` enfoca el input. `Esc` cierra el dropdown.

### 6.7 Adjuntos — drag & drop

#### Drop zone
- Área destacada con borde dashed: `border-2 border-dashed border-slate-300 rounded-xl`.
- Estados:
  - Idle: gris.
  - Drag-over: `border-blue-500 bg-blue-50`.
  - Uploading: progreso visible.
  - Error: borde rojo + mensaje.
- Click abre el selector de archivo nativo.
- Validación cliente: tipos permitidos (PDF, PNG, JPG, JPEG, GIF, WEBP, TXT, CSV, XLSX, DOCX), tamaño máx 10 MB, cantidad máx 5.

#### Render de adjuntos en el detalle
- **Imágenes**: thumbnail 64×64 px (`object-cover rounded-lg`). Click abre lightbox.
- **PDFs**: icono PDF + nombre + tamaño. Click abre en nueva pestaña.
- **Otros**: icono genérico + nombre + tamaño. Click descarga.
- Botón eliminar (X discreto) si el ticket aún no fue tomado.

### 6.8 Notificaciones

#### Tres lugares
1. **Campanita en el header** — icono con badge numérico (no leídas). Click abre popover con últimas 10. Click en una notificación → navega al ticket + marca como leída.
2. **Toast efímero** (sonner) — al recibir un evento SSE relevante. Auto-dismiss en 5 s. Click navega.
3. **Página `/notificaciones`** — listado completo paginado con filtros (leídas / no leídas, tipo, fecha).

Estado en `useNotificationsStore`. Sincronización con backend al login (`GET /notifications`) y vía SSE (`NotificationCreated`).

### 6.9 Empty states

Mismo patrón en toda la app: **icono Heroicon + título corto + descripción + CTA cuando aplique**.

```
[ Icono w-12 h-12 text-slate-300 ]
Título: text-base font-semibold text-slate-900
Descripción: text-sm text-slate-500
CTA opcional: botón primario
```

Ejemplos:
- Bandeja vacía: `InboxIcon` + "No hay tickets en tu bandeja" + "Cuando un ticket se asigne a tu área aparecerá acá".
- Sin notificaciones: `BellSlashIcon` + "Sin notificaciones nuevas".
- Sin resultados: `MagnifyingGlassIcon` + "No encontramos resultados" + "Probá con otras palabras".

### 6.10 Labels cortos para estados de ticket

Los estados internos del ticket se renderizan en UI con labels más cortos y humanos:

| Estado interno | Label en UI | Color de badge |
|---|---|---|
| `recibido` | Recibido | slate |
| `clasificado` | Clasificado | blue |
| `requiere_revision_clasificacion` | Revisar IA | amber |
| `escalado` | Escalado | blue |
| `en_progreso` | En progreso | sky |
| `cerrado` | Cerrado | emerald |
| `reabierto` | Reabierto | amber |
| `cancelado` | Cancelado | slate |

Helper `getTicketStateLabel(state)` y `getTicketStateColor(state)` viven en `lib/ticket-state.ts`. Nunca hardcodear el mapeo en componentes.

### 6.11 Permisos en UI — ocultar, no deshabilitar

Las acciones que el rol actual no puede ejecutar **se ocultan**. Hook `usePermissions()` lee el rol y áreas del `useAuthStore` y expone helpers:

```typescript
const can = usePermissions();

{can.takeTicket(ticket) && <Button onClick={...}>Tomar</Button>}
{can.reassignToOtherArea(ticket) && <Button onClick={...}>Mover a otra área</Button>}
```

La matriz de permisos se replica desde el backend (es la misma definida en la doc de backend) y vive en `lib/permissions.ts` como fuente única dentro del frontend.

### 6.12 Loading y error states

#### Loading
- **Skeletons** (`animate-pulse bg-slate-100 rounded-lg`) para listados y detalle.
- **Spinner inline** para botones de acción mientras la mutación está en vuelo.
- Sin overlays bloqueantes salvo en envíos de formularios largos.

#### Error
- **Error boundary global** captura crashes y muestra `ErrorPage` con CTA "Volver al inicio".
- Errores de red se traducen a toasts con mensaje en español.
- **Página 404** dedicada para rutas no encontradas.
- Errores de permisos (`403`) renderizan una página dedicada "No tenés acceso a esta sección".

---

## 7. Estructura de Carpetas

Estructura **mixta**: atomic design para componentes reutilizables + feature folders para dominios.

```
apps/front/
├── src/
│   ├── main.tsx                       # bootstrap React
│   ├── App.tsx                        # provider tree + router
│   ├── components/                    # reutilizables, agnósticos al dominio
│   │   ├── ui/                        # shadcn primitives (button, input, dialog…)
│   │   ├── atoms/                     # badges, sla-dot, avatar, kbd, etc.
│   │   ├── molecules/                 # form-field, search-input, empty-state, etc.
│   │   ├── organisms/                 # data-table, header, sidebar, command-palette
│   │   ├── brand/                     # tikora-logo
│   │   └── icons/                     # re-exports de Heroicons usados
│   ├── features/                      # por dominio
│   │   ├── auth/
│   │   │   ├── api/                   # hooks de TanStack Query
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   ├── tickets/
│   │   ├── kb/
│   │   ├── notifications/
│   │   ├── areas/
│   │   ├── users/
│   │   ├── sla/
│   │   ├── ai/
│   │   └── admin/
│   ├── pages/                         # rutas (composición de features)
│   │   ├── login.page.tsx
│   │   ├── mis-tickets.page.tsx
│   │   ├── ticket-detail.page.tsx
│   │   ├── bandeja.page.tsx
│   │   ├── perfil.page.tsx
│   │   ├── notificaciones.page.tsx
│   │   ├── buscar.page.tsx
│   │   ├── admin/
│   │   │   ├── usuarios.page.tsx
│   │   │   ├── areas.page.tsx
│   │   │   ├── slas.page.tsx
│   │   │   ├── umbrales-ia.page.tsx
│   │   │   ├── kb.page.tsx
│   │   │   ├── metricas.page.tsx
│   │   │   └── logs-ia.page.tsx
│   │   ├── routes.tsx                 # configuración de React Router v7
│   │   ├── error.page.tsx
│   │   └── not-found.page.tsx
│   ├── layouts/
│   │   ├── auth-layout.tsx
│   │   ├── app-shell.tsx
│   │   └── admin-layout.tsx
│   ├── lib/
│   │   ├── api-client.ts              # fetch + interceptor refresh
│   │   ├── sse-client.ts              # EventSource manager
│   │   ├── query-client.ts            # TanStack QueryClient
│   │   ├── permissions.ts             # matriz RBAC del cliente
│   │   ├── ticket-state.ts            # labels y colores de estado
│   │   ├── format.ts                  # fechas relativas, números
│   │   └── env.ts                     # acceso tipado a import.meta.env
│   ├── stores/                        # Zustand
│   │   ├── auth.store.ts
│   │   ├── notifications.store.ts
│   │   ├── ui.store.ts
│   │   └── filters.store.ts
│   ├── hooks/                         # globales
│   │   ├── use-permissions.ts
│   │   ├── use-debounced-value.ts
│   │   └── use-sla-tick.ts
│   ├── styles/
│   │   └── globals.css                # Tailwind v4 + tokens
│   └── types/
│       └── env.d.ts                   # tipado de env vars
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 7.1 Reglas

- **`components/`** son agnósticos al dominio. Si un componente sabe de "ticket", "área" o "KB", va al feature correspondiente.
- **`features/`** contiene la lógica de cada dominio: hooks de queries, mutaciones, componentes específicos, helpers locales.
- **`pages/`** componen features y layouts. Sin lógica de dominio: solo orquestan.
- **`pages/routes.tsx`** es la única configuración de routing. No se separa en `routes/`.
- **Tests** al lado del archivo (`xxx.test.ts(x)`).
- **Naming**:
  - Componentes: `PascalCase.tsx`.
  - Hooks: `use-*.ts`.
  - Stores: `xxx.store.ts`.
  - Pages: `xxx.page.tsx`.
- **Imports absolutos** con alias `@/`: `import { Button } from '@/components/ui/button';`.

---

## 8. Convenciones de Código

- TypeScript estricto: `strict: true`, `noImplicitAny`, `noUncheckedIndexedAccess`.
- ESLint + Prettier configurados. Imports ordenados con `eslint-plugin-import`.
- Identificadores en inglés, strings de UI en español.
- Texto de UI **nunca** se hardcodea en componentes reutilizables. En MVP se acepta inline en pages/features (futuro: capa de i18n).
- Mensajes de error de auth genéricos (`"Credenciales inválidas"`).
- Comentarios reservados para el porqué no obvio. Identificadores bien nombrados son la documentación principal.

---

## 9. Configuración

### 9.1 Variables de entorno

Archivo `.env` (Vite expone solo las que empiezan con `VITE_`):

| Variable | Descripción | Ejemplo |
|---|---|---|
| `VITE_API_URL` | URL base del backend | `http://localhost:3001/api/v1` |
| `VITE_SSE_URL` | URL del stream SSE | `http://localhost:3001/api/v1/notifications/stream` |
| `VITE_APP_NAME` | Nombre visible | `Tikora` |
| `VITE_ENV` | Ambiente | `development` / `staging` / `production` |
| `VITE_MAX_ATTACHMENT_SIZE_MB` | Espejo del backend para validación cliente | `10` |
| `VITE_MAX_ATTACHMENTS_PER_TICKET` | Espejo del backend | `5` |
| `VITE_PAGE_SIZE` | Tamaño de página default en listados | `50` |

Tipado en `src/types/env.d.ts`:

```typescript
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SSE_URL: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_ENV: 'development' | 'staging' | 'production';
  readonly VITE_MAX_ATTACHMENT_SIZE_MB: string;
  readonly VITE_MAX_ATTACHMENTS_PER_TICKET: string;
  readonly VITE_PAGE_SIZE: string;
}
```

### 9.2 Build

- Dev: `npx nx serve front` (Vite dev server con HMR).
- Build: `npx nx build front` → `dist/` con HTML + JS + CSS estáticos.
- Preview: `npx nx preview front`.

El output se sirve con cualquier static host (CDN, nginx, S3+CloudFront).

---

## 10. Testing

- **Unit + component**: Vitest + Testing Library.
- **E2E**: Playwright cubriendo flujos críticos:
  - Login → bandeja → detalle.
  - Crear ticket → ver clasificación.
  - Tomar ticket → resolver.
  - Aprobar respuesta IA (Fase 2).
  - Reabrir ticket dentro de la ventana de gracia.
- Tests al lado del archivo: `*.test.ts(x)`.
- **MSW** para mockear el backend en tests de integración.
- Comandos:
  ```bash
  npx vitest run apps/front           # unit + component
  npx vitest watch
  npx playwright test                 # E2E
  ```

---

## 11. Reglas para IA

Cuando una IA implementa o modifica el frontend de Tikora, debe respetar:

- **Solo paleta de Tikora** (sección 3.2). Ningún color fuera.
- **Solo Tailwind v4 + clases shadcn**. Sin estilos inline (salvo casos justificados como animaciones dinámicas).
- **Reutilizar primitives de shadcn** y wrappers en `components/`. No reinventar inputs, botones, dialogs.
- **TanStack Query para todo lo del backend**. No `useEffect + fetch + setState`.
- **Zustand solo para UI state**. Nunca duplicar data del servidor.
- **Schemas desde `@tikora/core`**. Nunca redefinir Zod schemas en el frontend.
- **`api-client.ts` para HTTP**. No usar fetch crudo en componentes/features. El interceptor maneja refresh.
- **Permisos vía `usePermissions()`**. Botones se ocultan, no se deshabilitan.
- **Acciones con efecto en el ticket pasan por el backend** y por sus mutations. El frontend no manipula estado del ticket localmente.
- **Validación con `zodResolver`** en todo formulario. Nunca validar a mano.
- **Toasts en español neutro empresarial**. Mensajes de auth genéricos.
- **Tipografía Inter**, escala definida en sección 3.4. No bumpear tamaños arbitrarios.
- **Iconos Heroicons outline `w-5 h-5`** (`w-4 h-4` en tabla densa). No mezclar otros sets.
- **Estructura mixta**: componentes agnósticos en `components/`, lógica de dominio en `features/`. No cruzar.
- **Optimistic updates solo en las acciones autorizadas** (sección 4.8). Para el resto, esperar la respuesta del backend.
- **No introducir librerías nuevas** sin decisión documentada en `decisiones-tecnicas.md`.
- **Labels de estado de ticket** vienen de `lib/ticket-state.ts`. No hardcodear el mapeo.
- **Adjuntos validados en cliente** según los límites del env (espejo del backend) antes de subir.

---

## 12. Comandos Útiles

```bash
# Desarrollo
pnpm install
npx nx serve front                      # Dev server con HMR
npx nx build front                      # Build de producción
npx nx preview front                    # Preview del build

# Testing
npx vitest run apps/front               # Unit + component
npx vitest watch
npx playwright test                     # E2E

# Lint
npx nx run front:lint

# Agregar primitive de shadcn
npx shadcn@latest add button            # ejemplo
```
