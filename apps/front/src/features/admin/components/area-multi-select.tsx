import { CheckIcon } from '@heroicons/react/24/outline';
import type { Area } from '@tikora/core';
import { cn } from '../../../lib/utils';

interface AreaMultiSelectProps {
  /** Áreas elegibles. El caller las filtra según el rol del editor. */
  options: Pick<Area, 'id' | 'name'>[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select compacto para asignación de áreas. No usamos un combobox
 * con búsqueda porque el volumen esperado (≤30 áreas por tenant) cabe en
 * una lista vertical chequeable. Si crece, se reemplaza por un popover
 * con búsqueda sin tocar el contrato del componente.
 */
export function AreaMultiSelect({ options, value, onChange, disabled }: AreaMultiSelectProps) {
  const selected = new Set(value);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
        No hay áreas disponibles.
      </p>
    );
  }

  return (
    <ul
      role="listbox"
      aria-multiselectable="true"
      className="max-h-48 overflow-y-auto rounded-md border border-slate-200"
    >
      {options.map((area) => {
        const isSelected = selected.has(area.id);
        return (
          <li key={area.id}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={disabled}
              onClick={() => toggle(area.id)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
                isSelected && 'bg-blue-50 text-blue-700',
              )}
            >
              <span>{area.name}</span>
              {isSelected && <CheckIcon className="h-4 w-4" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
