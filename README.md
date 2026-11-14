# RootPDF — Seu Estúdio Local de PDF

**RootPDF** é uma aplicação web 100% client-side para **converter imagens em PDF**, **ler, organizar, assinar e editar PDFs existentes**, **preencher contratos com detecção automática de campos** e **criar documentos PDF do zero** diretamente no navegador.

Todo o processamento ocorre localmente na memória do seu dispositivo usando Web Workers — nenhum arquivo é enviado para servidores externos.

---

## Funcionalidades

### 1. Imagem → PDF
- **Importação flexível:** suporte a `JPG/JPEG`, `PNG`, `WEBP`, `GIF`, `BMP`, `SVG` e `AVIF`, seleção múltipla, arrastar e soltar (*Drag & Drop*), colagem rápida da área de transferência (`Ctrl+V`) e filtro automático de duplicatas.
- **Prévia fiel e inspeção:** visualização em tempo real proporcional à folha e margens configuradas, além de modal de zoom para inspecionar e girar páginas (`←` / `→`).
- **Organização:** reordenação por *Drag & Drop* ou setas `↑` / `↓`, duplicação, rotação individual ou em lote, inversão da ordem e ordenação automática (manual, nome, tamanho ou data).
- **Configuração de saída:** tamanhos **A4**, **A5**, **Carta**, **Ofício** ou **Original da Imagem**; orientação automática/retrato/paisagem; margem de `0 pt` a `60 pt`; enquadramento (*Conter*, *Preencher* ou *Esticar*); perfis de qualidade (*Alta*, *Balanceada* e *Compacta*); progresso e cancelamento a qualquer momento.

### 2. Leitor, Organizador & Editor de PDF
- **Leitura fluida (PDF.js):** renderização nítida em alta densidade de pixels (HiDPI), seleção de texto, busca no documento (`Ctrl+F` com contagem e navegação entre ocorrências), campo "Ir para página", zoom manual/automático, modo tela cheia e painel de miniaturas.
- **Organização e mesclagem:** abra um ou mais PDFs simultaneamente, reordene miniaturas, gire páginas em 90°, duplique ou exclua páginas, abra PDFs protegidos por senha e exporte o documento consolidado.
- **Assinaturas digitais visuais:** crie assinaturas desenhando à mão livre, enviando uma imagem ou gerando assinatura tipográfica; salve em biblioteca local no navegador para reutilizar quando precisar.
- **Edição em camadas & formulários:** adicione blocos de texto, imagens (`PNG`, `JPG`, `WEBP`, `SVG`, `AVIF`), marca-texto (*Destaque*) e tarjas de **Cobrir / Substituir**; preencha formulários AcroForm nativos com opção de achatamento ao exportar.
- **Preenchedor Inteligente de Contratos:** detecta sob demanda linhas pretas horizontais, lacunas (`_____`, `.....`) e caixas de seleção (`[  ]`, `(  )`, `☐`) na página atual ou em todas as páginas, herdando fonte e tamanho aproximados do texto ao redor e permitindo alternar entre escrever **Acima da linha** ou **Cobrir lacuna**.

### 3. Criar PDF do Zero
- **Compositor multi-página:** crie novas páginas configurando tamanho (A4, A5, Carta, Ofício), orientação (Retrato/Paisagem) e tom do papel.
- **Montagem visual:** insira blocos de texto formatado, imagens e assinaturas salvas, controle opacidade, inclinação, alinhamento, cores e ordem das páginas.
- **Rascunho automático local:** alterações e textos são preservados localmente no navegador, com botão rápido para abrir o PDF recém-gerado direto no **Leitor & Editor**.

---

## Como Funciona (Tutorial Rápido)

### Converter Imagens em PDF (`Imagem → PDF`)
1. Selecione, arraste ou cole (`Ctrl+V`) as imagens desejadas.
2. Reordene ou gire as páginas nos cartões e ajuste tamanho da folha, orientação, margens e qualidade no painel lateral.
3. Clique em **Gerar & Baixar PDF**.

### Ler, Organizar, Assinar ou Preencher Contratos (`Leitor & Editor`)
1. Clique na aba **Leitor & Editor** e carregue um ou mais arquivos `.pdf`.
2. Para **reorganizar páginas**, abra **Páginas & Organizar**, arraste ou gire as miniaturas e adicione outros PDFs se quiser mesclar.
3. Para **assinar ou anotar**, escolha **Assinar**, **Texto**, **Imagem**, **Cobrir / Substituir** ou **Destaque** na barra do editor e ajuste fonte, cor, opacidade ou inclinação na faixa contextual abaixo.
4. Para **preencher contratos com linhas ou lacunas**:
   - Clique em **Detectar campos** (página atual) ou **Todas as págs.**;
   - Pressione `Tab` / `Shift+Tab` para saltar entre as lacunas em ordem de leitura;
   - Em caixas `[  ]` / `☐`, clique uma vez ou pressione `Espaço` / `Enter` para alternar o **X**;
   - Use o seletor **Lacuna** no inspetor para escolher **Acima da linha** (mantém o traço original) ou **Cobrir lacuna**;
   - Campos deixados em branco aparecem apenas como guias na tela e não são gravados ao clicar em **Exportar PDF editado**.

