import { cn } from 'cn'
import {
  Bookmark,
  Copy,
  FileInput,
  FileOutput,
  FilePlus2,
  Image,
  RotateCw,
  Scissors,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { ContextMenu as CM } from 'radix-ui'
import type { ReactNode } from 'react'
import { formatKeys, getCommand, runCommand } from '../commands/registry.ts'
import { t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/overlays.tsx'

/** Page commands shown in the toolbar "Pages" menu and the thumbnail context menu (null = separator). */
const ITEMS: ([string, LucideIcon] | null)[] = [
  ['page.insertBlank', FilePlus2],
  ['page.duplicate', Copy],
  ['page.rotate', RotateCw],
  ['page.delete', Trash2],
  null,
  ['page.bookmark', Bookmark],
  null,
  ['page.extract', FileOutput],
  ['page.split', Scissors],
  ['page.merge', FileInput],
  ['page.exportImages', Image],
]

const enabled = (id: string) => getCommand(id)?.when?.() ?? true

function Label({ item: [id, Icon] }: { item: [string, LucideIcon] }) {
  const cmd = getCommand(id)
  return (
    <>
      <Icon /> {cmd ? t(cmd.labelKey) : id}
    </>
  )
}

export function PagesMenu({ disabled }: { disabled?: boolean }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          {t('pages.menu')}
        </Button>
      </MenuTrigger>
      <MenuContent>
        {ITEMS.map((it, i) =>
          it ? (
            <MenuItem
              key={it[0]}
              shortcut={formatKeys(it[0])}
              disabled={!enabled(it[0])}
              onSelect={() => runCommand(it[0])}
            >
              <Label item={it} />
            </MenuItem>
          ) : (
            <MenuSeparator key={i} />
          ),
        )}
      </MenuContent>
    </Menu>
  )
}

const cmItem =
  'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent [&_svg]:size-4'

/** Right-click menu with the same page commands (they act on the thumbnail selection). */
export function PageContextMenu({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <CM.Root onOpenChange={(o) => o && onOpen()}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content
          className={cn(
            'z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          )}
        >
          {ITEMS.map((it, i) =>
            it ? (
              <CM.Item
                key={it[0]}
                className={cmItem}
                disabled={!enabled(it[0])}
                onSelect={() => runCommand(it[0])}
              >
                <Label item={it} />
                {formatKeys(it[0]) && (
                  <span className="ml-auto text-xs text-muted-foreground">{formatKeys(it[0])}</span>
                )}
              </CM.Item>
            ) : (
              <CM.Separator key={i} className="-mx-1 my-1 h-px bg-border" />
            ),
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}
