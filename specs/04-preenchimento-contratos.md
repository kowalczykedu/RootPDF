# 04 — Preenchedor Inteligente de Contratos (Detecção de Linhas e Lacunas)

- **Status:** Em andamento (build ok; pendente validação manual no navegador)
- **Branch sugerida:** `feat/contract-filler` (alvo: `develop`)
- **Depende de:** `specs/02-leitor-pdf.md`, `specs/03-editor-assinatura-pdf.md`

## Objetivo

Permitir que o usuário preencha PDFs de contratos (que não possuem formulários AcroForm nativos) mantendo o layout original 100% intacto. Sob demanda, o RootPDF detectará automaticamente linhas pretas horizontais, sequências de sublinhado/pontilhado (`_____`, `.....`) e caixas de marcação (`[  ]`, `(  )`, `☐`), transformando-os em campos interativos navegáveis por `Tab` / `Shift+Tab` e gravando no PDF final apenas o que for efetivamente preenchido.

## Definições Alinhadas

- **Ativação sob demanda:** botão/ferramenta **"Detectar campos"** na barra do Editor dentro do modo `Leitor & Organizador`, executando por padrão na **página atual** (instantâneo) com opção de aplicar em **todas as páginas** do PDF.
- **Padrões reconhecidos pelo detector:**
  1. **Linhas horizontais desenhadas:** traços vetoriais ou retângulos finos escuros com espaço livre logo acima (típicos de contratos exportados do Word/Docs).
  2. **Lacunas em texto:** sequências contínuas de sublinhados (`_____`) ou pontilhados (`.....`).
  3. **Caixas de marcação em texto:** padrões como `[  ]`, `(  )` e `☐`.
- **Comportamento visual & exportação:**
  - **Inteligente por padrão:** posiciona o texto alinhado logo acima da linha preta (preservando a pauta/linha original visível), oferecendo no inspetor do campo a opção de **cobrir/substituir** o trecho base (com cor de fundo amostrada/configurável) quando o usuário preferir esconder os `_____` ou `.....`.
  - **Herança tipográfica:** cada campo detectado herda automaticamente o tamanho aproximado e a família tipográfica compatível (`Sans`, `Serif` ou `Mono`) do texto vizinho na mesma linha.
  - **Caixas de marcação (`[  ]`, `(  )`, `☐`):** funcionam como _checkbox_ rápido — clicar ou pressionar `Espaço` alterna a marcação `"X"` centralizada na caixa.
  - **Campos em branco ignorados na exportação:** campos detectados que permanecerem vazios (ou desmarcados) aparecem apenas como guias suaves na tela e **não** são gravados no PDF exportado, evitando que falsos positivos sujem o documento.

## Requisitos

- [x] Todo o processo de detecção, edição e exportação deve ocorrer 100% localmente na memória do navegador (sem chamadas externas).
- [x] Adicionar controle **"Detectar campos"** (página atual + opção para todas as páginas) na barra de ferramentas do Editor em `src/reader/pdf-reader-studio.ts`.
- [x] Implementar detector local (`src/editor/contract-field-detector.ts`) combinando leitura de `TextContent` (`_____`, `.....`, `[  ]`, `(  )`, `☐` e métricas do texto vizinho) e detecção de linhas horizontais na página renderizada.
- [x] Suportar navegação direta por teclado (`Tab` / `Shift+Tab`) entre os campos da página em ordem de leitura (topo → base, esquerda → direita), entrando automaticamente em edição rápida.
- [x] Permitir alternar com 1 clique ou tecla `Espaço` o `"X"` em caixas de marcação detectadas (`[  ]`, `(  )`, `☐`).
- [x] Permitir mover, redimensionar ou excluir (`Del`) qualquer campo detectado, além de alternar no inspetor entre **"Acima da linha"** e **"Cobrir lacuna"**.
- [x] Na exportação (`src/pdf/pdf-overlay-renderer.ts`), ignorar qualquer campo cujo texto esteja vazio (e sem cobertura manual forçada), preservando o PDF original intacto nas áreas não preenchidas.
- [x] Seguir o design system Rosé Pine, Space Mono, ícones SVG, acessibilidade WCAG 2.2 AA e passar pela revisão de `.agents/rules/frontend-review.md`.

## Fora de Escopo

- Conversão do PDF inteiro para editor de fluxo contínuo estilo Google Docs (_reflow_ automático de parágrafos e cláusulas).
- OCR em contratos escaneados como imagem pura sem camada de texto (exceto a detecção visual das linhas horizontais no canvas).

## Arquivos Prováveis

- `src/types.ts` — propriedades adicionais para overlays/campos detectados (modo de cobertura, tipo checkbox/lacuna).
- `src/editor/contract-field-detector.ts` _(novo)_ — heurísticas de detecção de linhas horizontais, sequências `_____`/`.....`, caixas `[  ]`/`(  )`/`☐` e inferência de fonte/tamanho vizinho.
- `src/editor/page-overlay-editor.ts` — navegação `Tab` / `Shift+Tab`, toggle rápido de `"X"` com clique/`Espaço` e estado visual discreto para campos detectados ainda vazios.
- `src/editor/inspector-bar.ts` — opção de alternar entre escrever acima da linha vs. cobrir/substituir a lacuna base.
- `src/reader/pdf-reader-studio.ts` & `src/style.css` — botão/menu `"Detectar campos"` (página atual / todas as páginas), feedback em toast e estilos Rosé Pine.
- `src/pdf/pdf-overlay-renderer.ts` — filtragem de campos vazios durante a geração do PDF final.

## Critérios de Aceite

- [x] `npm run build` (`tsc -b && vite build`) passa sem erros.
- [ ] Clicar em **"Detectar campos"** em um PDF de contrato identifica linhas horizontais, `_____`, `.....` e caixas `[  ]` / `(  )` / `☐`, herdando tamanho de fonte coerente com o texto ao redor.
- [ ] O usuário consegue preencher os campos em sequência usando `Tab` / `Shift+Tab`, marcar `"X"` nas caixas com clique ou `Espaço` e apagar falsos positivos com `Del`.
- [ ] Campos detectados que ficarem em branco não alteram nada no PDF exportado.
- [ ] Comportamento validado manualmente no navegador (`npm run dev`) em desktop e mobile.
