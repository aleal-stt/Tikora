import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AreaMultiSelect } from './area-multi-select';

const OPTIONS = [
  { id: '1', name: 'Soporte TI' },
  { id: '2', name: 'RRHH' },
  { id: '3', name: 'Administración' },
];

describe('AreaMultiSelect', () => {
  it('renderiza todas las opciones', () => {
    render(<AreaMultiSelect options={OPTIONS} value={[]} onChange={() => undefined} />);
    expect(screen.getByText('Soporte TI')).toBeInTheDocument();
    expect(screen.getByText('RRHH')).toBeInTheDocument();
    expect(screen.getByText('Administración')).toBeInTheDocument();
  });

  it('muestra mensaje vacío cuando no hay opciones', () => {
    render(<AreaMultiSelect options={[]} value={[]} onChange={() => undefined} />);
    expect(screen.getByText(/No hay áreas disponibles/i)).toBeInTheDocument();
  });

  it('marca como seleccionadas las que están en value', () => {
    render(<AreaMultiSelect options={OPTIONS} value={['2']} onChange={() => undefined} />);
    const rrhh = screen.getByRole('option', { name: /RRHH/ });
    expect(rrhh).toHaveAttribute('aria-selected', 'true');
    const ti = screen.getByRole('option', { name: /Soporte TI/ });
    expect(ti).toHaveAttribute('aria-selected', 'false');
  });

  it('agrega un id al hacer click sobre una opción no seleccionada', () => {
    const onChange = vi.fn();
    render(<AreaMultiSelect options={OPTIONS} value={['1']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('option', { name: /RRHH/ }));
    expect(onChange).toHaveBeenCalledWith(['1', '2']);
  });

  it('quita el id al hacer click sobre una opción ya seleccionada', () => {
    const onChange = vi.fn();
    render(<AreaMultiSelect options={OPTIONS} value={['1', '2']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('option', { name: /Soporte TI/ }));
    expect(onChange).toHaveBeenCalledWith(['2']);
  });
});
