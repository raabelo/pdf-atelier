# 0003 — Licença copyleft

- **Status:** Aceita (licença exata GPL-3.0 vs AGPL-3.0 a confirmar)
- **Data:** 2026-10-02

## Contexto

A licença define quais engines/bibliotecas são utilizáveis (ex.: MuPDF é AGPL; espeak-ng, usado pelo fonemizador do Piper, é GPL-3.0).

## Alternativas

- MIT/permissiva — exclui MuPDF e componentes GPL (inclusive espeak-ng no Piper).
- Comercial/fechada — idem, salvo licenças pagas.
- **Copyleft (GPL/AGPL)**.

## Decisão

Open source copyleft.

## Consequências

- MuPDF.js (AGPL) passa a ser opção futura viável.
- Piper + espeak-ng (GPL-3.0) compatíveis.
- Vozes Piper têm licenças próprias por dataset; só usar as compatíveis (ver ADR 0008) e manter atribuições.
- Na AGPL, servir a versão web conta como distribuição: código-fonte deve estar disponível aos usuários.
- Criar arquivo `LICENSE` e `THIRD_PARTY_NOTICES` quando a licença exata for fixada.
