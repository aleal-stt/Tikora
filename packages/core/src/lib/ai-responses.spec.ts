import {
  aiResponseSchema,
  aiResponseSourceSchema,
  approveWithChangesSchema,
  autoResponseOutputSchema,
  discardAiResponseSchema,
} from './ai-responses';

describe('ai-responses contracts', () => {
  describe('autoResponseOutputSchema', () => {
    it('valida una respuesta respondable bien formada', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: 'Hola Juan, para solicitar vacaciones...',
        confianza: 0.92,
        sources: [
          { chunkIndex: 1, usedFor: 'pasos del procedimiento' },
          { chunkIndex: 2, usedFor: 'plazos de aprobación' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('valida una respuesta no respondable bien formada', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: false,
        motivo: 'La KB no cubre el caso de empleados temporales',
        confianza: 0.3,
      });
      expect(result.success).toBe(true);
    });

    it('rechaza respondable=true sin sources', () => {
      // Esta es la invariante crítica: no se puede afirmar que se respondió
      // con la KB sin citar al menos una fuente. Si esto pasa, el módulo
      // de auto-respuesta debe descartar el output y reintentar con prompt
      // correctivo.
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: 'algo',
        confianza: 0.9,
        sources: [],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza respondable=true con respuesta vacía', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: '',
        confianza: 0.9,
        sources: [{ chunkIndex: 1, usedFor: 'x' }],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza respondable=false sin motivo', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: false,
        confianza: 0.3,
      });
      expect(result.success).toBe(false);
    });

    it('rechaza chunkIndex menor a 1 (1-based)', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: 'algo',
        confianza: 0.9,
        sources: [{ chunkIndex: 0, usedFor: 'x' }],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza confianza fuera de rango [0,1]', () => {
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: 'algo',
        confianza: 1.2,
        sources: [{ chunkIndex: 1, usedFor: 'x' }],
      });
      expect(result.success).toBe(false);
    });

    it('rechaza campos extra en sources (.strict)', () => {
      // Defensa contra alucinaciones del modelo: si inventa un campo nuevo
      // queremos enterarnos antes de persistir, no después.
      const result = autoResponseOutputSchema.safeParse({
        respondable: true,
        respuesta: 'algo',
        confianza: 0.9,
        sources: [{ chunkIndex: 1, usedFor: 'x', tono: 'formal' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('aiResponseSourceSchema', () => {
    it('valida un source enriquecido completo', () => {
      const result = aiResponseSourceSchema.safeParse({
        chunkId: 'c_1',
        documentId: 'd_1',
        parentDocumentId: 'd_1',
        position: 0,
        score: 0.87,
        usedFor: 'explicación principal',
        documentTitle: 'Política de vacaciones',
        contentSnippet: 'Para solicitar vacaciones...',
      });
      expect(result.success).toBe(true);
    });

    it('rechaza position negativa (es 0-based)', () => {
      const result = aiResponseSourceSchema.safeParse({
        chunkId: 'c_1',
        documentId: 'd_1',
        parentDocumentId: 'd_1',
        position: -1,
        score: 0.87,
        usedFor: 'x',
        documentTitle: 't',
        contentSnippet: 's',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('aiResponseSchema', () => {
    const baseAiResponse = {
      id: 'r_1',
      ticketId: 't_1',
      estado: 'sugerida' as const,
      respondable: true,
      motivoNoRespondable: null,
      originalAiContent: 'Hola, ...',
      content: null,
      confianza: 0.9,
      sources: [],
      approvedBy: null,
      approvedAt: null,
      editedBy: null,
      editedAt: null,
      discardedBy: null,
      discardedAt: null,
      discardReason: null,
      sentAt: null,
      createdAt: '2026-05-08T10:00:00Z',
    };

    it('valida una sugerida sin agente todavía', () => {
      expect(aiResponseSchema.safeParse(baseAiResponse).success).toBe(true);
    });

    it('valida una enviada con metadata de aprobación y send', () => {
      const result = aiResponseSchema.safeParse({
        ...baseAiResponse,
        estado: 'enviada',
        content: 'Hola, ...',
        approvedBy: 'u_1',
        approvedAt: '2026-05-08T10:05:00Z',
        sentAt: '2026-05-08T10:05:30Z',
      });
      expect(result.success).toBe(true);
    });

    it('rechaza estado fuera del catálogo', () => {
      const result = aiResponseSchema.safeParse({
        ...baseAiResponse,
        estado: 'inventado',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('approveWithChangesSchema', () => {
    it('aplica trim antes de validar la longitud', () => {
      const result = approveWithChangesSchema.safeParse({
        respuestaFinal: '   Hola Juan   ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.respuestaFinal).toBe('Hola Juan');
      }
    });

    it('rechaza respuesta vacía tras trim', () => {
      const result = approveWithChangesSchema.safeParse({
        respuestaFinal: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rechaza respuesta de más de 10 000 chars', () => {
      const result = approveWithChangesSchema.safeParse({
        respuestaFinal: 'a'.repeat(10_001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('discardAiResponseSchema', () => {
    it('exige motivo no vacío tras trim', () => {
      const result = discardAiResponseSchema.safeParse({ motivo: '   ' });
      expect(result.success).toBe(false);
    });

    it('acepta un motivo válido', () => {
      const result = discardAiResponseSchema.safeParse({
        motivo: 'No contempla cuentas suspendidas',
      });
      expect(result.success).toBe(true);
    });
  });
});
