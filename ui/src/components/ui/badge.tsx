import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'idle' | 'running' | 'success' | 'error' | 'stopped';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variantClass: Record<Variant, string> = {
  idle: 'border-neutral-800 bg-neutral-900/40 text-neutral-300',
  running: 'border-neutral-800 bg-neutral-100 text-neutral-900',
  success: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200',
  error: 'border-red-900/60 bg-red-950/40 text-red-200',
  stopped: 'border-amber-900/60 bg-amber-950/40 text-amber-200',
};

function Badge({ className, variant = 'idle', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        variantClass[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
