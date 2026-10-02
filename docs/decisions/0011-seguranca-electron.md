# 0011 — Segurança (Electron e PDFs)

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

PDFs são entrada não confiável. Um renderer comprometido não pode virar acesso ao Node ou ao disco.

## Decisão

**Janela**
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- App servido por protocolo `app://` (`protocol.handle` + `registerSchemesAsPrivileged` com `standard`, `secure`, `supportFetchAPI`, `corsEnabled`), nunca `file://`.
- `will-navigate` bloqueado; `setWindowOpenHandler` → `deny`; `setPermissionRequestHandler` nega por padrão (exceto o necessário, ex.: `fileSystem` se usado).

**IPC**
- Preload expõe via `contextBridge` só `window.pdfAtelier.invoke(channel, ...args)` (canais de `RENDERER_CHANNELS`), `refForDroppedFile(file)` (caminho resolvido dentro do preload; o renderer nunca vê nem envia caminhos) e `onMenuCommand(cb)` (menu nativo → comandos da app).
- Main valida `event.senderFrame` (origem `app://` ou dev server em desenvolvimento) e os argumentos com os schemas zod de `packages/platform/src/ipc.ts`.
- Arquivos por **refs opacas**; recentes numa allowlist no main.

**Conteúdo**
- CSP estrita: `default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'`; `worker-src 'self' blob:`; `connect-src` limitado (modelos TTS).
- PDF.js com scripting desativado.
- Links externos: só `http:`, `https:`, `mailto:`, com confirmação, via `shell.openExternal`.

**Binário (fuses)**
- `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on, `GrantFileProtocolExtraPrivileges` off.

## Alternativas

- `file://` + `webSecurity` — origem nula, quebra IndexedDB/CSP.
- Expor APIs de fs genéricas — rejeitado.

## Consequências

- Adicionar capacidade nativa exige contrato + schema + handler (ver `development.md`).
- Electron deve ser atualizado com frequência.
- Sem assinatura de código no início: aviso do SmartScreen.
