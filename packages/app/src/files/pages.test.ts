import { createDocument, docOps } from '@pdf-atelier/core'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { buildMatcher, findAll } from '../sidebar/search.ts'
import { detectLanguage } from '../tts/detect.ts'
import { everyN, parseRanges, subsetModel } from './pages.ts'

describe('page ranges', () => {
  it('parses ranges to 0-based groups', () => {
    expect(parseRanges('1-3, 4-5,7', 7)).toEqual([[0, 1, 2], [3, 4], [6]])
  })
  it('rejects invalid or out-of-bounds ranges', () => {
    for (const bad of ['', '0-2', '3-1', '1-9', 'a', '1--2']) expect(parseRanges(bad, 8)).toBeNull()
  })
  it('chunks every N pages', () => {
    expect(everyN(2, 5)).toEqual([[0, 1], [2, 3], [4]])
  })
})

describe('subsetModel', () => {
  it('keeps only the chosen pages with their annotations and bookmarks', () => {
    const base = createDocument({
      title: 'x',
      source: { id: 's', name: 'x.pdf' },
      pages: [1, 2, 3].map(() => ({ width: 100, height: 100, rotation: 0 as const })),
    })
    const [p1, p2] = base.pages
    const doc = produce(base, (d) => {
      docOps.addBookmark(d, p1!.id, 'one')
      docOps.addBookmark(d, p2!.id, 'two')
    })
    const sub = subsetModel(doc, [p2!.id])
    expect(sub.pages.map((p) => p.id)).toEqual([p2!.id])
    expect(sub.bookmarks.map((b) => b.title)).toEqual(['two'])
  })
})

describe('search matcher', () => {
  const run = (q: string, text: string, o = {}) =>
    findAll(text, buildMatcher(q, { caseSensitive: false, wholeWord: false, regex: false, ...o })).length
  it('escapes plain queries and ignores case by default', () => {
    expect(run('a.b', 'A.B axb')).toBe(1)
  })
  it('whole word is Unicode-aware', () => {
    expect(run('ação', 'ação ações reação', { wholeWord: true })).toBe(1)
  })
  it('regex mode, invalid regex throws', () => {
    expect(run('\\d{3}', 'abc 123 4567', { regex: true })).toBe(2)
    expect(() => buildMatcher('(', { caseSensitive: false, wholeWord: false, regex: true })).toThrow()
  })
})

describe('detectLanguage', () => {
  it('maps detected languages and ignores short text', () => {
    expect(detectLanguage('O documento foi assinado pelas partes na presença das testemunhas.')).toBe('pt-BR')
    expect(detectLanguage('The agreement was signed by both parties in front of the witnesses.')).toBe('en-US')
    expect(detectLanguage('curto')).toBeNull()
  })
})
