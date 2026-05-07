import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlaIndicator } from './sla-indicator';

const NOW = Date.UTC(2026, 0, 15, 10, 0, 0);

describe('SlaIndicator', () => {
  it('muestra "—" cuando no hay deadline', () => {
    render(<SlaIndicator deadline={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('verde cuando faltan más de 24h', () => {
    const deadline = new Date(NOW + 30 * 60 * 60 * 1000).toISOString();
    const { container } = render(<SlaIndicator deadline={deadline} now={NOW} />);
    expect(container.querySelector('.bg-emerald-500')).not.toBeNull();
  });

  it('amarillo entre 6h y 24h', () => {
    const deadline = new Date(NOW + 12 * 60 * 60 * 1000).toISOString();
    const { container } = render(<SlaIndicator deadline={deadline} now={NOW} />);
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
  });

  it('rojo cuando faltan menos de 6h', () => {
    const deadline = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();
    const { container } = render(<SlaIndicator deadline={deadline} now={NOW} />);
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
  });

  it('rojo y "Vencido" cuando ya pasó la deadline', () => {
    const deadline = new Date(NOW - 60 * 60 * 1000).toISOString();
    render(<SlaIndicator deadline={deadline} now={NOW} />);
    expect(screen.getByText(/Vencido/)).toBeInTheDocument();
  });

  it('formato del label en horas y minutos', () => {
    const deadline = new Date(NOW + 2 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString();
    render(<SlaIndicator deadline={deadline} now={NOW} />);
    expect(screen.getByText('2h 15m')).toBeInTheDocument();
  });
});
