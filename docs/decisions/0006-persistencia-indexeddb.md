# 0006 — Persistência com IndexedDB nos dois runtimes

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

Precisamos guardar configurações, recentes, preferências de TTS, tema, ferramentas e estado por documento.

## Alternativas

| Opção | Prós | Contras |
|---|---|---|
| **IndexedDB nos dois** | Um único código | Dados presos à origem; pouco inspecionáveis |
| IndexedDB web + SQLite desktop | Queries, robustez | Duas implementações; build nativo ou `node:sqlite` |
| IndexedDB web + JSON em `userData` | Legível, backup fácil | Duas implementações, sem queries |
| localStorage | Simples | Síncrono, limite pequeno, só strings |

## Decisão

IndexedDB (via `idb`) em ambos os runtimes, a partir do renderer. Sem adapter de storage: a mesma implementação serve aos dois. Estado por documento indexado pelo hash do arquivo.

## Consequências

- No Electron a origem `app://` fixa é obrigatória; trocar o esquema exige migração.
- Exceção: a allowlist de caminhos recentes do desktop fica no main (arquivo em `userData`), por segurança (ADR 0011).
- Na web Chromium, `FileSystemFileHandle` é armazenável no IndexedDB (recentes reabríveis).
- SQLite pode entrar depois se surgirem buscas complexas ou sync.
