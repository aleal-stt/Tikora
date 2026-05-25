import {
  CheckIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';

interface RevealedSecretPanelProps {
  secret: string;
}

/**
 * Bloque de UI para mostrar un secreto recién generado con copy-to-clipboard
 * y advertencia destacada. Pensado para reusarse desde el flow de creación
 * y el de regeneración: la API solo expone el secret una sola vez, así que
 * cualquiera que termine con uno en mano renderiza este mismo panel.
 */
export function RevealedSecretPanel({ secret }: RevealedSecretPanelProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success('Secreto copiado al portapapeles.');
    } catch {
      toast.error('No se pudo copiar. Seleccioná el texto manualmente.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <span>
          Copialo y pegalo en la configuración del connector en claude.ai. Cualquiera con esta key
          puede operar tickets a tu nombre.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm">
          {secret}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={copyToClipboard}>
          {copied ? (
            <CheckIcon className="h-4 w-4" />
          ) : (
            <ClipboardDocumentIcon className="h-4 w-4" />
          )}
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}
