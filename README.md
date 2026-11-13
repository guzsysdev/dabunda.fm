# DaBunda.fm

> **Todos os direitos reservados.** Uso, cópia, modificação, distribuição e comercialização
> deste software são proibidos sem autorização prévia do titular dos direitos. Ver
> [LICENSE](LICENSE).

Bot de música para Discord com cara de rádio. Toca música no canal de voz e permite ligar e
desligar, a qualquer momento, um efeito **muffled**: o som abafado de uma música vindo do
apartamento vizinho. A transição é suave e acontece no meio da faixa, sem reiniciar nada.

Nas próximas etapas, uma **locutora** anuncia a próxima música entre as faixas, falando por cima
do fim da música atual, como numa rádio de verdade.

> **Status:** em desenvolvimento. Etapa 1 pronta: o filtro e a ferramenta para validar o som
> num arquivo. O bot em si vem na etapa 2.

## Como funciona o filtro

O efeito é implementado no próprio projeto, num `Transform` stream do Node, sem depender de
servidores de áudio como o Lavalink. Assim ele pode mudar de intensidade enquanto a música toca,
o que filtros fixos do FFmpeg não permitem.

```
fonte → FFmpeg (PCM 48 kHz estéreo) → MuffleTransform → Discord
```

- **Dois filtros passa-baixa em cascata** (biquad, fórmulas do RBJ Audio EQ Cookbook, Q 0,707),
  que cortam os agudos a 24 dB por oitava. É isso que dá a sensação de parede no meio do caminho.
- **Reforço leve de grave** (+2 dB perto de 100 Hz) e **ganho de 0,9**, porque o grave é o que
  atravessa a parede.
- Esses valores vêm de uma referência testada no FFmpeg
  (`lowpass=f=700,lowpass=f=700,bass=g=2,volume=0.9`) e o filtro do projeto reproduz o mesmo
  volume dela.
- **Intensidades:** leve (1800 Hz), média (700 Hz) e forte (250 Hz).
- **Transição suave:** ao ligar ou desligar, a frequência de corte desliza até o alvo em cerca de
  1 segundo, em escala logarítmica (o ouvido percebe frequência em oitavas). Os coeficientes são
  recalculados a cada 128 amostras, curto o bastante para não gerar estalos.
- **Desligado** = corte em 20 kHz. Nesse estado o áudio passa direto, sem processamento.

## Instalação

Requer [Node.js](https://nodejs.org/) 20 ou mais novo.

```bash
npm install
```

O FFmpeg vem junto, pelo pacote `ffmpeg-static`: a instalação baixa o executável certo para o
seu sistema, sem precisar instalar nada à parte.

## Testar o som sem o Discord

Para ouvir o efeito antes de existir o bot, aplique o filtro num arquivo de música:

```bash
# Arquivo todo abafado (intensidade média)
npm run muffle-file -- musica.mp3 saida.wav

# Escolhendo a intensidade
npm run muffle-file -- musica.mp3 saida.wav forte

# Liga e desliga a cada 5 segundos, para ouvir a transição
npm run muffle-file -- musica.mp3 saida.wav media --alternar 5
```

Aceita qualquer formato que o FFmpeg leia (MP3, FLAC, M4A, WAV...). A saída é sempre WAV.

## Testes

```bash
npm test
```

Conferem a resposta do filtro (com corte em 700 Hz, 100 Hz passa e 5 kHz cai mais de 60 dB),
que o áudio passa intacto quando desligado, que nenhum byte se perde entre pedaços de tamanho
ímpar e que a transição chega ao alvo em cerca de 1 segundo.

## Estrutura

```
src/audio/biquad.js           Cálculo dos coeficientes e processamento dos filtros
src/audio/MuffleTransform.js  O efeito muffled como stream, com a transição suave
scripts/muffleFile.js         Aplica o efeito num arquivo (npm run muffle-file)
test/biquad.test.js           Testes do filtro
```

## Próximas etapas

1. **Bot de música:** comandos `/play`, `/skip`, `/stop`, `/queue`, `/muffle` e `/volume`, fila por
   servidor e mensagem "Tocando agora" com botões (pausar, pular, muffle liga/desliga).
2. **Locutora de rádio:** anúncio da próxima música com voz feminina (Azure Speech), falando por
   cima do fim da faixa, com a música abaixando e a próxima entrando em crossfade.
3. **Hospedagem:** como criar o bot no Discord Developer Portal, permissões e como deixá-lo
   rodando 24 horas.
