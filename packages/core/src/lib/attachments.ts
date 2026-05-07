import { z } from 'zod';

/**
 * MIME types permitidos para adjuntos. Lista cerrada — la validación
 * ocurre en backend (multer + Zod) y se replica en frontend para feedback
 * temprano. Match con `tikora-data-model.md` §3.8.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
] as const;
export type AllowedAttachmentMimeType = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

/** Límites duros del adjunto. */
export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_TICKET = 5;

/**
 * Forma del adjunto expuesta al cliente. Se omite información sensible
 * de almacenamiento (`storagePath`, `storedName`, `checksum`, `storageProvider`):
 * el cliente solo descarga vía `GET /tickets/:id/attachments/:attId`.
 */
export const attachmentSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  uploaderId: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
