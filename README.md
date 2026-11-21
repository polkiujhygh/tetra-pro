# 💜 Netra Panel — نسخه Node.js برای Railway / Render و هر سرور Node دیگر

این پکیج، پنل **netra-panel** (که اصلی‌اش برای Cloudflare Workers نوشته شده) را روی **Node.js خالص** اجرا می‌کند — بدون Cloudflare، بدون workerd. پورت شامل سه بخش shim است:

| فایل | نقش |
|---|---|
| `worker.js` | کد اصلی پنل — **دست‌نخورده**، فقط اجرا می‌شود |
| `server.js` | تبدیل HTTP/WebSocket نود به رابط Workers |
| `shims/cf-sockets.mjs` | جایگزین `cloudflare:sockets` (اتصال TCP واقعی) |
| `shims/ws-pair.mjs` | جایگزین `WebSocketPair` با کتابخانه `ws` |
| `shims/kv.mjs` | جایگزین Workers KV (ذخیره در فایل JSON) |
| `loader.mjs` + `hooks.mjs` | هدایت `import "cloudflare:sockets"` به shim |

تست‌های انجام‌شده روی همین پورت: ✅ بارگذاری پنل و صفحه لاگین، ✅ تونل VLESS روی WebSocket، ✅ تونل Trojan روی WebSocket، ✅ ذخیره‌سازی KV و بقای آن بعد از ری‌استارت.

---

## 🚀 راه‌اندازی سریع (لوکال یا هر سرور Node)

```bash
npm install
npm start          # پیش‌فرض روی پورت 3000 (با متغیر PORT قابل تغییر)
```

سپس پنل را باز کنید: `http://localhost:3000/netra/panel`
(مسیر امن پیش‌فرض `netra` است؛ می‌توانید با متغیر محیطی `SUB_PATH` عوضش کنید.)

### متغیرهای محیطی (اختیاری)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PORT` | `3000` | پورت HTTP — روی Railway/Render خودکار ست می‌شود |
| `KV_PATH` | `./data/kv.json` | محل فایل KV |
| `SUB_PATH` | `netra` | مسیر امن پنل |
| `UUID` | `89b3cbba-...-4020` | UUID پروتکل VLESS |
| `TR_PASS` | `netra` | پسورد پروتکل Trojan |
| `CF_ACCOUNT_ID` / `CF_EMAIL` / `CF_API_TOKEN` | خالی | فقط برای قابلیت‌های ابری Cloudflare (WARP و...) |

---

## 🎨 دیپلوی روی Render (رایگان)

