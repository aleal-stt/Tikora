import type { Readable } from 'stream';

/**
 * Abstracción del almacenamiento de adjuntos. Define solo lo que el
 * caller necesita para que un futuro adapter S3/MinIO pueda reemplazar
 * al `LocalDiskStorage` sin tocar al `AttachmentsService`.
 */
export interface IAttachmentStorage {
  /** Persiste el binario en el storage y devuelve la ruta canónica. */
  write(args: {
    tenantId: string;
    ticketId: string;
    storedName: string;
    buffer: Buffer;
  }): Promise<{ storagePath: string }>;

  /** Devuelve un stream legible del archivo. */
  read(storagePath: string): Promise<Readable>;

  /** Borra el archivo del storage. Idempotente: no falla si no existe. */
  delete(storagePath: string): Promise<void>;
}

export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');