### Montar um Documento Novo (`Criar PDF`)
1. Acesse a aba **Criar PDF** e escolha os botões **Adicionar texto**, **Inserir imagem** ou **Assinar**.
2. Dê duplo clique nos blocos de texto para editar o conteúdo e arraste as alças para mover, redimensionar ou inclinar.
3. Ajuste tamanho, orientação e cor do papel (no celular, toque no resumo de folha para expandir as opções) e clique em **Gerar & Baixar PDF**.

---

## Como Executar Localmente

### Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- Gerenciador de pacotes `npm` (incluso no Node.js)

### Passos
```bash
# 1. Clone o repositório
git clone https://github.com/kowalczykedu/RootPDF.git
cd RootPDF

# 2. Instale as dependências
npm install

# 3. Inicie o servidor de desenvolvimento
npm run dev
```

Acesse a URL exibida no terminal (normalmente `http://localhost:5173`).

Para gerar o build de produção em `dist/` e pré-visualizá-lo localmente:

```bash
npm run build
npm run preview
```

---

## Estrutura de Pastas

```text
RootPDF/
├── docs/                          # Documentação técnica (tokens, design system e arquitetura)
├── public/                        # Favicons estáticos (SVG e PNG)
├── specs/                         # Especificações funcionais das entregas do projeto
├── src/
│   ├── creator/
│   │   └── pdf-creator-studio.ts  # Estúdio "Criar PDF" do zero com rascunho local
│   ├── editor/
│   │   ├── acroform-extractor.ts      # Leitura de widgets AcroForm nativos via PDF.js
│   │   ├── contract-field-detector.ts # Detecção local de linhas, lacunas e checkboxes
│   │   ├── image-asset-helper.ts      # Normalização e conversão de imagens de overlay
│   │   ├── inspector-bar.ts           # Barra contextual de propriedades do item selecionado
│   │   ├── page-overlay-editor.ts     # Camada interativa, seleção, arraste, rotação e teclado
│   │   ├── signature-modal.ts         # Modal de desenho, upload e tipografia de assinaturas
│   │   └── signature-store.ts         # Persistência local de assinaturas salvas
│   ├── pdf/
│   │   ├── pdf-acroform-helper.ts     # Preenchimento e achatamento de formulários AcroForm
│   │   ├── pdf-builder.ts             # Montagem de PDF a partir de imagens
│   │   ├── pdf-client.ts              # Controlador do Web Worker de imagens
│   │   ├── pdf-creator-builder.ts     # Geração de PDF a partir de páginas criadas do zero
│   │   ├── pdf-merge-builder.ts       # Mesclagem de PDFs + renderização de camadas
│   │   ├── pdf-merge-client.ts        # Controlador do Web Worker de leitor/criador
│   │   ├── pdf-merge.worker.ts        # Worker de composição, mesclagem e edição
│   │   ├── pdf-overlay-renderer.ts    # Desenho fiel de textos, assinaturas, imagens e filtragem
│   │   └── pdf.worker.ts              # Worker com OffscreenCanvas para rasterização de imagens
│   ├── reader/
│   │   ├── pdf-reader-studio.ts   # Estúdio "Leitor & Organizador" com busca e ferramentas
│   │   ├── pdf-search.ts          # Indexação e busca textual no PDF (Ctrl+F)
│   │   └── pdfjs-loader.ts        # Carregamento dinâmico do PDF.js e proteção por senha
│   ├── utils/
│   │   ├── format.ts              # Formatação de bytes, sanitização e conversão de unidades
│   │   ├── icons.ts               # Ícones SVG inline
│   │   ├── image.ts               # Miniaturas assíncronas e leitura de metadados
│   │   └── layout.ts              # Geometria compartilhada entre prévia em tela e PDF final
│   ├── main.ts                    # Ponto de entrada, abas de modo e fluxo Imagem → PDF
│   ├── rootsAnimation.ts          # Animação procedural de raízes em Canvas 2D
│   ├── style.css                  # Estilos e tokens CSS do tema Rosé Pine
│   ├── types.ts                   # Tipos TypeScript e constantes compartilhadas
│   └── vite-env.d.ts
├── index.html                     # Entrada HTML e fonte Space Mono
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Tecnologias Utilizadas

- **[TypeScript](https://www.typescriptlang.org/)** (`strict: true`) — Tipagem estática e arquitetura modular.
- **[Vite](https://vitejs.dev/)** — Empacotamento rápido, HMR e suporte nativo a Web Workers.
- **[pdf-lib](https://pdf-lib.js.org/)** — Criação, mesclagem, preenchimento de formulários e escrita vetorial em PDFs.
- **[PDF.js (`pdfjs-dist`)](https://mozilla.github.io/pdf.js/)** — Renderização de PDFs no navegador, camada de texto selecionável e inspeção de formulários.
- **Web Workers & OffscreenCanvas** — Processamento gráfico e montagem de PDFs fora da thread principal da interface.
- **HTML5 Canvas 2D** — Análise visual de linhas horizontais de contrato, captura de assinaturas e rede procedural de fundo.
- **CSS Puro** — Layout responsivo com CSS Grid/Flexbox, custom properties em 3 camadas e acessibilidade WCAG 2.2 AA.

---

## Documentação Técnica Adicional

Os detalhes de tokens visuais, acessibilidade, workers, persistência e especificações de engenharia ficam separados nos arquivos abaixo:

- [Design System & Tokens Rosé Pine](./docs/design-system.md)
- [Arquitetura Técnica & Especificações](./docs/arquitetura-tecnica.md)
- [Especificações Funcionais (`specs/`)](./specs/)

---

## Licença

Distribuído sob a licença MIT.
