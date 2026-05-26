# Tikora — Setup de Desarrollo

> Guía paso a paso para dejar un entorno local listo para desarrollar Tikora desde cero. Cubre prerrequisitos, inicialización del monorepo, servicios externos (MongoDB Atlas, Redis, proveedor LLM compatible con OpenAI SDK — Gemini free tier por default, SMTP para correo transaccional, Sentry opcional), seeds y comandos del día a día.

---

## 1. Prerrequisitos del sistema

| Software | Versión         | Verificación      |
| -------- | --------------- | ----------------- |
| Node.js  | 20 LTS o 22 LTS | `node -v`         |
| pnpm     | 9.x             | `pnpm -v`         |
| Docker   | reciente        | `docker -v`       |
| Git      | reciente        | `git -v`          |
| OpenSSL  | reciente        | `openssl version` |

Recomendado: instalar Node con `nvm` y fijar la versión con `.nvmrc` en la raíz del repo (`20` o `22`).

---

## 2. Estructura final del repositorio

Después del setup, el árbol queda así:

```
Tikora/
├── apps/
│   ├── back/
│   │   ├── src/
│   │   ├── .env                         # local, no versionar
│   │   ├── .env.example                 # versionado
│   │   ├── project.json
│   │   └── tsconfig.json
│   └── front/
│       ├── src/
│       ├── .env
│       ├── .env.example
│       ├── vite.config.ts
│       └── tsconfig.json
├── packages/
│   └── core/                            # @tikora/core
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── tikoraDocs/                          # docs del proyecto
├── nx.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .nvmrc
├── .gitignore
└── docker-compose.dev.yml               # servicios locales (Mongo, Redis)
```

---

## 3. Inicialización del monorepo Nx

Desde la raíz `/home/alejandro/Tikora` con el repo ya inicializado:

```bash
# Workspace base
pnpm init
pnpm dlx create-nx-workspace@latest . --preset=ts --packageManager=pnpm \
  --nxCloud=skip --interactive=false

# Plugins necesarios
pnpm add -Dw @nx/nest @nx/react @nx/vite @nx/js @nx/eslint @nx/workspace
```

### 3.1 Generar las apps y el paquete

```bash
# Backend NestJS
pnpm exec nx g @nx/nest:application back \
  --directory=apps/back --strict --linter=eslint --unitTestRunner=vitest

# Frontend React + Vite
pnpm exec nx g @nx/react:application front \
  --directory=apps/front --bundler=vite --routing=true --style=tailwind \
  --strict --linter=eslint --unitTestRunner=vitest --e2eTestRunner=playwright

# Paquete compartido @tikora/core
pnpm exec nx g @nx/js:library core \
  --directory=packages/core --bundler=tsc --unitTestRunner=vitest \
  --importPath=@tikora/core --strict
```

### 3.2 Dependencias

#### Backend (`apps/back`)

```bash
pnpm add -F back \
  @nestjs/common @nestjs/core @nestjs/platform-express \
  @nestjs/jwt @nestjs/passport @nestjs/event-emitter @nestjs/swagger @nestjs/throttler \
  @nestjs/mongoose mongoose nestjs-zod zod \
  bcryptjs cookie-parser \
  openai \
  bullmq ioredis \
  nodemailer \
  @xenova/transformers \
  date-fns date-fns-tz \
  uuid \
  multer \
  @sentry/node @sentry/profiling-node

pnpm add -DF back \
  @types/bcryptjs @types/cookie-parser @types/multer @types/uuid @types/nodemailer \
  fast-check
```

#### Frontend (`apps/front`)

```bash
pnpm add -F front \
  react@19 react-dom@19 react-router-dom@7 \
  @tanstack/react-query @tanstack/react-table \
  zustand \
  react-hook-form @hookform/resolvers \
  zod \
  date-fns \
  recharts \
  sonner \
  @heroicons/react \
  @fontsource-variable/inter \
  @sentry/react

# shadcn/ui se inicializa después con: pnpm dlx shadcn@latest init
# Tailwind v4 viene del preset --style=tailwind del generador

pnpm add -DF front msw @types/react @types/react-dom
```

