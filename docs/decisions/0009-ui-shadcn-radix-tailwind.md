# 0009 — UI: shadcn/ui (Radix) + Tailwind

- **Status:** Aceita
- **Data:** 2026-10-02

## Contexto

A UI deve parecer app profissional de desktop, acessível, com temas claro/escuro/sistema e utilizável em telas menores.

## Alternativas

- React Aria Components + CSS Modules — acessibilidade/teclado mais fortes.
- React Aria + Tailwind.
- **shadcn/ui (Radix) + Tailwind v4.**

## Decisão

shadcn/ui com base Radix (pacote unificado `radix-ui`) e Tailwind CSS v4 (`@tailwindcss/vite`, configuração em CSS). Componentes copiados para `packages/app/src/ui`. Tokens de tema em CSS variables (oklch); dark mode por classe (`@custom-variant dark`). `cn` do pacote `cn`; ícones `lucide-react`.

## Consequências

- Componentes são código nosso, editáveis.
- `@source` no CSS de `apps/web` precisa apontar para `packages/app/src` (Tailwind ignora `node_modules`).
- Padrões desktop (toolbar com roving focus, menus) exigem cuidado extra de acessibilidade.
- Strings da UI em catálogo pt-BR/en desde o MVP.
