import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RoleBadge } from './role-badge';

describe('RoleBadge', () => {
  it('muestra "Empleado" para empleado', () => {
    render(<RoleBadge value="empleado" />);
    expect(screen.getByText('Empleado')).toBeInTheDocument();
  });

  it('muestra "Agente" para agente', () => {
    render(<RoleBadge value="agente" />);
    expect(screen.getByText('Agente')).toBeInTheDocument();
  });

  it('muestra "Líder" para lider', () => {
    render(<RoleBadge value="lider" />);
    expect(screen.getByText('Líder')).toBeInTheDocument();
  });

  it('muestra "Admin" para admin', () => {
    render(<RoleBadge value="admin" />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });
});
