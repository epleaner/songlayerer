import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-100',
          'placeholder:text-neutral-500',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
