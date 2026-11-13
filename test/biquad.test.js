import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faCoefPassaBx, fnMagnitude, iTamCoef } from '../src/audio/biquad.js';
import { MuffleTransform, iTaxa, oIntensidades } from '../src/audio/MuffleTransform.js';

const fnDb = (pnLinear) => 20 * Math.log10(pnLinear);

// Seno estereo de 1 s (amplitude 10000) em PCM s16le
function faSeno(pnFreq){
   const iFrames = iTaxa;
   const aPcm    = Buffer.alloc(iFrames * 4);
   for(let iFr = 0; iFr < iFrames; iFr++){
      const iAm = Math.round(10000 * Math.sin(2 * Math.PI * pnFreq * iFr / iTaxa));
      aPcm.writeInt16LE(iAm, iFr * 4);
      aPcm.writeInt16LE(iAm, iFr * 4 + 2);
   }
   return aPcm;
}

// Passa o PCM pelo transform em pedacos de tamanho impar (pra exercitar a sobra entre pedacos)
async function faProcessar(poMuffle, paPcm){
   const aPartes = [];
   poMuffle.on('data', pbPedaco => aPartes.push(pbPedaco));
   const pFim = new Promise(pfOk => poMuffle.on('end', pfOk));
   for(let iPos = 0; iPos < paPcm.length; iPos += 1001){
      poMuffle.write(paPcm.subarray(iPos, iPos + 1001));
   }
   poMuffle.end();
   await pFim;
   return Buffer.concat(aPartes);
}

// RMS do canal esquerdo na segunda metade (depois do transiente inicial do filtro)
function fnRms(paPcm){
   const iIni = Math.floor(paPcm.length / 8) * 4;
   let nSoma  = 0;
   let iQtd   = 0;
   for(let iPos = iIni; iPos < paPcm.length; iPos += 4){
      const iAm = paPcm.readInt16LE(iPos);
      nSoma += iAm * iAm;
      iQtd++;
   }
   return Math.sqrt(nSoma / iQtd);
}

test('low-pass 700 Hz em cascata: 100 Hz passa e 5 kHz cai forte', () => {
   const aCoef  = faCoefPassaBx(new Float64Array(iTamCoef), 700, iTaxa);
   // Dois estagios iguais: a magnitude da cascata e o quadrado da de um estagio
   const nDb100 = fnDb(fnMagnitude(aCoef, 100, iTaxa) ** 2);
   const nDb5k  = fnDb(fnMagnitude(aCoef, 5000, iTaxa) ** 2);
   assert.ok(nDb100 > -0.5, `100 Hz deveria passar, saiu ${nDb100.toFixed(2)} dB`);
   assert.ok(nDb5k < -60, `5 kHz deveria cair mais de 60 dB, saiu ${nDb5k.toFixed(2)} dB`);
});

test('MuffleTransform ligado (700 Hz): 100 Hz mantem o volume e 5 kHz praticamente some', async () => {
   const nRmsIn = fnRms(faSeno(100));
   const nR100  = fnRms(await faProcessar(new MuffleTransform({ nCorte: oIntensidades.media }), faSeno(100))) / nRmsIn;
   const nR5k   = fnRms(await faProcessar(new MuffleTransform({ nCorte: oIntensidades.media }), faSeno(5000))) / nRmsIn;
   assert.ok(nR100 > 0.8 && nR100 < 1.25, `100 Hz: razao ${nR100.toFixed(3)}`);
   assert.ok(nR5k < 0.01, `5 kHz: razao ${nR5k.toFixed(5)} (${fnDb(nR5k).toFixed(1)} dB)`);
});

test('desligado: audio passa intacto e nenhum byte se perde com pedacos impares', async () => {
   const aPcm   = faSeno(5000);
   const aSaida = await faProcessar(new MuffleTransform(), aPcm);
   assert.equal(aSaida.length, aPcm.length);
   assert.ok(aSaida.equals(aPcm));
});

test('rampa: depois de ligar, o corte chega perto do alvo em cerca de 1 s', async () => {
   const oMuffle = new MuffleTransform();
   oMuffle.fLigar(true);
   await faProcessar(oMuffle, faSeno(440));
   const nRazao  = oMuffle.nCorte / oIntensidades.media;
   assert.ok(nRazao < 1.15, `corte apos 1 s: ${oMuffle.nCorte.toFixed(0)} Hz`);
});
