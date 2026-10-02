# 0010 — Estado: Zustand + Immer; histórico por patches

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Separar estado de UI, documento, editor, anotações, aplicação e persistência, sem um store gigante. Undo/redo deve cobrir anotações, desenhos, movimentação, exclusão, inserção e páginas.

## Alternativas

- Redux Toolkit — mais cerimônia.
- Jotai — átomos finos; histórico mais difícil.
- **Zustand** (stores pequenos) + **Immer**.
- Histórico: comandos com `do/undo` manuais vs **patches Immer**.

## Decisão

- Stores Zustand separados: UI, abas/documentos, editor (ferramenta, seleção), configurações.
- Documento = `DocumentModel` (core) + histórico próprio por aba.
- Operações são receitas Immer; `produceWithPatches` gera `{ label, patches, inversePatches }`.
- Undo/redo aplicam patches; transações agrupam mudanças; coalescência por chave transforma um arrastar em um passo.

## Consequências

- Sem código de `undo` manual por comando.
- Histórico serializável (base para sync futura).
- Modelo precisa ser dados puros (sem classes) para o Immer.
- Bytes dos PDFs ficam fora do estado.
