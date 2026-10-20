# Daggerfall VR — Standalone WebXR Edition

> **The Elder Scrolls II: Daggerfall** running natively in Standalone VR for Meta Quest 2, Quest 3, and Quest Pro via WebXR, built on top of the open-source DFO WebGL2 engine.

[![WebXR](https://img.shields.io/badge/WebXR-Meta%20Quest%203%20Native-blue.svg)](https://immersiveweb.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Repository](https://img.shields.io/badge/GitHub-felipevc13%2Fdaggerfall--vr-success.svg)](https://github.com/felipevc13/daggerfall-vr)

---

## 🧭 Visão Geral do Projeto (Overview for Developers & Agents)

Este repositório adiciona suporte completo a **Realidade Virtual Standalone (6DOF)** para o Daggerfall, permitindo que o jogador entre nas masmorras clássicas de Tamriel (começando pela icônica *Privateer's Hold*) diretamente pelo navegador **Meta Quest Browser** sem a necessidade de PCVR ou cabos.

### Destaques da Implementação VR:
- **Óptica Estereoscópica Calibrada (Zero Estrabismo)**: Projeção de paridade esquerda/direita ajustada especificamente para as lentes Pancake do Quest 3 (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, `proj[0] = -proj[0]`).
- **Combate Físico 6DOF**: Espada longa de ferro na mão direita e tocha iluminando a masmorra na mão esquerda com detecção de velocidade e impacto.
- **Inimigos Clássicos Autênticos**: Esqueleto Guerreiro (*TEXTURE.270*) em billboarding dinâmico com recorte alpha de 1-bit e física de recuo ao ser golpeado.
- **Locomoção Suave com Colisão**: Movimento no analógico esquerdo com deslizamento em cápsula física contra paredes e arquitetura da masmorra (`ctx.collider.move`).
- **Menus & UIs Holográficas Diegéticas**: Telas do jogo (Inventário, Paperdoll, Ficha e o Mapa de Tamriel / Chargen) abertas em painéis 3D no espaço do mundo com ponteiro laser 6DOF e feedback tátil (haptics).
- **Telemetria Remota em Tempo Real**: Streaming contínuo de logs e erros do headset Quest 3 para o servidor de desenvolvimento via `/api/vr-log`.

---

## 🚀 Como Rodar e Testar em VR (Quickstart & Testing Guide)

### 1. Iniciar o Servidor de Desenvolvimento
No terminal do computador, execute:
```bash
npm run dev
```
O Vite iniciará o servidor em `http://0.0.0.0:5173`.

### 2. Acessar no Meta Quest (Quest 2 / Quest 3 / Quest Pro)

#### Método A: Cabo USB (Recomendado para Desenvolvimento)
Conecte o Quest via USB com depuração USB ativa e rode no terminal:
```bash
adb reverse tcp:5173 tcp:5173
```
No navegador do Quest (Meta Quest Browser), abra:
```
http://localhost:5173/vr-dungeon.html
```

#### Método B: Rede Wi-Fi Local (Sem Fio)
Descubra o IP local do seu computador (ex: `192.168.0.30`) e abra no navegador do Quest:
```
http://192.168.0.30:5173/vr-dungeon.html
```

### 3. Entrar na Masmorra
Clique no botão verde **"ENTER VR"** no centro da tela.
- **Analógico Esquerdo**: Andar e deslizar lateralmente (strafe).
- **Analógico Direito**: Girar a visão (Snap Turn em 45°).
- **Mão Direita**: Empunhar e golpear com a espada.
- **Mão Esquerda**: Iluminar os corredores com a tocha.
- **Botão [Y] / Menu**: Abrir e fechar o Menu Holográfico / Mapa de Tamriel.
- **Gatilho Direito (Trigger)**: Clicar com o ponteiro laser nas opções do menu.

---

## 🏛️ Arquitetura Modular & Guia de Arquivos (Codebase Map)

> **Regra Fundamental de Modularidade**: Todo o código de Realidade Virtual é estritamente isolado no diretório `src/vr/` e na página `vr-dungeon.html`. Nenhuma classe base do jogo original (`PlayerMotor`, `Renderer`, `DungeonContext`, etc.) foi hackeada ou modificada. Isso garante que atualizações do repositório original (`Lattymoy/daggerfall-js-source`) possam ser sincronizadas via `git merge origin/main` sem conflitos.

### Mapa de Arquivos VR (`src/vr/`):

| Arquivo | Descrição & Responsabilidade |
|---|---|
| [`vr-dungeon.html`](vr-dungeon.html) | Ponto de entrada HTML do WebXR. Configura o canvas WebGL2, meta tags de viewport e inicializa a masmorra. |
| [`src/vr/vrDungeon.js`](src/vr/vrDungeon.js) | **Masmorra Principal (Privateer's Hold)**. Carrega blocos 3D originais, geometria, luzes, conecta o framebuffer do WebXR layer ao `Renderer` (bypassa FBOs desktop) e orquestra o loop de renderização estéreo. |
| [`src/vr/xrCamera.js`](src/vr/xrCamera.js) | **Câmera Estereoscópica Calibrada**. Extrai matrizes de pose dos olhos do WebXR, converte o sistema de coordenadas de mão direita (+X, +Y, -Z) para a convenção do jogo (+X, +Y, +Z) e aplica a correção óptica **Preset 5** (`VR_EYE_X = 1`, `IPD_SCALE = 0.75`, espelho apenas em `out[0]`). |
| [`src/vr/xrInput.js`](src/vr/xrInput.js) | **Entrada dos Controles do Quest**. Lê analógicos, botões (A, B, X, Y, Grips, Triggers), calcula locomoção suave com colisão de cápsula contra a masmorra (`ctx.collider.move`) e envia pulsos hápticos (`pulseHaptic`). |
| [`src/vr/xrWeapons.js`](src/vr/xrWeapons.js) | **Armas 6DOF**. Controla a espada longa na mão direita e a tocha na esquerda. Rastreia vetor de velocidade da ponta da lâmina (`tipSpeed`) e calcula interseção de caixa de colisão com alvos. |
| [`src/vr/xrSkeleton.js`](src/vr/xrSkeleton.js) | **Esqueleto Guerreiro (TEXTURE.270)**. Inimigo autêntico com billboarding vertical em direção ao jogador, recorte de transparência 1-bit, cálculo de HP e física de recuo ao ser golpeado. |
| [`src/vr/xrMenu.js`](src/vr/xrMenu.js) | **Menu Diegético Holográfico**. Renderiza Inventário (Paperdoll), Ficha de Atributos, Opções e o Mapa de Tamriel (Chargen inicial). Possui cálculo de raycasting de laser 6DOF e injeção de cliques. |
| [`src/vr/xrUI.js`](src/vr/xrUI.js) | **HUD Flutuante de Combate**. Mostra barras de HP do jogador e do inimigo, além do registro do último golpe desferido. |
| [`src/vr/xrSession.js`](src/vr/xrSession.js) | **Gerenciador de Sessão WebXR**. Solicita sessão `immersive-vr` com `local-floor`, monta o botão de entrada e gerencia ciclo de vida do WebXR. |
| [`src/vr/xrLog.js`](src/vr/xrLog.js) | **Telemetria Remota**. Intercepta `console.log`, `warn`, `error` e exceções da janela do Quest 3 e envia via `POST /api/vr-log`. |

---

## 🛠️ Detalhes Técnicos & Lições Aprendidas (Gotchas & Solutions)

1. **Tela Preta no WebXR (LightingLane / FBO redirection)**:
   - *Causa*: O renderer original do Daggerfall criava um FBO offscreen (`_frameFbo`) para pós-processamento de desktop (`AirPass`). O WebGL desenhava tudo no FBO e deixava o buffer do WebXR em branco.
   - *Solução*: Em VR, chamamos `renderer.setLightingLane(null)` e desenhamos diretamente no `layer.framebuffer` do WebXR.
2. **Convergência Estéreo e Foco das Lentes (Preset 5)**:
   - *Causa*: O espelho de coordenadas do Daggerfall Unity inverte o NDC X. Espelhar o centro óptico (`out[8]`) causava distorção e náusea ao olhar para objetos próximos (como a espada).
   - *Solução*: Espelhar apenas a escala `out[0] = -out[0]` e relaxar a separação virtual de IPD em 75% (`IPD_SCALE = 0.75`). A visão é instantaneamente nítida tanto para armas próximas quanto para paredes distantes.
3. **Mapeamento de Mão Invertida**:
   - *Causa*: Multiplicar o eixo X do controle por constantes de espelho da câmera fazia a mão direita mover a espada no lado esquerdo.
   - *Solução*: As coordenadas de rastreamento do controle do WebXR já são físicas (+X direita, +Y cima, -Z frente) e nunca devem ser invertidas pelo sinal do olho.

---

## 📜 Sobre o Jogo Base (DFO Online)

Este mod é construído sobre o **DFO Online**, uma reimplementação open-source em WebGL2 de *The Elder Scrolls II: Daggerfall*.

### Scripts Úteis:
- `npm run dev`: Inicia o servidor Vite local.
- `npm run build`: Compila o bundle de produção.
- `npm test`: Executa os testes automatizados do motor.
- `npm run lint`: Checa a sintaxe e padrões de código.

### Licença
Distribuído sob a licença **MIT**.
The Elder Scrolls e Daggerfall são marcas registradas da Bethesda Softworks / ZeniMax Media Inc. Este é um projeto sem fins lucrativos e não oficial feito por fãs.
