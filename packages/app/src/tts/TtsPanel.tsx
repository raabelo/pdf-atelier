import { Download, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../i18n/index.ts'
import { useSettings } from '../stores/settings.ts'
import { Button } from '../ui/button.tsx'
import { Select, Separator, Slider, Switch } from '../ui/controls.tsx'
import {
  installVoice,
  readFromCurrentPage,
  readSelection,
  refreshVoices,
  removeVoice,
  stopReading,
  togglePause,
  useTts,
} from './controller.ts'

const PIPER_LANGS = ['pt-BR', 'en-US', 'es-ES', 'fr-FR']
const langName = (lang: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

export function TtsPanel() {
  const { state, voices, current, installing, detected } = useTts()
  const tts = useSettings((s) => s.tts)
  const locale = useSettings((s) => s.locale)
  const setTts = useSettings((s) => s.setTts)

  useEffect(() => {
    void refreshVoices()
  }, [])

  // Any language a voice exists for, Piper ones first; '*' is the synthetic system default.
  const langs = [
    ...new Set([...PIPER_LANGS, ...voices.map((v) => v.lang).filter((l) => l !== '*')]),
  ]
  const base = (l: string) => l.toLowerCase().split('-')[0]
  const forLang = voices.filter((v) => v.lang === '*' || base(v.lang) === base(tts.lang))
  const piper = voices.filter((v) => v.provider === 'piper')

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('tts.language')}</span>
        <Select value={tts.lang} onChange={(e) => setTts({ lang: e.target.value, voiceId: null })}>
          {langs.map((l) => (
            <option key={l} value={l}>
              {langName(l, locale)} ({l})
            </option>
          ))}
        </Select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('tts.voice')}</span>
        <Select
          value={tts.voiceId ?? ''}
          onChange={(e) => setTts({ voiceId: e.target.value || null })}
        >
          <option value="">{t('tts.voiceAuto')}</option>
          {forLang.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.provider === 'piper' && !v.installed ? ' ↓' : ''}
            </option>
          ))}
        </Select>
      </label>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">
          {t('tts.rate')}: {tts.rate.toFixed(2)}×
        </span>
        <Slider
          label={t('tts.rate')}
          min={0.5}
          max={2}
          step={0.05}
          value={[tts.rate]}
          onValueChange={([r]) => setTts({ rate: r! })}
        />
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>{t('tts.autoDetect')}</span>
        <Switch
          checked={tts.autoDetect}
          onCheckedChange={(autoDetect) => setTts({ autoDetect })}
        />
      </label>
      {tts.autoDetect && detected && state !== 'idle' && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('tts.detected', { lang: `${langName(detected, locale)} (${detected})` })}
        </p>
      )}
      <label className="flex items-center justify-between gap-2">
        <span>{t('tts.autoRead')}</span>
        <Switch checked={tts.autoRead} onCheckedChange={(autoRead) => setTts({ autoRead })} />
      </label>

      <div className="flex flex-wrap gap-2">
        {state === 'idle' ? (
          <>
            <Button size="sm" onClick={() => readSelection()}>
              <Play /> {t('tts.readSelection')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void readFromCurrentPage()}>
              {t('tts.readFromPage')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => void togglePause()}>
              {state === 'paused' ? <Play /> : <Pause />}{' '}
              {state === 'paused' ? t('tts.resume') : t('tts.pause')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void stopReading()}>
              <Square /> {t('tts.stop')}
            </Button>
          </>
        )}
      </div>

      {current && (
        <p className="rounded-md bg-muted p-2 leading-relaxed" aria-live="polite">
          <span className="sr-only">{t('tts.reading')}: </span>
          <mark className="rounded-sm bg-yellow-200 px-0.5 text-black">
            {current.text.slice(current.start, current.end)}
          </mark>
        </p>
      )}

      <Separator />
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('tts.voices')}
      </h3>
      <ul className="space-y-2">
        {piper.map((v) => {
          const progress = installing[v.id]
          return (
            <li key={v.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {langName(v.lang, locale)} · {v.license}
                    {v.sizeBytes ? ` · ${Math.round(v.sizeBytes / 1e6)} MB` : ''}
                  </div>
                </div>
                {progress !== undefined ? (
                  <progress className="w-20" value={progress} max={1} aria-label={v.name} />
                ) : v.installed ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeVoice(v.id)}
                    aria-label={`${t('tts.remove')} ${v.name}`}
                  >
                    <Trash2 /> {t('tts.remove')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void installVoice(v.id)}
                    aria-label={`${t('tts.install')} ${v.name}`}
                  >
                    <Download /> {t('tts.install')}
                  </Button>
                )}
              </div>
              {v.attribution && (
                <p className="mt-1 text-xs text-muted-foreground">{v.attribution}</p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('tts.systemVoices')}</p>
    </div>
  )
}
