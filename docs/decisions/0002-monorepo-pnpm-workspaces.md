# 0002 — Monorepo com pnpm workspaces

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Poucos pacotes (core, pdf, platform, app, tts + 2 apps), prioridade em simplicidade e clareza.

## Alternativas

- **pnpm workspaces puro** — simples, rápido, sem camada extra.
- Turborepo — cache de tarefas; útil quando builds ficam lentos.
- Nx — poderoso, mas pesado para este tamanho.

## Decisão

pnpm workspaces, sem orquestrador. Pacotes internos consumidos como fonte TS (`exports` → `src/index.ts`), sem build próprio; o Vite compila. Scripts raiz usam `pnpm --filter` / `pnpm -r`.

Granularidade reduzida em relação à proposta inicial: `storage`, `filesystem`, `ui`, `state` não são pacotes — são adapters em `platform` ou pastas em `app`. Separar só quando houver motivo real.

## Consequências

- `node-linker=hoisted` por compatibilidade com electron-builder.
- `onlyBuiltDependencies: [electron, esbuild]` (pnpm 10).
- Turborepo pode entrar depois sem reestruturar.
