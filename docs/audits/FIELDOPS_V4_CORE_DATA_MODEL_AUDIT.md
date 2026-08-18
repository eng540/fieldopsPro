# FieldOps V4 Core Data Model Audit

## نطاق التدقيق

هذا التدقيق يثبت بنية الكود في commit الأصل `6dbb0931e79a7ca1ce4febdbac45190aadd10a4e` على فرع `fieldops-v4`. لا تُعد أعداد الإنتاج أو مشروع Mhsam أو QA Demo مثبتة هنا إلا بعد استعلام حي مصادق عليه؛ لذلك يفصل هذا الملف بين **Code Evidence** و**Runtime Evidence**.

## النتيجة المعمارية

النموذج المقصود في الكود هو:

```text
Project
├── ProjectUnit
├── BOQItem (project-scoped Master BOQ)
└── UnitBoQAssignment (applicability + planned quantity)
       ↓
ExecutionEvent (WORM source of truth)
       ↓
UnitBoQProgress (materialized current state)
       ↓
Project/Unit/BOQ rollups
```

## مصفوفة الكيانات

| الكيان | Model/Table | Migration evidence | API evidence | Frontend consumer | Relationship | حالة التدقيق |
|---|---|---|---|---|---|---|
| Project | `Project` / `projects` | project migrations | `/projects` | ProjectsScreen, Dashboard | org-scoped root | مثبت بالكود |
| Unit | `ProjectUnit` / `project_units` | project migrations | `/projects/{id}/units` | ProjectsScreen, SpeedEntryGrid | belongs to Project | مثبت بالكود |
| Master BOQ | `BOQItem` / `boq_items` | `sprint9_project_scoped_boq` | `/projects/{id}/boq`, canonical BOQ | Project Configuration, SpeedEntryGrid | belongs to Project | مثبت بالكود |
| Assignment | `UnitBoQAssignment` / `unit_boq_assignments` | `sprint9`, `sprint10`, `sprint11` | apply/unapply and explicit assignment routes | canonical hydration, SpeedEntryGrid | Unit × BOQ unique pair | مثبت بالكود |
| Execution Event | `ExecutionEvent` / `execution_events` | `sprint6_epic1_events` | `/execution/events`, history | execution-client, Operations | WORM event ledger | مثبت بالكود |
| Progress | `UnitBoQProgress` / `unit_boq_progress` | `sprint4`, `sprint6`, `sprint12` | `/execution/state`, legacy progress | SpeedEntryGrid, aggregation | one row per Unit × BOQ | مثبت بالكود |
| Work Order | `WorkOrder` / `work_orders` | execution migrations | `/execution/work-orders` | WorkOrdersScreen | project/unit execution task | مثبت بالكود |
| Quality | `Remark` and templates | quality migrations | `/quality/remarks`, `/quality/templates`, photos | QualityScreen | project/unit, optionally work order | مثبت جزئيًا حتى اختبار السلوك |
| Diary | field diary model | field diary migrations | `/field-diary` | Field Diary screen | project/user/day | مثبت؛ offline gap محتمل |
| Sync | Event sync + generic sync | sync migrations | `/sync/pull`, `/sync/push` | api-client, sync hooks | idempotency/conflict | موجود؛ يحتاج توحيد progress/diary |
| Reporting | reporting models/routers | reporting migrations | summary/project-progress/dashboard | Dashboard, Reports | read projections | موجود؛ يجب إثبات تطابق المصدر |
| Dictionary | `ProjectDictionary` / `project_dictionaries` | project migrations | `/projects/dictionaries` | configuration/import flows | org/project scoped | مثبت ومرن |

## الفجوات المؤكدة من الكود

