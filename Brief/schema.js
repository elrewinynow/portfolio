export const steps = [
  {
    title: "النشاط والتواصل",
    fields: [
      ["brand", "اسم النشاط أو البراند", "text", true],
      ["contactName", "اسم الشخص المسؤول", "text", true],
      ["phone", "رقم واتساب (بكود الدولة لو خارج مصر)", "tel"],
      ["email", "البريد الإلكتروني", "email"],
      [
        "links",
        "الموقع وحسابات التواصل (روابط عامة، كل رابط في سطر)",
        "textarea",
      ],
      [
        "sector",
        "مجال النشاط",
        "select",
        false,
        [
          "تجارة ومتاجر",
          "صحة وجمال",
          "مطاعم ومشروبات",
          "تعليم وتدريب",
          "خدمات مهنية",
          "تقنية وتطبيقات",
          "عقارات",
          "مجال آخر",
        ],
      ],
      ["sectorOther", "لو مجال آخر، اكتب المجال", "text"],
      [
        "stage",
        "مرحلة النشاط",
        "radio",
        false,
        ["جديد", "قائم", "إعادة إطلاق", "في مرحلة توسع"],
      ],
      ["market", "السوق الأساسي — المحافظة أو الدولة", "text"],
    ],
  },
  {
    title: "المنتج أو الخدمة",
    fields: [
      [
        "offering",
        "إيه المنتج أو الخدمة الأساسية اللي بتبيعها؟",
        "textarea",
        true,
      ],
      ["focus", "إيه أهم منتج أو خدمة عايز تركز عليها؟", "text"],
      ["price", "نطاق السعر أو متوسط قيمة الطلب (مع العملة)", "text"],
      ["difference", "إيه اللي بيميز نشاطك عن البدائل؟", "textarea"],
      ["offers", "هل فيه عروض حالية؟", "text"],
    ],
  },
  {
    title: "الهدف والتحدي",
    fields: [
      [
        "challenge",
        "إيه أكبر تحدٍ تسويقي بيواجه نشاطك دلوقتي؟",
        "textarea",
        true,
      ],
      [
        "goals",
        "الهدف الرئيسي — اختار بحد أقصى هدفين *",
        "checkbox",
        true,
        [
          "زيادة العملاء أو المبيعات",
          "تحسين التحويل",
          "فهم سبب ضعف النتائج",
          "ترتيب الأولويات",
          "تحسين المحتوى",
          "اختيار قناة تسويق",
          "إطلاق أو تطوير منتج/خدمة",
          "هدف آخر",
        ],
      ],
      ["goalOther", "لو هدف آخر، وضحه هنا", "text"],
      ["outcome", "إيه النتيجة اللي تخليك تعتبر الجلسة مفيدة؟", "text"],
    ],
  },
  {
    title: "الجمهور وسلوك الشراء",
    fields: [
      ["audience", "مين العميل المناسب لنشاطك؟", "textarea"],
      ["motivation", "إيه اللي بيدفعه للشراء؟", "textarea"],
      [
        "objections",
        "إيه الاعتراضات أو العوائق اللي بتمنعه يشتري؟",
        "textarea",
      ],
    ],
  },
  {
    title: "التسويق الحالي",
    fields: [
      [
        "channels",
        "بتستخدم إيه من القنوات دي؟ — اختار كل المناسب",
        "checkbox",
        false,
        [
          "Facebook / Instagram",
          "TikTok",
          "Google",
          "الموقع",
          "WhatsApp",
          "البريد الإلكتروني",
          "متاجر أو منصات",
          "قنوات أخرى",
          "لا توجد قنوات حاليًا",
        ],
      ],
      [
        "activities",
        "إيه الأنشطة اللي بتنفذها حاليًا؟ — اختار كل المناسب",
        "checkbox",
        false,
        [
          "محتوى",
          "إعلانات",
          "عروض",
          "تسويق عبر المؤثرين",
          "أنشطة أخرى",
          "لا توجد أنشطة حاليًا",
        ],
      ],
      [
        "performance",
        "إيه اللي شايفه شغال كويس؟ وإيه اللي مش بيجيب نتيجة؟",
        "textarea",
      ],
      [
        "budget",
        "ميزانية التسويق الشهرية التقريبية (جنيه مصري)",
        "select",
        false,
        [
          "بدون ميزانية حاليًا",
          "أقل من ٥٬٠٠٠",
          "٥٬٠٠٠ – ٢٠٬٠٠٠",
          "٢٠٬٠٠٠ – ٥٠٬٠٠٠",
          "أكثر من ٥٠٬٠٠٠",
          "ميزانية بعملة أخرى (وضحها في الملاحظات)",
          "أفضل عدم الإجابة",
        ],
      ],
      [
        "metrics",
        "أرقام متاحة تساعدنا نفهم الوضع (والفترة الزمنية لو معروفة)",
        "textarea",
      ],
    ],
  },
  {
    title: "المنافسون والموعد",
    fields: [
      ["competitors", "أسماء أو روابط منافسين أو أنشطة قريبة منك", "textarea"],
      [
        "references",
        "روابط عامة لحملات أو صفحات أو تقارير عايز تناقشها",
        "textarea",
      ],
      ["deadline", "هل فيه موعد مهم أو إطلاق قريب؟", "text"],
      ["notes", "أي معلومة تانية تساعدني أفهم المشكلة؟", "textarea"],
    ],
  },
];
export const fields = steps.flatMap((s) => s.fields);
const digits = (s) =>
  s
    .replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c))
    .replace(/[۰-۹]/g, (c) => "۰۱۲۳۴۵۶۷۸۹".indexOf(c));
