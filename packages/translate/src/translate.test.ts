import { describe, expect, it } from 'vitest'
import { chunk, MODELS, route } from './index.ts'

describe('route', () => {
  it('uses one model to or from English, with the target token for en-ROMANCE', () => {
    expect(route('en', 'pt')).toEqual([{ model: 'Xenova/opus-mt-en-ROMANCE', token: '>>pt_br<<' }])
    expect(route('fr', 'en')).toEqual([{ model: 'Xenova/opus-mt-ROMANCE-en', token: '' }])
    expect(route('en', 'de')).toEqual([{ model: 'Xenova/opus-mt-en-de', token: '' }])
    expect(route('pt', 'pt')).toEqual([])
  })

  it('pivots other pairs through English, only with listed models', () => {
    const steps = route('de', 'es')
    expect(steps).toEqual([
      { model: 'Xenova/opus-mt-de-en', token: '' },
      { model: 'Xenova/opus-mt-en-ROMANCE', token: '>>es<<' },
    ])
    for (const s of [...route('pt', 'de'), ...route('it', 'fr')])
      expect(MODELS.map((m) => m.id)).toContain(s.model)
  })
})

describe('chunk', () => {
  it('splits sentences, joins line wraps and keeps paragraph breaks', () => {
    const text = 'First line\nwraps here. Second one?\n\n  New paragraph.  '
    expect(chunk(text, 'en')).toEqual([
      'First line wraps here.',
      'Second one?',
      '\n\n',
      'New paragraph.',
    ])
  })

  it('returns nothing for blank text', () => {
    expect(chunk(' \n\n ', 'en')).toEqual([])
  })
})
