# PDF Atelier

Leitor e editor de PDF multiplataforma: **uma única aplicação** com dois runtimes — **Web** (navegador) e **Desktop** (Electron, Windows).

O Electron é só um host: fornece capacidades nativas (arquivos, diálogos, shell) por meio de adapters. UI, estado, viewer, anotações e editor existem uma única vez.

## Requisitos

- Node **24 LTS** (`.nvmrc`)
- pnpm **10** (`packageManager` no `package.json`)

## Início rápido

```bash
pnpm install
pnpm dev            # web (Vite)
pnpm dev:desktop    # Vite + Electron
```

| Script | O que faz |
|---|---|
| `pnpm dev` / `pnpm dev:web` | Servidor de desenvolvimento web |
| `pnpm dev:desktop` | App desktop apontando para o dev server |
| `pnpm build` | `build:web` + `build:desktop` |
| `pnpm build:web` | Build estático (deploy Vercel) |
| `pnpm build:desktop` | Main/preload + renderer empacotáveis |
| `pnpm test` | Vitest (unitários/integração) |
| `pnpm test:e2e` | Playwright (web + Electron) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` em todos os pacotes |
| `pnpm format` | Prettier |

## Estrutura

```text
apps/
  web/        entry única do renderer (Vite); escolhe o adapter de plataforma
  desktop/    Electron: main + preload, zero UI; carrega o build de apps/web
packages/
  core/       domínio puro: modelo do documento, anotações, histórico
  pdf/        engine: PDF.js (render/texto/busca) + @cantoo/pdf-lib (escrita)
  platform/   contratos + adapters web/electron + contrato IPC (zod)
  app/        a UI (React): shell, viewer, ferramentas, painéis, stores
  tts/        texto-para-fala: Piper local + Web Speech
docs/         arquitetura, desenvolvimento, roadmap, ADRs
e2e/          testes Playwright
```

## Documentação

- [Arquitetura](docs/architecture.md)
- [Desenvolvimento](docs/development.md)
- [Roadmap](docs/roadmap.md)
- [Decisões (ADRs)](docs/decisions/)

## Licença

Copyleft (GPL/AGPL) — ver [ADR 0003](docs/decisions/0003-licenca-copyleft.md).
