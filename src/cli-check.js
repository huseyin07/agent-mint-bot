// Tek bir kontratı ASLA işlem göndermeden kontrol eder:
//   npm run check -- 0xKONTRAT
// Doğrulama, mint fonksiyonu, simülasyon ve Binance önizlemesi + kural motoru sonucu yazdırılır.

import { encodeFunctionData, getAddress } from 'viem';
import { config } from './config.js';
import { Baw } from './baw.js';
import { lookupVerified } from './verify.js';
import { makeClient, alreadyHolds } from './chain.js';
import { evaluatePreview, pickMintCandidates, referencesRegistry } from './policy.js';

const address = getAddress(process.argv[2] || '');
const wallet = getAddress(config.wallet);
const client = makeClient(config.rpcUrl);

const code = await client.getCode({ address });
console.log('Agent ID registry kodda geçiyor mu:', referencesRegistry(code, config.agentRegistry));

const v = await lookupVerified(config.chainId, address, { requireExact: config.requireExactMatch, etherscanApiKey: config.etherscanApiKey });
console.log('Doğrulama:', v.status, v.source || '', v.match || '');
if (v.status !== 'verified') process.exit(0);

const candidates = pickMintCandidates(v.abi, config.maxQuantity);
console.log('Aday fonksiyonlar:', candidates.map((c) => `${c.abiItem.name}(${c.args.join(',')})`).join(', ') || 'yok');
console.log('Zaten elimde:', await alreadyHolds(client, address, wallet));

for (const c of candidates) {
  const data = encodeFunctionData({ abi: [c.abiItem], functionName: c.abiItem.name, args: c.args });
  try {
    await client.call({ account: wallet, to: address, data, value: 0n });
  } catch (e) {
    console.log(`${c.abiItem.name}: simülasyon revert -> ${e.shortMessage || e.message}`);
    continue;
  }
  console.log(`${c.abiItem.name}: simülasyon OK, Binance önizlemesi alınıyor…`);
  const preview = await new Baw(config.bawBin).previewCall({ from: wallet, to: address, inputData: data });
  console.log(JSON.stringify(preview, null, 2));
  console.log('Kural motoru:', evaluatePreview(preview));
  break;
}
