import { cn } from 'cn'
import { Dialog as D, DropdownMenu as M, Popover as P, Tooltip as T } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from './button.tsx'

const panel =
  'z-50 rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/** Icon button with tooltip + accessible label. */
export function IconButton({
  label,
  shortcut,
  ...props
}: ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props} />
      </T.Trigger>
      <T.Portal>
        <T.Content sideOffset={6} className={cn(panel, 'px-2 py-1 text-xs')}>
          {label}
          {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

export const TooltipProvider = T.Provider

export function Popover({
  trigger,
  children,
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content sideOffset={6} align="start" className={cn(panel, 'w-64 p-3', className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ className, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={4}
        align="start"
        className={cn(panel, 'min-w-48 p-1', className)}
        {...props}
      />
    </M.Portal>
  )
}

export function MenuItem({
  className,
  shortcut,
  children,
  ...props
}: ComponentProps<typeof M.Item> & { shortcut?: string }) {
  return (
    <M.Item
      className={cn(
        'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      {children}
      {shortcut && <span className="ml-auto text-xs text-muted-foreground">{shortcut}</span>}
    </M.Item>
  )
}

export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          className={cn(
            panel,
            'fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-5 focus:outline-none',
          )}
        >
          <D.Title className="text-base font-semibold">{title}</D.Title>
          {description ? (
            <D.Description className="mt-2 text-sm break-words text-muted-foreground">
              {description}
            </D.Description>
          ) : (
            <D.Description className="sr-only">{title}</D.Description>
          )}
          {children}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