#### Core (`packages/core`)

```bash
pnpm add -F core zod
```

### 3.3 Configurar paths de TypeScript

En `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@tikora/core": ["packages/core/src/index.ts"],
      "@/*": ["apps/front/src/*"]
    }
  }
}
```

---

## 4. Servicios externos

### 4.1 MongoDB

#### Opción A — local con Docker (rápido para empezar)

`docker-compose.dev.yml`:

```yaml
services:
  mongo:
    image: mongo:7
    ports:
      - '27017:27017'
    volumes:
      - tikora_mongo_data:/data/db
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - tikora_redis_data:/data
volumes:
  tikora_mongo_data:
  tikora_redis_data:
```

```bash
docker compose -f docker-compose.dev.yml up -d
```

Limitación: **Atlas Vector Search no está disponible en Mongo local**. Para Fase 1 (solo clasificación) Mongo local funciona; para Fase 2 (auto-respuesta con RAG) necesitás un cluster Atlas con el índice vectorial.

#### Opción B — MongoDB Atlas (recomendado para todo el ciclo)

1. Crear cuenta en https://cloud.mongodb.com.
2. Crear un cluster **M0 Free** (suficiente para dev).
3. En "Network Access" agregar la IP local (o `0.0.0.0/0` solo en dev).
4. En "Database Access" crear un usuario con permisos read/write.
5. En "Connect" → "Drivers" copiar la cadena `mongodb+srv://...` al `MONGODB_URI`.

##### Crear el índice de Atlas Vector Search

1. En el cluster → "Atlas Search" → "Create Search Index".
2. Tipo: **Vector Search**.
3. Database: `tikora` (la del `MONGODB_URI`).
4. Collection: `kb_chunks`.
5. Index name: `kb_chunks_vector` (debe coincidir con `MONGODB_VECTOR_INDEX_NAME`).
6. Definición JSON:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine" },
    { "type": "filter", "path": "tenantId" },
    { "type": "filter", "path": "active" },
    { "type": "filter", "path": "scope" },
    { "type": "filter", "path": "areaIds" }
  ]
}
```

7. Guardar y esperar a que el estado pase a "Active".

> El índice se puede crear también vía API. Documentar el comando en `apps/back/scripts/create-vector-index.ts` cuando se necesite automatizar.

### 4.2 Redis

Usado por BullMQ (colas) y por los SSE tickets (TTL 90 s).

- **Local con Docker:** ya cubierto en el `docker-compose.dev.yml` de §4.1A.
- **Cloud:** cualquier Redis 7+. Render, Upstash, Railway, etc.

### 4.3 Proveedor LLM (endpoint OpenAI-compatible)

Tikora habla con el LLM usando el SDK oficial de OpenAI (`openai`) configurado con `baseURL` apuntando a un endpoint OpenAI-compatible. Esto permite usar prácticamente cualquier proveedor (OpenAI, Gemini, OpenRouter, vLLM self-hosted, Ollama, LM Studio, …) cambiando solo variables de entorno — sin tocar código.

**Opción recomendada para piloto gratis: Gemini free tier.**

1. Crear cuenta en https://aistudio.google.com.
2. Generar una API key en https://aistudio.google.com/apikey.
3. Completar `.env` del back:

   ```env
   LLM_API_KEY=AIzaSy...
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   LLM_MODEL_CLASSIFICATION=gemini-2.5-flash
   LLM_MODEL_RESPONSE=gemini-2.5-flash
   LLM_MAX_TOKENS_CLASSIFICATION=2048
   LLM_MAX_TOKENS_RESPONSE=4096
   LLM_PROMPT_CACHE_ENABLED=false
   ```

4. Verificar acceso disparando un ticket y observando logs del worker (`[ClassificationProcessor]` debe completar sin 4xx).

**Notas sobre cuotas (Gemini free tier):**

- ~15 RPM en `gemini-2.5-flash`. BullMQ ya reintenta con backoff, pero no testees varios tickets en sucesión rápida.
- `gemini-2.5-flash` reserva tokens internos para "thinking"; por eso los defaults de `LLM_MAX_TOKENS_*` están más altos que en un modelo regular. Bajarlos puede hacer que `completion_tokens=0` y la respuesta visible quede vacía.
- Si tu cuenta no tiene cuota en algún modelo (visible como `limit: 0` en el 429), probar otro modelo dentro del mismo free tier.

**Cambiar de proveedor:** solo modificar `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL_*`. Ejemplos:

| Proveedor        | `LLM_BASE_URL`                                             | `LLM_MODEL_*` ejemplo    |
| ---------------- | ---------------------------------------------------------- | ------------------------ |
| OpenAI           | `https://api.openai.com/v1`                                | `gpt-4o-mini`, `gpt-4o`  |
| OpenRouter       | `https://openrouter.ai/api/v1`                             | `anthropic/claude-haiku` |
| Gemini (default) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash`       |
| vLLM self-hosted | `http://<host>:8000/v1`                                    | `<model-id-deployed>`    |

