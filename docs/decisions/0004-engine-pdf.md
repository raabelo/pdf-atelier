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

- FreeText com caracteres fora de WinAnsi embute subsets de Noto Sans (OFL, `@fontsource/noto-sans`) via `@cantoo/fontkit`, carregados sob demanda; texto WinAnsi continua em Helvetica.
- PDF de origem protegido: `exportPdf` recebe a senha por fonte e recriptografa a saída (AES-256, mesma senha como user/owner) — salvar nunca remove a proteção silenciosamente.
- Compressão **sem perda** (`exportPdf({ compress: true })`, comando "Salvar cópia comprimida"): recomprime streams Flate no nível máximo, comprime streams sem filtro, deduplica streams idênticos (fontes/imagens repetidas após mesclar), remove `/Thumb` e `/PieceInfo` e objetos inalcançáveis, usa object streams. Imagens DCT/JPX/JBIG2/CCITT não são tocadas: nenhuma reamostragem ou recompressão com perda. Ganho depende do arquivo (PDFs já otimizados ganham pouco).
- Impressão é só do app (igual nos dois runtimes): exporta, rasteriza páginas a 150 DPI e chama `window.print()`.

- Bytes originais precisam ser copiados antes de ir ao PDF.js (o worker transfere/destaca o `ArrayBuffer`).
- Appearance streams (/AP) gerados por nós para cada tipo de anotação.
- PDFs criptografados/malformados podem abrir no PDF.js e falhar na escrita → modo somente leitura com aviso.
- PDF.js 6.x já oferece `extractPages` (reordenar/mesclar/extrair) e `saveDocument`; podem simplificar operações de página no futuro.
- MuPDF.js é alternativa viável sob licença copyleft (ADR 0003) se precisarmos de redação/compressão.
- Assets do PDF.js (`cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`) servidos localmente; CSP precisa de `'wasm-unsafe-eval'`.
