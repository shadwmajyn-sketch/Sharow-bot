# Diablos Messenger Bot

بوت Node.js لإدارة أوامر المجموعات ومراقبة كنية حساب البوت على Messenger عبر `ws3-fca`.

## التشغيل

- `pnpm start` — تشغيل عامل البوت من جذر مساحة العمل.
- `pnpm --filter @workspace/scripts test` — اختبارات الأوامر والمحاكاة المحلية.
- `pnpm run typecheck` — فحص TypeScript لمساحة العمل.
- `pnpm run build` — فحص وبناء الحزم.

العامل لا يفتح منفذ ويب. يحتاج `FACEBOOK_DEVELOPER_ID` و`FACEBOOK_APPSTATE_JSON`؛ خزّن جلسة Facebook في Secrets/متغير سري، ولا تحفظها في Git. يستطيع `DIABLOS_DATA_DIR` نقل حالة البوت ونسخ الحماية إلى مجلد دائم على استضافات مثل Railway.

## البنية

- `scripts/src/diablos/index.js` — اتصال Messenger، تحميل الأوامر ومعالجة الأحداث.
- `scripts/src/diablos/cmd/` — وحدات الأوامر.
- `scripts/src/diablos/lib/` — إعداد الجلسة والحالة والحماية والكنية الثابتة.
- `scripts/src/diablos/data/` و`Nike/` — حالة محلية ونسخ الحماية، مستثناة من Git.
- `artifacts/api-server/` و`artifacts/mockup-sandbox/` — خدمتا API ومعاينة مكونات، منفصلتان عن عامل Messenger.

تظل صلاحيات المنصة نفسها سارية؛ إزالة فحص المشرف من الكود لا تجعل Facebook يقبل عملية يرفضها حساب البوت.
