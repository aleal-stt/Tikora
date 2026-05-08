# KB — Reporte de pruebas end-to-end de endpoints

**Fecha:** 2026-05-08 14:18  
**Backend:** `http://localhost:3002/api/v1`  
**Cluster:** Mongo Atlas (`mongodb+srv://...mongodb.net/tikora`)  
**Modelo de embeddings:** `Xenova/multilingual-e5-small` (cargado en 6.7 s en frío)

## Resumen

- 32 casos ejecutados — 15 con status esperado de éxito (2xx), 17 con error esperado (4xx).
- Indexación BullMQ + Transformers.js + persistencia en `kb_chunks` confirmada por logs del worker.
- Versionado, rollback y soft-delete validados con admin y líder.

## Precondiciones

Para probar permisos cruzados se crearon dos áreas y dos usuarios adicionales al admin del seed:

| Área       | ID                         |
| ---------- | -------------------------- |
| Soporte TI | `69fdef7eb24d4156c5998df7` |
| RRHH       | `69fdef7eb24d4156c5998df8` |

| Usuario                 | Rol    | Áreas |
| ----------------------- | ------ | ----- |
| `admin@empresa.com`     | admin  | —     |
| `lider.ti@empresa.com`  | lider  | TI    |
| `agente.ti@empresa.com` | agente | TI    |

Login (mismo shape para los tres):

```bash
curl -s -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"ChangeMe123!"}'
```

Devuelve `{accessToken, user}`. El `accessToken` se usa como `Authorization: Bearer <token>` y en este reporte se referencia como `$ADMIN_TOKEN` / `$LIDER_TOKEN` / `$AGENTE_TOKEN`.

## 1. POST /kb-documents — creación

### ADM crea documento global válido — `201`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Política de vacaciones", "content": "# Política\n\nLos empleados con más de 5 años de antigüedad tienen derecho a 25 días corridos de vacaciones. Para solicitar, completar el formulario en RRHH con 15 días de anticipación.", "scope": "global", "areaIds": []}'
```

**Response `201`**

```json
{
  "id": "69fdefe0b24d4156c5998e03",
  "parentDocumentId": "69fdefe0b24d4156c5998e03",
  "title": "Política de vacaciones",
  "content": "# Política\n\nLos empleados con más de 5 años de antigüedad tienen derecho a 25 días corridos de vacaciones. Para solicitar, completar el formulario en RRHH con 15 días de anticipación.",
  "scope": "global",
  "areaIds": [],
  "version": 1,
  "active": false,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.228Z",
  "updatedAt": "2026-05-08T14:14:56.348Z"
}
```

### ADM crea documento en área (TI) — `201`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Configuración VPN", "content": "## Pasos\n\n1. Ingresar al portal interno.\n2. Descargar el cliente OpenVPN.\n3. Importar el archivo .ovpn provisto por TI.", "scope": "area", "areaIds": ["69fdef7eb24d4156c5998df7"]}'
```

**Response `201`**

```json
{
  "id": "69fdefe0b24d4156c5998e06",
  "parentDocumentId": "69fdefe0b24d4156c5998e06",
  "title": "Configuración VPN",
  "content": "## Pasos\n\n1. Ingresar al portal interno.\n2. Descargar el cliente OpenVPN.\n3. Importar el archivo .ovpn provisto por TI.",
  "scope": "area",
  "areaIds": ["69fdef7eb24d4156c5998df7"],
  "version": 1,
  "active": false,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.781Z",
  "updatedAt": "2026-05-08T14:14:56.891Z"
}
```

