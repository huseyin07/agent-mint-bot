import { encodeFunctionData, formatEther, getAddress } from 'viem';
import { config } from './config.js';
import { State, today } from './state.js';
import { Baw } from './baw.js';
import { Telegram } from './telegram.js';
import { lookupVerified } from './verify.js';
import { makeClient, alreadyHolds, DeployWatcher } from './chain.js';
import { evaluatePreview, pickMintCandidates, referencesRegistry, withinLimits } from './policy.js';

const log = {
  info: (m) => console.log(new Date().toISOString(), m),
  warn: (m) => console.warn(new Date().toISOString(), 'UYARI', m),
  error: (m) => console.error(new Date().toISOString(), 'HATA', m),
};

const state = new State(config.statePath);
const baw = new Baw(config.bawBin);
const tg = new Telegram(config.telegramToken, config.telegramChatId, log);
const client = makeClient(config.rpcUrl);
const wallet = getAddress(config.wallet);
const scan = (a) => `https://bscscan.com/address/${a}`;
const txLink = (h) => `https://bscscan.com/tx/${h}`;

// Tüm mint işlemleri tek sıradan geçer: aynı anda iki işlem asla gönderilmez.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch((e) => log.error(e.stack || e.message)));

// ---------------------------------------------------------------- aday işleme

async function onDeploy(address, blockNumber) {
  if (state.known(address)) return;
  const code = await client.getCode({ address }).catch(() => null);
  if (!referencesRegistry(code, config.agentRegistry)) return;
  log.info(`aday: ${address} (blok ${blockNumber})`);
  state.data.pendingVerify[address.toLowerCase()] = { firstSeen: Date.now(), nextTry: 0 };
  state.save();
  enqueue(() => processCandidate(address));
}

async function processCandidate(address) {
  if (state.data.paused) return;
  const key = address.toLowerCase();
  if (state.known(address)) return;

  // 1) Kaynak doğrulaması
  const v = await lookupVerified(config.chainId, address, {
    requireExact: config.requireExactMatch,
    etherscanApiKey: config.etherscanApiKey,
  });
  if (v.status === 'proxy') return state.mark(address, 'skipped', { reason: 'proxy kontrat' });
  if (v.status !== 'verified') {
    const p = state.data.pendingVerify[key] || { firstSeen: Date.now() };
    if (Date.now() - p.firstSeen > config.unverifiedGiveUpHours * 3600_000) {
      return state.mark(address, 'skipped', { reason: 'kaynak doğrulanmadı (zaman aşımı)' });
    }
    p.nextTry = Date.now() + config.unverifiedRetryMinutes * 60_000;
    state.data.pendingVerify[key] = p;
    state.save();
    return;
  }

  // 2) Mint fonksiyonu
  const candidates = pickMintCandidates(v.abi, config.maxQuantity);
  if (candidates.length === 0) return state.mark(address, 'skipped', { reason: 'uygun (ücretsiz, payable olmayan) mint fonksiyonu yok' });

  // 3) Zaten elimde mi?
  if (await alreadyHolds(client, address, wallet)) return state.mark(address, 'skipped', { reason: 'zaten elimde' });

  // 4) Yerel simülasyon: ilk geçen fonksiyonu seç
  let chosen = null;
  for (const c of candidates) {
    const data = encodeFunctionData({ abi: [c.abiItem], functionName: c.abiItem.name, args: c.args });
    try {
      await client.call({ account: wallet, to: address, data, value: 0n });
      chosen = { ...c, data };
      break;
    } catch {
      // revert: sıradaki aday
    }
  }
  if (!chosen) return state.mark(address, 'skipped', { reason: 'simülasyon başarısız (bitti, kapalı ya da ücretli)' });

  // 5) Tavanlar ve bakiye
  const lim = withinLimits(state.rollDay(), config);
  if (!lim.ok) {
    // Yarın tekrar denenmesi için işaretleme yapmadan bekleme listesine koy.
    state.data.pendingVerify[key] = { firstSeen: Date.now(), nextTry: Date.now() + 3600_000 };
    state.save();
    return;
  }
  const bal = await client.getBalance({ address: wallet });
  if (Number(formatEther(bal)) < config.minBnbReserve) {
    await tg.send(`BNB yetersiz (${formatEther(bal)} BNB). Mint durduruldu, cüzdana BNB ekle.`);
    state.data.paused = true;
    state.save();
    return;
  }

  const fnLabel = `${chosen.abiItem.name}(${chosen.args.join(',')})`;

  // 6) Binance önizlemesi + sabit kurallar
  const preview = await baw.previewCall({ from: wallet, to: address, inputData: chosen.data });
  const verdict = evaluatePreview(preview);
  if (!verdict.ok) {
    return state.mark(address, 'skipped', { reason: verdict.reasons.join('; '), fn: fnLabel });
  }

  if (config.dryRun) {
    state.mark(address, 'dry-run', { fn: fnLabel, source: v.source });
    return tg.send(`[DENEME] Mint edilebilirdi:\n${address}\nFonksiyon: ${fnLabel}\nKaynak: ${v.source} (${v.match})\n${scan(address)}`);
  }

  // 7) Gönder. Önce işaretle: çökme olursa aynı kontrat ikinci kez denenmez.
  state.data.inflight[key] = { requestId: verdict.requestId, at: Date.now() };
  state.mark(address, 'sending', { fn: fnLabel });
  const ex = await baw.execute(verdict.requestId);
  if (!ex?.success) {
    delete state.data.inflight[key];
    state.mark(address, 'failed', { reason: `${ex?.error?.name || ''} ${ex?.error?.message || ''}`.trim(), fn: fnLabel });
    return tg.send(`Mint gönderilemedi: ${address}\n${ex?.error?.message || 'bilinmeyen hata'}`);
  }
  const { status, txHash } = ex.data || {};
  if (status !== 'BROADCASTED' || !txHash) {
    delete state.data.inflight[key];
    state.mark(address, 'pending-app', { fn: fnLabel, orderId: ex.data?.orderId });
    return tg.send(`İşlem uygulama onayı bekliyor (${status}): ${address}`);
  }

  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 }).catch(() => null);
  delete state.data.inflight[key];
  if (receipt) state.addGas(receipt.gasUsed * receipt.effectiveGasPrice);
  if (receipt?.status === 'success') {
    state.rollDay().mints += 1;
    state.mark(address, 'minted', { fn: fnLabel, txHash });
    const d = state.data.daily;
    await tg.send(`Mint edildi ✅\n${address}\n${fnLabel}\n${txLink(txHash)}\nBugün: ${d.mints}/${config.maxMintsPerDay} mint, ${formatEther(BigInt(d.gasWei))} BNB gas`);
  } else {
    state.mark(address, 'failed', { reason: receipt ? 'işlem revert oldu' : 'makbuz alınamadı', fn: fnLabel, txHash });
    await tg.send(`Mint başarısız ❌\n${address}\n${txLink(txHash)}`);
  }
}

