# Cosmic Velocity: Multiplayer Runner

Um endless runner/shooter espacial de navegador, com salas multiplayer em tempo real. Os jogadores pilotam naves em um tunel cosmico com sensacao 3D, giram ao redor do corredor, desviam de obstaculos, atiram em inimigos, coletam power-ups e competem por pontuacao.

## Tecnologias usadas

- Node.js
- Express
- Socket.IO
- HTML5
- CSS3
- JavaScript
- Three.js
- WebGL
- Armazenamento em memoria para salas e ranking

## Como instalar

```bash
npm install
```

## Como rodar

```bash
npm start
```

Acesse:

```text
http://localhost:3000
```

## Como testar o multiplayer

1. Abra `http://localhost:3000` em duas abas ou em dois navegadores.
2. Na primeira aba, informe um nickname e clique em `Criar sala`.
3. Copie o codigo da sala exibido no lobby.
4. Na segunda aba, informe outro nickname, cole o codigo e clique em `Entrar em sala`.
5. Na aba do host, clique em `Lancar naves`.
6. Movimente as duas naves e atire para verificar a sincronizacao em tempo real.

## Controles

- `A` ou seta para esquerda: girar a nave para a esquerda ao redor do tunel
- `S`, `D` ou seta para direita: girar a nave para a direita ao redor do tunel
- `Espaco` ou clique no canvas: atirar
- `Esc` ou `P`: pausar ou continuar a corrida

## Onde o HTTP e usado

O Express serve a pagina principal e os arquivos estaticos em `public/`. Tambem existem endpoints REST:

- `GET /api/rooms`: lista salas abertas.
- `POST /api/rooms`: cria uma sala e retorna seu codigo.
- `GET /api/rooms/:roomId`: consulta dados basicos de uma sala.
- `GET /api/leaderboard`: retorna o ranking geral em memoria.
- `POST /api/score`: registra uma pontuacao final no ranking.

## Onde o WebSocket e usado

O Socket.IO sincroniza a partida em tempo real:

- entrada em salas com `joinRoom`;
- aviso de novos jogadores com `playerJoined`;
- inicio sincronizado com `startGame` e `gameStarted`;
- envio de controles com `playerInput`;
- distribuicao de estado com `roomState` e `playerState`;
- tiros, spawns, dano, morte, score e fim de jogo com eventos em tempo real.

O servidor controla salas, jogadores, inimigos, obstaculos, power-ups, vida, pontuacao e ranking final da sala.

## Mecanicas implementadas

- Movimento em tunel 3D projetado, com giro ao redor do corredor.
- Avanco automatico simulado por profundidade, aneis do tunel e distancia.
- Tiros com limite de cadencia.
- Inimigos em linha reta, zigue-zague, rapidos e resistentes.
- Inimigos passam a manobrar dentro do tunel depois de um tempo de corrida.
- Obstaculos do tipo asteroide e barreira energetica.
- Obstaculos com nucleos solidos, halos pulsantes, cores de alerta e balizas luminosas para leitura em alta velocidade.
- Power-ups de escudo, tiro rapido, cura, bonus e aneis de upgrade de arma.
- HUD lateral com identificacao e duracao dos efeitos coletados.
- Aneis de arma com halo, animacao e destaque visual proprio.
- Cada jogador tem uma barra superior com 4 slots dourados de upgrade.
- A arma evolui ate 4 niveis, aumentando a quantidade de tiros.
- Ao preencher os 4 slots dourados, a sala avanca de fase e muda a paleta do tunel e dos inimigos.
- A troca de fase reduz temporariamente a velocidade antes de iniciar uma nova escalada.
- Dificuldade progressiva sem limite, com ondas maiores, spawns mais frequentes e obstaculos maiores.
- Pause sincronizado para toda a sala.
- Menu, lobby e tela de resultado integrados ao tunel 3D.
- Trilha ambiente procedural original com controle de som.
- Tres trilhas de corrida alternadas conforme as fases: Cold Circuit, Neon Pursuit e Solar Collapse.
- Efeitos sonoros sintetizados para disparos, impactos, destruicoes, inimigos, power-ups, dano, escudo, fases, pause e morte.
- Motor continuo da nave com frequencia e intensidade ligadas a velocidade.
- Campo de particulas, explosoes, camera dinamica, inclinacao da nave e FOV adaptativo para reforcar profundidade e velocidade.
- Tipografia local Orbitron e Rajdhani, sem dependencia de fontes externas em runtime.
- Pontuacao por tempo, distancia, inimigos destruidos, coletas e sequencia sem dano.
- Morte com modo espectador ate o fim da rodada.
- Ranking da sala e ranking geral em memoria.

## Melhorias futuras

- Persistir ranking em SQLite ou arquivo JSON.
- Criar matchmaking publico.
- Adicionar reconexao com retomada de jogador.
- Melhorar validacao antitrapaca.
- Incluir fases visuais diferentes sem fim fixo.
