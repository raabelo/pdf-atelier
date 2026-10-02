# Desenvolvimento

## Ambiente

- Node 24 LTS (`.nvmrc`). Node 20 está EOL.
- pnpm 10.

```bash
pnpm install
```

## Scripts

| Script | Descrição |
|---|---|
| `pnpm dev` / `pnpm dev:web` | Vite em `apps/web` |
| `pnpm dev:desktop` | Compila main/preload, sobe Vite e abre Electron apontando para o dev server |
| `pnpm build:web` | Build estático em `apps/web/dist` |
| `pnpm build:desktop` | Main/preload (esbuild) + renderer (build web) |
| `pnpm build` | Ambos |
| `pnpm test` | Vitest; projetos `node` (core/pdf/platform/tts/desktop) e `dom` (app) |
| `pnpm test:e2e` | Playwright (web + Electron via `_electron`) |
| `pnpm lint` | ESLint (flat config) |
| `pnpm typecheck` | `tsc --noEmit` em cada pacote |
| `pnpm format` | Prettier |

## Por que estas versões

- **`node-linker=hoisted`** (`.npmrc`): o electron-builder ainda é mais confiável com `node_modules` hoisted em workspaces pnpm.
- **`onlyBuiltDependencies`** (`pnpm-workspace.yaml`): pnpm 10 bloqueia postinstall por padrão; `electron` (download do binário) e `esbuild` precisam rodar. No pnpm 11 o equivalente é `allowBuilds`.
- **TypeScript fixado em `~6.0`**: `typescript-eslint` exige `<6.1`; o TS 7 (compilador nativo) ainda não tem API programática estável e o `--build` está incompleto.

Ver [ADR 0012](decisions/0012-versoes-toolchain.md).

## Regras do código

- `packages/**` nunca importa `electron`, `node:*`, `fs` ou `path` (ESLint `no-restricted-imports`). Tudo que é específico de plataforma passa por `packages/platform`.
- Tipos de PDF.js/pdf-lib não saem de `packages/pdf`.
- `packages/core` não usa DOM nem React.
- Atalhos são registrados no registro central como comandos; componentes não escutam teclas diretamente.
- Strings da UI ficam no catálogo de i18n (pt-BR/en).

## Como adicionar uma capacidade de plataforma

Exemplo: "mostrar item na pasta".

1. **Contrato** — `packages/platform/src/contracts.ts`: adicione o método (e uma flag em `capabilities` se nem todo runtime suportar).
2. **Schema IPC** — `packages/platform/src/ipc.ts`: adicione o canal com `req`/`res` em zod. Use refs opacas, nunca caminhos vindos do renderer.
3. **Handler no main** — `apps/desktop/src`: registre o handler; valide sender + args com o schema.
4. **Adapter Electron** — `packages/platform/src/electron`: chame `bridge.invoke('canal', ...)`.
5. **Adapter Web** — `packages/platform/src/web`: implemente com APIs do navegador ou declare a capacidade como indisponível.
6. **Teste** — unitário do adapter web e teste do handler (validação rejeita entradas inválidas).

O preload não muda: ele só repassa canais presentes no schema.

## Deploy web

Vercel, projeto com **Root Directory** = `apps/web`, preset Vite. CSP e rewrites em `apps/web/vercel.json`. Deploy só com confirmação explícita.

## Empacotamento desktop

electron-builder, alvo Windows NSIS. Fuses aplicados no build. Sem assinatura de código por enquanto (SmartScreen avisará).
