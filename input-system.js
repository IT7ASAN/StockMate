(function () {
  "use strict";
  const ar = "٠١٢٣٤٥٦٧٨٩", fa = "۰۱۲۳۴۵۶۷۸۹";

  function normalizeNumeric(value) {
    return String(value == null ? "" : value)
      .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
      .replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
      .replace(/\u066B/g, ".").replace(/\u066C/g, "");
  }
  function replaceSelection(value, start, end, inserted, maxLength) {
    const source = String(value == null ? "" : value);
    const left = Math.max(0, Math.min(source.length, Number(start) || 0));
    const right = Math.max(left, Math.min(source.length, Number(end) || left));
    const text = normalizeNumeric(inserted);
    let next = source.slice(0, left) + text + source.slice(right);
    if (Number.isFinite(maxLength) && maxLength >= 0 && next.length > maxLength) next = next.slice(0, maxLength);
    return { value: next, caret: Math.min(next.length, left + text.length) };
  }
  function deleteSelection(value, start, end, direction) {
    const source = String(value == null ? "" : value);
    let left = Math.max(0, Math.min(source.length, Number(start) || 0));
    let right = Math.max(left, Math.min(source.length, Number(end) || left));
    if (left === right) {
      if (direction === "forward") right = Math.min(source.length, right + 1);
      else left = Math.max(0, left - 1);
    }
    return { value: source.slice(0, left) + source.slice(right), caret: left };
  }
  function validateNumericValue(value, options) {
    const c = options || {}, raw = normalizeNumeric(value).trim();
    if (!raw) return c.required ? "required" : "";
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) return "format";
    if (c.pattern) {
      try { if (!(new RegExp("^(?:" + c.pattern + ")$", "u")).test(raw)) return "pattern"; } catch (_) {}
    }
    const n = Number(raw);
    const min = c.min == null || c.min === "" ? null : Number(c.min);
    const max = c.max == null || c.max === "" ? null : Number(c.max);
    if (min != null && n < min) return "min";
    if (max != null && n > max) return "max";
    const step = c.step == null || c.step === "" ? "1" : String(c.step);
    if (step !== "any") {
      const valueStep = Number(step), base = min != null ? min : (c.base == null || c.base === "" ? 0 : Number(c.base));
      if (valueStep > 0 && Number.isFinite(valueStep) && Number.isFinite(base)) {
        const ratio = (n - base) / valueStep;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-8 * Math.max(1, Math.abs(ratio))) return "step";
      }
    }
    return "";
  }
  const core = { normalizeNumeric, replaceSelection, deleteSelection, validateNumericValue };
  if (typeof module === "object" && module.exports) module.exports = core;
  if (typeof document === "undefined" || !document.body) {
    if (typeof globalThis !== "undefined") globalThis.StockMateInputCore = core;
    return;
  }

  const panel = document.createElement("aside");
  panel.id = "stockmateNumericKeyboard";
  panel.className = "numeric-keyboard";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "لوحة الأرقام");
  panel.innerHTML =
    '<div class="numeric-keyboard-shell">' +
      '<div class="numeric-keyboard-heading"><div><small>إدخال رقمي</small><b class="numeric-keyboard-title">القيمة المحددة</b></div>' +
      '<button type="button" class="numeric-keyboard-close" data-numeric-action="confirm" aria-label="تأكيد وإغلاق">✓</button></div>' +
      '<div class="numeric-keyboard-readout" dir="ltr"><button type="button" data-numeric-action="caret-left" aria-label="تحريك المؤشر لليسار">‹</button>' +
      '<output class="numeric-keyboard-value" aria-live="polite">—</output><button type="button" data-numeric-action="caret-right" aria-label="تحريك المؤشر لليمين">›</button></div>' +
      '<div class="numeric-keyboard-grid" dir="ltr" role="group" aria-label="أزرار الأرقام">' +
        '<button type="button" data-numeric-key="1">1</button><button type="button" data-numeric-key="2">2</button><button type="button" data-numeric-key="3">3</button>' +
        '<button type="button" data-numeric-key="4">4</button><button type="button" data-numeric-key="5">5</button><button type="button" data-numeric-key="6">6</button>' +
        '<button type="button" data-numeric-key="7">7</button><button type="button" data-numeric-key="8">8</button><button type="button" data-numeric-key="9">9</button>' +
        '<button type="button" class="numeric-decimal-key" data-numeric-key=".">.</button><button type="button" data-numeric-key="0">0</button><button type="button" data-numeric-action="backspace" aria-label="حذف آخر رقم">⌫</button></div>' +
      '<div class="numeric-keyboard-footer"><span class="numeric-keyboard-message" aria-live="polite"></span>' +
      '<button type="button" class="numeric-keyboard-clear" data-numeric-action="clear">مسح القيمة</button><button type="button" class="numeric-keyboard-done" data-numeric-action="confirm">تم</button></div>' +
    '</div>';
  document.body.appendChild(panel);

  const output = panel.querySelector(".numeric-keyboard-value");
  const message = panel.querySelector(".numeric-keyboard-message");
  const decimalKey = panel.querySelector(".numeric-decimal-key");
  let active = null, nativeInput = null, scrollTarget = null, committed = "", scrollTimer = 0, nativeScrollTimer = 0;
  const isInput = el => !!el && el.tagName === "INPUT";
  function numericCandidate(el) {
    if (!isInput(el) || el.disabled || el.readOnly) return false;
    return el.type === "number" || el.id === "pBarcode" || el.id === "scanCode" ||
      el.dataset.variantField === "barcode" || el.hasAttribute("data-stockmate-numeric");
  }
  function isNumericField(el) {
    return isInput(el) && (el.dataset.stockmateNumericReady === "true" || numericCandidate(el));
  }
  function initialize(el) {
    if (!isInput(el)) return false;
    if (el.dataset.stockmateNumericReady === "true") return true;
    if (!numericCandidate(el)) return false;
    const type = el.type, inputmode = el.getAttribute("inputmode") || "", declaredStep = el.getAttribute("step");
    const decimal = inputmode === "decimal" || declaredStep === "any" ||
      (declaredStep && Number(declaredStep) > 0 && !Number.isInteger(Number(declaredStep)));
    el.dataset.stockmateNumericReady = "true";
    el.dataset.stockmateOriginalType = type;
    el.dataset.stockmateOriginalInputmode = inputmode;
    el.dataset.stockmateNumericStep = declaredStep || (decimal ? "any" : "1");
    el.dataset.stockmateNumericBase = el.getAttribute("min") || el.getAttribute("value") || "0";
    el.dataset.stockmateNumericDecimal = decimal ? "true" : "false";
    if (type === "number") el.type = "text";
    el.classList.add("custom-numeric-input");
    el.readOnly = true;
    el.setAttribute("inputmode", "none");
    el.setAttribute("autocomplete", "off");
    el.setAttribute("enterkeyhint", "done");
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-controls", panel.id);
    el.setAttribute("aria-readonly", "true");
    return true;
  }
  function configureText(el) {
    if (!isInput(el) || el.dataset.stockmateTextReady === "true" || isNumericField(el)) return;
    el.dataset.stockmateTextReady = "true";
    if (el.type === "search") {
      if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
      if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "none");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "false");
      if (!el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
      if (!el.hasAttribute("enterkeyhint")) el.setAttribute("enterkeyhint", "search");
      return;
    }
    const id = el.id || "", variant = el.dataset.variantField || "";
    const nameField = /^(pName|pBrand|pFlavor|shelfName|sectionName|receivingSupplier)$/.test(id) ||
      variant === "flavor" || el.hasAttribute("data-batch-flavor-name");
    const noteField = /note|description|notes/i.test(id) || /note/i.test(variant);
    if (nameField) {
      if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "on");
      if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "words");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "true");
      if (!el.hasAttribute("enterkeyhint")) el.setAttribute("enterkeyhint", "next");
    } else if (noteField) {
      if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "on");
      if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "sentences");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "true");
      if (!el.hasAttribute("enterkeyhint")) el.setAttribute("enterkeyhint", "done");
    } else if (id === "pLocation") {
      if (!el.hasAttribute("autocorrect")) el.setAttribute("autocorrect", "off");
      if (!el.hasAttribute("autocapitalize")) el.setAttribute("autocapitalize", "characters");
      if (!el.hasAttribute("spellcheck")) el.setAttribute("spellcheck", "false");
    }
  }
  function scan(root) {
    if (isInput(root)) { if (!initialize(root)) configureText(root); }
    if (root && root.querySelectorAll) root.querySelectorAll("input").forEach(el => { if (!initialize(el)) configureText(el); });
  }
  function labelFor(el) {
    const label = el.labels && el.labels[0];
    if (label) {
      const text = label.textContent.replace(/\s+/g, " ").trim().replace(/[＊*]\s*$/, "");
      if (text) return text;
    }
    return el.getAttribute("aria-label") || el.placeholder || "القيمة المحددة";
  }
  function setMessage(text) {
    message.textContent = text || "";
    panel.classList.toggle("has-error", !!text);
  }
  function sync() {
    if (!active) return;
    output.textContent = active.value || "—";
    panel.querySelector(".numeric-keyboard-title").textContent = labelFor(active);
    decimalKey.hidden = active.dataset.stockmateNumericDecimal !== "true";
    setMessage("");
  }
  function updateScrollTarget(el) {
    if (scrollTarget) scrollTarget.classList.remove("numeric-keyboard-scroll-target");
    scrollTarget = el ? el.closest(".modal-card") : null;
    if (scrollTarget) scrollTarget.classList.add("numeric-keyboard-scroll-target");
  }
  function scrollActive() {
    if (active && active.isConnected) {
      try { active.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); }
      catch (_) { try { active.scrollIntoView(false); } catch (_) {} }
    }
  }
  function scheduleScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(scrollActive, 120);
  }
  function scheduleNativeScroll() {
    clearTimeout(nativeScrollTimer);
    nativeScrollTimer = window.setTimeout(function () {
      if (nativeInput && document.activeElement === nativeInput) {
        try { nativeInput.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); } catch (_) {}
      }
    }, 180);
  }
  function getSelection(el) {
    const len = el.value.length;
    try { return { start: el.selectionStart == null ? len : el.selectionStart, end: el.selectionEnd == null ? len : el.selectionEnd }; }
    catch (_) { return { start: len, end: len }; }
  }
  function setSelection(el, start, end) {
    try { el.setSelectionRange(start, end == null ? start : end); } catch (_) {}
  }
  function changed(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    sync();
    scheduleScroll();
  }
  function insert(text) {
    if (!active) return;
    const el = active, range = getSelection(el), value = normalizeNumeric(text);
    if (value === ".") {
      if (el.dataset.stockmateNumericDecimal !== "true" || el.value.includes(".")) return;
    } else if (!/^\d+$/.test(value)) return;
    const max = el.maxLength > -1 ? el.maxLength : Infinity;
    const result = replaceSelection(el.value, range.start, range.end, value, max);
    el.value = result.value;
    setSelection(el, result.caret);
    changed(el);
    setSelection(el, result.caret);
  }
  function remove(direction) {
    if (!active) return;
    const range = getSelection(active), result = deleteSelection(active.value, range.start, range.end, direction);
    active.value = result.value;
    setSelection(active, result.caret);
    changed(active);
    setSelection(active, result.caret);
  }
  function commit() {
    if (active && active.value !== committed) {
      active.dispatchEvent(new Event("change", { bubbles: true }));
      committed = active.value;
    }
  }
  function close(blur) {
    if (active) commit();
    const old = active;
    active = null;
    panel.hidden = true;
    panel.classList.remove("has-error");
    document.body.classList.remove("numeric-keyboard-open");
    if (scrollTarget) scrollTarget.classList.remove("numeric-keyboard-scroll-target");
    scrollTarget = null;
    if (blur && old && document.activeElement === old) old.blur();
  }
  function open(el) {
    if (!initialize(el)) return;
    if (active && active !== el) commit();
    active = el;
    committed = el.value;
    updateScrollTarget(el);
    panel.hidden = false;
    document.body.classList.add("numeric-keyboard-open");
    sync();
    scheduleScroll();
  }
  function options(el) {
    return {
      required: el.required, pattern: el.getAttribute("pattern"), min: el.getAttribute("min"),
      max: el.getAttribute("max"), step: el.dataset.stockmateNumericStep || "1",
      base: el.dataset.stockmateNumericBase || "0"
    };
  }
  function errorText(code) {
    return ({
      required: "أدخل قيمة هذا الحقل.", format: "أدخل أرقاماً صحيحة.",
      pattern: "صيغة الرقم غير صحيحة.", min: "القيمة أقل من الحد المسموح.",
      max: "القيمة أكبر من الحد المسموح.", step: "استخدم القيمة أو الجزء العشري المناسب لهذا الحقل."
    })[code] || "تحقق من القيمة المدخلة.";
  }
  function validateForm(event) {
    if (!event.target || !event.target.elements) return;
    for (const el of Array.from(event.target.elements)) {
      if (el.dataset && el.dataset.stockmateNumericReady === "true" && !el.disabled) {
        const error = validateNumericValue(el.value, options(el));
        if (error) {
          event.preventDefault();
          event.stopImmediatePropagation();
          open(el);
          setMessage(errorText(error));
          el.setAttribute("aria-invalid", "true");
          scheduleScroll();
          return;
        }
        el.removeAttribute("aria-invalid");
      }
    }
  }
  function physicalKey(event) {
    if (event.target !== active || !active || event.isComposing) return;
    const key = event.key;
    if (/^[0-9٠-٩۰-۹]$/.test(key)) { event.preventDefault(); insert(key); }
    else if ((key === "." || key === "," || key === "٫") && active.dataset.stockmateNumericDecimal === "true") { event.preventDefault(); insert("."); }
    else if (key === "Backspace") { event.preventDefault(); remove("backward"); }
    else if (key === "Delete") { event.preventDefault(); remove("forward"); }
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const r = getSelection(active), d = key === "ArrowLeft" ? -1 : 1;
      setSelection(active, Math.max(0, Math.min(active.value.length, (d < 0 ? r.start : r.end) + d)));
    } else if (key === "Home" || key === "End") {
      event.preventDefault(); setSelection(active, key === "Home" ? 0 : active.value.length);
    } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "a") {
      event.preventDefault(); setSelection(active, 0, active.value.length);
    } else if (key === "Enter") {
      event.preventDefault();
      if (active.id === "scanCode" && active.form) {
        const form = active.form;
        close(true);
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      } else close(true);
    }
  }
  function panelAction(event) {
    const button = event.target.closest("button");
    if (!button || !panel.contains(button)) return;
    if (button.dataset.numericKey) { insert(button.dataset.numericKey); return; }
    const action = button.dataset.numericAction;
    if (action === "backspace") remove("backward");
    else if (action === "clear" && active) { active.value = ""; setSelection(active, 0); changed(active); }
    else if ((action === "caret-left" || action === "caret-right") && active) {
      const r = getSelection(active), d = action === "caret-left" ? -1 : 1;
      const pos = d < 0 ? Math.max(0, r.start - 1) : Math.min(active.value.length, r.end + 1);
      setSelection(active, pos);
      active.focus({ preventScroll: true });
    } else if (action === "confirm") close(true);
  }
  function outsidePointer(event) {
    if (panel.hidden || panel.contains(event.target)) return;
    const target = event.target.closest && event.target.closest("input");
    if (target && isNumericField(target)) return;
    close(true);
  }
  function paste(event) {
    if (event.target !== active) return;
    const text = normalizeNumeric(event.clipboardData && event.clipboardData.getData("text"));
    if (!text) return;
    const valid = active.dataset.stockmateNumericDecimal === "true" ? /^\d*\.?\d*$/.test(text) : /^\d+$/.test(text);
    if (valid) { event.preventDefault(); insert(text); }
  }

  scan(document);
  const observer = new MutationObserver(records => records.forEach(record =>
    record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); })
  ));
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("focusin", event => {
    if (!isInput(event.target)) return;
    if (isNumericField(event.target)) {
      nativeInput = null;
      open(event.target);
    } else {
      nativeInput = ["file", "date", "checkbox", "radio", "hidden"].includes(event.target.type) ? null : event.target;
      if (!panel.hidden) close(false);
      if (nativeInput) scheduleNativeScroll();
    }
  }, true);
  document.addEventListener("click", event => {
    if (event.target === active) window.setTimeout(() => { if (active === event.target) sync(); }, 0);
  }, true);
  document.addEventListener("focusout", event => {
    if (event.target === nativeInput) window.setTimeout(() => {
      if (document.activeElement !== nativeInput) nativeInput = null;
    }, 0);
    if (event.target === active) window.setTimeout(() => {
      if (active && document.activeElement !== active && !panel.hidden) close(false);
    }, 40);
  }, true);
  document.addEventListener("input", event => {
    if (event.target === active) {
      active.removeAttribute("aria-invalid");
      sync();
      const field = active;
      window.setTimeout(() => {
        if (active !== field) return;
        const page = field.closest(".page"), modal = field.closest(".modal");
        if ((page && !page.classList.contains("active")) || (modal && modal.classList.contains("hidden"))) close(true);
      }, 0);
    }
  }, true);
  document.addEventListener("keydown", physicalKey, true);
  document.addEventListener("paste", paste, true);
  document.addEventListener("pointerdown", outsidePointer, true);
  document.addEventListener("submit", validateForm, true);
  document.addEventListener("reset", event => window.setTimeout(() => {
    if (active && active.form === event.target) close(false);
  }, 0), true);
  panel.addEventListener("pointerdown", event => { if (event.target.closest("button")) event.preventDefault(); });
  panel.addEventListener("click", panelAction);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") close(false); });
  window.addEventListener("pagehide", () => close(false));

  function viewportChanged() {
    if (!window.visualViewport) return;
    document.documentElement.style.setProperty("--stockmate-visual-viewport-height", window.visualViewport.height + "px");
    if (active && !panel.hidden) scheduleScroll();
    else if (nativeInput && document.activeElement === nativeInput) scheduleNativeScroll();
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", viewportChanged);
    window.visualViewport.addEventListener("scroll", viewportChanged);
    viewportChanged();
  }
  window.StockMateInput = { open, close: () => close(true), refresh: () => scan(document), core };
  window.StockMateInputCore = core;
})();