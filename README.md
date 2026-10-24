# 🏛️ متحف السلالات الكبرى | Museum of the Great Dynasties

[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-blue?style=for-the-badge&logo=github)](https://0xenki.github.io/Museum-of-the-Great-Dynasties/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active%20Development-brightgreen?style=for-the-badge)](#)
[![Stack](https://img.shields.io/badge/Stack-HTML5%20%7C%20CSS3%20%7C%20JS--ES6+-orange?style=for-the-badge)](#)

> **منصة رقمية وسينمائية تفاعلية لإحياء الفن، الآثار، والتاريخ العراقي العريق في تجربة مستخدم مبهرة.**

---

## 📖 جدول المحتويات (Table of Contents)
- [نظرة عامة](#-نظرة-عامة-overview)
- [المميزات الرئيسية](#-المميزات-الرئيسية-key-features)
- [العرض والتصميم والتفاعل](#-العرض-والتصميم-والتفاعل)
- [هيكلية المشروع](#-هيكلية-المشروع-project-structure)
- [التقنيات وبنية المكونات](#-التقنيات-وبنية-المكونات-tech-stack)
- [التثبيت والتشغيل المحلي](#-التثبيت-والتشغيل-المحلي-getting-started)
- [إعدادات النشر](#-إعدادات-النشر-deployment)
- [دليل المساهمة](#-دليل-المساهمة-contributing)
- [الترخيص](#-الترخيص-license)

---

## 🌟 نظرة عامة (Overview)

يهدف مشروع **متحف السلالات الكبرى** إلى تحويل التجربة المتحفية التقليدية إلى معرض رقمي غني بالوسائط والتفاعلية. يستعرض المشروع الحضارات العراقية القديمة (السومرية، الأكدية، البابلية، والآشورية) بالإضافة إلى الفنون الكلاسيكية والمعاصرة من خلال الواجهات الحديثة والنوافذ التفاعلية.

---

## ✨ المميزات الرئيسية (Key Features)

### 🎬 1. واجهة العرض السينمائية (Dynamic Hero Choreography)
- خلفيات مرئية وسينمائية متغيرة بتأثيرات بصرية سلاسة.
- نصوص استكشافية تدعم التصفح التفاعلي الفوري.

### 📜 2. معرض الشخصيات التاريخية (Historical Figures Slider)
- استعراض لأبرز القادة والعلماء والشخصيات المؤثرة.
- بطاقات تفاعلية مزودة بسلايدر سلس وسريع الاستجابة.

### 🖼️ 3. قاعات المعارض المتخصصة (Specialized Galleries)
- **قاعة الفن الكلاسيكي (`classical-hall.html`):** استعراض لأجمل اللوحات والفنون الكلاسيكية العالمية والعراقية.
- **قاعة الفن المعاصر (`contemporary-hall.html`):** تسليط الضوء على الإبداعات الفنية الحديثة والمعاصرة.
- **قاعة المنحوتات التاريخية (`sculpture-hall.html`):** استعراض التماثيل والألواح والمنحوتات الأثرية بحجم دقيق وإضاءة ممتازة.

### 🔍 4. نظام البطاقات المنبثقة الشامل (Interactive Modal System)
- إمكانية الضغط على أي عنصر أثري لمشاهدة تفاصيله الكاملة (الوصف التاريخي، العصر، المادة، الموقع الأصلي).
- تصميم أنيق مع خلفيات غائمة (Backdrop Blur) لتجربة تركيز عالية.

### 🏷️ 5. السجل الرقمي والمقتنيات (Digital Inventory System)
- جدول مقتنيات متكامل يحتوي على معرفات استجابة سريعة (QR Barcodes).
- تتبع حالة المقتنيات (معروضة، تحت الترميم، قيد الأرشيف).

---

## 📁 هيكلية المشروع (Project Structure)

```bash
Museum-of-the-Great-Dynasties/
├── 📂 classical/              # الوسائط والصور الخاصة بالفن الكلاسيكي
├── 📂 contemporary/           # الموارد والصور الخاصة بالفن المعاصر
├── 📂 data/                   # بيانات JSON وملفات البيانات الهيكلية
├── 📂 gold/                   # المجوهرات والآثار الذهبية
├── 📂 sculpture/              # صور ومعلومات قاعة المنحوتات
├── 📂 شخصيات عرفها التاريخ/    # صور وأرشيف الشخصيات التاريخية
├── 📄 .gitignore              # تحديد الملفات المستثناة من تتبع Git
├── 📄 LICENSE                 # رخصة المشروع (MIT)
├── 📄 index.html              # الصفحة الرئيسية للمتحف
├── 📄 classical-hall.html     # صفحة قاعة الفن الكلاسيكي
├── 📄 contemporary-hall.html  # صفحة قاعة الفن المعاصر
├── 📄 sculpture-hall.html     # صفحة قاعة المنحوتات
├── 📄 style.css               # ملف التنسيقات والأنماط الرئيسية (CSS3)
├── 📄 script.js               # البرمجة التفاعلية وإدارة المنطق (JS)
├── 📄 firebase.json           # إعدادات النشر والاستضافة على Firebase
└── 📄 vercel.json             # إعدادات النشر على منصة Vercel
```

---

## 🛠️ التقنيات وبنية المكونات (Tech Stack)

| التقنية | الاستخدام |
| :--- | :--- |
| **HTML5** | الهيكلية العامة مع الالتزام بمعايير الوصولية (Accessibility) ودعم العربية (RTL). |
| **CSS3** | تصميم الاستجابة الكاملة (Flexbox/Grid)، والمتغيرات (CSS Variables)، والانتقالات السلسة. |
| **JavaScript (ES6+)** | التحكم بالمعارض، أحداث المودال (Modals)، التفاعلات والتنقل بين الصفحات. |
| **Firebase Hosting** | إعدادات الجاهزية للنشر السريع وتوفير الأداء العالي. |
| **Vercel / GitHub Pages** | النشر المباشر والتكامل مع مستودع Git. |

---

## 🚀 التثبيت والتشغيل المحلي (Getting Started)

### المتطلبات الأساسية
- متصفح ويب حديث (Chrome, Firefox, Edge, Safari).
- محرر أكواد مثل [VS Code](https://code.visualstudio.com/).

### خطوات التشغيل:

1. **استكشاف المستودع (Clone Repository):**
   ```bash
   git clone https://github.com/0xEnki/Museum-of-the-Great-Dynasties.git
   ```

2. **الانتقال إلى مجلد المشروع:**
   ```bash
   cd Museum-of-the-Great-Dynasties
   ```

3. **التشغيل عبر خادم محلي (Local Server):**
   - باستخدام إضافة **Live Server** في VS Code:
     انقر بزر الماوس الأيمن على `index.html` واختر **Open with Live Server**.
   - أو باستخدام Python (في حال رغبتك بخادم سريع):
     ```bash
     python -m http.server 8000
     ```
     ثم قم بزيارة: `http://localhost:8000`

---

## 🌐 إعدادات النشر (Deployment)

المشروع معد مسبقاً للنشر عبر عدة منصات:

### 1. GitHub Pages
المشروع يعمل تلقائياً عند التفعيل من إعدادات المستودع `Settings -> Pages`.

### 2. Vercel
يحتوي المشروع على ملف `vercel.json` جاهز، يمكنك ربط المستودع مباشرة بـ Vercel لإجراء النشر الآلي عند كل `push`.

### 3. Firebase Hosting
يمكنك النشر عبر أدوات Firebase CLI:
```bash
firebase login
firebase deploy
```

---

## 🤝 دليل المساهمة (Contributing)

المساهمات مرحب بها دائماً! لتطوير هذا المشروع:

1. اعمل Fork للمستودع.
2. أنشئ فرعاً لميزتك الجديد (`git checkout -b feature/AmazingFeature`).
3. احفظ التغييرات (`git commit -m 'Add some AmazingFeature'`).
4. ارفع التغييرات إلى الفرع (`git push origin feature/AmazingFeature`).
5. افتح طلب سحب (Pull Request).

---

## 📜 الترخيص (License)

هذا المشروع مرخص تحت رخصة **MIT** - يرجى مراجعة ملف [LICENSE](LICENSE) لمزيد من التفاصيل.

---

<p center="align">
  تم تطوير المشروع بروح الشغف للفن والحضارة العريقة 🏛️✨
</p>
