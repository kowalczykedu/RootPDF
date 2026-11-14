# 05 — Animação Botânica Orgânica de Raízes (Crescimento em Ondas e Pulso GPU)

- **Status:** Em andamento (build ok; pendente validação manual no navegador)
- **Branch sugerida:** `feat/contract-filler` (ou nova branch `feat/organic-roots` após merge)

## Objetivo

Refinar o motor procedural de fundo ([src/rootsAnimation.ts](../src/rootsAnimation.ts)) para entregar raízes botânicas com traçado contínuo livre de junções aparentes, pontas extremamente finas em agulha, nascimento aleatório em qualquer um dos 4 cantos da tela a cada carregamento, crescimento cinematográfico em ondas (~4,0s) e assentamento em baixa opacidade com pulso vivo contínuo no compositor GPU a custo próximo de zero de CPU.

## Definições Alinhadas (Questionário)

- **Estilo visual:** botânico orgânico refinado — troncos contínuos sem "bolinhas"/junções de sobreposição, curvas S orgânicas e radículas ultrafinas seguindo a paleta Rosé Pine (`#ebbcba` → `#c4a7e7` → `#9ccfd8` → `#31748f`).
- **Pontas em agulha:** todos os ramos (e a própria extremidade viva durante o crescimento) devem afinar progressivamente até raio `0px` em vértice pontiagudo, eliminando qualquer terminação quadrada ou truncada.
- **Origem aleatória rente aos 4 cantos:** a cada abertura, sorteia um dos 4 cantos (`top-left`, `top-right`, `bottom-left`, `bottom-right`) ancorando diretamente no vértice da borda (sem espaço solto atrás do tronco) e expande em leque amplo para os lados e meio da tela, preservando o canto sorteado durante redimensionamentos da mesma sessão.
- **Ritmo de crescimento (~4,0s em ondas):**
  1. Troncos principais emergem em leque amplo e avançam primeiro pelo campo visual.
  2. Bifurcações precoces e amplas do início para o meio + pontes de anastomose proximal se abrem lateralmente pelos dois lados da tela.
  3. Capilares e radículas terminais desabrocham nas ondas finais até as extremidades em agulha.
- **Estado assentado com pulsação única de baixo custo:** após os 4,0s, o loop `requestAnimationFrame` é encerrado (**0% de CPU JS contínua**). Todas as raízes no `#rootsCanvas` recebem uma pulsação única e unificada de `opacity` (`@keyframes rootsBreath`) diretamente no compositor GPU.

## Requisitos

- [x] Tornar o gerador de rede agnóstico ao canto sorteado (`top-left`, `top-right`, `bottom-left`, `bottom-right`), ancorando rente ao vértice da tela (sem folga/corte traseiro nos cantos inferiores) e ignorando microvariações de altura da barra de endereço mobile em `resize`.
- [x] Substituir os segmentos individuais desconectados por cadeias contínuas de nós (`RootBranch[]`) renderizadas em polígono Bézier fechado único com gradiente linear e opacidade interna `1.0`, eliminando marcas circulares e acúmulo duplo de alpha nas juntas.
- [x] Ampliar o leque inicial e antecipar bifurcações laterais do início para o meio da tela, preenchendo os flancos com corpo orgânico em vez de concentrar tudo em um feixe diagonal estreito.
- [x] Garantir afinamento terminal contínuo até vértice `r = 0` (*needle taper*) tanto nos ramos finalizados quanto na ponta em crescimento ativo a cada quadro.
- [x] Implementar escalonamento cinematográfico em ondas ao longo de `4000ms` com *baking* incremental em buffer auxiliar para manter 60fps durante o crescimento e encerrar o `requestAnimationFrame` ao terminar.
- [x] Aplicar pulsação única unificada em todas as raízes via CSS `@keyframes rootsBreath` na camada `#rootsCanvas`, mantendo baixa opacidade legível e impacto mínimo de desempenho.
- [x] Respeitar estritamente `@media (prefers-reduced-motion: reduce)` exibindo a rede estática sem pulso ou crescimento animado, e atualizar [docs/design-system.md](../docs/design-system.md) ao concluir.

## Fora de Escopo

- Controles interativos na UI para pausar, mudar cores ou escolher manualmente o canto das raízes.
- Redesenho contínuo frame a frame via JavaScript após o término dos 4,0s de crescimento.

## Arquivos Prováveis

- `src/rootsAnimation.ts` — novo motor de cadeias contínuas sem emendas, pontas em agulha, ancoragem rente aos 4 cantos, leque amplo lateral e ondas em 4,0s.
- `src/style.css` — classe `.roots-canvas`, `@keyframes rootsBreath` único em GPU em baixa opacidade e fallback `prefers-reduced-motion`.
- `docs/design-system.md` — atualização da seção do motor procedural refletindo os 4 cantos rente à borda, ramificação ampla, 4,0s em ondas e pulsação única em GPU.

## Critérios de Aceite

- [x] `npm run build` (`tsc -b && vite build`) passa sem erros.
- [ ] Recarregar a página repetidamente sorteia os 4 cantos diferentes da tela com crescimento suave em ondas de ~4,0s.
- [ ] Inspeção visual confirma ausência de "bolinhas"/emendas entre segmentos e todas as pontas afinando até extremidades em agulha (desktop e mobile).
- [ ] Após 4,0s, o uso contínuo de JS no fundo cai para 0% enquanto as raízes pulsam suavemente em baixa opacidade sem prejudicar rolagem ou contraste dos painéis.
- [ ] Com `prefers-reduced-motion: reduce` ativo, o fundo renderiza estático sem animações.
