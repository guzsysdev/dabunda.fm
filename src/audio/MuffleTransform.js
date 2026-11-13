import { Transform } from 'node:stream';
import { faCoefGrave, faCoefPassaBx, fnPreparar, fnProcessar, iTamCoef } from './biquad.js';

// PCM s16le 48 kHz estereo: o formato que o FFmpeg entrega e o @discordjs/voice espera em
// StreamType.Raw. Um frame = uma amostra de cada canal = 4 bytes
export const iTaxa = 48000;
const iCanais      = 2;
const iBytesFrame  = 4;

// Corte do low-pass por intensidade. "media" e o 700 Hz validado no FFmpeg
export const oIntensidades = { leve: 1800, media: 700, forte: 250 };

// Desligado = corte em 20 kHz (o ouvido nao percebe o filtro). Acima de 19 kHz e sem rampa, o
// audio passa direto, sem processar
const nCorteDesl = 20000;
const nLogBypass = Math.log(19000);
const nLogDesl   = Math.log(nCorteDesl);
const nLogRef    = Math.log(oIntensidades.media);

// Grave e ganho da referencia (bass=g=2, volume=0.9), aplicados em proporcao ao quanto o filtro
// esta fechado - assim tudo entra e sai junto na rampa, sem degrau de volume
const nGraveFreq = 100;
const nGraveDb   = 2;
const nPerdaVol  = 0.1;

// Rampa: o corte persegue o alvo em escala log a cada bloco de 128 frames (2,7 ms). Constante
// de tempo de 0,25 s = ~98% do caminho em 1 s. Recalcular por bloco, e nao a cada amostra,
// evita o custo e e curto o bastante pra nao dar "zipper"
const iBloco    = 128;
const nPasso    = 1 - Math.exp(-iBloco / (0.25 * iTaxa));
const nFolga    = 0.001;
const iEstagios = 3;

function fiLimitar(pnAm){
   return Math.max(-32768, Math.min(32767, Math.round(pnAm)));
}

// Filtro "muffled" (som abafado, como musica vindo do apartamento vizinho): 2 low-pass em
// cascata (24 dB/oitava), reforco leve de grave e ganho 0.9. Liga e desliga com transicao suave
// no meio da faixa, sem reiniciar nada
export class MuffleTransform extends Transform {

   constructor(poOpc = {}){
      super();
      this.nCorteLig = oIntensidades[poOpc.sIntens] ?? oIntensidades.media;
      this.nLogAtual = Math.log(poOpc.nCorte ?? nCorteDesl);
      this.nLogAlvo  = this.nLogAtual;
      this.aCoefPB   = new Float64Array(iTamCoef);
      this.aCoefGr   = new Float64Array(iTamCoef);
      // Estado (z1, z2) por canal e por estagio: [canal][low-pass 1, low-pass 2, grave]
      this.aEst      = new Float64Array(iCanais * iEstagios * 2);
      this.nGanho    = 1;
      this.iNoBloco  = 0;
      this.aSobra    = null;
      this.lPulou    = true;
      this.fAtualizar();
   }

   get lAtivo(){
      return this.nLogAlvo < nLogBypass;
   }

   get nCorte(){
      return Math.exp(this.nLogAtual);
   }

   fDefAlvo(pnCorte){
      this.nLogAlvo = Math.log(Math.max(20, Math.min(nCorteDesl, pnCorte)));
   }

   fLigar(plLigado){
      this.fDefAlvo(plLigado ? this.nCorteLig : nCorteDesl);
   }

   fAlternar(){
      this.fLigar(!this.lAtivo);
      return this.lAtivo;
   }

   // Troca a intensidade; se ja estiver ligado, a rampa leva ate o novo corte
   fDefIntens(psNome){
      this.nCorteLig = oIntensidades[psNome] ?? oIntensidades.media;
      if(this.lAtivo){
         this.fDefAlvo(this.nCorteLig);
      }
   }

