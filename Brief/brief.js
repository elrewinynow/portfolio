import { steps, validate } from "./schema.js";
import { API_BASE } from "./config.js";
const form = document.querySelector("form"),
  container = document.querySelector("#fields"),
  error = document.querySelector("#error"),
  next = document.querySelector("#next"),
  back = document.querySelector("#back");
let step = 0,
  answers = {},
  requestId = crypto.randomUUID(),
  token = null,
  tokenReadyAt = 0,
  tokenExpiresAt = 0,
  busy = false;
function collect() {
  for (const el of container.querySelectorAll("input,textarea,select")) {
    if (el.type === "checkbox") {
      answers[el.name] = [...container.querySelectorAll("input[type=checkbox]")]
        .filter((x) => x.name === el.name && x.checked)
        .map((x) => x.value);
    } else if (el.type === "radio") {
      if (el.checked) answers[el.name] = el.value;
    } else answers[el.name] = el.value;
  }
}
function render(focus = false) {
  container.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = steps[step].title;
  heading.tabIndex = -1;
  container.append(heading);
  document.querySelector("#step-label").textContent = steps[step].title;
  document.querySelector("#step-count").textContent = `الخطوة ${step + 1} من 6`;
  document.querySelector("#progress").value = step + 1;
  for (const [key, title, type, required, options] of steps[step].fields) {
    const choice = ["radio", "checkbox"].includes(type),
      wrap = document.createElement(choice ? "fieldset" : "div");
    wrap.className = "field";
    const label = document.createElement(choice ? "legend" : "label");
    label.textContent = title + (required && !title.includes("*") ? " *" : "");
    if (!choice) label.htmlFor = key;
    if (!required) {
      const s = document.createElement("span");
      s.className = "optional";
      s.textContent = ["phone", "email"].includes(key)
        ? "واحد منهما مطلوب *"
        : ["sectorOther", "goalOther"].includes(key)
          ? "مطلوب عند اختيار «آخر»"
          : "اختياري";
      label.append(s);
    }
    wrap.append(label);
    if (choice) {
      const group = document.createElement("div");
      group.className = "choices";
      for (const option of options) {
        const l = document.createElement("label");
        l.className = "choice";
        const input = document.createElement("input");
        input.type = type;
        input.name = key;
        input.value = option;
        input.checked =
          type === "checkbox"
            ? (answers[key] || []).includes(option)
            : answers[key] === option;
        const span = document.createElement("span");
        span.textContent = option;
        l.append(input, span);
        group.append(l);
      }
      wrap.append(group);
    } else {
      const el = document.createElement(
        type === "textarea"
          ? "textarea"
          : type === "select"
            ? "select"
            : "input",
      );
      el.id = key;
      el.name = key;
      if (el.tagName === "INPUT") el.type = type;
      if (type === "select") {
        el.add(new Option("اختار لو متاح", ""));
        options.forEach((o) => el.add(new Option(o, o)));
      } else el.maxLength = type === "textarea" ? 2500 : 300;
      el.value = answers[key] || "";
      el.required = !!required;
      if (key === "email") el.autocomplete = "email";
      if (key === "phone") el.autocomplete = "tel";
      wrap.append(el);
    }
    container.append(wrap);
  }
  back.hidden = step === 0;
  next.textContent = step === 5 ? "إرسال البريف ✓" : "التالي ←";
  error.textContent = "";
  if (focus) heading.focus();
}
container.addEventListener("change", (e) => {
  if (e.target.name === "goals") {
    const selected = [...container.querySelectorAll("[name=goals]:checked")];
    if (selected.length > 2) {
      e.target.checked = false;
      error.textContent = "اختار هدفين بحد أقصى عشان نحدد الأولوية.";
    } else error.textContent = "";
  }
  collect();
});
back.addEventListener("click", () => {
  if (busy) return;
  collect();
  step--;
  render(true);
});
async function getToken() {
  const r = await fetch(`${API_BASE}/api/brief/challenge`, {
    cache: "no-store",
    credentials: "omit",
  });
  if (!r.ok)
    throw Error(
      "خدمة الإرسال مش متاحة دلوقتي. إجاباتك لسه موجودة؛ جرّب تاني بعد شوية.",
    );
  const body = await r.json();
  tokenReadyAt = body.readyAt || Date.now() + 3100;
  tokenExpiresAt = body.expiresAt || Date.now() + 7200000;
  return body.token;
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  collect();
  const result = validate(answers, step);
  if (Object.keys(result.errors).length) {
    showErrors(result.errors);
    return;
  }
  if (step < 5) {
    step++;
    render(true);
    return;
  }
  const all = validate(answers);
  if (Object.keys(all.errors).length) {
    step = steps.findIndex((s) => s.fields.some((f) => all.errors[f[0]]));
    render(true);
    showErrors(all.errors);
    return;
  }
  busy = true;
  next.disabled = back.disabled = true;
  next.textContent = "جاري الإرسال…";
  error.textContent = "";
  try {
    if (!token || Date.now() >= tokenExpiresAt) token = await getToken();
    const wait = Math.max(0, Math.min(4000, tokenReadyAt - Date.now()));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const response = await fetch(`${API_BASE}/api/brief`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": requestId,
      },
      body: JSON.stringify({
        answers: all.data,
        token,
        website_confirm: form.elements.website_confirm.value,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 403) token = null;
      throw Error(
        body.message || "الإرسال ما تمش. إجاباتك لسه موجودة؛ حاول تاني.",
      );
    }
    if (!body.id) throw Error("تعذر تأكيد حفظ البريف. حاول تاني بنفس الصفحة.");
    document.querySelector("#wizard").hidden = true;
    const success = document.querySelector("#success");
    success.hidden = false;
    document.querySelector("#receipt").textContent = `رقم البريف: ${body.id}`;
    success.focus();
    answers = {};
  } catch (err) {
    error.textContent = err.message;
    error.focus();
  } finally {
    busy = false;
    next.disabled = back.disabled = false;
    next.textContent = "إرسال البريف ✓";
  }
});
function showErrors(errors) {
  error.textContent = Object.values(errors).join(" ");
  for (const el of container.querySelectorAll("[aria-invalid]"))
    el.removeAttribute("aria-invalid");
  const key = steps[step].fields.find((f) => errors[f[0]])?.[0];
  if (key) {
    const target = container.querySelector(`[name="${key}"]`);
    target?.setAttribute("aria-invalid", "true");
    target?.setAttribute("aria-describedby", "error");
    target?.focus();
  } else error.focus();
}
window.addEventListener("beforeunload", (e) => {
  if (
    Object.values(answers).some((v) => (Array.isArray(v) ? v.length : !!v)) &&
    !document.querySelector("#wizard").hidden
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});
render();
getToken()
  .then((t) => (token = t))
  .catch(() => {});