### LID crea en su área (TI) — OK — `201`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $LIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Resetear contraseña Active Directory", "content": "### Pasos\n\nUsar el portal de autoservicio. Si no responde, contactar al área TI mencionando el ticket.", "scope": "area", "areaIds": ["69fdef7eb24d4156c5998df7"]}'
```

**Response `201`**

```json
{
  "id": "69fdefe1b24d4156c5998e08",
  "parentDocumentId": "69fdefe1b24d4156c5998e08",
  "title": "Resetear contraseña Active Directory",
  "content": "### Pasos\n\nUsar el portal de autoservicio. Si no responde, contactar al área TI mencionando el ticket.",
  "scope": "area",
  "areaIds": ["69fdef7eb24d4156c5998df7"],
  "version": 1,
  "active": false,
  "uploadedBy": "69fdef93b24d4156c5998df9",
  "createdAt": "2026-05-08T14:14:57.240Z",
  "updatedAt": "2026-05-08T14:14:57.349Z"
}
```

### LID intenta crear global → 403 — `403`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $LIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Intento global", "content": "contenido", "scope": "global", "areaIds": []}'
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "KB_GLOBAL_REQUIRES_ADMIN",
  "message": "Solo un administrador puede crear documentos globales.",
  "details": []
}
```

### LID crea en área que no lidera → 403 — `403`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $LIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Doc RRHH", "content": "contenido", "scope": "area", "areaIds": ["69fdef7eb24d4156c5998df8"]}'
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "KB_FORBIDDEN",
  "message": "Solo podés crear/editar documentos en áreas que liderás.",
  "details": []
}
```

### AGENTE intenta crear → 403 — `403`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $AGENTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Doc agente", "content": "contenido", "scope": "area", "areaIds": ["69fdef7eb24d4156c5998df7"]}'
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "AUTH_ROLE_FORBIDDEN",
  "message": "No tenés permisos para esta acción.",
  "details": []
}
```

### Sin auth → 401 — `401`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Content-Type: application/json" \
  -d '{"title": "X", "content": "y", "scope": "global", "areaIds": []}'
```

**Response `401`**

```json
{
  "statusCode": 401,
  "code": "AUTH_REQUIRED",
  "message": "Autenticación requerida.",
  "details": []
}
```

### Validación: scope=area sin areaIds → 422 — `400`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Doc", "content": "contenido", "scope": "area", "areaIds": []}'
```

**Response `400`**

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "code": "custom",
      "path": ["areaIds"],
      "message": "Documentos con scope área requieren al menos un área"
    }
  ]
}
```

### Validación: title <3 chars → 422 — `400`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "AB", "content": "contenido", "scope": "global", "areaIds": []}'
```

**Response `400`**

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "origin": "string",
      "code": "too_small",
      "minimum": 3,
      "inclusive": true,
      "path": ["title"],
      "message": "El título debe tener al menos 3 caracteres"
    }
  ]
}
```

### Validación: scope=global con areaIds → 422 — `400`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Mix", "content": "x", "scope": "global", "areaIds": ["69fdef7eb24d4156c5998df7"]}'
```

**Response `400`**

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "code": "custom",
      "path": ["areaIds"],
      "message": "Documentos globales no pueden tener áreas asignadas"
    }
  ]
}
```

### Validación: content vacío → 422 — `400`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Título OK", "content": "", "scope": "global", "areaIds": []}'
```

**Response `400`**

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "origin": "string",
      "code": "too_small",
      "minimum": 1,
      "inclusive": true,
      "path": ["content"],
      "message": "El contenido no puede estar vacío"
    }
  ]
}
```

## 2. GET /kb-documents — listado

### ADM lista todos los documentos del tenant — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "items": [
    {
      "id": "69fdefe1b24d4156c5998e08",
      "parentDocumentId": "69fdefe1b24d4156c5998e08",
      "title": "Resetear contraseña Active Directory",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fdef93b24d4156c5998df9",
      "createdAt": "2026-05-08T14:14:57.240Z",
      "updatedAt": "2026-05-08T14:14:58.929Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e06",
      "parentDocumentId": "69fdefe0b24d4156c5998e06",
      "title": "Configuración VPN",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.781Z",
      "updatedAt": "2026-05-08T14:14:58.055Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e03",
      "parentDocumentId": "69fdefe0b24d4156c5998e03",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.228Z",
      "updatedAt": "2026-05-08T14:14:57.156Z"
    },
    {
      "id": "69fdefc4b24d4156c5998e00",
      "parentDocumentId": "69fdefc4b24d4156c5998e00",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:28.462Z",
      "updatedAt": "2026-05-08T14:14:36.063Z"
    }
  ],
  "nextCursor": null
}
```

