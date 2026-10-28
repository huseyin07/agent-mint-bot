// Kural motoru. Bilinçli olarak SAF fonksiyonlardan oluşur: ağ yok, LLM yok, dış girdi
// yorumlamak yok. Bir şey beklenmedik görünürse cevap "hayır"dır (fail-closed).

const NAME_PRIORITY = ['freeMint', 'mintFree', 'agentMint', 'mintAgent', 'publicMint', 'mint', 'claim'];

function isUintType(t) {
  return /^uint(8|16|32|64|128|256)?$/.test(t);
}

/**
 * ABI'den denenecek mint fonksiyonlarını çıkarır.
 * Sadece payable OLMAYAN, en fazla tek bir uint parametresi alan fonksiyonlar.
 */
export function pickMintCandidates(abi, maxQuantity = 1) {
  if (!Array.isArray(abi)) return [];
  const out = [];
  for (const item of abi) {
    if (item?.type !== 'function') continue;
    if (item.stateMutability !== 'nonpayable') continue; // payable / view / pure elenir
    const rank = NAME_PRIORITY.findIndex((n) => n.toLowerCase() === String(item.name).toLowerCase());
    if (rank === -1) continue;
    const inputs = item.inputs || [];
    if (inputs.length === 0) {
      out.push({ rank, abiItem: item, args: [] });
    } else if (inputs.length === 1 && isUintType(inputs[0].type)) {
      out.push({ rank, abiItem: item, args: [BigInt(Math.max(1, Math.floor(maxQuantity)))] });
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** İç içe bir nesnede negatif miktar var mı? (balanceChanges şekli belgelenmediği için genel tarama) */
export function hasOutflow(node) {
  if (node === null || node === undefined) return false;
  if (Array.isArray(node)) return node.some(hasOutflow);
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (['amount', 'change', 'delta', 'value', 'balancechange', 'rawamount'].includes(key)) {
        if (typeof v === 'number' && v < 0) return true;
        if (typeof v === 'string' && v.trim().startsWith('-')) return true;
      }
      if (['direction', 'type', 'changetype'].includes(key) && typeof v === 'string' && /out|send|decrease|transfer_out/i.test(v)) {
        return true;
      }
      if (typeof v === 'object' && hasOutflow(v)) return true;
    }
  }
  return false;
}

function nonEmpty(x) {
  if (!x) return false;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object') return Object.keys(x).length > 0;
  return Boolean(x);
}

/**
 * baw contract-call preview cevabını değerlendirir.
 * @returns {{ ok: boolean, reasons: string[], requestId?: string }}
 */
export function evaluatePreview(res) {
  const reasons = [];
  if (!res || res.success !== true) {
    const e = res?.error;
    return { ok: false, reasons: [`önizleme reddedildi: ${e?.name || ''} ${e?.message || ''}`.trim()] };
  }
  const d = res.data || {};
  if (!d.requestId) reasons.push('requestId yok');
  if (d.requireConfirmation !== false) reasons.push('uygulama onayı istiyor');

  const sim = d.simulationResult;
  if (!sim) {
    reasons.push('simülasyon sonucu yok');
  } else {
    if (sim.simulationErrorDetail) reasons.push(`simülasyon hatası: ${String(sim.simulationErrorDetail).slice(0, 120)}`);
    if (sim.simulationCode && !/^0+$/.test(String(sim.simulationCode))) reasons.push(`simülasyon kodu ${sim.simulationCode}`);
    if (sim.preCheckCode) reasons.push(`ön kontrol kodu ${sim.preCheckCode}`);
    if (nonEmpty(sim.allowanceChanges)) reasons.push('approve / allowance değişimi var');
    if (nonEmpty(sim.authorityChanges)) reasons.push('yetki değişimi var');
    if (hasOutflow(sim.balanceChanges)) reasons.push('cüzdandan çıkış var');
  }

  const amount = d.parsedTx?.amount;
  if (amount !== undefined && amount !== null && Number(amount) !== 0) reasons.push('gönderilen değer 0 değil');

  const risks = d.risks || {};
  if (nonEmpty(risks.riskDetails)) reasons.push(`risk: ${risks.riskDetails.map((r) => r.title).join(', ')}`);
  if (nonEmpty(risks.riskBehaviors)) reasons.push('riskli davranış işaretlendi');
  for (const [addr, info] of Object.entries(risks.addresses || {})) {
    if ((info?.riskLevel ?? 0) > 0 || nonEmpty(info?.riskDetails)) reasons.push(`riskli adres ${addr}`);
  }

  return { ok: reasons.length === 0, reasons, requestId: d.requestId };
}

/** Günlük tavanlar dolu mu? */
export function withinLimits({ mints, gasWei }, { maxMintsPerDay, maxGasBnbPerDay }) {
  if (mints >= maxMintsPerDay) return { ok: false, reason: `günlük mint tavanı (${maxMintsPerDay}) doldu` };
  const maxWei = BigInt(Math.round(maxGasBnbPerDay * 1e18));
  if (BigInt(gasWei) >= maxWei) return { ok: false, reason: `günlük gas tavanı (${maxGasBnbPerDay} BNB) doldu` };
  return { ok: true };
}

/** Bytecode içinde registry adresi geçiyor mu? */
export function referencesRegistry(bytecode, registry) {
  if (!bytecode || bytecode === '0x') return false;
  return bytecode.toLowerCase().includes(registry.toLowerCase().replace(/^0x/, ''));
}
