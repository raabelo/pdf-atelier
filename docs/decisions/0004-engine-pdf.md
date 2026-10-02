# 0004 — Engine PDF

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Precisamos renderizar (com texto selecionável, busca, links) e também escrever PDFs: anotações com aparência, operações de página, mesclagem.

## Alternativas

| Opção | Prós | Contras |
|---|---|---|
| **PDF.js 6.3 + `@cantoo/pdf-lib`** | Melhor render JS (Apache-2.0); fork pdf-lib ativo (MIT, 2.11.x, set/2026) com criptografia, load com senha, update incremental | Dois parsers; anotações e /AP construídas em baixo nível |
| PDFium WASM (EmbedPDF) | Engine do Chrome, uma só para render+escrita, permissiva | Ecossistema jovem, ~5 MB wasm, text layer próprio |
| MuPDF.js | Mais completa (anotações com /AP, redação, senha, compressão) | AGPL ou licença paga |

`pdf-lib` original está sem manutenção desde 2021; `@pdfme/pdf-lib` não tem `encrypt()`.

## Decisão

PDF.js (`pdfjs-dist` 6.3) para leitura/render/texto/busca/links/import de anotações. `@cantoo/pdf-lib` para compor e escrever o arquivo final. Tudo encapsulado em `packages/pdf`; nenhum tipo de engine sai do pacote (interface `PdfSource`).

## Consequências

- Bytes originais precisam ser copiados antes de ir ao PDF.js (o worker transfere/destaca o `ArrayBuffer`).
- Appearance streams (/AP) gerados por nós para cada tipo de anotação.
- PDFs criptografados/malformados podem abrir no PDF.js e falhar na escrita → modo somente leitura com aviso.
- PDF.js 6.x já oferece `extractPages` (reordenar/mesclar/extrair) e `saveDocument`; podem simplificar operações de página no futuro.
- MuPDF.js é alternativa viável sob licença copyleft (ADR 0003) se precisarmos de redação/compressão.
- Assets do PDF.js (`cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`) servidos localmente; CSP precisa de `'wasm-unsafe-eval'`.
