# Design System & Tokens Visuais

Documentação técnica da identidade visual do **RootPDF**, implementada em [src/style.css](../src/style.css) com variáveis CSS nativas em arquitetura de 3 camadas e zero frameworks de estilo.

---

## 1. Arquitetura de Tokens (3 Camadas)

### Camada 1 — Primitivos Tipográficos, Raios e Movimento

Definidos em `:root`:

- **Tipografia:** `--font-sans` e `--font-mono` configuradas com `"Space Mono"` e fallbacks monoespaçados (`ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `"Liberation Mono", monospace`).
- **Escala de bordas:** `--radius-xs` (`6px`), `--radius-sm` (`9px`), `--radius-md` (`12px`), `--radius-lg` (`16px`), `--radius-xl` (`20px`), `--radius-pill` (`999px`).
- **Curva e tempo de transição:** `--ease-out` (`cubic-bezier(0.22, 1, 0.36, 1)`) e `--duration-fast` (`140ms`).

### Camada 2 — Tokens Semânticos (Rosé Pine)

| Papel | Token(s) | Valor |
| :--- | :--- | :--- |
| **Fundo base & palco** | `--bg` / `--bg-deep` | `#191724` / `#12101b` |
| **Superfícies & hover** | `--panel`, `--panel-strong`, `--panel-hover`, `--input-bg` | `#1f1d2e`, `#26233a`, `#332e4d`, `#161420` |
| **Texto** | `--text-strong`, `--text`, `--muted`, `--faint` | `#ffffff`, `#e0def4`, `#908caa`, `#6e6a86` |
| **Acentos principais** | `--purple` (Rose), `--purple-2` (Iris), `--foam` (Foam) | `#ebbcba`, `#c4a7e7`, `#9ccfd8` |
| **Sucesso / Detecção** | `--success`, `--success-soft`, `--success-border` | `#31748f` (Pine) e variações RGBA |
| **Perigo / Remoção** | `--danger`, `--danger-soft`, `--danger-border` | `#eb6f92` (Love) e variações RGBA |
| **Guias de contrato** | `--contract-guide-ink`, `--contract-guide-border`, `--contract-guide-bg`, `--contract-guide-bg-hover` | `#286983` (Pine Deep) e guias Foam/Pine sobre papel claro |
| **Bordas & foco** | `--border-soft`, `--border`, `--border-strong`, `--border-focus` | Variações RGBA e `#ebbcba` |

### Camada 3 — Componentes & Breakpoints Responsivos

- **Breakpoints principais:**
  - `≤ 1040px`: colapsa as grades de duas colunas (`Imagem → PDF`, `Leitor & Organizador`, `Criar PDF`) para coluna única e posiciona a prancheta do Criador (`.creator-stage-panel`) acima da lista de páginas.
  - `≤ 720px`: converte `.detect-fields-group` (`Detectar campos` / `Todas as págs.`) em grade simétrica de 2 colunas com `min-height: 44px`.
  - `≤ 680px`: reorganiza `.reader-toolbar`, `.reader-editor-toolbar`, `.creator-toolbar` (com seção recolhível `.creator-page-settings` via `.creator-settings-toggle`), `.reader-inspector-host` e `.studio-tabs` para uso ergonômico em toque.
  - `≤ 460px` / `≤ 380px`: compacta `.studio-tabs` com ícone acima do rótulo (`min-height: 48px`) e adapta `.reader-doc-bar` e `.reader-tool-actions` sem overflow horizontal.
  - `pointer: coarse`: amplia alvos das alças/mini-barra flutuante de overlays (`.overlay-mini-btn` em `44×44px`).

---

## 2. Motor Procedural de Raízes Botânicas (`src/rootsAnimation.ts`)

- Renderizado em Canvas 2D único (`#rootsCanvas`), sorteando aleatoriamente um dos **4 cantos da tela** a cada carregamento e ancorado diretamente no vértice do canto escolhido (`(-2, -2)` / extremos da viewport), expandindo em leque amplo para os dois flancos e para o meio da tela.
- Modela cadeias contínuas (`RootBranch[]`) em polígonos Bézier fechados sem emendas ou acúmulo duplo de transparência nas juntas, com ramificação intensa do início ao meio e extremidades em formato de **agulha (`r → 0`)** na paleta Rosé Pine (`#ebbcba` → `#c4a7e7` → `#9ccfd8` → `#31748f`).
- Cresce em ondas cinematográficas ao longo de `~4.0s` (troncos principais → bifurcações amplas e pontes de anastomose → radículas capilares), encerrando completamente o loop `requestAnimationFrame` ao concluir (**0% de uso contínuo de CPU JS**) e mantendo uma pulsação única unificada em baixa opacidade diretamente via `@keyframes rootsBreath` na GPU.
- Respeita automaticamente `@media (prefers-reduced-motion: reduce)` exibindo a composição estática sem crescimento animado nem pulso.

---

## 3. Acessibilidade (WCAG 2.2 AA)

- Anéis de foco consistentes via `:focus-visible` (`--border-focus`), além de `:focus-within` em wrappers de upload e jump de página.
- Alvos táteis mínimos de `44×44px` em botões, seletores e controles de overlay em telas menores ou `pointer: coarse`.
- Ícones exclusivamente em SVG ([src/utils/icons.ts](../src/utils/icons.ts)), sem emojis em botões.
- Regiões dinâmicas com `role="status"` / `aria-live="polite"`, sinalização de carregamento (`aria-busy` nos botões de detecção), atributos `aria-expanded` / `aria-controls` em painéis recolhíveis e papéis `role="checkbox"` + `aria-checked` em caixas de contrato, com proteção de eventos IME (`isComposing` e `keyCode === 229`).