### LID lista globales + áreas que lidera — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $LIDER_TOKEN"
```

**Response `200`**

```json
{
  "items": [
    {
      "id": "69fdefe1b24d4156c5998e08",
      "parentDocumentId": "69fdefe1b24d4156c5998e08",
      "title": "Resetear contraseña Active Directory",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fdef93b24d4156c5998df9",
      "createdAt": "2026-05-08T14:14:57.240Z",
      "updatedAt": "2026-05-08T14:14:58.929Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e06",
      "parentDocumentId": "69fdefe0b24d4156c5998e06",
      "title": "Configuración VPN",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.781Z",
      "updatedAt": "2026-05-08T14:14:58.055Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e03",
      "parentDocumentId": "69fdefe0b24d4156c5998e03",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.228Z",
      "updatedAt": "2026-05-08T14:14:57.156Z"
    },
    {
      "id": "69fdefc4b24d4156c5998e00",
      "parentDocumentId": "69fdefc4b24d4156c5998e00",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:28.462Z",
      "updatedAt": "2026-05-08T14:14:36.063Z"
    }
  ],
  "nextCursor": null
}
```

### Filtro ?scope=global — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents?scope=global \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "items": [
    {
      "id": "69fdefe0b24d4156c5998e03",
      "parentDocumentId": "69fdefe0b24d4156c5998e03",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.228Z",
      "updatedAt": "2026-05-08T14:14:57.156Z"
    },
    {
      "id": "69fdefc4b24d4156c5998e00",
      "parentDocumentId": "69fdefc4b24d4156c5998e00",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:28.462Z",
      "updatedAt": "2026-05-08T14:14:36.063Z"
    }
  ],
  "nextCursor": null
}
```

### Filtro ?areaId=AREA_TI — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents?areaId=69fdef7eb24d4156c5998df7 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "items": [
    {
      "id": "69fdefe1b24d4156c5998e08",
      "parentDocumentId": "69fdefe1b24d4156c5998e08",
      "title": "Resetear contraseña Active Directory",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fdef93b24d4156c5998df9",
      "createdAt": "2026-05-08T14:14:57.240Z",
      "updatedAt": "2026-05-08T14:14:58.929Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e06",
      "parentDocumentId": "69fdefe0b24d4156c5998e06",
      "title": "Configuración VPN",
      "scope": "area",
      "areaIds": ["69fdef7eb24d4156c5998df7"],
      "version": 1,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.781Z",
      "updatedAt": "2026-05-08T14:14:58.055Z"
    }
  ],
  "nextCursor": null
}
```

### AGENTE intenta listar → 403 — `403`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents \
  -H "Authorization: Bearer $AGENTE_TOKEN"
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "AUTH_ROLE_FORBIDDEN",
  "message": "No tenés permisos para esta acción.",
  "details": []
}
```

### Listar sin auth → 401 — `401`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents
```

**Response `401`**

```json
{
  "statusCode": 401,
  "code": "AUTH_REQUIRED",
  "message": "Autenticación requerida.",
  "details": []
}
```

## 3. GET /kb-documents/:id — detalle

### ADM obtiene detalle de documento — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_ID> \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "id": "69fdefe0b24d4156c5998e03",
  "parentDocumentId": "69fdefe0b24d4156c5998e03",
  "title": "Política de vacaciones",
  "content": "# Política\n\nLos empleados con más de 5 años de antigüedad tienen derecho a 25 días corridos de vacaciones. Para solicitar, completar el formulario en RRHH con 15 días de anticipación.",
  "scope": "global",
  "areaIds": [],
  "version": 1,
  "active": true,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.228Z",
  "updatedAt": "2026-05-08T14:14:57.156Z"
}
```

