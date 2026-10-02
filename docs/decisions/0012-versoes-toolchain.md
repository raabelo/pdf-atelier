# 0012 — Versões da toolchain

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Versões verificadas no registro npm / docs em 2026-10-02.

## Decisão

| Ferramenta | Versão | Observação |
|---|---|---|
| Node | 24 LTS | 20 está EOL; Electron 44 embute Node 24 |
| pnpm | 10.19 | `onlyBuiltDependencies`; `node-linker=hoisted` |
| TypeScript | ~6.0.3 | typescript-eslint 8.x exige `<6.1`; TS 7 sem API estável |
| Vite | 8.3 | `@vitejs/plugin-react` 6 |
| React | 19.3 | |
| Electron | 44.5 | Chromium 152, Node 24.21 |
| electron-builder | 26.x | NSIS (Windows) |
| pdfjs-dist | 6.3 | `getDocument({...})` só com objeto de parâmetros |
| @cantoo/pdf-lib | 2.11 | |
| Tailwind CSS | 4.3 | |
| shadcn | 4.x | base Radix |
| Vitest | 5 | |
| Playwright | 1.63 | |
| ESLint | 10 (flat) | |

## Alternativas

- TS 7 — mais rápido, mas quebra typescript-eslint e `tsc -b`.
- Node 22 LTS — mais maduro, suporte mais curto.

## Consequências

- Revisitar TS 7 quando typescript-eslint suportar.
- pnpm 11 troca `onlyBuiltDependencies` por `allowBuilds`.
