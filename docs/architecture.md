# Arquitetura

## Regra fundamental

> PDF Atelier é **uma aplicação única com dois runtimes**: Web e Desktop.

Uma UI → uma lógica de negócio → adapters por plataforma. O Electron não é uma segunda aplicação; é um host que expõe capacidades nativas mínimas.

```text
                    PDF Atelier
                         │
          packages/app (UI única, React)
                         │
        core · pdf · tts · platform (contratos)
                         │
              ┌──────────┴──────────┐
              │                     │
          apps/web             apps/desktop
       adapter web           adapter electron
     (APIs do browser)   (window.pdfAtelier → IPC → main)
```

O build de `apps/web` é **o mesmo** nos dois runtimes. A única linha que sabe qual runtime está ativo é o bootstrap:

```ts
const platform = window.pdfAtelier
  ? createElectronPlatform(window.pdfAtelier)
  : createWebPlatform()
```

## Pacotes e regras de dependência

```text
apps/web ──► app ──► core
               ├───► pdf ──► core
               ├───► tts
               └───► platform (contratos)
apps/desktop ──► platform (ipc schema)      [main + preload, sem UI]
```

| Pacote | Responsabilidade | Pode depender de | Não pode |
|---|---|---|---|
| `core` | Modelo do documento, anotações, comandos, histórico, geometria | `immer` | DOM, React, PDF.js, Electron |
| `pdf` | Wrapper de PDF.js (render, texto, busca, links, import de anotações) e escritor com `@cantoo/pdf-lib` | `core` | Vazar tipos do PDF.js/pdf-lib |
| `platform` | Contratos (`FileSystemAdapter`, `ShellAdapter`, `Platform`), schema IPC (zod), adapters web e electron (renderer) | `zod` | Importar `electron`/`node:*` |
| `tts` | Providers de fala (Piper local via WASM, Web Speech), fragmentação em frases, gestão de modelos | `@mintplex-labs/piper-tts-web` | Conhecer a UI |
| `app` | **A única UI**: shell, abas, viewer, ferramentas, painéis, stores, atalhos, i18n | todos acima | Chamar APIs de Electron diretamente |
| `apps/web` | `index.html`, bootstrap, Vite, assets do PDF.js, deploy | `app`, `platform` | Componentes próprios |
| `apps/desktop` | Janela, protocolo `app://`, handlers IPC, preload, empacotamento | `platform` (schema) | UI |

ESLint bloqueia imports de `electron`, `node:*`, `fs` e `path` em `packages/**`.

Pacotes internos são consumidos como **fonte TS** (`exports` → `src/index.ts`); o Vite compila. Sem etapa de build por pacote.

## Modelo de documento (não destrutivo)

```text
Document = fontes (bytes originais, fora do estado)
         + páginas (fonte, índice na fonte, tamanho, rotação)
         + anotações (por pageId)
```

- Abrir: cria uma fonte e uma página por página da fonte; anotações existentes são importadas para o modelo.
- Editar: só altera o modelo (pequeno, serializável). Bytes nunca são reescritos durante a edição.
- Reordenar/excluir/rotacionar/mesclar: operações na lista de páginas. Anotações seguem a página pelo `id`.
- Salvar/Exportar: o pacote `pdf` **compõe** o PDF final a partir das fontes + páginas + anotações.

## Sistema de coordenadas

Pontos PDF (1/72 pol), origem no **canto superior esquerdo do crop box sem rotação**, y para baixo. A view aplica zoom, DPR e rotação; o escritor converte para o espaço do usuário PDF (origem inferior esquerda, offsets de CropBox).

## Histórico (undo/redo)

Cada alteração do documento é uma receita Immer aplicada com `produceWithPatches`. O histórico guarda `{ label, patches, inversePatches }`.

- Undo/redo = aplicar patches inversos/diretos.
- Transações agrupam várias mudanças (multisseleção).
- Coalescência por chave: um arrastar contínuo vira um passo.
- Vale igualmente para anotações e páginas, porque ambas vivem no mesmo modelo.

Um histórico por documento (aba).

## Estado

Stores Zustand pequenos e separados — UI, documentos/abas, editor (ferramenta ativa, seleção), configurações. O documento em si é o `DocumentModel` do `core` + seu histórico.

## Persistência

IndexedDB nos dois runtimes (um único código): configurações, recentes, estado por documento (chave = hash do arquivo). No Electron a origem fixa `app://` mantém os dados estáveis entre sessões. Na web Chromium, `FileSystemFileHandle` é guardado no IndexedDB para reabrir recentes.

## Segurança

PDFs são entrada não confiável.

**PDF.js**: scripting desativado; links externos aceitos só `http`, `https` e `mailto`, abertos via `shell.openExternal` do adapter (com confirmação); anexos não executam.

**Electron**:

```text
renderer (sandbox, contextIsolation, sem Node)
   │  window.pdfAtelier.invoke(channel, ...args)
preload (contextBridge: invoke p/ RENDERER_CHANNELS, refForDroppedFile, onMenuCommand)
   │  ipcRenderer.invoke
main ── valida sender (origem app://) + args com zod ── fs/dialog/shell
```

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Protocolo `app://` (privilegiado: standard, secure, fetch, CORS) em vez de `file://`.
- `will-navigate` bloqueado, `setWindowOpenHandler` nega tudo, permission handler nega por padrão.
- **Refs opacas de arquivo**: o renderer nunca envia caminhos escolhidos por ele. O main mapeia ref → caminho escolhido via diálogo/drop. Recentes ficam numa allowlist no main.
- CSP estrita (`'wasm-unsafe-eval'` só para WASM do PDF.js/Piper; `worker-src 'self' blob:`).
- Fuses: `RunAsNode` off, `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`, sem `NODE_OPTIONS`/inspect.

Detalhes em [ADR 0011](decisions/0011-seguranca-electron.md).

## Web vs Desktop

| Capacidade | Web Chromium | Web Firefox/Safari | Desktop |
|---|---|---|---|
| Salvar no próprio arquivo | sim (FS Access API) | não → download | sim |
| Reabrir recentes | sim (handle no IndexedDB) | só metadados | sim (allowlist) |
| TTS Piper | sim | sim | sim |
| Vozes do sistema | sim | sim | limitado (ver ADR 0008) |

O adapter expõe `capabilities`; a UI se adapta em vez de prometer o que o runtime não tem.