### LID obtiene detalle de documento global — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_ID> \
  -H "Authorization: Bearer $LIDER_TOKEN"
```

**Response `200`**

```json
{
  "id": "69fdefe0b24d4156c5998e03",
  "parentDocumentId": "69fdefe0b24d4156c5998e03",
  "title": "Política de vacaciones",
  "content": "# Política\n\nLos empleados con más de 5 años de antigüedad tienen derecho a 25 días corridos de vacaciones. Para solicitar, completar el formulario en RRHH con 15 días de anticipación.",
  "scope": "global",
  "areaIds": [],
  "version": 1,
  "active": true,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.228Z",
  "updatedAt": "2026-05-08T14:14:57.156Z"
}
```

### LID obtiene detalle de doc de su área — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/<DOC_AREA_TI_ID> \
  -H "Authorization: Bearer $LIDER_TOKEN"
```

**Response `200`**

```json
{
  "id": "69fdefe0b24d4156c5998e06",
  "parentDocumentId": "69fdefe0b24d4156c5998e06",
  "title": "Configuración VPN",
  "content": "## Pasos\n\n1. Ingresar al portal interno.\n2. Descargar el cliente OpenVPN.\n3. Importar el archivo .ovpn provisto por TI.",
  "scope": "area",
  "areaIds": ["69fdef7eb24d4156c5998df7"],
  "version": 1,
  "active": true,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.781Z",
  "updatedAt": "2026-05-08T14:14:58.055Z"
}
```

### GET con id inválido → 400 — `400`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/invalido \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `400`**

```json
{
  "statusCode": 400,
  "code": "KB_DOCUMENT_ID_INVALID",
  "message": "ID inválido.",
  "details": []
}
```

### GET con id inexistente → 404 — `404`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/000000000000000000000000 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `404`**

```json
{
  "statusCode": 404,
  "code": "KB_DOCUMENT_NOT_FOUND",
  "message": "Documento no encontrado.",
  "details": []
}
```

## 4. PUT /kb-documents/:id — edición / nueva versión

### ADM edita documento global (crea v2) — `200`

**Request**

```bash
curl -s -X PUT \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_ID> \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Política de vacaciones (revisada)", "content": "# Política revisada\n\nLos empleados con más de 3 años de antigüedad tienen derecho a 20 días corridos de vacaciones."}'
```

**Response `200`**

```json
{
  "id": "69fdf023b24d4156c5998e0b",
  "parentDocumentId": "69fdefe0b24d4156c5998e03",
  "title": "Política de vacaciones (revisada)",
  "content": "# Política revisada\n\nLos empleados con más de 3 años de antigüedad tienen derecho a 20 días corridos de vacaciones.",
  "scope": "global",
  "areaIds": [],
  "version": 2,
  "active": false,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:16:03.564Z",
  "updatedAt": "2026-05-08T14:16:03.564Z"
}
```

### LID intenta editar doc global → 403 — `403`

**Request**

```bash
curl -s -X PUT \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_ID> \
  -H "Authorization: Bearer $LIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "hack", "content": "x"}'
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "KB_GLOBAL_REQUIRES_ADMIN",
  "message": "Solo un administrador puede modificar documentos globales.",
  "details": []
}
```

### LID edita doc de su área (TI) — `200`

**Request**

```bash
curl -s -X PUT \
  http://localhost:3002/api/v1/kb-documents/<DOC_LIDER_TI_ID> \
  -H "Authorization: Bearer $LIDER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Resetear contraseña AD (v2)", "content": "### Pasos actualizados\n\n1. Ir al portal de autoservicio.\n2. Si no responde, abrir ticket en TI."}'
```