   // Coeficientes e ganho pro corte atual. nMix vai de 0 (desligado) a 1 (700 Hz ou mais fechado)
   fAtualizar(){
      const nMix = Math.max(0, Math.min(1, (nLogDesl - this.nLogAtual) / (nLogDesl - nLogRef)));
      faCoefPassaBx(this.aCoefPB, Math.exp(this.nLogAtual), iTaxa);
      faCoefGrave(this.aCoefGr, nGraveFreq, nGraveDb * nMix, iTaxa);
      this.nGanho = 1 - nPerdaVol * nMix;
   }

   // Avanca a rampa um bloco. Em escala log porque o ouvido percebe frequencia em oitavas: a
   // descida de 20 kHz a 700 Hz soa uniforme, sem "despencar" no fim
   fPassoRampa(){
      const nDif = this.nLogAlvo - this.nLogAtual;
      if(nDif === 0){
         return;
      }
      this.nLogAtual = Math.abs(nDif) < nFolga ? this.nLogAlvo : this.nLogAtual + nDif * nPasso;
      this.fAtualizar();
   }

   flPulavel(){
      return this.nLogAtual === this.nLogAlvo && this.nLogAtual >= nLogBypass;
   }

   // Voltando do bypass: estado de cada estagio em regime com a amostra atual, pra nao estalar
   fSairBypass(paDados, piPos){
      for(let iCanal = 0; iCanal < iCanais; iCanal++){
         const iBase = iCanal * iEstagios * 2;
         let nAm     = paDados.readInt16LE(piPos + iCanal * 2);
         nAm = fnPreparar(this.aCoefPB, this.aEst, iBase, nAm);
         nAm = fnPreparar(this.aCoefPB, this.aEst, iBase + 2, nAm);
         fnPreparar(this.aCoefGr, this.aEst, iBase + 4, nAm);
      }
      this.lPulou = false;
   }

   _transform(pbPedaco, psCodif, pfFim){
      let aDados = pbPedaco;
      if(this.aSobra){
         aDados      = Buffer.concat([this.aSobra, pbPedaco]);
         this.aSobra = null;
      }
      // O FFmpeg nao garante pedacos com frames inteiros: a sobra (1 a 3 bytes) espera o proximo.
      // Copiada, porque quem escreveu pode reaproveitar o buffer original
      const iUteis = aDados.length - (aDados.length % iBytesFrame);
      if(iUteis < aDados.length){
         this.aSobra = Buffer.from(aDados.subarray(iUteis));
      }
      if(iUteis === 0){
         pfFim();
         return;
      }
      if(this.flPulavel()){
         this.lPulou = true;
         pfFim(null, aDados.subarray(0, iUteis));
         return;
      }
      if(this.lPulou){
         this.fSairBypass(aDados, 0);
      }
      const aSaida = Buffer.allocUnsafe(iUteis);
      for(let iPos = 0; iPos < iUteis; iPos += iBytesFrame){
         if(this.iNoBloco === 0){
            this.fPassoRampa();
         }
         for(let iCanal = 0; iCanal < iCanais; iCanal++){
            const iByte = iPos + iCanal * 2;
            const iBase = iCanal * iEstagios * 2;
            let nAm     = aDados.readInt16LE(iByte);
            nAm = fnProcessar(this.aCoefPB, this.aEst, iBase, nAm);
            nAm = fnProcessar(this.aCoefPB, this.aEst, iBase + 2, nAm);
            nAm = fnProcessar(this.aCoefGr, this.aEst, iBase + 4, nAm) * this.nGanho;
            aSaida.writeInt16LE(fiLimitar(nAm), iByte);
         }
         this.iNoBloco = (this.iNoBloco + 1) % iBloco;
      }
      pfFim(null, aSaida);
   }

   // Sobra de menos de um frame no fim do audio nao forma amostra: e descartada
   _flush(pfFim){
      this.aSobra = null;
      pfFim();
   }
}
