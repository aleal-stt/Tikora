import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { Readable } from 'stream';
import type { Env } from '../../config/env.schema';
import { IAttachmentStorage } from './attachment-storage.interface';

/**
 * Adapter local para `IAttachmentStorage`. Escribe los binarios en
 * `<UPLOADS_DIR>/<tenantId>/<ticketId>/<storedName>`. La ruta devuelta
 * es relativa al `UPLOADS_DIR` para que la metadata persistida no
 * dependa de la ruta absoluta del proceso.
 */
@Injectable()
export class LocalDiskStorage implements IAttachmentStorage {
  private readonly logger = new Logger(LocalDiskStorage.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async write(args: {
    tenantId: string;
    ticketId: string;
    storedName: string;
    buffer: Buffer;
  }): Promise<{ storagePath: string }> {
    const relativePath = join(args.tenantId, args.ticketId, args.storedName);
    const absolutePath = this.absolute(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, args.buffer);
    return { storagePath: relativePath };
  }

  async read(storagePath: string): Promise<Readable> {
    return createReadStream(this.absolute(storagePath));
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await unlink(this.absolute(storagePath));
    } catch (err) {
      // ENOENT es aceptable: la metadata pudo quedar huérfana en otro flujo.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      this.logger.warn(
        `No se pudo borrar el adjunto en ${storagePath}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      throw err;
    }
  }

  private absolute(relativePath: string): string {
    const root = this.config.get('UPLOADS_DIR', { infer: true });
    return resolve(root, relativePath);
  }
}
