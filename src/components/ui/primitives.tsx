'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared interface primitives.
 *
 * Grouped in one module because they are small, share the same token set, and
 * are always imported together — a file per primitive would be more files than
 * lines of substance.
 */

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xs border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.07em] leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-raised text-ink-muted',
        accent: 'border-edge/35 bg-edge/12 text-edge-soft',
        good: 'border-stable/35 bg-stable/12 text-stable',
        warn: 'border-warn/35 bg-warn/12 text-warn',
        bad: 'border-cycle/35 bg-cycle/12 text-cycle',
        info: 'border-signal/35 bg-signal/12 text-signal',
        ghost: 'border-transparent bg-transparent text-ink-faint',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border border-line bg-pit px-3 text-sm text-ink transition-colors',
          'placeholder:text-ink-ghost hover:border-line-strong',
          'focus:border-edge/60 focus:outline-none focus:ring-2 focus:ring-edge/25',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);

// ---------------------------------------------------------------------------
// Panel — the standard bordered surface
// ---------------------------------------------------------------------------

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface/70', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  detail,
  action,
  className,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-line px-4 py-2.5',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-[13px] font-medium text-ink">{title}</h3>
        {detail ? <p className="mt-0.5 truncate text-[11px] text-ink-faint">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Small caps section label used throughout the workspace chrome. */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-ghost',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-center gap-0.5 rounded-md bg-pit p-0.5', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium text-ink-faint transition-colors',
        'hover:text-ink-muted',
        'data-[state=active]:bg-raised data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('focus-visible:outline-none', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 300,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-100 max-w-xs rounded-sm border border-line bg-raised px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-muted shadow-xl',
            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-100 bg-void/80 backdrop-blur-sm',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'glass fixed left-1/2 top-1/2 z-100 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl p-6',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-xs p-1 text-ink-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('font-display text-lg font-semibold text-ink', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1 text-sm text-ink-muted', className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Scroll area
// ---------------------------------------------------------------------------

export function ScrollArea({
  className,
  children,
  viewportClassName,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={cn('h-full w-full', viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-opacity"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-line-strong hover:bg-ink-ghost" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({
  value,
  className,
  tone = 'accent',
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'good' | 'warn' | 'bad';
}) {
  const colors = {
    accent: 'bg-edge',
    good: 'bg-stable',
    warn: 'bg-warn',
    bad: 'bg-cycle',
  } as const;

  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full transition-transform duration-500 ease-out', colors[tone])}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-line transition-colors',
        'data-[state=checked]:border-edge/60 data-[state=checked]:bg-edge/30 data-[state=unchecked]:bg-pit',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-3 rounded-full bg-ink-faint shadow transition-transform',
          'data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-edge-soft data-[state=unchecked]:translate-x-[2px]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Stat — the metric readout used across dashboards
// ---------------------------------------------------------------------------

export function Stat({
  label,
  value,
  detail,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  className?: string;
}) {
  const toneClass = {
    neutral: 'text-ink',
    good: 'text-stable',
    warn: 'text-warn',
    bad: 'text-cycle',
    accent: 'text-edge-soft',
  }[tone];

  return (
    <div className={cn('min-w-0', className)}>
      <Eyebrow>{label}</Eyebrow>
      <div className={cn('tabular mt-1.5 text-[22px] font-medium leading-none', toneClass)}>
        {value}
      </div>
      {detail ? <div className="mt-1.5 truncate text-[11px] text-ink-faint">{detail}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-md border border-line bg-raised text-ink-faint">
          {icon}
        </div>
      ) : null}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? (
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-faint">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