1. محتوای این پوشه را در یک ریپوی GitHub جدید push کنید (ساختار: `worker.js`, `server.js`, `shims/`, `hooks.mjs`, `loader.mjs`, `package.json`, `Dockerfile`, `render.yaml`).
2. در [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → ریپو را انتخاب کنید. فایل `render.yaml` همه‌چیز را خودکار می‌سازد.
   (یا دستی: **New → Web Service** → Runtime = `Docker` → Plan = `Free`.)
3. بعد از Build، آدرس `https://<اسم-اپ>.onrender.com/netra/panel` را باز کنید. تمام!

**نکات مهم Render:**
- پلن رایگان بعد از ~۱۵ دقیقه بی‌کاری می‌خوابد؛ اولین اتصال بعد از خواب ۳۰–۶۰ ثانیه طول می‌کشد. برای بیدار ماندن، یک UptimeRobot هر ۵ دقیقه به `https://<اسم-اپ>.onrender.com/` پینگ بزند کافی است.
- دیسک پلن رایگان **ephemeral** است: با هر redeploy تنظیمات پنل پاک می‌شود. راه حل: از پایپ‌لاین استفاده نکنید و تغییرات را از خود پنل اعمال کنید، یا یک paid disk اضافه کنید و `KV_PATH` را به مسیر دیسک بدهید.

## 🚂 دیپلوی روی Railway

1. ریپو را بسازید (مثل بالا). Railway فایل `railway.json` و `Dockerfile` را خودکار تشخیص می‌دهد.
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. بعد از Deploy: **Settings → Networking → Generate Domain** تا آدرس عمومی بگیرید.
4. پنل: `https://<اسم-سرویس>.up.railway.app/netra/panel`

**نکات مهم Railway:**
- Railway دیگر پلن رایگان دائمی ندارد؛ حساب جدید یک اعتبار تست یک‌بار مصرف (حدود ۵ دلار) می‌گیرد. مصرف این پنل بسیار کم است ولی بعد از پایان اعتبار باید پلن Hobby فعال شود.
- برای ماندگاری تنظیمات: **Service → Volumes** یک Volume به `/app/data` وصل کنید (فایل KV همان‌جاست).
- پورت خودکار: Railway متغیر `PORT` را خودش ست می‌کند؛ کاری لازم نیست.

## ☁️ اگر همان Cloudflare را می‌خواهید — رفع خطای 1101

خطای 1101 یعنی «Worker در حین اجرا exception پرتاب کرده». برای این پنل دو عامل مشخص دارد:

**عامل ۱ — پرچم `nodejs_compat` فعال نیست (علت اصلی 1101):**
کد پنل `node:crypto` را import می‌کند؛ بدون این پرچم Worker اصلاً بالا نمی‌آید و همه درخواست‌ها 1101 می‌شوند.

1. داشبورد Cloudflare → **Workers & Pages** → وارکر خودتان
2. **Settings** → قسمت **Compatibility flags** → بنویسید و اضافه کنید: `nodejs_compat`
3. مطمئن شوید **Compatibility date** جدید است (مثلاً `2025-01-01` یا بعدتر)
4. **Deploy** بزنید

**عامل ۲ — بایندینگ KV به نام دقیق `kv`:**
اگر 1101 ندارید ولی صفحه خطای `TypeError: Cannot read properties of undefined (reading 'get')` می‌بینید، یعنی KV وصل نیست:

1. **Storage & Databases → KV** → یک Namespace جدید بسازید (اسم دلخواه)
2. برگردید به Worker → **Settings → Bindings → Add binding → KV Namespace**
3. Variable name را **دقیقاً** `kv` بگذارید (کوچک، بدون فاصله) و همان Namespace را انتخاب کنید
4. **Deploy** بزنید

سپس آدرس پنل: `https://<اسم-ورکر>.<زیر-دامنه>.workers.dev/netra/panel`

---

## 🔒 بعد از اولین ورود

- در صفحه `/{مسیر-امن}/login` یا رمز بگذارید یا **Skip** بزنید (فقط برای تست توصیه می‌شود؛ با Skip هر کسی که آدرس را بداند وارد می‌شود).
- قبل از اشتراک‌گذاری لینک subscription، **UUID و پسورد Trojan و مسیر امن** را از داخل پنل عوض کنید.
- آدرس پنل را مثل رمز محرمانه نگه دارید.

## 🧪 تست‌های همراه پکیج

```bash
node test_vless_ws.mjs     # تونل واقعی VLESS → example.com:80
node test_trojan_ws.mjs    # تونل واقعی Trojan → example.com:80
```
(سرور باید اول با `npm start` بالا آمده باشد.)

## ⚠️ ملاحظات

- برخی سرویس‌های PaaS در شرایط استفاده از ترافیک پراکسی محدودیت دارند؛ این پکیج را صرفاً روی اکانت خودتان و مسئولیت خودتان اجرا کنید.
- دامنه‌های رایگان (`onrender.com`، `up.railway.app`) ممکن است در برخی شبکه‌ها فیلتر باشند؛ در صورت نیاز دامنه اختصاصی به سرویس وصل کنید (Render رایگان هم Custom Domain دارد).
- برای عبور از CDN/پروکسی خود پلتفرم، کلاینت‌ها باید از مسیرهای `/vl` و `/tr` با همان تنظیمات پنل استفاده کنند.

---

# 🇬🇧 English (summary)

Node.js port of the Cloudflare-Workers **netra-panel** (VLESS/Trojan over WebSocket, web panel, KV storage). Runs with plain Node ≥ 20 — `npm install && npm start`, panel at `/netra/panel` (default secure path `netra`).

**Render:** push this folder to GitHub → Render → New → Blueprint (uses `render.yaml`, Docker runtime, free plan) → open `https://<app>.onrender.com/netra/panel`. Free plan sleeps after ~15 min idle; ping with UptimeRobot. Free disk is ephemeral — panel settings reset on redeploy.

**Railway:** Deploy from GitHub repo (auto-detects `railway.json` + `Dockerfile`) → Generate Domain → `https://<svc>.up.railway.app/netra/panel`. Attach a Volume at `/app/data` for persistent settings. Trial credit is one-time (~$5), not a permanent free plan.

**Cloudflare 1101 fix (original platform):** add compatibility flag `nodejs_compat` (the code imports `node:crypto` — without the flag every request returns 1101), and bind a KV namespace with the variable name **exactly** `kv` (missing KV shows "TypeError ... reading 'get'" instead). Panel URL: `https://<worker>.workers.dev/netra/panel`.

**Env vars:** `PORT`, `KV_PATH`, `SUB_PATH` (default `netra`), `UUID`, `TR_PASS`, `CF_ACCOUNT_ID`/`CF_EMAIL`/`CF_API_TOKEN` (optional, only for Cloudflare API features).
