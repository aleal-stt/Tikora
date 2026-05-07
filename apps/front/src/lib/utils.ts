import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Helper estilo shadcn — combina clsx y tailwind-merge para que las
 * clases del usuario sobrescriban las defaults sin colisionar.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