**Response `200`**

```json
{
  "id": "69fdf024b24d4156c5998e0d",
  "parentDocumentId": "69fdefe1b24d4156c5998e08",
  "title": "Resetear contraseña AD (v2)",
  "content": "### Pasos actualizados\n\n1. Ir al portal de autoservicio.\n2. Si no responde, abrir ticket en TI.",
  "scope": "area",
  "areaIds": ["69fdef7eb24d4156c5998df7"],
  "version": 2,
  "active": false,
  "uploadedBy": "69fdef93b24d4156c5998df9",
  "createdAt": "2026-05-08T14:16:04.194Z",
  "updatedAt": "2026-05-08T14:16:04.194Z"
}
```

## 5. GET /kb-documents/:id/versions — historial

### ADM lista versiones del documento — `200`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_V2_ID>/versions \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "items": [
    {
      "id": "69fdf023b24d4156c5998e0b",
      "parentDocumentId": "69fdefe0b24d4156c5998e03",
      "title": "Política de vacaciones (revisada)",
      "scope": "global",
      "areaIds": [],
      "version": 2,
      "active": true,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:16:03.564Z",
      "updatedAt": "2026-05-08T14:16:04.301Z"
    },
    {
      "id": "69fdefe0b24d4156c5998e03",
      "parentDocumentId": "69fdefe0b24d4156c5998e03",
      "title": "Política de vacaciones",
      "scope": "global",
      "areaIds": [],
      "version": 1,
      "active": false,
      "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
      "createdAt": "2026-05-08T14:14:56.228Z",
      "updatedAt": "2026-05-08T14:16:04.043Z"
    }
  ]
}
```

## 6. POST /kb-documents/:id/versions/:n/activate — rollback

### ADM rollback a v1 — `201`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_V2_ID>/versions/1/activate \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `201`**

```json
{
  "id": "69fdefe0b24d4156c5998e03",
  "parentDocumentId": "69fdefe0b24d4156c5998e03",
  "title": "Política de vacaciones",
  "content": "# Política\n\nLos empleados con más de 5 años de antigüedad tienen derecho a 25 días corridos de vacaciones. Para solicitar, completar el formulario en RRHH con 15 días de anticipación.",
  "scope": "global",
  "areaIds": [],
  "version": 1,
  "active": true,
  "uploadedBy": "69fb68c9fa533dc8ae71b3f6",
  "createdAt": "2026-05-08T14:14:56.228Z",
  "updatedAt": "2026-05-08T14:16:35.431Z"
}
```

### LID intenta rollback → 403 — `403`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_V2_ID>/versions/1/activate \
  -H "Authorization: Bearer $LIDER_TOKEN"
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "AUTH_ROLE_FORBIDDEN",
  "message": "No tenés permisos para esta acción.",
  "details": []
}
```

### Rollback a versión inexistente → 404 — `404`

**Request**

```bash
curl -s -X POST \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_V2_ID>/versions/99/activate \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `404`**

```json
{
  "statusCode": 404,
  "code": "KB_VERSION_NOT_FOUND",
  "message": "No existe la versión 99 de este documento.",
  "details": []
}
```

## 7. DELETE /kb-documents/:id — soft delete

### ADM soft-delete documento — `204`

**Request**

```bash
curl -s -X DELETE \
  http://localhost:3002/api/v1/kb-documents/<DOC_AREA_TI_ID> \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `204`**

```json

```

### GET post-delete → 404 — `404`

**Request**

```bash
curl -s -X GET \
  http://localhost:3002/api/v1/kb-documents/<DOC_AREA_TI_ID> \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `404`**

```json
{
  "statusCode": 404,
  "code": "KB_DOCUMENT_NOT_FOUND",
  "message": "Documento no encontrado.",
  "details": []
}
```

### LID intenta soft-delete doc global → 403 — `403`

**Request**

```bash
curl -s -X DELETE \
  http://localhost:3002/api/v1/kb-documents/<DOC_GLOBAL_V2_ID> \
  -H "Authorization: Bearer $LIDER_TOKEN"
