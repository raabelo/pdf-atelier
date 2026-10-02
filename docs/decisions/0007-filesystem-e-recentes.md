# 0007 — Sistema de arquivos e recentes

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Abrir, salvar, salvar como e recentes devem funcionar nos dois runtimes sem a app saber qual é o atual. O navegador tem limites de segurança diferentes por engine.

## Alternativas

- Só Chromium.
- **Chromium completo + fallback honesto** em Firefox/Safari.
- Fallback + cópia opcional em OPFS para reabrir recentes.

## Decisão

Contrato `FileSystemAdapter` com `capabilities: { saveInPlace, reopenRecent }`.

- **Web Chromium:** File System Access API (`showOpenFilePicker`, `createWritable`); handles guardados no IndexedDB; `requestPermission` ao reabrir.
- **Web Firefox/Safari:** abrir via `<input type="file">`, salvar via download, recentes só com metadados (reabrir pede o arquivo). Sem cópia em OPFS.
- **Desktop:** diálogos e fs nativos no main via IPC. O renderer recebe **refs opacas**; nunca envia caminhos. Recentes = allowlist de caminhos persistida no main. Arquivos arrastados: preload obtém o caminho (`webUtils.getPathForFile`) e o main emite uma ref.
- Arrastar-e-soltar funciona em todos os runtimes (`fromDroppedFile`).

## Consequências

- A UI adapta rótulos e fluxos às capacidades (ex.: "Salvar" vira download no fallback).
- O renderer comprometido não consegue ler arquivos arbitrários do disco.
- Cópia em OPFS pode ser reavaliada se o fallback incomodar.
