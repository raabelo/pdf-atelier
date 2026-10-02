# 0003 — Licença copyleft

- **Status:** Aceita — **AGPL-3.0-only** (confirmada em 2026-10-02)
- **Data:** 2026-10-02

## Contexto

A licença define quais engines/bibliotecas são utilizáveis (ex.: MuPDF é AGPL; espeak-ng, usado pelo fonemizador do Piper, é GPL-3.0).

## Alternativas

- MIT/permissiva — exclui MuPDF e componentes GPL (inclusive espeak-ng no Piper).
- Comercial/fechada — idem, salvo licenças pagas.
- **Copyleft (GPL/AGPL)**.

## Decisão

Open source copyleft: **AGPL-3.0-only**. Escolhida sobre GPL-3.0 porque o app também roda como serviço web: quem hospedar uma versão modificada precisa oferecer o código-fonte aos usuários.

## Consequências

- MuPDF.js (AGPL) passa a ser opção futura viável.
- Piper + espeak-ng (GPL-3.0) compatíveis.
- Vozes Piper têm licenças próprias por dataset; só usar as compatíveis (ver ADR 0008) e manter atribuições.
- Na AGPL, servir a versão web conta como distribuição: código-fonte deve estar disponível aos usuários.
- `LICENSE` (texto oficial AGPL-3.0) e `THIRD_PARTY_NOTICES.md` na raiz; o instalador mostra a licença e o diálogo Sobre aponta para o código-fonte (URL do repositório a definir).
