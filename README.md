# Logo Hazırlayıcı

Operasyon ekibinin marka logolarını müşterinin istediği boyutlara (ör. Cadooz: 600×378, 200×126, 124×124, 75×75 – JPG, 72 dpi, köşesiz) hazırlaması için tarayıcıda çalışan araç. Sunucu yok; dosyalar hiçbir yere gönderilmez.

## Ne yapar
- **Yükleme:** SVG (önerilen), PNG, JPG, WEBP – sürükle-bırak, tıkla veya Ctrl+V.
- **Otomatik kırpma:** Logonun etrafındaki boşluk/zemin atılır.
- **Çerçeveye oturtma:** Oran korunarak her boyutta mümkün olan en büyük hâlde ortalanır (kenar boşluğu ayarlanabilir).
- **Çözünürlük:** Kaynak küçükse kademeli büyütme + akıllı keskinleştirme; büyükse kaliteli küçültme.
- **Kalite kontrolü ve öneriler** (her boyut için ayrı):
  - büyütme oranı / düşük çözünürlük, bulanıklık (kenar geçiş genişliği), JPEG sıkıştırma izi
  - logo-çerçeve oran uyumsuzluğu ve doluluk (ör. kare boyut için ikon versiyonu önerisi)
  - zemin-logo kontrastı, kaynak zemini ile çerçeve rengi uyumsuzluğu
  - **yuvarlatılmış köşe tespiti** → tek tıkla çerçeveyi zemin rengiyle doldurup köşeleri düzleştirme
  - Önerilerin çoğunda tek tıklık “düzelt” butonu vardır.
- **Arka plan temizleme (isteğe bağlı):** Kenarlardan düz renk zemini siler, kenar yumuşatmasını korur; tolerans ve “harf içi boşluklar” seçenekleri.
- **Çıktı:** JPG veya PNG, DPI meta verisi (varsayılan 72) dosyaya yazılır. Tek tek ya da tümü ZIP olarak indirilebilir. Özel boyut eklenebilir.

## Çalıştırma
ES modülleri kullandığı için `index.html` dosyaya çift tıklayarak değil, bir web sunucusundan açılmalı:

```bash
npx serve .          # veya: python3 -m http.server
```

Ekip kullanımı için en kolayı **GitHub Pages**: Settings → Pages → bu branch / root.

## Test
```bash
npx serve -l 8123 . &
node tests/smoke.mjs   # playwright gerekir
```
