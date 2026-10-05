import { LANGS, MODEL_BYTES, MODELS } from '@pdf-atelier/translate'
import { Copy, Download, Languages, Trash2, Volume2 } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../i18n/index.ts'
import { useSettings } from '../stores/settings.ts'
import { notify } from '../stores/ui.ts'
import { speakText } from '../tts/controller.ts'
import { Button } from '../ui/button.tsx'
import { Select, Separator, Switch } from '../ui/controls.tsx'
import { IconButton } from '../ui/overlays.tsx'
import {
  installModel,
  refreshModels,
  removeModel,
  translateSelection,
  useTranslate,
} from './controller.ts'

/** "Xenova/opus-mt-en-ROMANCE" -> "en → pt, es, fr, it". */
const pairName = (id: string) =>
  id.split('opus-mt-')[1]!.replace('-', ' → ').replace('ROMANCE', 'pt, es, fr, it')

const langName = (lang: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

export function TranslatePanel() {
  const { busy, result, installed, installing } = useTranslate()
  const tr = useSettings((s) => s.translate)
  const locale = useSettings((s) => s.locale)
  const setTranslate = useSettings((s) => s.setTranslate)

  useEffect(() => {
    void refreshModels()
  }, [])

  const options = LANGS.map((l) => (
    <option key={l} value={l}>
      {langName(l, locale)}
    </option>
  ))

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('translate.from')}</span>
        <Select value={tr.from} onChange={(e) => setTranslate({ from: e.target.value })}>
          <option value="auto">{t('translate.auto')}</option>
          {options}
        </Select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('translate.to')}</span>
        <Select value={tr.to} onChange={(e) => setTranslate({ to: e.target.value })}>
          {options}
        </Select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>{t('translate.auto.selection')}</span>
        <Switch
          checked={tr.autoTranslate}
          onCheckedChange={(autoTranslate) => setTranslate({ autoTranslate })}
        />
      </label>
      <div>
        <Button size="sm" disabled={busy} onClick={() => translateSelection()}>
          <Languages /> {t('translate.selection')}
        </Button>
      </div>

      {result && (
        <div className="space-y-2 rounded-md bg-muted p-2" aria-busy={busy}>
          {tr.from === 'auto' && (
            <p className="text-xs text-muted-foreground">
              {t('translate.detected', { lang: langName(result.from, locale) })}
            </p>
          )}
          <p className="leading-relaxed whitespace-pre-wrap" aria-live="polite">
            {result.text || (busy ? t('translate.working') : '')}
          </p>
          {!busy && result.text && (
            <div className="flex justify-end gap-1">
              <IconButton
                size="icon-sm"
                label={t('cmd.edit.copy')}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(result.text)
                    .then(() => notify(t('translate.copied')))
                }
              >
                <Copy />
              </IconButton>
              <IconButton
                size="icon-sm"
                label={t('cmd.tts.play')}
                onClick={() => speakText(result.text)}
              >
                <Volume2 />
              </IconButton>
            </div>
          )}
        </div>
      )}

      <Separator />
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('translate.models')}
      </h3>
      <ul className="space-y-2">
        {MODELS.map(({ id, license }) => {
          const progress = installing[id]
          const name = pairName(id)
          return (
            <li key={id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <div className="truncate font-medium" title={name}>
                  {name}
                </div>
                <div className="text-xs text-muted-foreground">
                  Opus-MT · {license} · {Math.round(MODEL_BYTES / 1e6)} MB
                </div>
              </div>
              {progress !== undefined ? (
                <progress className="w-20" value={progress} max={1} aria-label={name} />
              ) : installed.includes(id) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void removeModel(id)}
                  aria-label={`${t('tts.remove')} ${name}`}
                >
                  <Trash2 /> {t('tts.remove')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void installModel(id)}
                  aria-label={`${t('tts.install')} ${name}`}
                >
                  <Download /> {t('tts.install')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('translate.offline')}</p>
    </div>
  )
}