> Recomendación de seguridad: usar una key distinta para dev y prod. Cuando se contrate un tier pago, limitar budget desde la consola del proveedor.

### 4.4 Correo transaccional (SMTP)

El backend manda correos vía SMTP genérico con `nodemailer`. La opción
recomendada para piloto **gratis** es **Gmail con app password** (~500
destinatarios por día sin costo). Cualquier proveedor SMTP funciona
cambiando las envs (`SMTP_*`) — Outlook, Zoho, Brevo, servidor propio.

#### Setup con Gmail

1. Activar 2FA en la cuenta de Gmail desde
   https://myaccount.google.com/security.
2. Generar un _app password_ en
   https://myaccount.google.com/apppasswords (16 caracteres sin
   espacios). Es distinto a la contraseña normal de la cuenta.
3. Completar `.env` del back:

   ```env
   EMAIL_DELIVERY_MODE=live
   EMAIL_FROM="Tikora <tikora.notif@gmail.com>"   # mismo email que SMTP_USER
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=tikora.notif@gmail.com
   SMTP_PASS=<app-password-de-16-chars>
   ```

   Importante: `EMAIL_FROM` y `SMTP_USER` deben coincidir — Gmail
   bloquea el envío con remitentes que no son la cuenta autenticada
   (anti-spoofing).

4. Verificar que el envío funciona arrancando el back y disparando
   cualquier flujo que mande email (alta de usuario, aprobación de
   auto-respuesta).

#### Cuotas y migración a futuro

- Gmail gratuito: ~500 destinatarios/día, ~100 simultáneos. Suficiente
  para piloto interno; si Tikora pasa a producción real conviene migrar
  a un proveedor con dominio propio verificado (mejor reputación de IP,
  sin riesgo de que Google rate-limitee la cuenta).
- Alternativas drop-in cambiando solo las envs: **Brevo** (300/día
  gratis permanente), **SendGrid** (100/día permanente), **Resend**
  (3.000/mes con dominio propio verificado).

> En `EMAIL_DELIVERY_MODE=log` (default en dev) los correos no salen:
> se imprimen en consola con su payload. Cambiar a `live` solo cuando
> el SMTP esté configurado y se quiera probar el envío real.

### 4.5 Sentry (opcional en dev)

1. Crear cuenta en https://sentry.io.
2. Crear dos proyectos: uno **Node.js** (back) y uno **React** (front).
3. Copiar el DSN de cada uno a:
   - Backend: `SENTRY_DSN` en `apps/back/.env`.
   - Frontend: `VITE_SENTRY_DSN` en `apps/front/.env`.
4. Si los DSN quedan vacíos en dev, Sentry no se inicializa. Es la operación recomendada en local.

---

## 5. Configuración local

### 5.1 Generar secretos JWT

```bash
echo "JWT_SECRET=$(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 64)"
echo "JWT_SSE_SECRET=$(openssl rand -hex 64)"
```

Pegar los valores en `apps/back/.env`.

### 5.2 Copiar los `.env.example`

