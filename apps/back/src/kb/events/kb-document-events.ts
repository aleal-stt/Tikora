import type { KbDocumentEventType } from '@tikora/core';

/**
 * Catálogo de eventos del módulo `kb`. Ninguno dispara notificación al
 * usuario (`tikora-events.md` §2) — son eventos técnicos que sirven al
 * frontend para invalidar caches de React Query y al cron de mantenimiento
 * para reaccionar.
 */
export const KB_DOCUMENT_EVENTS = {
  KbDocumentCreated: 'KbDocumentCreated',
  KbDocumentUpdated: 'KbDocumentUpdated',
  KbDocumentDeleted: 'KbDocumentDeleted',
  KbDocumentReindexed: 'KbDocumentReindexed',
} as const satisfies Record<KbDocumentEventType, KbDocumentEventType>;

interface BaseKbEvent {
  tenantId: string;
  documentId: string;
  parentDocumentId: string;
}

export interface KbDocumentCreatedEvent extends BaseKbEvent {
  version: number;
  scope: 'global' | 'area';
  uploadedBy: string;
}

export interface KbDocumentUpdatedEvent extends BaseKbEvent {
  version: number;
  uploadedBy: string;
}

export interface KbDocumentDeletedEvent extends BaseKbEvent {
  deletedBy: string;
}

export interface KbDocumentReindexedEvent extends BaseKbEvent {
  version: number;
  chunksCreated: number;
  durationMs: number;
}
