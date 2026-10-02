import { cn } from 'cn'
import { useEffect } from 'react'
import { t } from '../i18n/index.ts'
import type { OpenDoc } from '../stores/documents.ts'
import { useUi } from '../stores/ui.ts'
import { Input } from '../ui/controls.tsx'
import { row } from './OutlinePanel.tsx'
import {
  clearSearch,
  focusHit,
  runSearch,
  searchedDoc,
  useSearchOptions,
  type SearchOptions,
} from './search.ts'

export function SearchPanel({ doc }: { doc: OpenDoc }) {
  const search = useUi((s) => s.search)
  const { wholeWord, regex, error } = useSearchOptions()
  const opts: SearchOptions = { caseSensitive: search.caseSensitive, wholeWord, regex }
  const pageNo = (pageId: string) => doc.history.present.pages.findIndex((p) => p.id === pageId) + 1

  // Results belong to the document they were computed on.
  useEffect(() => {
    if (searchedDoc() !== doc.id) clearSearch()
  }, [doc.id])

  const toggle = (patch: Partial<SearchOptions>) => void runSearch(doc, search.query, { ...opts, ...patch })

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const q = new FormData(e.currentTarget).get('q') as string
          if (q === search.query && search.hits.length) focusHit((search.active + 1) % search.hits.length)
          else void runSearch(doc, q, opts)
        }}
      >
        <Input
          id="search-input"
          name="q"
          type="search"
          defaultValue={search.query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          aria-invalid={!!error}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.value = ''
            e.currentTarget.blur()
            clearSearch()
          }}
        />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {(
            [
              ['caseSensitive', 'search.matchCase'],
              ['wholeWord', 'search.wholeWord'],
              ['regex', 'search.regex'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={opts[k]} onChange={(e) => toggle({ [k]: e.target.checked })} />
              {t(label)}
            </label>
          ))}
        </div>
      </form>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t('search.invalidRegex', { message: error })}
        </p>
      )}
      {search.query && !search.running && !error && (
        <p className="text-xs text-muted-foreground" role="status">
          {search.hits.length ? t('search.results', { n: search.hits.length }) : t('search.none')}
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto">
        {search.hits.map((h, i) => (
          <li key={i}>
            {(i === 0 || search.hits[i - 1]!.pageId !== h.pageId) && (
              <h3 className="px-2 pt-2 text-xs font-semibold text-muted-foreground">
                {t('page.label', { n: pageNo(h.pageId) })}
              </h3>
            )}
            <button
              className={cn(row, 'whitespace-normal', i === search.active && 'bg-accent')}
              aria-current={i === search.active}
              onClick={() => focusHit(i)}
            >
              <span className="line-clamp-2">{h.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