1. `boq_items.unit_id` ما زال موجودًا كعمود توافق deprecated، ويوجد endpoint توافق قديم لإنشاء/تعيين BOQ من سياق الوحدة. يجب إغلاق الكتابة القديمة أو تحويلها إلى canonical facade.
2. Excel importer يحقق الملف ويحفظه مباشرة؛ لا توجد مرحلة Preview مستقلة أو Dry Run أو Approve أو Import Report idempotent.
3. `UNIT_PROGRESS` في مسار offline sync يستطيع تحديث `UnitBoQProgress` مباشرة إذا وجد assignment، ولا يمر دائمًا عبر Event Pipeline بنفس عقد online.
4. `DAILY_LOG` غير مدعوم بالكامل في مسار sync؛ يجب تحديد هل سيصبح offline في هذه الجولة أم يبقى online-only موثقًا.
5. يوجد عميل مركزي للمصادقة والـAPI، لكن بعض wrappers مثل project creation وretry في Excel تحتاج consolidation.
6. Fast Entry يعتمد على assignments في بناء الخلايا؛ الخلية غير المطبقة يجب أن تُعرض صراحة ولا تظهر كحقل غامض أو شرطة صامتة.

## Runtime Evidence المطلوب

قبل أي migration بيانات أو Feature جديدة، يجب جمع الآتي لكل مشروع اختبار:

| القياس | الاستعلام/المصدر | المطلوب |
|---|---|---|
| Projects | `/projects` أو DB read-only | عدد المشاريع والسياق |
| Units | `/projects/{id}/units` | عدد الوحدات وعدم تغيره عند التطبيق |
| Master BOQ | `/projects/{id}/canonical-boq` | عدد البنود المشروعية |
| Assignments | canonical response | عدد الأزواج النشطة والفريدة |
| Execution Events | `/execution/events/history` | العدد والـsync_uuid وعدم التكرار |
| Progress | `/execution/state` | صف لكل assignment نشط، دون orphan |
| Quality | `/quality/remarks` | الربط بالمشروع/الوحدة/أمر العمل |
| Diary | `/field-diary` | السجل اليومي وربطه بالمشروع |
| Sync | `/sync` metrics/pull/push | pending/failed/conflict والـlast_error |

## قرار المرحلة الأولى

النموذج الأساسي موجود وصالح للاستمرار؛ لا حاجة إلى BOQV2 أو UnitV2 أو ExecutionV2. الإصلاحات التالية يجب أن تكون **إغلاق مسارات الكتابة القديمة، وتثبيت التعيينات، وتوحيد مسار الأحداث، وتحسين الأدلة والاختبارات**، لا إعادة بناء النظام.

## مراجع الكود

- `backend/app/modules/projects/models.py`
- `backend/app/modules/projects/router.py`
- `backend/app/modules/projects/canonical_router.py`
- `backend/app/modules/projects/excel_import_router.py`
- `backend/app/modules/execution/models.py`
- `backend/app/modules/execution/service.py`
- `backend/app/modules/execution/router.py`
- `backend/app/modules/sync/service.py`
- `src/components/fieldops/SpeedEntryGrid.tsx`
- `src/lib/api-client.ts`
- `src/lib/auth-store.ts`

## Runtime probe note — 2026-08-18

حاولت جمع runtime evidence من النسخة المنشورة بالحساب الإداري المقدم. طلب `POST /api/v1/auth/login` بقي لمدة 10,003ms، وهو نفس حد مهلة الواجهة، دون إكمال تهيئة الجلسة. لذلك لم تُسجل أعداد المشاريع والوحدات والبنود والتعيينات كحقيقة runtime في هذا التدقيق. هذه نتيجة مستقلة عن حقائق الكود، ويجب إعادة الاختبار بعد عودة المصادقة أو عبر Staging.

لا يجوز استخدام هذه المهلة كدليل على أن التعيينات مفقودة؛ الدليل الوحيد المثبت حاليًا هو أن runtime probe لم يصل إلى مرحلة قراءة البيانات.

## Audit gate

المرحلة الأولى لا تغلق اعتمادًا على UI فقط. إغلاقها يتطلب إما استعلامًا مصادقًا ناجحًا يعيد counts والعلاقات، أو تشغيل اختبارات قاعدة بيانات في Staging على fixture قابل للتنظيف. إلى حين ذلك، تُنفذ إصلاحات الكود التي لا تتطلب تعديل بيانات الإنتاج، وتُؤجل migrations/backfills حتى تتوفر نافذة تشغيل موثقة.

