import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-700',
      info: 'bg-blue-50 text-blue-700',
      success: 'bg-emerald-50 text-emerald-700',
      warning: 'bg-amber-50 text-amber-700',
      danger: 'bg-red-50 text-red-700',
      muted: 'bg-slate-50 text-slate-500',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone, className }))} {...props}>
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';