// Doğrulanmamış adayları belirli aralıklarla tekrar dene
async function retryLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 60_000));
    if (state.data.paused) continue;
    for (const [addr, p] of Object.entries(state.data.pendingVerify)) {
      if (Date.now() >= (p.nextTry || 0) && !state.known(addr)) enqueue(() => processCandidate(getAddress(addr)));
    }
  }
}

// ---------------------------------------------------------------- oturum takibi

const lastAlert = {};
async function alertOnce(kind, text, everyMs = 3 * 3600_000) {
  if (Date.now() - (lastAlert[kind] || 0) < everyMs) return;
  lastAlert[kind] = Date.now();
  await tg.send(text);
}

async function sessionCheck() {
  const st = await baw.status();
  const connected = st?.success && JSON.stringify(st.data).includes('CONNECTED') && !JSON.stringify(st.data).includes('UNCONNECTED');
  if (!connected) {
    return alertOnce('disconnected', 'Agentic Wallet oturumu kapalı. Giriş için /giris yaz.');
  }
  const s = await baw.settings();
  if (!s?.success) return;
  const dm = s.data?.devMode;
  if (!dm?.enabled) {
    await alertOnce('devmode', "Developer Mode kapalı. Binance uygulamasında Agentic Wallet > Ayarlar'dan aç.");
  } else if (dm.expiresAt && dm.expiresAt * 1000 - Date.now() < 24 * 3600_000) {
    await alertOnce('devmode-soon', 'Developer Mode 24 saat içinde kapanacak. Uygulamadan yenile.');
  }
  for (const k of ['sessionExpireTime', 'inactiveSignOutTime']) {
    const t = Date.parse(s.data?.[k]);
    if (t && t - Date.now() < 6 * 3600_000) {
      await alertOnce(`session-${k}`, `Cüzdan oturumu 6 saat içinde kapanacak (${s.data[k]}). Yenilemek için /giris yaz.`);
    }
  }
}