export function validate(input, stepIndex) {
  const data = {},
    errors = {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { data, errors: { form: "صيغة البيانات غير صحيحة." } };
  for (const [key, label, type, required, options] of fields) {
    const raw = input[key];
    if (type === "checkbox") {
      data[key] = Array.isArray(raw) ? [...new Set(raw)] : [];
      if (
        raw !== undefined &&
        (!Array.isArray(raw) ||
          raw.some((v) => typeof v !== "string" || !options.includes(v)) ||
          data[key].length !== raw.length)
      )
        errors[key] = "اختار إجابات من الاختيارات المتاحة.";
      if (key === "goals" && data[key].length > 2)
        errors[key] = "اختار هدفين بحد أقصى.";
    } else {
      data[key] = typeof raw === "string" ? raw.trim() : "";
      if (raw !== undefined && typeof raw !== "string")
        errors[key] = "اكتب إجابة نصية صحيحة.";
      if (data[key].length > (type === "textarea" ? 2500 : 300))
        errors[key] = "الإجابة طويلة؛ اختصرها شوية.";
      if (options && data[key] && !options.includes(data[key]))
        errors[key] = "اختار إجابة من القائمة.";
    }
    if (
      required &&
      (!data[key] || (Array.isArray(data[key]) && !data[key].length))
    )
      errors[key] = "السؤال ده مطلوب.";
  }
  data.phone = digits(data.phone).replace(/[\s().-]/g, "");
  if (!data.phone && !data.email)
    errors.phone = "اكتب رقم واتساب أو بريد إلكتروني واحد على الأقل.";
  if (data.phone && !/^(?:\+?[1-9]\d{7,14}|01[0125]\d{8})$/.test(data.phone))
    errors.phone = "اكتب رقم صحيح؛ مثل 01012345678 أو +201012345678.";
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    errors.email = "اكتب بريد إلكتروني صحيح، مثل name@example.com.";
  if (data.sector === "مجال آخر" && !data.sectorOther)
    errors.sectorOther = "وضح مجال النشاط.";
  if (data.goals.includes("هدف آخر") && !data.goalOther)
    errors.goalOther = "وضح الهدف الآخر.";
  for (const key of ["links", "references"]) {
    const urls = data[key].split(/\s+/).filter(Boolean);
    if (urls.length > 12) errors[key] = "اكتب ١٢ رابط بحد أقصى.";
    for (const url of urls) {
      try {
        const u = new URL(url);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          !u.hostname.includes(".") ||
          u.hostname === "localhost"
        )
          throw Error();
      } catch {
        errors[key] =
          "اكتب روابط عامة كاملة تبدأ بـ https://، كل رابط في سطر، ومن غير بيانات دخول.";
      }
    }
  }
  if (stepIndex !== undefined) {
    const keys = new Set(steps[stepIndex].fields.map((f) => f[0]));
    for (const k of Object.keys(errors)) if (!keys.has(k)) delete errors[k];
  }
  return { data, errors };
}