```bash
cp apps/back/.env.example apps/back/.env
cp apps/front/.env.example apps/front/.env
# Completar las variables (REQUIRED)
```

### 5.3 Proxy de Vite

`apps/front/vite.config.ts` debe incluir:

```typescript
export default defineConfig({
  // ...
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

Esto hace que las requests del front a `/api/v1/...` vayan al back en el mismo origen del browser (cookies same-origin sin fricción).

### 5.4 Inicializar shadcn/ui

```bash
cd apps/front
pnpm dlx shadcn@latest init
# Seleccionar: TypeScript yes, Tailwind v4, alias @/components, etc.

# Agregar primitives base
pnpm dlx shadcn@latest add button input label form dialog dropdown-menu \
  card badge separator avatar tooltip select textarea toast tabs table \
  popover command sheet skeleton scroll-area
```

### 5.5 Tailwind v4 — `globals.css`

`apps/front/src/styles/globals.css`:

```css
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;

  /* La paleta exacta vive en tikora-frontend.md §3.2 — solo se usan las shades listadas. */
}

html,
body,
#root {
  height: 100%;
}
body {
  @apply bg-slate-50 text-slate-900 font-sans antialiased;
}
```

---

## 6. Seeds y bootstrap

Al arrancar `back` por primera vez, las migraciones de §6 de `tikora-data-model.md` se ejecutan e insertan:

- `Tenant` con `_id = DEFAULT_TENANT_ID`.
- `User` admin con email `SEED_ADMIN_EMAIL` y contraseña hasheada de `SEED_ADMIN_PASSWORD`. Marcado `mustChangePassword: true`.

Con eso ya se puede ingresar a la plataforma. El admin crea áreas y otros usuarios desde el panel admin.

---

## 7. Comandos del día a día

### 7.1 Levantar todo en local

```bash
# Servicios externos (Mongo + Redis locales si no usás Atlas)
docker compose -f docker-compose.dev.yml up -d

# Backend
pnpm exec nx serve back

# Frontend (en otra terminal)
pnpm exec nx serve front
```

Backend: http://localhost:3001 — Swagger en /api/docs.
Frontend: http://localhost:5173.

### 7.2 Tests

```bash
# Todos los tests del workspace
pnpm exec nx run-many -t test

# Un proyecto específico
pnpm exec nx test back
pnpm exec nx test front
pnpm exec nx test core

# Watch
pnpm exec nx test back --watch

# E2E del frontend
pnpm exec nx e2e front-e2e
```

### 7.3 Lint y typecheck

```bash
pnpm exec nx run-many -t lint
pnpm exec nx run-many -t typecheck
```

### 7.4 Build de producción

```bash
pnpm exec nx build back
pnpm exec nx build front
```

### 7.5 Worker BullMQ

El worker puede correr embebido en el proceso del back en dev, o en proceso separado en prod:

```bash
pnpm exec nx serve back --configuration=worker     # solo procesa colas
```

### 7.6 Mantenimiento de KB

```bash
# Re-indexar todos los documentos del tenant (regenera chunks y embeddings)
pnpm exec nx run back:reindex-kb -- --tenantId <id> [--dry-run]
```

### 7.7 Conectar Claude (claude.ai → WhatsApp) al servidor MCP

Tikora expone un servidor MCP en `POST /api/v1/mcp` que permite a Claude operar tickets en nombre del usuario (crear, listar, consultar y comentar). El flujo end-to-end es **el usuario configura un connector custom en claude.ai apuntando al back de Tikora; ese connector queda disponible automáticamente en la surface de WhatsApp** (Claude responde por el número oficial de Anthropic). Decisiones y motivos en `tikora-mcp.md`.

#### Variables de entorno

En `apps/back/.env`:

```bash
MCP_ENABLED=true                   # default true; false → /mcp responde 503 MCP_DISABLED
MCP_MAX_ACTIVE_KEYS_PER_USER=5     # cap de keys activas por usuario antes de forzar revocación
```

No hay variables MCP en el front: la pantalla de gestión consume los mismos endpoints REST con la JWT del usuario.

#### Generar una API key MCP en Tikora

1. Login en el front como el usuario al que vas a conectar (cualquier rol).
2. Ir a `/perfil/mcp-keys` (también accesible desde el item "Claves MCP" del sidebar).
3. Botón **"Crear key"**, ponerle un nombre descriptivo (ej.: `Claude en WhatsApp`), copiar el `secret` (`tk_mcp_…`) que aparece **una sola vez**.
4. Si lo perdés: el botón **"Regenerar"** en la lista revoca la actual y crea una nueva con el mismo nombre.

#### Exponer el back para que claude.ai lo alcance

claude.ai necesita una URL HTTPS pública. En dev usar un túnel:

```bash
# Con ngrok (gratis):
ngrok http 3001
# Devuelve algo como https://abcd-1234.ngrok-free.app
```

El URL del connector queda: `https://<host-publico>/api/v1/mcp`. Para que CORS no bloquee, agregar el host público a `CORS_ORIGINS` del back y reiniciar.

