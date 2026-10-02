import { BLANK_SOURCE } from '@pdf-atelier/core'
import type { OpenSource } from '../stores/documents.ts'

/**
 * Source for inserted blank pages (PageModel.sourceId === BLANK_SOURCE): nothing to draw, no text.
 * Lives in every OpenDoc.sources so viewer code needs no special case; exportDoc skips it.
 */
export const blankSource: OpenSource = {
  bytes: new Uint8Array(),
  pdf: {
    id: BLANK_SOURCE,
    pageCount: 0,
    pages: [],
    renderPage: async () => {},
    renderTextLayer: async () => () => {},
    getLinks: async () => [],
    getPageText: async () => '',
    search: async function* () {},
    getAnnotations: async () => [],
    getAtelierExtras: async () => ({ images: [], bookmarks: [] }),
    getOutline: async () => [],
    destroy: async () => {},
  },
}
