# agent-mint-bot

BSC'de yeni yayınlanan kontratları izler, içinde Binance **Agent ID** registry'si
(`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`) geçenleri aday sayar ve **sabit kurallardan**
geçerse Binance Agentic Wallet (`baw` CLI) ile ücretsiz mint eder. Her adımda Telegram'a bildirim atar.

X/Twitter okumaz, LLM kullanmaz. Karar tamamen koddaki kurallara bağlıdır, bu yüzden bir tweet ya da
kontrat açıklaması bota talimat veremez.

## Bir kontrat mint edilmeden önce

1. Kodunda Agent ID registry adresi geçmeli.
2. Kaynak kodu Sourcify'da (ya da anahtar verilirse BscScan'de) doğrulanmış olmalı. Proxy kontratlar atlanır.
   Doğrulanmamışsa 5 dakikada bir, en fazla 6 saat tekrar denenir.
3. ABI'de **payable olmayan**, parametresiz ya da tek `uint` alan bir `freeMint` / `mintFree` / `mint` / `claim`… fonksiyonu olmalı.
4. Cüzdanda o koleksiyondan zaten olmamalı.
5. Zincirde `value = 0` ile simülasyon başarılı olmalı.
6. Günlük mint ve gas tavanı dolmamış, BNB bakiyesi rezervin üstünde olmalı.
7. `baw contract-call preview` sonucunda: simülasyon hatası yok, **approve / allowance yok, yetki değişimi yok,
   cüzdandan hiçbir çıkış yok, gönderilen değer 0, risk uyarısı yok, uygulama onayı gerekmiyor.**
   Beklenmedik ya da eksik bir alan varsa cevap "hayır"dır.

Sadece hepsi geçerse `baw contract-call execute` çağrılır. Mint'ler tek sırayla gönderilir, aynı kontrat iki kez denenmez.
Gönderim sırasında bot çökerse o kontrat tekrar denenmez, Telegram'dan haber verilir.

## Kurulum (Railway)

1. Bu repoyu GitHub'a yükle, Railway'de **New Project → Deploy from GitHub repo** ile bağla. Dockerfile otomatik kullanılır.
2. Servise bir **Volume** ekle, mount path: `/data`. (Cüzdan oturumu ve durum dosyası burada durur.)
3. Değişkenleri gir: `.env.example` dosyasındakiler. En az `AGENT_WALLET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
   `DRY_RUN=true` ile başla.
4. Deploy bitince Telegram'a "Bot başladı" mesajı gelir. **/giris** yaz: bot bir link ve eşleşme kodu gönderir.
   Linki telefonda aç, Binance uygulamasında kod aynıysa onayla.
5. Binance uygulamasında Agentic Wallet ayarlarından **Developer Mode** açık olmalı.

Birkaç gün `DRY_RUN=true` ile izle. "[DENEME] Mint edilebilirdi" bildirimleri mantıklı görünüyorsa
Railway'de `DRY_RUN=false` yap.

## Telegram komutları

| Komut | Ne yapar |
|---|---|
| `/durum` | Mod, bugünkü mint/gas, bakiye, sayaçlar |
| `/son` | Son 10 kontrat ve sonucu |
| `/dur` / `/devam` | Mint'i duraklat / sürdür |
| `/giris` | Cüzdan oturumunu yenile (link + eşleşme kodu) |

Bot oturum kapanmak üzereyken ve Developer Mode bitmek üzereyken haber verir.

## Tek kontrat test etmek (işlem göndermez)

```bash
npm install
cp .env.example .env   # AGENT_WALLET'ı doldur
export $(grep -v '^#' .env | xargs)
npm run check -- 0x48ab7d1eddc73b329f9db049b846d547092e77df
```

Bu komut doğrulama, simülasyon ve Binance önizlemesini çalıştırıp kural motorunun kararını yazdırır.
Önizleme için makinede `baw` oturumunun açık olması gerekir.

## Güvenlik

- Agentic Wallet'ta **sadece birkaç dolarlık BNB** tut ve Binance uygulamasından **Developer Mode günlük limitini** düşük ayarla.
  Sunucu ele geçirilirse kayıp bu tutarla sınırlı kalır.
- Railway değişkenlerine cüzdanla ilgili gizli bilgi girilmez. Oturum `baw` tarafından `/data/baw` içinde tutulur.
- `npm test` kural motorunun birim testlerini çalıştırır.

## Bilinen sınırlar

- Sadece doğrudan yayınlanan kontratları görür. Bir fabrika kontratının içeriden oluşturduğu kontratları kaçırır.
- Kaynağını hiç doğrulamayan projeler atlanır.
- `balanceChanges` alanının tam şekli Binance tarafından belgelenmemiş. Bot negatif miktar ya da "out" yönü
  gördüğü her şeyi reddeder. İlk günlerde `/son` çıktısını kontrol et.
- Mint edilen NFT/tokenlerin değeri garanti değil. Bot satış yapmaz.