> ⚠ En producción el back debe estar detrás de HTTPS real y un dominio estable. Las keys MCP viajan en `Authorization: Bearer …`; sin TLS quedan expuestas en el camino.

#### Configurar el connector en claude.ai

1. https://claude.ai → **Settings → Connectors → Add custom**.
2. Tipo: **HTTP**. URL: `https://<host-publico>/api/v1/mcp`.
3. Auth: **Bearer token**. Pegar el `secret` `tk_mcp_…` generado en Tikora.
4. Aceptar permisos. Una vez configurado, el connector aparece automáticamente en la surface de WhatsApp para el mismo número de Anthropic que el usuario ya tiene en su Claude.

#### Probar las tools

Desde claude.ai (o desde WhatsApp, ya con el connector activo), pedir:

- _"Crea un ticket que diga que la impresora del piso 3 no imprime."_ → debe responder con `shortCode` y `ticketId`.
- _"Lista mis últimos 5 tickets abiertos."_ → debe enumerar tickets del usuario.
- _"Muéstrame el detalle del ticket TKT-XXX"_ → debe traer asunto, estado y última respuesta del agente si la hay.
- _"Agrega este comentario al ticket TKT-XXX: …"_ → debe confirmar el append.

Si Claude no llama tools, revisar que el connector quede en estado **Connected** en Settings → Connectors. Si rechaza la auth, ver troubleshooting.

#### Smoke directo con `curl` (sin Claude)

Útil para validar que el back está OK antes de tocar claude.ai:

```bash
SECRET=tk_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxx

# initialize
curl -sS -X POST https://<host>/api/v1/mcp \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -sS -X POST https://<host>/api/v1/mcp \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# tools/call listar_mis_tickets
curl -sS -X POST https://<host>/api/v1/mcp \
  -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"listar_mis_tickets","arguments":{"limite":5}}}'
```

Respuestas esperadas: `200` con el body JSON-RPC del SDK MCP. Códigos de error en `tikora-api.md` §15.5.

---

## 8. Troubleshooting

