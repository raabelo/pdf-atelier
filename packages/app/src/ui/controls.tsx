import { cn } from 'cn'
import { Slider as S, Switch as Sw } from 'radix-ui'
import type { ComponentProps } from 'react'

export function Slider({
  className,
  label,
  ...props
}: ComponentProps<typeof S.Root> & { label: string }) {
  return (
    <S.Root
      className={cn('relative flex h-5 w-full touch-none items-center select-none', className)}
      {...props}
    >
      <S.Track className="relative h-1.5 grow rounded-full bg-muted">
        <S.Range className="absolute h-full rounded-full bg-primary" />
      </S.Track>
      <S.Thumb
        aria-label={label}
        className="block size-4 rounded-full border border-primary bg-background shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </S.Root>
  )
}

export function Switch({ className, ...props }: ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <Sw.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  )
}

/** Native select: accessible and keyboard friendly everywhere. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

export const Separator = ({ vertical }: { vertical?: boolean }) => (
  <div
    role="separator"
    className={vertical ? 'mx-1 h-5 w-px shrink-0 bg-border' : 'my-2 h-px w-full bg-border'}
  />
)
