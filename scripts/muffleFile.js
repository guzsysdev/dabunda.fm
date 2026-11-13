// Aplica o MuffleTransform num arquivo para validar o som sem Discord:
//   npm run muffle-file -- entrada.mp3 saida.wav [leve|media|forte] [--alternar 5]
// --alternar N comeca desligado e liga/desliga a cada N segundos de audio, para ouvir a rampa
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sFfmpeg from 'ffmpeg-static';
import { MuffleTransform, iTaxa, oIntensidades } from '../src/audio/MuffleTransform.js';

const iBytesSeg = iTaxa * 4;
const iTamCabec = 44;

// Cabecalho WAV PCM 16 bits estereo. Os tamanhos so sao conhecidos no fim: vao zerados e o
// fCorrigirWav grava os valores reais depois
function faCabecWav(piBytesDados){
   const aCabec = Buffer.alloc(iTamCabec);
   aCabec.write('RIFF', 0, 'ascii');
   aCabec.writeUInt32LE(36 + piBytesDados, 4);
   aCabec.write('WAVEfmt ', 8, 'ascii');
   aCabec.writeUInt32LE(16, 16);
   aCabec.writeUInt16LE(1, 20);
   aCabec.writeUInt16LE(2, 22);
   aCabec.writeUInt32LE(iTaxa, 24);
   aCabec.writeUInt32LE(iBytesSeg, 28);
   aCabec.writeUInt16LE(4, 32);
   aCabec.writeUInt16LE(16, 34);
   aCabec.write('data', 36, 'ascii');
   aCabec.writeUInt32LE(piBytesDados, 40);
   return aCabec;
}

async function fCorrigirWav(psArq, piBytesDados){
   const oArq = await open(psArq, 'r+');
   try {
      await oArq.write(faCabecWav(piBytesDados), 0, iTamCabec, 0);
   } finally {
      await oArq.close();
   }
}

function foLerArgs(paArgs){
   const oArgs = { sEntrada: '', sSaida: '', sIntens: 'media', nAlternar: 0 };
   const aPos  = [];
   for(let iPos = 0; iPos < paArgs.length; iPos++){
      if(paArgs[iPos] === '--alternar'){
         oArgs.nAlternar = Number(paArgs[iPos + 1]) || 5;
         iPos++;
         continue;
      }
      aPos.push(paArgs[iPos]);
   }
   [oArgs.sEntrada, oArgs.sSaida] = aPos;
   if(aPos[2]){
      oArgs.sIntens = aPos[2];
   }
   return oArgs;
}

async function fPrincipal(){
   const oArgs = foLerArgs(process.argv.slice(2));
   if(!oArgs.sEntrada || !oArgs.sSaida || !(oArgs.sIntens in oIntensidades)){
      console.error('Uso: npm run muffle-file -- entrada.mp3 saida.wav [leve|media|forte] [--alternar 5]');
      process.exit(1);
   }
   // Sem --alternar o arquivo sai todo abafado (ja comeca no corte, sem rampa de entrada)
   const oMuffle = new MuffleTransform({
      sIntens : oArgs.sIntens,
      nCorte  : oArgs.nAlternar ? undefined : oIntensidades[oArgs.sIntens],
   });
   const oFfmpeg = spawn(sFfmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', oArgs.sEntrada,
      '-f', 's16le', '-ar', String(iTaxa), '-ac', '2', 'pipe:1',
   ], { stdio: ['ignore', 'pipe', 'inherit'] });
   const pFimFfmpeg = new Promise(pfOk => oFfmpeg.on('close', pfOk));
   // Conta os bytes do audio decodificado: alterna pelo tempo da musica, nao pelo relogio
   let iBytes     = 0;
   let iProxTroca = oArgs.nAlternar * iBytesSeg;
   const oContar  = new Transform({
      transform(pbPedaco, psCodif, pfFim){
         iBytes += pbPedaco.length;
         if(oArgs.nAlternar && iBytes >= iProxTroca){
            const lAtivo = oMuffle.fAlternar();
            console.log(`${(iBytes / iBytesSeg).toFixed(1)} s: muffle ${lAtivo ? 'ligado' : 'desligado'}`);
            iProxTroca += oArgs.nAlternar * iBytesSeg;
         }
         pfFim(null, pbPedaco);
      },
   });
   const oSaida = createWriteStream(oArgs.sSaida);
   oSaida.write(faCabecWav(0));
   await pipeline(oFfmpeg.stdout, oContar, oMuffle, oSaida);
   const iCodigo = await pFimFfmpeg;
   if(iCodigo !== 0){
      console.error(`FFmpeg terminou com erro (codigo ${iCodigo}).`);
      process.exit(1);
   }
   const iDados = oSaida.bytesWritten - iTamCabec;
   await fCorrigirWav(oArgs.sSaida, iDados);
   console.log(`Pronto: ${oArgs.sSaida} (${(iDados / iBytesSeg).toFixed(1)} s, intensidade ${oArgs.sIntens})`);
}

fPrincipal().catch(oErro => {
   console.error(oErro.message);
   process.exit(1);
});