| Síntoma                                                               | Causa probable                                                           | Solución                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MongooseServerSelectionError` al arrancar back                       | Mongo no está corriendo o `MONGODB_URI` mal.                             | Verificar `docker compose ps` o probar con `mongosh "$MONGODB_URI"`.                                                                                           |
| Login responde 401 con cookies en dev                                 | Origen distinto entre front y back.                                      | Verificar que el front consume `/api/v1` (relativo) y el proxy de Vite está activo.                                                                            |
| `Vector search index not found`                                       | El índice de Atlas no se creó o el nombre no coincide.                   | Re-crear con el nombre exacto de `MONGODB_VECTOR_INDEX_NAME`.                                                                                                  |
| `LLM API error 401/402`                                               | API key inválida o sin cuota.                                            | Verificar `LLM_API_KEY` y cuota del proveedor. Para Gemini free tier ver `aistudio.google.com/apikey`.                                                         |
| `LLM API error 429`                                                   | Rate limit del free tier.                                                | Esperar al reset (~1 min en Gemini) o subir a tier pago / cambiar `LLM_BASE_URL`.                                                                              |
| `Email not delivered` y no falla                                      | `EMAIL_DELIVERY_MODE=log`.                                               | Cambiar a `live` y configurar `SMTP_*` (ver §4.4).                                                                                                             |
| `Invalid login: 535-5.7.8 Username and Password not accepted` (Gmail) | Estás usando la contraseña normal de Gmail, no un app password.          | Generar app password en https://myaccount.google.com/apppasswords y pegarlo en `SMTP_PASS`.                                                                    |
| Worker no procesa jobs                                                | Redis no está, o `REDIS_URL` apunta a otro lado.                         | `redis-cli ping` debe responder `PONG`.                                                                                                                        |
| `Cannot find module '@tikora/core'`                                   | Paths de TS o build del paquete sin compilar.                            | Re-ejecutar `pnpm install` y verificar `tsconfig.base.json`.                                                                                                   |
| Cookie de refresh no aparece en el browser                            | Falta `credentials: 'include'` en fetch o el back no setea `Set-Cookie`. | Revisar interceptor de `lib/api-client.ts` y CORS del back.                                                                                                    |
| HMR del front no recarga                                              | Permisos de inotify en Linux.                                            | `sudo sysctl fs.inotify.max_user_watches=524288`.                                                                                                              |
| `/mcp` responde `503 MCP_DISABLED`                                    | Variable `MCP_ENABLED=false` o ausente con override `false`.             | Setear `MCP_ENABLED=true` en `apps/back/.env` y reiniciar el back.                                                                                             |
| claude.ai marca el connector como "Failed to connect"                 | URL HTTPS no alcanzable o el back rechaza por CORS.                      | Verificar que el túnel (ngrok) responde y agregar el host público a `CORS_ORIGINS` del back.                                                                   |
| `/mcp` responde `401 MCP_KEY_INVALID`                                 | Secreto pegado mal, key revocada, o se truncó al copiar.                 | Regenerar la key desde `/perfil/mcp-keys` y volver a pegar el secreto completo en claude.ai.                                                                   |
| `POST /me/mcp-keys` responde `409 MCP_KEY_LIMIT_REACHED`              | El usuario ya alcanzó `MCP_MAX_ACTIVE_KEYS_PER_USER` (default 5).        | Revocar keys que no se usen desde `/perfil/mcp-keys` antes de crear otra, o subir el cap.                                                                      |
| Claude no llama las tools y responde "no puedo hacerlo"               | El connector está conectado pero Claude decide no invocar.               | Pedir explícitamente la acción ("crea un ticket que…", "lista mis tickets") y revisar `description` de tools en `mcp-server.service.ts` si el patrón persiste. |

---

## 9. Checklist de "listo para empezar"

Antes del primer `pnpm exec nx serve back` exitoso:

- [ ] Node 20/22 instalado, `.nvmrc` respetado.
- [ ] pnpm 9.x instalado.
- [ ] Repo Tikora clonado en `/home/alejandro/Tikora` con `tikoraDocs/` poblado.
- [ ] `pnpm install` completado sin errores.
- [ ] Mongo accesible (Atlas o Docker local).
- [ ] Redis accesible.
- [ ] Índice `kb_chunks_vector` creado en Atlas (puede dejarse para Fase 2).
- [ ] API key del proveedor LLM lista (Gemini free tier para piloto gratis).
- [ ] Cuenta SMTP configurada (Gmail con app password para piloto gratis) — opcional en dev si se usa `EMAIL_DELIVERY_MODE=log`.
- [ ] Secretos JWT generados con `openssl rand -hex 64`.
- [ ] `apps/back/.env` y `apps/front/.env` completados.
- [ ] `vite.config.ts` con el proxy `/api → localhost:3001`.
- [ ] shadcn/ui inicializado.

Cuando todos los checks estén marcados, queda listo arrancar Sprint 1 (módulo `auth` + estructura base, según el plan de `tikora-data-model.md` y `tikora-api.md`).
