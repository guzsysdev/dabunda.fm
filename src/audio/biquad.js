// Filtros biquad pelas formulas do RBJ Audio EQ Cookbook. Os coeficientes ficam num Float64Array de
// 5 posicoes [b0, b1, b2, a1, a2], ja normalizados por a0, e sao reescritos no lugar: o
// MuffleTransform recalcula a cada bloco durante a rampa e nao pode alocar memoria nisso

export const iTamCoef = 5;

// Q 0.707 = Butterworth: resposta plana ate o corte, sem pico de ressonancia
export function faCoefPassaBx(paCoef, pnCorte, pnTaxa, pnQ = Math.SQRT1_2){
   const nW0   = 2 * Math.PI * pnCorte / pnTaxa;
   const nCos  = Math.cos(nW0);
   const nAlfa = Math.sin(nW0) / (2 * pnQ);
   const nA0   = 1 + nAlfa;
   paCoef[0] = (1 - nCos) / 2 / nA0;
   paCoef[1] = (1 - nCos) / nA0;
   paCoef[2] = paCoef[0];
   paCoef[3] = -2 * nCos / nA0;
   paCoef[4] = (1 - nAlfa) / nA0;
   return paCoef;
}

// Low-shelf (reforco de grave). Q 0.5 e 100 Hz sao os padroes do filtro "bass" do FFmpeg, usado
// na referencia que soou bem (lowpass=f=700,lowpass=f=700,bass=g=2)
export function faCoefGrave(paCoef, pnFreq, pnGanhoDb, pnTaxa, pnQ = 0.5){
   const nA    = Math.pow(10, pnGanhoDb / 40);
   const nW0   = 2 * Math.PI * pnFreq / pnTaxa;
   const nCos  = Math.cos(nW0);
   const nAlfa = Math.sin(nW0) / (2 * pnQ);
   const nRaiz = 2 * Math.sqrt(nA) * nAlfa;
   const nA0   = (nA + 1) + (nA - 1) * nCos + nRaiz;
   paCoef[0] = nA * ((nA + 1) - (nA - 1) * nCos + nRaiz) / nA0;
   paCoef[1] = 2 * nA * ((nA - 1) - (nA + 1) * nCos) / nA0;
   paCoef[2] = nA * ((nA + 1) - (nA - 1) * nCos - nRaiz) / nA0;
   paCoef[3] = -2 * ((nA - 1) + (nA + 1) * nCos) / nA0;
   paCoef[4] = ((nA + 1) + (nA - 1) * nCos - nRaiz) / nA0;
   return paCoef;
}

// |H| na frequencia pnFreq: confere a resposta do filtro sem precisar tocar audio
export function fnMagnitude(paCoef, pnFreq, pnTaxa){
   const nW   = 2 * Math.PI * pnFreq / pnTaxa;
   const nNRe = paCoef[0] + paCoef[1] * Math.cos(nW) + paCoef[2] * Math.cos(2 * nW);
   const nNIm = -(paCoef[1] * Math.sin(nW) + paCoef[2] * Math.sin(2 * nW));
   const nDRe = 1 + paCoef[3] * Math.cos(nW) + paCoef[4] * Math.cos(2 * nW);
   const nDIm = -(paCoef[3] * Math.sin(nW) + paCoef[4] * Math.sin(2 * nW));
   return Math.sqrt((nNRe * nNRe + nNIm * nNIm) / (nDRe * nDRe + nDIm * nDIm));
}

// Uma amostra em forma direta transposta II (estavel com coeficientes mudando bloco a bloco).
// paEst[piPos] e paEst[piPos + 1] sao o estado (z1, z2) daquele canal naquele estagio
export function fnProcessar(paCoef, paEst, piPos, pnX){
   const nY = paCoef[0] * pnX + paEst[piPos];
   paEst[piPos]     = paCoef[1] * pnX - paCoef[3] * nY + paEst[piPos + 1];
   paEst[piPos + 1] = paCoef[2] * pnX - paCoef[4] * nY;
   return nY;
}

// Poe o estado em regime pra entrada constante pnX e devolve a saida correspondente. Sair do
// bypass com estado zerado daria um clique: o filtro partiria do silencio no meio da musica
export function fnPreparar(paCoef, paEst, piPos, pnX){
   const nGanho = (paCoef[0] + paCoef[1] + paCoef[2]) / (1 + paCoef[3] + paCoef[4]);
   const nY     = nGanho * pnX;
   paEst[piPos + 1] = paCoef[2] * pnX - paCoef[4] * nY;
   paEst[piPos]     = paCoef[1] * pnX - paCoef[3] * nY + paEst[piPos + 1];
   return nY;
}
