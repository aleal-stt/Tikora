import { describe, expect, it } from 'vitest';
import { createMcpKeySchema, mcpKeySchema } from './mcp-keys';

describe('createMcpKeySchema', () => {
  it('acepta un nombre válido y lo trimea', () => {
    const result = createMcpKeySchema.parse({ name: '  Mi WhatsApp personal  ' });
    expect(result.name).toBe('Mi WhatsApp personal');
  });

  it('rechaza nombre vacío', () => {
    expect(() => createMcpKeySchema.parse({ name: '' })).toThrow();
    expect(() => createMcpKeySchema.parse({ name: '   ' })).toThrow();
  });

  it('rechaza nombre que supere 80 caracteres', () => {
    expect(() => createMcpKeySchema.parse({ name: 'x'.repeat(81) })).toThrow();
  });
});

describe('mcpKeySchema', () => {
  it('acepta la forma pública con lastUsedAt nulo', () => {
    const value = mcpKeySchema.parse({
      id: 'abc',
      name: 'Mi WhatsApp',
      prefix: 'tk_mcp_abcde',
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(value.prefix).toBe('tk_mcp_abcde');
    expect(value.lastUsedAt).toBeNull();
  });

  it('rechaza objetos sin createdAt', () => {
    const result = mcpKeySchema.safeParse({
      id: 'abc',
      name: 'x',
      prefix: 'p',
      lastUsedAt: null,
    });
    expect(result.success).toBe(false);
  });
});
