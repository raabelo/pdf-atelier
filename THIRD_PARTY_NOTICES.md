# Avisos de terceiros

PDF Atelier é distribuído sob a **AGPL-3.0** (ver `LICENSE`). Ele inclui ou baixa os componentes abaixo, cada um sob sua própria licença.

## Bibliotecas incluídas no app

| Componente | Licença |
|---|---|
| PDF.js (`pdfjs-dist`) — Mozilla | Apache-2.0 |
| `@cantoo/pdf-lib` (fork de pdf-lib) | MIT |
| React, React DOM | MIT |
| Radix UI (`radix-ui`) | MIT |
| Zustand, Immer, Zod, `@tanstack/react-virtual` | MIT |
| `idb`, `lucide-react` | ISC |
| `class-variance-authority` | Apache-2.0 |
| `cn`, Tailwind CSS, `tw-animate-css` | MIT |
| ONNX Runtime Web (`onnxruntime-web`) — Microsoft | MIT |
| `@mintplex-labs/piper-tts-web` | MIT |
| Transformers.js (`@huggingface/transformers`) | Apache-2.0 |
| `@diffusionstudio/piper-wasm` — inclui **espeak-ng** | MIT (pacote) / **GPL-3.0** (espeak-ng) |
| Electron (somente desktop) — inclui Chromium e Node.js | MIT (+ licenças do Chromium em `LICENSES.chromium.html`) |

## Vozes Piper (baixadas sob demanda do Hugging Face)

| Voz | Idioma | Licença do dataset | Atribuição |
|---|---|---|---|
| `en_US-ljspeech-medium` | en-US | Domínio público | — |
| `pt_BR-faber-medium` | pt-BR | CC0 | — |
| `es_ES-davefx-medium` | es-ES | CC0 | — |
| `fr_FR-siwis-medium` | fr-FR | CC BY 4.0 | SIWIS French Speech Synthesis Database (Honnet, Lazaridis, Garner, Yamagishi), CC BY 4.0 |

## Modelos de tradução Opus-MT (baixados sob demanda do Hugging Face)

Modelos do Helsinki-NLP (OPUS-MT, Tiedemann & Thottingal), convertidos para ONNX por Xenova.

| Modelo | Licença |
|---|---|
| `Xenova/opus-mt-en-ROMANCE` | Apache-2.0 |
| `Xenova/opus-mt-ROMANCE-en` | Apache-2.0 |
| `Xenova/opus-mt-en-de` | CC BY 4.0 — Helsinki-NLP, OPUS-MT |
| `Xenova/opus-mt-de-en` | Apache-2.0 |

Os modelos Piper foram treinados com o projeto Piper (rhasspy/piper, MIT; continuação OHF-Voice/piper1-gpl, GPL-3.0).
