import { SparklesIcon } from '@heroicons/react/24/outline';
import type { AiResponse, AiResponseSource } from '@tikora/core';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api-client';
import {
  useApproveAiResponse,
  useApproveAiResponseWithChanges,
  useDiscardAiResponse,
} from '../api/use-ai-responses';

interface AiSuggestionPanelProps {
  ticketId: string;
  aiResponse: AiResponse;
  /** Si el caller no puede actuar, mostramos solo lectura (sin botones). */
  canAct: boolean;
}

/**
 * Panel "Sugerencia IA" — render principal cuando un ticket tiene una
 * `AiResponse` en estado `sugerida`. Estados posteriores (`enviada`,
 * `descartada`) tampoco se muestran, porque la sugerencia ya no aplica
 * — la conversación queda en el timeline normal de interactions.
 *
 * Match con `tikora-ia.md` §7.6 desde la perspectiva del agente.
 */
export function AiSuggestionPanel({ ticketId, aiResponse, canAct }: AiSuggestionPanelProps) {
  // Modo edición: cuando el agente entra a "Editar", mostramos un textarea
  // con el contenido pre-cargado y los botones cambian a "Guardar cambios"
  // / "Cancelar". Aprobar tal cual vuelve sin entrar a edición.
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(aiResponse.originalAiContent ?? '');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardMotivo, setDiscardMotivo] = useState('');

  // Si llega una sugerencia nueva (raro pero posible si el usuario
  // descarta y se regenera), reseteamos el textarea al nuevo content.
  useEffect(() => {
    setEditedContent(aiResponse.originalAiContent ?? '');
  }, [aiResponse.id, aiResponse.originalAiContent]);

  const approve = useApproveAiResponse();
  const approveEdit = useApproveAiResponseWithChanges();
  const discard = useDiscardAiResponse();

  const submitting = approve.isPending || approveEdit.isPending || discard.isPending;
  const confianza = aiResponse.confianza;
  const confianzaTone = confianza >= 0.85 ? 'success' : confianza >= 0.7 ? 'info' : 'warning';

  async function handleApprove() {
    try {
      await approve.mutateAsync({ id: aiResponse.id, ticketId });
      toast.success('Sugerencia aprobada — correo enviado y ticket cerrado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No pudimos aprobar la sugerencia.');
    }
  }

  async function handleApproveEdit() {
    try {
      await approveEdit.mutateAsync({
        id: aiResponse.id,
        ticketId,
        input: { respuestaFinal: editedContent },
      });
      toast.success('Sugerencia editada y enviada — ticket cerrado.');
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No pudimos enviar la edición.');
    }
  }

  async function handleDiscard() {
    if (!discardMotivo.trim()) return;
    try {
      await discard.mutateAsync({
        id: aiResponse.id,
        ticketId,
        input: { motivo: discardMotivo.trim() },
      });
      toast.success('Sugerencia descartada — el ticket vuelve a la bandeja.');
      setDiscardOpen(false);
      setDiscardMotivo('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No pudimos descartar la sugerencia.');
    }
  }

  return (
    <Card className="border-violet-200 bg-violet-50/50">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-violet-900">
            <SparklesIcon className="h-5 w-5" />
            Sugerencia IA
          </CardTitle>
          <p className="text-xs text-slate-600">
            La IA generó una respuesta basada en la base de conocimiento. Aprobala para enviarla por
            correo y cerrar el ticket, o descartala para tomar el caso manualmente.
          </p>
        </div>
        <Badge tone={confianzaTone}>Confianza {(confianza * 100).toFixed(0)}%</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <Textarea
            rows={Math.max(8, Math.min(20, editedContent.split('\n').length + 2))}
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="bg-white"
          />
        ) : (
          <div className="rounded-md border border-violet-200 bg-white p-3 text-sm whitespace-pre-wrap text-slate-700">
            {aiResponse.originalAiContent ?? '(sin contenido)'}
          </div>
        )}

        {aiResponse.sources.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fuentes citadas
            </p>
            <ul className="flex flex-col gap-2">
              {aiResponse.sources.map((s) => (
                <SourceItem key={s.chunkId} source={s} />
              ))}
            </ul>
          </div>
        )}

        {canAct && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    setEditing(false);
                    setEditedContent(aiResponse.originalAiContent ?? '');
                  }}
                >
                  Cancelar edición
                </Button>
                <Button
                  size="sm"
                  disabled={submitting || !editedContent.trim()}
                  onClick={handleApproveEdit}
                >
                  {approveEdit.isPending ? 'Enviando…' : 'Guardar y enviar'}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setDiscardOpen(true)}
                >
                  Descartar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setEditing(true)}
                >
                  Editar
                </Button>
                <Button size="sm" disabled={submitting} onClick={handleApprove}>
                  {approve.isPending ? 'Enviando…' : 'Aprobar y enviar'}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>

      <Dialog
        open={discardOpen}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open) setDiscardMotivo('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar sugerencia</DialogTitle>
            <DialogDescription>
              Decinos por qué la sugerencia no servía — alimenta el feedback para mejorar la KB y
              los prompts. El ticket vuelve a la bandeja para que lo tomes manualmente.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            placeholder='Ej: "no aplica al caso porque el solicitante es contratista, no empleado"'
            value={discardMotivo}
            onChange={(e) => setDiscardMotivo(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!discardMotivo.trim() || discard.isPending}
              onClick={handleDiscard}
            >
              {discard.isPending ? 'Descartando…' : 'Descartar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SourceItem({ source }: { source: AiResponseSource }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{source.documentTitle}</span>
        <Badge tone="muted">score {(source.score * 100).toFixed(0)}%</Badge>
      </div>
      {source.usedFor && (
        <span className="text-xs text-slate-500">
          Usado para: <span className="text-slate-700">{source.usedFor}</span>
        </span>
      )}
      {source.contentSnippet && (
        <blockquote className="border-l-2 border-slate-200 pl-2 text-xs italic text-slate-600">
          {source.contentSnippet}
        </blockquote>
      )}
    </li>
  );
}
