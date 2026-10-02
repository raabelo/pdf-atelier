# 0005 — Modelo de anotações e formato de gravação

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

A UI não deve manipular objetos do PDF.js. O modelo precisa suportar edição, undo/redo, persistência, exportação, importação e sync futura. As anotações devem ser visíveis em outros leitores.

## Alternativas

1. **Dentro do PDF como anotações padrão + metadado próprio.**
2. Sidecar/banco local — PDF intocado, mas outros leitores não veem nada.
3. Ambos — mais complexidade.
4. Achatar (flatten) — fiel, mas não editável.

## Decisão

Opção 1.

- Modelo próprio em `packages/core` (`Annotation` = união discriminada: `highlight|underline|strikeout`, `ink`, `rect|ellipse`, `line|arrow`, `freetext`), referenciando a página por `pageId`.
- Ao salvar: anotações PDF padrão (/Highlight, /Underline, /StrikeOut, /Ink, /Square, /Circle, /Line com /LE para seta, /FreeText) **com /AP**, mais a chave `/PDFAtelier` contendo o JSON do modelo para round-trip sem perda.
- Ao abrir: anotações existentes são importadas (`importedFrom.objectId`); ao salvar, o original é substituído.

**Coordenadas:** pontos PDF, origem no canto superior esquerdo do crop box sem rotação, y para baixo. O escritor converte para espaço do usuário PDF.

## Consequências

- Interoperabilidade com Acrobat e outros leitores.
- Gerar /AP correto por tipo é o principal custo e risco.
- Tipos não suportados na importação são preservados no arquivo, mas não editáveis.
- Formato serializável facilita sync futura.
