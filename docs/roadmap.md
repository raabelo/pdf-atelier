# Roadmap

## MVP — ✅ concluído (2026-10-02)

**Fundação**
- Monorepo; web e desktop (Windows) rodando o mesmo build.
- Adapters de arquivos e shell; Electron seguro.
- Deploy web na Vercel.

**Arquivos**
- Abrir (diálogo, drag-and-drop), Salvar, Salvar como (no próprio arquivo no desktop/Chromium; download no fallback).
- Documentos recentes; aviso de alterações não salvas.
- **Abas** (vários documentos).

**Viewer**
- Páginas virtualizadas, render incremental (worker).
- Zoom, ajustar largura, ajustar página, rotação de visualização.
- Miniaturas, navegação, campo de página.
- Seleção e cópia de texto; busca simples com destaque; links internos/externos seguros.

**Anotações**
- Marca-texto, sublinhado, riscado.
- Caixa de texto (texto novo).
- Desenho livre; linha, seta, retângulo, elipse.
- Selecionar, mover, redimensionar, excluir; cor, espessura, opacidade, preenchimento.
- Painel lateral de anotações.
- Salvar como anotações PDF padrão (/AP + `/PDFAtelier`); importar anotações existentes.

**Páginas**
- Rotacionar, excluir, reordenar (arrastar miniaturas).

**Histórico**
- Undo/redo de anotações e páginas.

**TTS**
- Ler seleção; play, pause, resume, stop; velocidade; voz; idioma.
- "Ler texto selecionado automaticamente".
- Destaque da frase em leitura.
- Piper local (en-US, pt-BR, es-ES, fr-FR) baixado sob demanda, com gestão/remoção de modelos; Web Speech para os demais idiomas.

**Interface**
- Toolbar, sidebar, área do documento, barra de status.
- Tema claro/escuro/sistema; registro central de atalhos.
- UI em pt-BR e en (catálogo centralizado).

## V1 — ✅ concluído (2026-10-02), exceto i18n lib

- Comentários e respostas; notas.
- Bookmarks de páginas.
- Inserir, duplicar, extrair páginas; mesclar e dividir PDFs.
- Imagens, carimbos, assinatura (desenhada/imagem).
- Seleção múltipla, duplicar objetos, copiar/colar estilo.
- Impressão; exportar páginas como imagem.
- Busca avançada (regex, maiúsculas, palavra inteira).
- TTS: leitura contínua, detecção automática de idioma.
- PWA / offline.
- ~~Biblioteca de i18n completa~~ — adiada: o catálogo `t()` PT-BR/EN cobre a necessidade atual; adotar lib quando houver plural/formatação complexa ou mais idiomas.

## V1.5

- Polígonos, régua/medição.
- Números de página, cabeçalho e rodapé.
- Carimbos personalizados; agrupamento e rotação de objetos.
- Criação de links.
- Modo apresentação; modo foco.
- Importar/exportar anotações (XFDF/JSON).
- Instalador com auto-update.

## V2

- OCR (tesseract.js em worker).
- Proteção por senha (criptografar/remover).
- Compressão.
- Substituição de texto (cobrir + sobrepor); redação real.
- Preenchimento de formulários (AcroForm).
- Mais vozes/idiomas neurais.

## Future

- Sincronização e nuvem; colaboração.
- Plugins.
- Assinatura digital PKI; PDF/A.
- Recursos com IA.
- macOS/Linux (exige assinatura/notarização no macOS).
