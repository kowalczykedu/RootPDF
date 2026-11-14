# Arquitetura Técnica & Especificações

Visão técnica dos módulos internos, processamento assíncrono, persistência local e especificações funcionais do **RootPDF**.

---

## 1. Processamento 100% Local e Web Workers

Nenhuma imagem, texto ou PDF sai da memória do navegador (`File`, `ArrayBuffer`, `Blob` e objetos Canvas/OffscreenCanvas).

- **Conversão Imagem → PDF:**
  - Controlada por `PdfGenerationController` ([src/pdf/pdf-client.ts](../src/pdf/pdf-client.ts)), com worker dedicado em [src/pdf/pdf.worker.ts](../src/pdf/pdf.worker.ts).
  - Usa `OffscreenCanvas` + `createImageBitmap` no worker para reamostragem em perfis de qualidade sem bloquear a thread principal, e montagem final via [src/pdf/pdf-builder.ts](../src/pdf/pdf-builder.ts) com `pdf-lib`.
  - Inclui fallback automático para a thread principal caso `OffscreenCanvas` não esteja disponível no ambiente.
- **Leitura, Edição, Mesclagem e Criação:**
  - O motor **PDF.js** (`pdfjs-dist`) é carregado sob demanda via `import()` dinâmico ([src/reader/pdfjs-loader.ts](../src/reader/pdfjs-loader.ts)), isolando o bundle inicial da aba **Imagem → PDF**.
  - A consolidação do PDF final (mesclagem de páginas, rotações, overlays, preenchimento/achatamento AcroForm e criação do zero) roda no worker [src/pdf/pdf-merge.worker.ts](../src/pdf/pdf-merge.worker.ts), gerenciado por [src/pdf/pdf-merge-client.ts](../src/pdf/pdf-merge-client.ts) com suporte a progresso página a página e cancelamento.

---

## 2. Fidelidade Geométrica (Prévia ↔ PDF)

Centralizada em [src/utils/layout.ts](../src/utils/layout.ts) e aplicada por [src/pdf/pdf-overlay-renderer.ts](../src/pdf/pdf-overlay-renderer.ts):

- Todos os overlays de texto, imagem, assinatura, tarja (`redact`) e destaque (`highlight`) são armazenados em coordenadas normalizadas `[0..1]` relativas à orientação atual da página.
- Rotações intrínsecas do PDF + rotações aplicadas pelo usuário na organização (`0°`, `90°`, `180°`, `270°`) transformam tanto os retângulos dos overlays quanto as regiões `aboveLineRect` e `coverRect` dos campos de contrato via `transformOverlayOnPageRotate`.
- A geração aplica `cropBox`, rotação combinada e `clipping paths` quando aplicável, além de adaptar caracteres fora do conjunto WinAnsi quando necessário (`sanitizeWinAnsiText`) com aviso contextual no editor/inspetor.

---

## 3. Módulos de Edição & Preenchedor Inteligente de Contratos

- **Camada de overlays e AcroForm:** [src/editor/page-overlay-editor.ts](../src/editor/page-overlay-editor.ts) e [src/editor/acroform-extractor.ts](../src/editor/acroform-extractor.ts).
- **Inspetor contextual:** [src/editor/inspector-bar.ts](../src/editor/inspector-bar.ts) — adapta controles por tipo selecionado (texto, imagem, assinatura, destaque, tarja ou campo de contrato/checkbox), além de ações de desfazer, descartar campos vazios e limpar página.
- **Assinaturas:** [src/editor/signature-modal.ts](../src/editor/signature-modal.ts) e [src/editor/signature-store.ts](../src/editor/signature-store.ts) (desenho livre, upload com remoção de fundo opcional e assinatura tipográfica).
- **Detecção de campos de contrato ([src/editor/contract-field-detector.ts](../src/editor/contract-field-detector.ts)):**
  - Extrai corridas de texto via `page.getTextContent()` para localizar sublinhados/pontilhados (`_____`, `.....`) e checkboxes textuais (`[  ]`, `(  )`, `☐`, `□`).
  - Executa varredura horizontal no canvas renderizado (ou canvas temporário por página em lotes multi-página) para detectar linhas horizontais escuras com espaço livre acima e amostrar a cor do papel (`sampledBgColor`).
  - Infere família tipográfica compatível (`helvetica`, `times` ou `courier`), tamanho aproximado e dica de rótulo (`labelHint`) a partir de texto vizinho na mesma linha.
  - Deduplica contra overlays existentes e widgets AcroForm, ordena em ordem de leitura (topo → base, esquerda → direita) e permite alternar por campo entre `"Acima da linha"` (`aboveLineRect`) e `"Cobrir lacuna"` (`coverRect`).
  - Na exportação, `isOverlayExportable` ([src/pdf/pdf-overlay-renderer.ts](../src/pdf/pdf-overlay-renderer.ts)) ignora automaticamente campos de contrato que permaneceram vazios ou desmarcados.

---

## 4. Armazenamento Local no Navegador

| Escopo | Chave | Finalidade |
| :--- | :--- | :--- |
| `localStorage` | `rootpdf-settings` *(fallback legado: `pixelpdf-settings`)* | Preferências do conversor **Imagem → PDF** |
| `localStorage` | `rootpdf-active-mode` | Última aba ativa selecionada |
| `localStorage` | `rootpdf-signatures` | Biblioteca local de assinaturas salvas |
| `localStorage` | `rootpdf-creator-draft-v1` | Rascunho automático do modo **Criar PDF** |
| `sessionStorage` | `rootpdf-reader-session-v1` | Último zoom e página visualizada no **Leitor** |

---

## 5. Especificações de Desenvolvimento (`specs/`)

O planejamento e os critérios de aceite de cada etapa do projeto estão registrados em [specs/](../specs/):

1. [01 — Rebranding para RootPDF](../specs/01-rebranding.md)
2. [02 — Leitor e Organizador de PDF no Navegador](../specs/02-leitor-pdf.md)
3. [03 — Assinatura, Edição em Camadas e Criação de PDF](../specs/03-editor-assinatura-pdf.md)
4. [04 — Preenchedor Inteligente de Contratos](../specs/04-preenchimento-contratos.md)
