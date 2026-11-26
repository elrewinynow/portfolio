import { steps } from "./schema.js";
const $ = (id) => document.getElementById(id),
  labels = {
    new: "جديد",
    reviewing: "قيد المراجعة",
    reviewed: "تمت المراجعة",
    archived: "مؤرشف",
  };
const date = (value) =>
  new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
let nextCursor = null,
  current = null,
  dirty = false,
  saving = false,
  pending = null,
  loading = false,
  loadSequence = 0;
async function api(path, init = {}) {
  const r = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!r.ok) {
    let message = "تعذر الاتصال بالداشبورد.";
    try {
      message = (await r.json()).message || message;
    } catch {}
    const e = Error(message);
    e.status = r.status;
    throw e;
  }
  return r;
}
function params() {
  const p = new URLSearchParams({
    q: $("query").value.trim(),
    status: $("filter-status").value,
  });
  return p;
}
function showMessage(text) {
  $("message").textContent = text;
}
function card(row) {
  const article = document.createElement("article");
  article.className = "brief-card";
  const text = document.createElement("div"),
    title = document.createElement("h3");
  title.textContent = row.brand;
  const name = document.createElement("p");
  name.textContent = row.contact_name;
  const contact = document.createElement("p");
  contact.textContent = [row.phone, row.email].filter(Boolean).join(" · ");
  const meta = document.createElement("div");
  meta.className = "card-meta";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.state = row.status;
  badge.textContent = labels[row.status] || row.status;
  const time = document.createElement("time");
  time.dateTime = row.submitted_at;
  time.textContent = date(row.submitted_at);
  meta.append(badge, time);
  text.append(title, name, contact, meta);
  const button = document.createElement("button");
  button.className = "secondary";
  button.textContent = "مراجعة البريف ←";
  button.addEventListener("click", () => openDetail(row.id));
  article.append(text, button);
  return article;
}
async function load(append = false) {
  const sequence = ++loadSequence;
  loading = true;
  $("more").disabled = true;
  $("refresh").disabled = true;
  $("list-state").textContent = "جاري تحميل البريفات…";
  showMessage("");
  try {
    const p = params();
    if (append && nextCursor) p.set("cursor", nextCursor);
    const body = await (await api("/api/briefs?" + p)).json();
    if (sequence !== loadSequence) return;
    if (!append) $("list").replaceChildren();
    body.rows.forEach((row) => $("list").append(card(row)));
    nextCursor = body.nextCursor;
    $("more").hidden = !nextCursor;
    let total = 0;
    Object.keys(labels).forEach((key) => {
      const count = body.counts.find((x) => x.status === key)?.count || 0;
      total += count;
      $("count-" + key).textContent = count;
    });
    $("count-all").textContent = total;
    $("list-state").textContent = $("list").children.length
      ? "المعروض: " + $("list").children.length + " بريف"
      : "مفيش بريفات مطابقة للبحث الحالي.";
  } catch (e) {
    if (sequence === loadSequence) {
      showMessage(e.message);
      $("list-state").textContent = "تعذر تحميل القائمة. جرّب التحديث.";
    }
  } finally {
    if (sequence === loadSequence) {
      loading = false;
      $("more").disabled = false;
      $("refresh").disabled = false;
    }
  }
}
function links(value, wrap) {
  for (const line of String(value).split(/\s+/).filter(Boolean)) {
    try {
      const url = new URL(line);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
      const a = document.createElement("a");
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = line;
      wrap.append(a);
    } catch {
      const p = document.createElement("span");
      p.textContent = line + " ";
      wrap.append(p);
    }
  }
}
function renderDetail(row) {
  current = row;
  $("print-brief").href="/api/briefs/"+encodeURIComponent(row.id)+"/print";
  dirty = false;
  pending = null;
  $("detail-title").textContent = row.brand;
  $("detail-contact").textContent = [row.contact_name, row.phone, row.email]
    .filter(Boolean)
    .join(" · ");
  $("detail-date").textContent = "اترسل " + date(row.submitted_at);
  $("answers").replaceChildren();
  for (const step of steps) {
    const section = document.createElement("section");
    section.className = "answer-group";
    const title = document.createElement("h3");
    title.textContent = step.title;
    section.append(title);
    const dl = document.createElement("dl");
    for (const [key, label] of step.fields) {
      const value = row.answers[key];
      if (!value || (Array.isArray(value) && !value.length)) continue;
      const pair = document.createElement("div");
      pair.className = "answer";
      const dt = document.createElement("dt");
      dt.textContent = label.replace(/\s*\*$/, "");
      const dd = document.createElement("dd");
      if (["links", "references"].includes(key)) links(value, dd);
      else dd.textContent = Array.isArray(value) ? value.join("، ") : value;
      pair.append(dt, dd);
      dl.append(pair);
    }
    if (!dl.children.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "لم تُكتب إجابات في القسم ده.";
      section.append(p);
    } else section.append(dl);
    $("answers").append(section);
  }
  $("review-status").value = row.status;
  $("notes").value = row.notes;
  $("save-message").textContent = "";
  $("updated").textContent = row.updated_at
    ? "آخر حفظ: " + date(row.updated_at)
    : "لم تُكتب مراجعة بعد.";
}
async function openDetail(id) {
  try {
    const row = await (
      await api("/api/briefs/" + encodeURIComponent(id))
    ).json();
    renderDetail(row);
    if (!$("detail").open) $("detail").showModal();
  } catch (e) {
    showMessage(e.message);
  }
}
function closeDetail() {
  if (saving) return;
  if (dirty && !confirm("في تعديلات لسه ما اتحفظتش. تقفل من غير حفظ؟")) return;
  $("detail").close();
  current = null;
  pending = null;
  dirty = false;
}
$("close").addEventListener("click", closeDetail);
$("detail").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
$("review-form").addEventListener("input", () => {
  dirty = true;
  pending = null;
});
$("review-form").addEventListener("change", () => {
  dirty = true;
  pending = null;
});
$("reload-detail").addEventListener("click", () => {
  if (
    current &&
    !saving &&
    (!dirty ||
      confirm("هتستبدل التعديلات غير المحفوظة بالنسخة الحالية. متأكد؟"))
  )
    openDetail(current.id);
});
$("review-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current || saving) return;
  saving = true;
  $("notes").disabled = true;
  $("review-status").disabled = true;
  $("save").disabled = true;
  $("reload-detail").disabled = true;
  const body = {
    status: $("review-status").value,
    notes: $("notes").value,
    version: current.version,
  };
  const intent = JSON.stringify(body);
  if (!pending || pending.intent !== intent)
    pending = { key: crypto.randomUUID(), intent };
  $("save-message").textContent = "جاري الحفظ…";
  $("save-message").dataset.error = "false";
  try {
    const result = await (
      await api("/api/briefs/" + current.id, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "brief-dashboard",
          "Idempotency-Key": pending.key,
        },
        body: intent,
      })
    ).json();
    current.version = result.version;
    current.status = result.status;
    dirty = false;
    pending = null;
    $("save-message").textContent = "اتحفظت المراجعة ✓";
    $("updated").textContent = "آخر حفظ: " + date(new Date().toISOString());
    await load();
  } catch (error) {
    $("save-message").textContent = error.message;
    $("save-message").dataset.error = "true";
  } finally {
    saving = false;
    $("notes").disabled = false;
    $("review-status").disabled = false;
    $("save").disabled = false;
    $("reload-detail").disabled = false;
  }
});
$("filters").addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});
$("filter-status").addEventListener("change", () => load());
$("refresh").addEventListener("click", () => load());
$("more").addEventListener("click", () => {
  if (!loading) load(true);
});
$("export").addEventListener("click", async () => {
  $("export").disabled = true;
  try {
    const response = await api("/api/export.csv?" + params()),
      blob = await response.blob(),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "briefs.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage("تم تنزيل الردود المطابقة للبحث الحالي.");
  } catch (e) {
    showMessage(e.message);
  } finally {
    $("export").disabled = false;
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  const session = await (await api("/api/session")).json();
  $("owner").textContent = session.email;
  await load();
} catch (e) {
  showMessage(e.message);
  $("list-state").textContent = "لم تُحمّل أي بيانات خاصة.";
}

$('logout').addEventListener('click',async()=>{if(dirty&&!confirm('عندك ملاحظات غير محفوظة. تخرج؟'))return;try{await api('/auth/logout',{method:'POST',headers:{'X-Requested-With':'brief-dashboard'}});location.assign('/login');}catch(e){alert(e.message);}});

$('export-excel').addEventListener('click',async()=>{const button=$('export-excel');button.disabled=true;showMessage('جاري تجهيز ملف Excel…');try{const body=await (await api('/api/export.json?'+params())).json();const {makeWorkbook}=await import('./excel-export.js');const bytes=await makeWorkbook(body.rows);const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download='briefs.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showMessage('تم تجهيز ملف Excel للردود المطابقة للبحث الحالي.');}catch(e){showMessage(e.message);}finally{button.disabled=false;}});
