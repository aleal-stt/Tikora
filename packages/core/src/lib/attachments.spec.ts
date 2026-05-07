import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_MAX_PER_TICKET,
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentSchema,
} from './attachments';

describe('attachments contracts', () => {
  it('lista de MIME types contiene los formatos esperados', () => {
    expect(ALLOWED_ATTACHMENT_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_ATTACHMENT_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_ATTACHMENT_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('límites coinciden con lo definido en el data-model', () => {
    expect(ATTACHMENT_MAX_SIZE_BYTES).toBe(10 * 1024 * 1024);
    expect(ATTACHMENT_MAX_PER_TICKET).toBe(5);
  });

  it('attachmentSchema valida la forma pública', () => {
    const result = attachmentSchema.safeParse({
      id: 'a_1',
      ticketId: 't_1',
      uploaderId: 'u_1',
      originalName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdAt: '2026-05-07T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza tamaño negativo', () => {
    const result = attachmentSchema.safeParse({
      id: 'a_1',
      ticketId: 't_1',
      uploaderId: 'u_1',
      originalName: 'x',
      mimeType: 'image/png',
      sizeBytes: -1,
      createdAt: '2026-05-07T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
