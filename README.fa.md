# صفحه آپلود و دانلود متصل به Google Drive

یک وب‌اپ Node.js و Express با رابط فارسی و واکنش‌گرا. فایل‌ها در پوشه‌ای که برنامه در Google Drive می‌سازد ذخیره می‌شوند و لینک دانلود مستقیم برای هر فایل نمایش داده می‌شود.

## امکانات

- آپلود با نمایش درصد پیشرفت
- فهرست عمومی فایل‌ها، حجم و تاریخ آپلود
- لینک مستقیم با قالب `https://drive.google.com/uc?export=download&id=FILE_ID`
- کپی لینک و حذف فایل (با رمز مدیریت)
- OAuth گوگل و ذخیره امن توکن روی سرور
- محدودیت حجم آپلود و rate limit پایه

> **مهم درباره عمومی بودن:** با `MAKE_FILES_PUBLIC=true`، هر فایل آپلودشده برای هر کسی که لینک را دارد قابل دسترسی می‌شود. فایل خصوصی، اطلاعات شخصی یا فایل دارای حق نشر را عمومی نکنید. لینک Drive ممکن است برای فایل‌های بسیار بزرگ، سیاست‌های حساب یا محدودیت‌های گوگل به صفحه تأیید هدایت شود؛ بنابراین هیچ سرویس Drive تضمین مطلق برای دانلود مستقیم بدون واسطه نمی‌دهد.

## پیش‌نیاز

- Node.js نسخه 20 یا جدیدتر
- یک حساب Google و دسترسی به Google Cloud Console
- دامنه با HTTPS برای استفاده واقعی در اینترنت (برای OAuth production)
- سرور/VPS لینوکسی

## ۱. ساخت OAuth در Google Cloud

