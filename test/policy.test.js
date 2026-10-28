import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePreview, hasOutflow, pickMintCandidates, referencesRegistry, withinLimits } from '../src/policy.js';

const okPreview = () => ({
  success: true,
  data: {
    requestId: 'abc',
    parsedTx: { transactionType: 'ContractInteraction', amount: 0 },
    simulationResult: {
      simulationCode: '000000000',
      simulationErrorDetail: null,
      balanceChanges: [{ tokenSymbol: 'LUCKY', amount: '1', tokenId: '1977' }],
      allowanceChanges: [],
      authorityChanges: [],
      preCheckCode: '',
    },
    risks: { riskDetails: [], addresses: {}, riskBehaviors: [] },
    requireConfirmation: false,
  },
});

test('temiz önizleme geçer', () => {
  const r = evaluatePreview(okPreview());
  assert.equal(r.ok, true, r.reasons.join());
  assert.equal(r.requestId, 'abc');
});

test('approve varsa reddedilir', () => {
  const p = okPreview();
  p.data.simulationResult.allowanceChanges = [{ token: '0x55d3', spender: '0xbad', amount: 'unlimited' }];
  assert.equal(evaluatePreview(p).ok, false);
});

test('yetki değişimi varsa reddedilir', () => {
  const p = okPreview();
  p.data.simulationResult.authorityChanges = [{ x: 1 }];
  assert.equal(evaluatePreview(p).ok, false);
});

test('cüzdandan çıkış varsa reddedilir', () => {
  const p = okPreview();
  p.data.simulationResult.balanceChanges.push({ tokenSymbol: 'USDT', amount: '-5' });
  assert.equal(evaluatePreview(p).ok, false);
});

test('risk uyarısı varsa reddedilir', () => {
  const p = okPreview();
  p.data.risks.riskDetails = [{ title: 'High Risk Address' }];
  assert.equal(evaluatePreview(p).ok, false);
  const q = okPreview();
  q.data.risks.addresses = { '0xabc': { riskLevel: 5, riskDetails: [] } };
  assert.equal(evaluatePreview(q).ok, false);
});

test('uygulama onayı isterse reddedilir', () => {
  const p = okPreview();
  p.data.requireConfirmation = true;
  assert.equal(evaluatePreview(p).ok, false);
});

test('simülasyon sonucu yoksa reddedilir (fail-closed)', () => {
  const p = okPreview();
  delete p.data.simulationResult;
  assert.equal(evaluatePreview(p).ok, false);
});

test('engellenen önizleme reddedilir', () => {
  assert.equal(evaluatePreview({ success: false, error: { code: 351803, name: 'AGENT_DEV_MODE_RISK_BLOCKED' } }).ok, false);
});

test('değer gönderen işlem reddedilir', () => {
  const p = okPreview();
  p.data.parsedTx.amount = 1000;
  assert.equal(evaluatePreview(p).ok, false);
});

test('mint adayları: payable elenir, öncelik sırası korunur', () => {
  const abi = [
    { type: 'function', name: 'mint', stateMutability: 'payable', inputs: [] },
    { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'freeMint', stateMutability: 'nonpayable', inputs: [] },
    { type: 'function', name: 'mintTo', stateMutability: 'nonpayable', inputs: [{ type: 'address' }] },
    { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }] },
    { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [] },
  ];
  const c = pickMintCandidates(abi, 1);
  assert.deepEqual(c.map((x) => [x.abiItem.name, x.args]), [['freeMint', []], ['mint', [1n]]]);
});

test('hasOutflow pozitifleri yok sayar', () => {
  assert.equal(hasOutflow([{ amount: '1' }, { amount: 2 }]), false);
  assert.equal(hasOutflow([{ direction: 'OUT', amount: '1' }]), true);
});

test('limitler', () => {
  const cfg = { maxMintsPerDay: 2, maxGasBnbPerDay: 0.001 };
  assert.equal(withinLimits({ mints: 1, gasWei: '0' }, cfg).ok, true);
  assert.equal(withinLimits({ mints: 2, gasWei: '0' }, cfg).ok, false);
  assert.equal(withinLimits({ mints: 0, gasWei: String(10n ** 15n) }, cfg).ok, false);
});

test('registry referansı', () => {
  const reg = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
  assert.equal(referencesRegistry('0x6080' + reg.slice(2).toLowerCase() + 'ff', reg), true);
  assert.equal(referencesRegistry('0x6080ff', reg), false);
  assert.equal(referencesRegistry('0x', reg), false);
});