// ---------------------------------------------------------------- Telegram komutları

tg.on('/durum', async () => {
  const d = state.rollDay();
  const counts = {};
  for (const c of Object.values(state.data.contracts)) counts[c.status] = (counts[c.status] || 0) + 1;
  const bal = await client.getBalance({ address: wallet }).catch(() => null);
  await tg.send(
    [
      `Mod: ${config.dryRun ? 'DENEME (gerçek işlem yok)' : 'CANLI'}${state.data.paused ? ' — DURAKLATILDI' : ''}`,
      `Son blok: ${state.data.lastBlock}`,
      `Bugün (${today()}): ${d.mints}/${config.maxMintsPerDay} mint, ${formatEther(BigInt(d.gasWei))}/${config.maxGasBnbPerDay} BNB gas`,
      `Bakiye: ${bal === null ? '?' : formatEther(bal)} BNB`,
      `Doğrulama bekleyen: ${Object.keys(state.data.pendingVerify).length}`,
      `Kontratlar: ${JSON.stringify(counts)}`,
    ].join('\n'),
  );
});

tg.on('/son', async () => {
  const rows = Object.entries(state.data.contracts)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, 10)
    .map(([a, c]) => `${c.status} ${a.slice(0, 10)}… ${c.fn || ''} ${c.reason ? '— ' + c.reason : ''}`);
  await tg.send(rows.length ? rows.join('\n') : 'Henüz kontrat yok.');
});

tg.on('/dur', async () => {
  state.data.paused = true;
  state.save();
  await tg.send('Duraklatıldı. Yeni mint yapılmayacak. Devam için /devam');
});

tg.on('/devam', async () => {
  state.data.paused = false;
  state.save();
  await tg.send('Devam ediliyor.');
});

let signingIn = false;
tg.on('/giris', async () => {
  if (signingIn) return tg.send('Giriş zaten sürüyor.');
  signingIn = true;
  try {
    const r = await baw.signin();
    if (!r?.success) return tg.send(`Giriş başlatılamadı: ${r?.error?.message}`);
    if (r.data?.status === 'ALREADY_CONNECTED') return tg.send('Zaten bağlı.');
    await tg.send(`Eşleşme kodu: ${r.data.pairingCode}\n\nBu linki telefonunda aç, Binance uygulamasında kodun aynı olduğunu kontrol edip onayla (5 dk geçerli):\n${r.data.urlForWeb}`);
    const v = await baw.verify(r.data.qrCodeId);
    await tg.send(v?.success ? 'Giriş tamam ✅' : `Giriş başarısız: ${v?.error?.message}. Tekrar /giris yaz.`);
  } finally {
    signingIn = false;
  }
});

tg.on('/yardim', () => tg.send('/durum — özet\n/son — son 10 kontrat\n/dur — duraklat\n/devam — sürdür\n/giris — cüzdan oturumunu yenile'));

// ---------------------------------------------------------------- başlat

async function main() {
  // Önceki çalıştırmada yarım kalan gönderimler: asla yeniden göndermez, sadece bildirir.
  for (const [addr, f] of Object.entries(state.data.inflight)) {
    state.mark(addr, 'unknown', { reason: 'çökme sırasında gönderiliyordu, BscScan\'den kontrol et', requestId: f.requestId });
    await tg.send(`Dikkat: ${addr} için gönderim yarım kalmış olabilir. Tekrar denenmeyecek, BscScan'den kontrol et.`);
  }
  state.data.inflight = {};
  state.save();

  await tg.send(`Bot başladı. Mod: ${config.dryRun ? 'DENEME' : 'CANLI'}. Cüzdan: ${wallet}\n/yardim ile komutları gör.`);
  await sessionCheck().catch((e) => log.error(e.message));
  setInterval(() => sessionCheck().catch((e) => log.error(e.message)), 30 * 60_000);

  tg.pollForever();
  retryLoop();

  const startBlock = state.data.lastBlock ? BigInt(state.data.lastBlock) : null;
  const watcher = new DeployWatcher(client, { pollMs: config.pollMs, maxBlocksPerTick: config.maxBlocksPerTick, startBlock, log });
  let lastSave = 0;
  await watcher.run(onDeploy, (next) => {
    state.data.lastBlock = String(next);
    if (Date.now() - lastSave > 30_000) {
      state.save();
      lastSave = Date.now();
    }
  });
}

main().catch((e) => {
  log.error(e.stack || e.message);
  process.exit(1);
});
