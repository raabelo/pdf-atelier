# 0001 — Aplicação única, dois runtimes

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

O PDF Atelier precisa rodar no navegador e no desktop. Manter duas aplicações duplica UI, lógica e bugs.

## Alternativas

1. Duas apps (`apps/web` e `apps/desktop` com componentes próprios) — duplicação.
2. Tauri — WebView diferente por SO (WebView2/WebKitGTK/WKWebView); comportamento diverge do navegador-alvo.
3. **Uma app React compartilhada; Electron como host com adapters de plataforma.**

## Decisão

Opção 3. `packages/app` é a única UI. `apps/web` é a entry do renderer e o mesmo build roda no Electron. O bootstrap escolhe `createWebPlatform()` ou `createElectronPlatform(window.pdfAtelier)`; nenhum outro ponto conhece o runtime. Funcionalidades específicas passam por contratos em `packages/platform`.

## Consequências

- Uma única base de UI, estado e testes.
- Capacidades divergentes são explicitadas via `capabilities` (ex.: `saveInPlace`), não escondidas.
- `apps/desktop` contém só main, preload e empacotamento.
- ESLint impede imports de Electron/Node em `packages/**`.
