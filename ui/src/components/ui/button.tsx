import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-neutral-800 bg-neutral-100 px-3 text-xs font-medium text-neutral-900 shadow-sm transition-colors',
          'hover:bg-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
          'disabled:pointer-events-none disabled:opacity-50',
          className
        )}
        ref={ref}
        type={type}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
