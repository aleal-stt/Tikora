import {
  KB_MAX_BYTES,
  createKbDocumentSchema,
  kbContentSchema,
  kbDocumentListItemSchema,
  kbDocumentSchema,
  updateKbDocumentSchema,
} from './kb';

describe('kb document contracts', () => {
  describe('createKbDocumentSchema', () => {
    it('acepta un documento global válido sin áreas', () => {
      const result = createKbDocumentSchema.safeParse({
        title: '  Política de vacaciones  ',
        content: '# Pasos\n\n1. Llenar formulario',
        scope: 'global',
        areaIds: [],
      });
      expect(result.success).toBe(true);
      // Trim del título se aplica antes de validar la longitud, así que
      // el dato persistido ya está limpio.
      if (result.success) {
        expect(result.data.title).toBe('Política de vacaciones');
      }
    });

    it('acepta un documento de área con al menos un area', () => {
      const result = createKbDocumentSchema.safeParse({
        title: 'Manual de impresoras',
        content: 'Texto',
        scope: 'area',
        areaIds: ['a_1'],
      });
      expect(result.success).toBe(true);
    });

    it('rechaza scope=area sin áreas', () => {
      const result = createKbDocumentSchema.safeParse({
        title: 'Manual',
        content: 'Texto',
        scope: 'area',
        areaIds: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join('.') === 'areaIds')).toBe(true);
      }
    });

    it('rechaza scope=global con áreas asignadas', () => {
      const result = createKbDocumentSchema.safeParse({
        title: 'Manual',
        content: 'Texto',
        scope: 'global',
        areaIds: ['a_1'],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza título por debajo del mínimo tras trim', () => {
      const result = createKbDocumentSchema.safeParse({
        title: '  ab  ',
        content: 'Texto',
        scope: 'global',
        areaIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza contenido vacío', () => {
      const result = createKbDocumentSchema.safeParse({
        title: 'Título OK',
        content: '',
        scope: 'global',
        areaIds: [],
      });
      expect(result.success).toBe(false);
    });

    it('aplica el default a areaIds cuando no se envía', () => {
      const result = createKbDocumentSchema.safeParse({
        title: 'Título OK',
        content: 'Texto',
        scope: 'global',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.areaIds).toEqual([]);
      }
    });
  });

  describe('kbContentSchema', () => {
    it('rechaza contenido por encima del límite en bytes UTF-8', () => {
      // Caracteres ASCII: 1 byte cada uno → exactamente KB_MAX_BYTES + 1 bytes.
      const tooLong = 'a'.repeat(KB_MAX_BYTES + 1);
      const result = kbContentSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it('rechaza contenido cuyo conteo en chars cabría pero en bytes no', () => {
      // El emoji ocupa 4 bytes UTF-8. Si midiéramos por `.length` el doc
      // pasaría; medir por bytes lo rechaza correctamente.
      const charCount = Math.floor(KB_MAX_BYTES / 4) + 1;
      const overByBytes = '😀'.repeat(charCount);
      expect(overByBytes.length).toBeLessThanOrEqual(KB_MAX_BYTES);
      const result = kbContentSchema.safeParse(overByBytes);
      expect(result.success).toBe(false);
    });

    it('acepta contenido exactamente en el límite', () => {
      const exact = 'a'.repeat(KB_MAX_BYTES);
      const result = kbContentSchema.safeParse(exact);
      expect(result.success).toBe(true);
    });
  });

  describe('updateKbDocumentSchema', () => {
    it('no expone scope en el shape (no se permite cambiar)', () => {
      const result = updateKbDocumentSchema.safeParse({
        title: 'Nuevo título',
        content: 'Nuevo contenido',
        scope: 'global',
      });
      // Zod es tolerante a campos extra por default — pero scope no se
      // propaga al tipo inferido. El test verifica que el parser no falla
      // con campos extra (forward-compat) pero el tipo derivado no incluye
      // scope: TS no nos deja accederlo aunque venga en el JSON.
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('scope');
      }
    });

    it('areaIds es opcional', () => {
      const result = updateKbDocumentSchema.safeParse({
        title: 'Título',
        content: 'Contenido',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('kbDocumentSchema y kbDocumentListItemSchema', () => {
    const fullDoc = {
      id: 'd_1',
      parentDocumentId: 'd_1',
      title: 'Doc',
      content: 'Texto',
      scope: 'global' as const,
      areaIds: [],
      version: 1,
      active: true,
      uploadedBy: 'u_1',
      createdAt: '2026-05-08T00:00:00Z',
      updatedAt: '2026-05-08T00:00:00Z',
    };

    it('valida un documento completo', () => {
      expect(kbDocumentSchema.safeParse(fullDoc).success).toBe(true);
    });

    it('rechaza version menor a 1', () => {
      const bad = { ...fullDoc, version: 0 };
      expect(kbDocumentSchema.safeParse(bad).success).toBe(false);
    });

    it('listItem omite el content', () => {
      const { content, ...rest } = fullDoc;
      void content;
      const result = kbDocumentListItemSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('content');
      }
    });
  });
});
