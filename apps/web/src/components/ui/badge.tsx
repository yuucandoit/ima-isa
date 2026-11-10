import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors',
  {
    variants: {
      variant: {
        default: 'border-primary/25 bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        positive: 'border-positive/25 bg-positive/10 text-positive',
        negative: 'border-negative/25 bg-negative/10 text-negative',
        neutral: 'border-border bg-secondary/80 text-muted-foreground',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        high: 'border-warning/40 bg-warning/15 text-warning',
        critical: 'border-critical/40 bg-critical/15 text-critical',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