1. وارد [Google Cloud Console](https://console.cloud.google.com/) شوید و یک پروژه بسازید یا انتخاب کنید.
2. از بخش **APIs & Services → Library**، سرویس **Google Drive API** را فعال کنید.
3. در **Google Auth Platform** (یا بخش OAuth consent screen قدیمی)، نام برنامه و ایمیل پشتیبانی را وارد کنید.
4. اگر برنامه روی حالت **Testing** است، حساب گوگلی که می‌خواهید متصل کنید را به‌عنوان **Test user** اضافه کنید. برای استفاده عمومی و گسترده ممکن است لازم باشد وضعیت انتشار/تأیید OAuth را مطابق الزامات گوگل تنظیم کنید.
5. در **Clients** یک OAuth Client بسازید؛ نوع آن **Web application** باشد.
6. در **Authorized redirect URIs** دقیقاً آدرس زیر را اضافه کنید (با توجه به دامنه و پورت خود تغییر دهید):
   - توسعه محلی: `http://localhost:3000/auth/google/callback`
   - سرور: `https://files.example.com/auth/google/callback`
7. Client ID و Client Secret را کپی کنید. Secret را در مرورگر، کد سمت کاربر یا مخزن عمومی قرار ندهید.

این برنامه از scope محدود `drive.file` استفاده می‌کند و پوشه اختصاصی خودش را در Drive ایجاد می‌کند؛ نیازی به دسترسی کامل به همه فایل‌های درایو ندارد.

## ۲. نصب روی VPS

فایل ZIP را روی سرور باز کنید و وارد پوشه پروژه شوید:

```bash
unzip gdrive-upload-download.zip
cd gdrive-upload-download
npm install
cp .env.example .env
nano .env
```

مقادیر `.env` را تنظیم کنید:

```env
PORT=3000
NODE_ENV=production
APP_URL=https://files.example.com
ADMIN_PASSWORD=یک-رمز-تصادفی-طولانی-حداقل-۱۶-کاراکتر
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://files.example.com/auth/google/callback
MAX_FILE_SIZE_MB=100
DRIVE_FOLDER_NAME=Public Downloads
MAKE_FILES_PUBLIC=true
```

`ADMIN_PASSWORD` را با یک رمز تصادفی طولانی جایگزین کنید. رمز مدیریت را در اختیار بازدیدکنندگان قرار ندهید؛ هر کسی آن را داشته باشد می‌تواند آپلود یا حذف کند. از قرار دادن `.env` در Git خودداری کنید.

سپس اجرا کنید:

```bash
npm start
```

برای سرویس دائمی، می‌توانید از PM2 استفاده کنید:

```bash
sudo npm install -g pm2
pm2 start server.js --name gdrive-files
pm2 save
pm2 startup
```

دستور نهایی `pm2 startup` یک دستور دیگر چاپ می‌کند؛ همان دستور چاپ‌شده را نیز اجرا کنید.

## ۳. HTTPS و دامنه

برای سایت عمومی، دامنه را به IP سرور متصل کنید و Nginx یا یک reverse proxy مشابه را با گواهی TLS تنظیم کنید. پورت عمومی HTTPS باید به برنامه روی `127.0.0.1:3000` یا پورت داخلی آن reverse proxy شود. سپس مقدار `APP_URL` و `GOOGLE_REDIRECT_URI` را با آدرس HTTPS واقعی یکسان کنید. اگر پورت 3000 را مستقیم روی اینترنت باز می‌کنید، حتماً فایروال و HTTPS را جداگانه تنظیم کنید؛ برای استفاده عمومی توصیه نمی‌شود.

نمونه حداقلی Nginx (مسیر گواهی‌ها را مطابق سرور خود تنظیم کنید):

```nginx
server {
    listen 443 ssl http2;
    server_name files.example.com;

    ssl_certificate /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

برای دریافت گواهی رایگان، می‌توانید از Certbot/Let's Encrypt استفاده کنید. پیش از راه‌اندازی، پیکربندی Nginx و گواهی را اعتبارسنجی کنید.

## ۴. اتصال Google Drive

1. سایت را باز کنید.
2. روی **اتصال Google Drive** کلیک کنید.
3. با حساب گوگلی که می‌خواهید فایل‌ها در آن ذخیره شوند وارد شوید و مجوزهای درخواستی را تأیید کنید.
4. پس از برگشت به سایت، وضعیت اتصال نمایش داده می‌شود.
5. رمز مدیریت را وارد کنید و فایل را آپلود کنید.

برنامه در اولین آپلود، پوشه `Public Downloads` (یا نامی که در `DRIVE_FOLDER_NAME` گذاشته‌اید) را می‌سازد. توکن در `data/google-token.json` با مجوز فایل محدود ذخیره می‌شود؛ از آن پشتیبان امن بگیرید و هرگز منتشرش نکنید. کل پوشه `data/` را عمومی سرو نکنید.

## ۵. لینک مستقیم

بعد از آپلود، دکمه «دانلود مستقیم» و «کپی لینک» نمایش داده می‌شود. فرمت لینک:

```text
https://drive.google.com/uc?export=download&id=FILE_ID
```

برنامه برای هر فایل مجوز `anyone: reader` می‌سازد، اگر `MAKE_FILES_PUBLIC=true` باشد. در حساب‌های Workspace یا محیط‌هایی که اشتراک‌گذاری عمومی مسدود شده است، ممکن است این کار از طرف سیاست مدیر گوگل رد شود.

## ۶. مدیریت و نگهداری

- `GET /health` وضعیت زنده ساده سرور را می‌دهد.
- `GET /api/status` وضعیت اتصال و محدودیت حجم را می‌دهد.
- `data/files.json` فهرست فایل‌هایی را که این برنامه آپلود کرده نگه می‌دارد.
- حذف از رابط، فایل را از Google Drive نیز حذف می‌کند.
- برای قطع اتصال، برنامه را متوقف و فایل `data/google-token.json` را حذف کنید؛ در صورت نیاز مجوز برنامه را نیز از تنظیمات امنیت حساب گوگل لغو کنید.
- از `.env` و `data/` نسخه پشتیبان رمزگذاری‌شده بگیرید. فایل‌های داخل `uploads/` فقط موقت هستند و بعد از پایان آپلود حذف می‌شوند.

## عیب‌یابی

- **redirect_uri_mismatch:** آدرس redirect در Cloud Console باید دقیقاً با `GOOGLE_REDIRECT_URI` برابر باشد.
- **Access blocked / app not verified:** در حالت Testing، حساب را به Test users اضافه کنید؛ برای انتشار عمومی الزامات OAuth گوگل را بررسی کنید.
- **insufficient permissions / sharing restricted:** سیاست حساب گوگل یا Workspace ممکن است اشتراک‌گذاری عمومی را مسدود کرده باشد.
- **فایل‌های بزرگ:** `MAX_FILE_SIZE_MB` و `client_max_body_size` در Nginx را هماهنگ کنید؛ محدودیت‌های Google Drive همچنان اعمال می‌شود.
- **لینک مستقیم صفحه تأیید نشان می‌دهد:** این رفتار ممکن است برای فایل بزرگ یا محدودیت‌های گوگل رخ دهد و از سمت این برنامه قابل تضمین نیست.

## نکته امنیتی

این پروژه نمونه آماده اجراست، اما پیش از ارائه عمومی آن را روی سرور واقعی آزمایش کنید. برای بارگذاری گسترده یا استفاده چندمدیره، بهتر است رمز مدیریت با سامانه کاربران، ثبت رویدادها، محدودیت نرخ مجزا برای آپلود و مانیتورینگ تکمیل شود.
