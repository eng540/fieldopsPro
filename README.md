# --- FieldOps V4.0 — منصة العمليات الميدانية المتقدمة

> نظام إنتاج جاهز (Production-Ready) — FastAPI + PostgreSQL + Redis + Next.js 16 + Docker Compose

## 🏗️ العمارة

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Next.js    │────▶│   FastAPI    │────▶│  PostgreSQL  │
│  (Frontend)  │     │  (Backend)   │     │  16 + RLS    │
│  Port: 3000  │     │  Port: 8000  │     │  Port: 5432  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                           │
                     ┌─────┴──────┐
                     │   Redis 7   │
                     │  (Cache)    │
                     │  Port: 6379 │
                     └────────────┘
```

## 📁 هيكل المشروع

```
├── src/                          # Next.js Frontend
│   ├── app/                      # App Router
│   ├── components/fieldops/      # مكونات النظام
│   └── lib/
│       ├── api-client.ts         # عميل API (FastAPI)
│       ├── auth-store.ts         # إدارة المصادقة (JWT)
│       └── offline-db.ts         # IndexedDB (Dexie)
├── backend/                      # FastAPI Backend
│   ├── app/
│   │   ├── core/                 # الإعدادات الأساسية
│   │   │   ├── config.py         # إعدادات التطبيق
│   │   │   ├── database.py       # SQLAlchemy + PostgreSQL
│   │   │   ├── security.py       # JWT + bcrypt
│   │   │   ├── rls_middleware.py # Row-Level Security
│   │   │   └── redis_client.py   # Redis cache
│   │   └── modules/
│   │       ├── iam/              # المصادقة والصلاحيات
│   │       ├── projects/         # المشاريع والوحدات
│   │       ├── execution/        # التنفيذ الميداني
│   │       ├── sync/             # محرك المزامنة
│   │       ├── quality/          # مراقبة الجودة
│   │       ├── governance/       # محرك الحوكمة
│   │       └── reporting/        # التقارير
│   ├── alembic/                  # Migrations
│   └── scripts/seed.py           # بيانات تجريبية
├── docs/openapi/openapi.yaml     # عقدة API
├── infrastructure/docker/        # Dockerfiles
├── docker-compose.yml            # Docker Compose
├── .env.example                  # متغيرات البيئة
└── Makefile                      # أوامر التطوير
```

## 🚀 التشغيل السريع

### المتطلبات
- Docker + Docker Compose
- Node.js 20+
- Python 3.12+

### التشغيل بـ Docker Compose

```bash
# 1. إعداد متغيرات البيئة
cp .env.example .env
# عدّل .env وضع كلمات مرور آمنة

# 2. تشغيل جميع الخدمات
docker compose up --build

# 3. تهيئة قاعدة البيانات
docker compose exec api python -m scripts.seed
```

### التشغيل المحلي (للتطوير)

```bash
# 1. شغّل PostgreSQL + Redis
docker compose up postgres redis

# 2. شغّل FastAPI
cd backend
pip install -r requirements.txt  # أو: poetry install
uvicorn app.main:app --reload --port 8000

# 3. شغّل Next.js
npm run dev

# 4. تهيئة البيانات التجريبية
cd backend && python -m scripts.seed
```

## 🔐 المصادقة

- **JWT Access Token**: 15 دقيقة، في الذاكرة فقط
- **Refresh Token**: 7 أيام، HttpOnly Cookie (مع التدوير)
- **الجلسات**: مسجلة في PostgreSQL + مُخزّنة مؤقتاً في Redis
- **RLS**: PostgreSQL Row-Level Security حسب `org_id`

### الحسابات التجريبية

| البريد | كلمة المرور | الدور |
|--------|-------------|-------|
| admin@fieldops.sa | demo1234 | مدير النظام الأعلى |
| orgadmin@fieldops.sa | demo1234 | مدير المنظمة |
| pm@fieldops.sa | demo1234 | مدير مشروع |
| field@fieldops.sa | demo1234 | مهندس ميداني |
| viewer@fieldops.sa | demo1234 | مشاهد |

## 🔄 محرك المزامنة (Offline-First)

- **Pull**: `POST /api/v1/sync/pull` — تنزيل بيانات الخادم
- **Push**: `POST /api/v1/sync/push` — رفع العمليات المعلقة
- **Exactly-Once**: `operation_uuid` deduplication (72h window)
- **Monotonic Progress**: نسبة الإنجاز لا يمكن أن تنخفض
- **207 Multi-Status**: معالجة التعارضات الجزئية
- **IndexedDB**: Dexie.js للتخزين المحلي

## 📋 أوامر Makefile

```bash
make help          # عرض جميع الأوامر
make dev           # تشغيل Docker Compose
make seed          # تهيئة البيانات التجريبية
make migrate       # تشغيل Alembic migrations
make test          # تشغيل الاختبارات
make build         # بناء الواجهة الأمامية
```

## 🛡️ الحوكمة (Governance)

- كل قرار حوكمة يعيد `{decision, matched_rule, reason, policy_version}`
- WORM Audit Trail — سجلات لا يمكن تعديلها أو حذفها
- RLS في PostgreSQL + تصفية تطبيقية مزدوجة

## 📦 S3 رفع الصور

- رفع الصور عبر `aioboto3` إلى AWS S3
- ممنوع تخزين Base64 في قاعدة البيانات
- المسار: `POST /api/v1/quality/remarks/{id}/photos`