```

**Response `403`**

```json
{
  "statusCode": 403,
  "code": "KB_GLOBAL_REQUIRES_ADMIN",
  "message": "Solo un administrador puede modificar documentos globales.",
  "details": []
}
```

## 8. Indexación end-to-end (worker BullMQ + Transformers.js)

Cada `POST` y `PUT` encoló un job en la cola `kb-indexing`. El processor cargó el modelo `multilingual-e5-small` la primera vez (~6.7 s, cache miss) y desde ahí cada documento se chunkea + embebe + persiste + swap atómico de `active` en milisegundos.

Logs relevantes capturados durante las pruebas:

```
TransformersEmbeddingProvider  Cargando modelo de embeddings Xenova/multilingual-e5-small...
TransformersEmbeddingProvider  Modelo de embeddings listo en 6690ms
KbIndexerService  Indexación KB completada documentId=...e00 version=1 chunks=1 durationMs=795
KbIndexerService  Indexación KB completada documentId=...e03 version=1 chunks=1 durationMs=810
KbIndexerService  Indexación KB completada documentId=...e06 version=1 chunks=1 durationMs=787
KbIndexerService  Indexación KB completada documentId=...e08 version=1 chunks=1 durationMs=761
KbIndexerService  Indexación KB completada documentId=...e0b version=2 chunks=1 durationMs=752
```

Los textos de prueba eran cortos (~30-60 tokens) y por eso resolvieron en 1 chunk cada uno. Para validar chunking real conviene reindexar un documento >1000 tokens (queda como prueba manual con `pnpm exec nx run back:reindex-kb`).

## 9. Hallazgos durante las pruebas

> **Estado de los hallazgos tras el sprint de cleanup posterior (2026-05-08):**
> los puntos 1 y 2 quedaron resueltos. El punto 3 era una imprecisión del autor
> del reporte y se retiró tras releer la spec. El punto 4 sigue siendo
> informativo (no es un bug, es la curva de cold-start documentada).

1. **Shape de body de error divergente del contrato** _(resuelto)_. El default de
   `ZodValidationPipe` devolvía `{statusCode, message, errors[]}`, pero
   `tikora-api.md` §1 define `{statusCode, code, message, details[]}`. El
   status `400` era correcto (ver línea 20 de la spec: «`400` validación
   fallida (Zod)»). Se alineó configurando `createZodValidationPipe` con un
   `createValidationException` que produce un `ApiException` con el shape
   estándar (`apps/back/src/common/validation/zod-validation.factory.ts`).
   Ejemplo del error tras el fix:

   ```json
   {
     "statusCode": 400,
     "code": "VALIDATION_FAILED",
     "message": "El título debe tener al menos 3 caracteres",
     "details": [
       {
         "path": "title",
         "code": "too_small",
         "message": "El título debe tener al menos 3 caracteres"
       }
     ]
   }
   ```

2. **Warning Mongoose por índice duplicado en `kb_chunks`** _(resuelto)_.
   `@Prop({ ref: 'KbDocument', index: true })` colisionaba con
   `KbChunkSchema.index({ documentId: 1 })`. Se quitó `index: true` del
   `@Prop` y el warning desapareció.

3. **Modelo de embeddings: ~6.7 s en frío.** La primera carga descarga el
   ONNX (~120 MB) desde Hugging Face y lo cachea en
   `./.cache/transformers/`. Arranques siguientes con la cache poblada
   bajan a 1-3 s según `tikora-embeddings.md` §11.1. Cada embedding luego
   resuelve en <1 s. No es un bug, es la curva esperada — se documenta
   acá para que el operador sepa qué esperar.
