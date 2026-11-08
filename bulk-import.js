(() => {
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const PREVIEW_LIMIT = 40;
  const fields = [
    { key: "name", label: "اسم المنتج", aliases: ["name", "product", "product name", "اسم", "اسم المنتج", "المنتج"], required: true },
    { key: "brand", label: "العلامة التجارية", aliases: ["brand", "manufacturer", "العلامة التجارية", "العلامة", "الشركة"] },
    { key: "flavor", label: "النكهة", aliases: ["flavor", "taste", "النكهة", "الطعم"] },
    { key: "size", label: "الحجم", aliases: ["size", "unit", "الحجم", "السعة"] },
    { key: "barcode", label: "الباركود", aliases: ["barcode", "bar code", "sku", "الباركود", "رمز المنتج"] },
    { key: "fridge", label: "كمية البراد", aliases: ["fridge", "cooler", "كمية البراد", "البراد"] },
    { key: "store", label: "كمية المخزن", aliases: ["store", "warehouse", "كمية المخزن", "المخزن"] },
    { key: "target", label: "هدف البراد", aliases: ["target", "target quantity", "هدف البراد", "الهدف"] },
    { key: "minStore", label: "حد المخزن الأدنى", aliases: ["minstore", "minimum store", "حد المخزن الأدنى", "حد المخزن"] },
    { key: "cartonSize", label: "عدد القطع في الكرتون", aliases: ["cartonsize", "carton size", "عدد القطع في الكرتون", "حجم الكرتون"] },
    { key: "shelf", label: "الرف", aliases: ["shelf", "رف", "الرف"] },
    { key: "section", label: "القسم", aliases: ["section", "قسم", "القسم"] },
    { key: "location", label: "الموقع", aliases: ["location", "الموقع", "رمز الموقع"] },
    { key: "locationType", label: "نوع الموقع", aliases: ["locationtype", "location type", "نوع الموقع"] },
    { key: "expiry", label: "تاريخ الصلاحية", aliases: ["expiry", "expiration", "expiry date", "تاريخ الصلاحية", "الصلاحية"] },
    { key: "notes", label: "ملاحظات", aliases: ["notes", "note", "ملاحظات", "ملاحظة"] }
  ];
  const numericFields = new Set(["fridge", "store", "target", "minStore", "cartonSize"]);
  const defaults = { fridge: 0, store: 0, target: 0, minStore: 0, cartonSize: 1 };
  const el = id => document.getElementById(id);
  const state = { workbook: null, rows: [], headers: [], mapping: {}, fileName: "", isCSV: false, saving: false, completed: false };

  const normalizeHeader = value => String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ـ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, "");

  function setStatus(message, isError = false) {
    const status = el("bulkImportStatus");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function showError(message) {
    const box = el("bulkImportErrors");
    box.textContent = message;
    box.classList.remove("hidden");
    setStatus(message, true);
  }

  function clearError() {
    el("bulkImportErrors").textContent = "";
    el("bulkImportErrors").classList.add("hidden");
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r\n|\n|\r/, 1)[0] || "";
    const candidates = [",", ";", "\t"];
    let best = ",";
    let maximum = -1;
    for (const delimiter of candidates) {
      let count = 0;
      let quoted = false;
      for (let index = 0; index < firstLine.length; index += 1) {
        if (firstLine[index] === '"') {
          if (quoted && firstLine[index + 1] === '"') index += 1;
          else quoted = !quoted;
        } else if (firstLine[index] === delimiter && !quoted) count += 1;
      }
      if (count > maximum) {
        maximum = count;
        best = delimiter;
      }
    }
    return best;
  }

  function parseCSV(text, delimiter) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          value += character;
        }
      } else if (character === '"' && value.length === 0) {
        quoted = true;
      } else if (character === delimiter) {
        row.push(value);
        value = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }
    if (quoted) throw new Error("يوجد اقتباس غير مكتمل في ملف CSV.");
    row.push(value);
    if (row.some(cell => String(cell).trim())) rows.push(row);
    return rows;
  }

  function loadSpreadsheetLibrary() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.bulkXlsxLoad) return window.bulkXlsxLoad;
    window.bulkXlsxLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      script.integrity = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (window.XLSX) resolve(window.XLSX);
        else {
          window.bulkXlsxLoad = null;
          reject(new Error("تعذر تهيئة قارئ Excel."));
        }
      };
      script.onerror = () => {
        window.bulkXlsxLoad = null;
        reject(new Error("تعذر تحميل قارئ Excel. اتصل بالإنترنت مرة واحدة لقراءة ملفات Excel."));
      };
      document.head.appendChild(script);
    });
    return window.bulkXlsxLoad;
  }

  function normalizeSpreadsheetDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = normalizeDigits(String(value ?? "").trim());
    if (!text) return "";
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
      const [year, month, day] = text.split("-").map(Number);
      return validDate(year, month, day);
    }
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) {
      const [year, month, day] = text.split("/").map(Number);
      return validDate(year, month, day);
    }
    const dmy = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
    if (dmy) {
      let first = Number(dmy[1]);
      let second = Number(dmy[2]);
      let year = Number(dmy[3]);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      if (second > 12) [first, second] = [second, first];
      return validDate(year, second, first);
    }
    const serial = Number(text);
    if (Number.isFinite(serial) && serial >= 1 && serial <= 2958465) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return date.toISOString().slice(0, 10);
    }
    return "";
  }

  function validDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function normalizeDigits(value) {
    return String(value).replace(/[٠-٩۰-۹]/g, digit => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
  }

  function importExcel(file) {
    return loadSpreadsheetLibrary().then(XLSX => file.arrayBuffer().then(buffer => {
      state.workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      if (!state.workbook.SheetNames.length) throw new Error("لا يحتوي ملف Excel على أوراق.");
      const select = el("workbookSheet");
      select.innerHTML = state.workbook.SheetNames.map((name, index) =>
        `<option value="${index}">${escapeHTML(name)}</option>`
      ).join("");
      el("workbookSheetWrap").classList.toggle("hidden", state.workbook.SheetNames.length < 2);
      renderExcelSheet();
    }));
  }

  function renderExcelSheet() {
    if (!state.workbook) return;
    const XLSX = window.XLSX;
    const index = Number(el("workbookSheet").value || 0);
    const sheet = state.workbook.Sheets[state.workbook.SheetNames[index]];
    if (!sheet) throw new Error("تعذر قراءة ورقة Excel المحددة.");
    state.rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: true });
    prepareRows();
  }

  function renderCSV(file) {
    return file.text().then(text => {
      text = text.replace(/^\uFEFF/, "");
      const selected = el("csvDelimiter").value;
      const delimiter = selected === "auto" ? detectDelimiter(text) : selected === "tab" ? "\t" : selected;
      state.rows = parseCSV(text, delimiter);
      el("csvDelimiterWrap").classList.remove("hidden");
      prepareRows();
    });
  }

  function prepareRows() {
    if (!state.rows.length || !state.rows[0].some(cell => String(cell).trim())) {
      throw new Error("الملف فارغ أو لا يحتوي على صف عناوين في بدايته.");
    }
    state.headers = state.rows[0].map((header, index) => String(header ?? "").trim() || `عمود ${index + 1}`);
    const normalizedHeaders = state.headers.map(normalizeHeader);
    state.mapping = {};
    for (const field of fields) {
      const aliases = new Set(field.aliases.map(normalizeHeader));
      const index = normalizedHeaders.findIndex(header => aliases.has(header));
      state.mapping[field.key] = index < 0 ? "" : String(index);
    }
    renderMapping();
    evaluateRows();
    const dataRows = state.rows.slice(1).filter(row => row.some(cell => String(cell).trim())).length;
    setStatus(`تمت قراءة ${dataRows} صفاً من الملف. راجع المطابقة والمعاينة قبل الإضافة.`);
  }

  function renderMapping() {
    const columns = el("bulkColumnMapping");
    columns.innerHTML = fields.map(field => {
      const options = ['<option value="">غير مستخدم</option>'].concat(state.headers.map((header, index) =>
        `<option value="${index}" ${state.mapping[field.key] === String(index) ? "selected" : ""}>${escapeHTML(header)}</option>`
      ));
      return `<label class="bulk-map-field"><span>${escapeHTML(field.label)}${field.required ? " *" : ""}</span><select data-import-field="${field.key}">${options.join("")}</select></label>`;
    }).join("");
  }

  function parseNonnegativeInteger(value, label) {
    const normalized = normalizeDigits(String(value ?? "").trim()).replace(/[٬,]/g, "");
    if (!normalized) return { empty: true };
    const number = Number(normalized);
    if (!Number.isSafeInteger(number) || number < 0) return { error: `${label}: أدخل عدداً صحيحاً غير سالب.` };
    return { value: number };
  }

  function readCell(row, field) {
    const column = state.mapping[field.key];
    return column === "" || column === undefined ? "" : String(row[Number(column)] ?? "").trim();
  }

  function resolveShelf(value) {
    const normalized = normalizeHeader(value);
    if (!normalized) return shelves[0] || null;
    return shelves.find(shelf =>
      String(shelf.id) === value.trim() ||
      normalizeHeader(shelf.name) === normalized ||
      (String(shelf.id) === "1" && ["1", "رف1", "الرف1", "shelf1", "shelfone"].includes(normalized)) ||
      (String(shelf.id) === "2" && ["2", "رف2", "الرف2", "shelf2", "shelftwo"].includes(normalized))
    ) || null;
  }

  function resolveSection(shelf, value) {
    if (!value) return shelf?.sections?.[0] || null;
    const normalized = normalizeHeader(value);
    return shelf?.sections?.find(section =>
      String(section.id) === value.trim() || normalizeHeader(section.name) === normalized
    ) || null;
  }

  function identityKeys(product) {
    const barcode = String(product.barcode || "").trim();
    const natural = [product.name, product.brand, product.size]
      .map(value => normalizeHeader(value))
      .join("|");
    const keys = [];
    if (barcode) keys.push(`barcode:${barcode}`);
    if (natural.replace(/\|/g, "")) keys.push(`name:${natural}`);
    return keys;
  }

  const matchKeys = product => identityKeys(product).filter(key =>
    product.barcode ? key.startsWith("barcode:") : key.startsWith("name:")
  );
  const primaryIdentity = product => matchKeys(product)[0] || "";

  function validateRow(row, rowNumber) {
    const product = {};
    const errors = [];
    const mappedFields = new Set(fields.filter(field => state.mapping[field.key] !== "").map(field => field.key));
    for (const field of fields) {
      if (!mappedFields.has(field.key)) continue;
      const cell = readCell(row, field);
      if (field.required && !cell) errors.push(`حقل «${field.label}» مطلوب.`);
      if (numericFields.has(field.key)) {
        const parsed = parseNonnegativeInteger(cell, field.label);
        if (parsed.error) errors.push(parsed.error);
        else if (!parsed.empty) product[field.key] = parsed.value;
      } else if (field.key === "expiry") {
        if (cell) {
          const date = normalizeSpreadsheetDate(cell);
          if (!date) errors.push("تاريخ الصلاحية غير صالح؛ استخدم YYYY-MM-DD.");
          else product.expiry = date;
        }
      } else if (field.key === "shelf") {
        if (cell) {
          const shelf = resolveShelf(cell);
          if (!shelf) errors.push(`الرف «${cell}» غير موجود.`);
          else product.shelf = String(shelf.id);
        }
      } else if (field.key === "section") {
        if (cell) product.sectionInput = cell;
      } else if (field.key === "locationType") {
        if (cell) {
          const normalized = normalizeHeader(cell);
          if (["fixed", "ثابت", "موقعثابت"].includes(normalized)) product.locationType = "fixed";
          else if (["variable", "متغير", "موقعمتغير"].includes(normalized)) product.locationType = "variable";
          else errors.push(`نوع الموقع «${cell}» غير معروف؛ استخدم ثابت أو متغير.`);
        }
      } else if (cell || field.required) {
        product[field.key] = cell;
      }
    }
    if (!product.name) errors.push("تعذر تحديد اسم المنتج من العمود المطابق.");
    let shelf = product.shelf ? shelves.find(item => String(item.id) === String(product.shelf)) : null;
    if (product.sectionInput) {
      const sectionMatches = shelf
        ? [{ shelf, section: resolveSection(shelf, product.sectionInput) }].filter(item => item.section)
        : shelves.flatMap(item => {
          const section = resolveSection(item, product.sectionInput);
          return section ? [{ shelf: item, section }] : [];
        });
      if (!sectionMatches.length) errors.push(`القسم «${product.sectionInput}» غير موجود.`);
      else {
        const match = sectionMatches[0];
        shelf = match.shelf;
        product.shelf = String(match.shelf.id);
        product.section = match.section.id;
      }
    }
    delete product.sectionInput;
    if (shelf) {
      product.shelf = String(shelf.id);
      if (!product.section) product.section = shelf.sections?.[0]?.id || "";
    }
    if (errors.length) return { rowNumber, product, errors, state: "invalid" };
    return { rowNumber, product, errors: [], state: "valid", mappedFields };
  }

  function evaluateRows(existingProducts = products) {
    clearError();
    const selectedColumns = Object.entries(state.mapping).filter(([, column]) => column !== "");
    const duplicateColumns = selectedColumns.filter(([, column], index) =>
      selectedColumns.findIndex(([, other]) => other === column) !== index
    );
    if (!state.mapping.name || duplicateColumns.length) {
      const message = !state.mapping.name
        ? "عيّن عمود «اسم المنتج» أولاً."
        : "لا يمكن مطابقة العمود نفسه مع أكثر من حقل.";
      showError(message);
      el("commitBulkImport").disabled = true;
      el("bulkSummary").innerHTML = "";
      el("bulkPreviewHead").innerHTML = "";
      el("bulkPreviewBody").innerHTML = "";
      el("bulkPreviewCount").textContent = "";
      return;
    }

    const existingByKey = new Map();
    for (const product of existingProducts) {
      for (const key of identityKeys(product)) {
        if (!existingByKey.has(key)) existingByKey.set(key, product);
      }
    }
    const seenInFile = new Set();
    state.validated = state.rows.slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) => row.some(cell => String(cell).trim()))
      .map(({ row, rowNumber }) => {
      const item = validateRow(row, rowNumber);
      if (item.state !== "valid") return item;
      const keys = matchKeys(item.product);
      const identity = primaryIdentity(item.product);
      if (identity && seenInFile.has(identity)) {
        item.state = "invalid";
        item.errors.push("المنتج مكرر داخل الملف؛ احتفظ بصف واحد فقط.");
        return item;
      }
      if (identity) seenInFile.add(identity);
      item.existing = keys.map(key => existingByKey.get(key)).find(Boolean) || null;
      if (item.existing && item.product.section && item.mappedFields.has("section") && !item.mappedFields.has("shelf")) {
        const existingShelf = shelves.find(shelf => String(shelf.id) === String(item.existing.shelf));
        const section = resolveSection(existingShelf, readCell(row, fields.find(field => field.key === "section")));
        if (!section) {
          item.state = "invalid";
          item.errors.push("حدد الرف عند نقل منتج موجود إلى قسم في رف آخر.");
          return item;
        }
        item.product.shelf = String(existingShelf.id);
        item.product.section = section.id;
      }
      item.state = item.existing ? "duplicate" : "new";
      return item;
    });

    const counts = { new: 0, duplicate: 0, invalid: 0, actionable: 0 };
    for (const item of state.validated) {
      if (item.state === "new") counts.new += 1;
      else if (item.state === "duplicate") counts.duplicate += 1;
      else counts.invalid += 1;
    }
    const updateExisting = el("bulkDuplicatePolicy").value === "update";
    counts.actionable = counts.new + (updateExisting ? counts.duplicate : 0);
    el("bulkSummary").innerHTML = [
      ["سيُضاف", counts.new, "new"],
      [updateExisting ? "سيُحدّث" : "مكرر (سيُتخطى)", counts.duplicate, "duplicate"],
      ["صفوف غير صالحة", counts.invalid, "invalid"]
    ].map(([label, count, kind]) => `<span class="bulk-count ${kind}"><b>${count}</b>${label}</span>`).join("");
    el("bulkPreviewHead").innerHTML = "<tr><th>الصف</th><th>المنتج</th><th>الباركود</th><th>الحالة</th><th>التفاصيل</th></tr>";
    el("bulkPreviewBody").innerHTML = state.validated.slice(0, PREVIEW_LIMIT).map(item => {
      const status = item.state === "new" ? "جديد" : item.state === "duplicate" ? "مكرر" : "غير صالح";
      const detail = item.errors.join(" ") || (item.existing ? "مطابق لمنتج موجود" : "جاهز للإضافة");
      return `<tr class="row-${item.state}"><td>${item.rowNumber}</td><td>${escapeHTML(item.product.name || "—")}</td><td>${escapeHTML(item.product.barcode || "—")}</td><td>${status}</td><td>${escapeHTML(detail)}</td></tr>`;
    }).join("");
    el("bulkPreviewCount").textContent = `معاينة ${Math.min(PREVIEW_LIMIT, state.validated.length)} من ${state.validated.length} صفاً`;
    el("commitBulkImport").disabled = !counts.actionable || state.saving || state.completed;
    setStatus(`${counts.actionable} منتج جاهز للإضافة أو التحديث.`);
  }

  function getNewProduct(item) {
    const product = { id: uid(), name: "", barcode: "", location: "", notes: "", expiry: "", ...defaults };
    for (const key of item.mappedFields) {
      if (numericFields.has(key)) product[key] = item.product[key] ?? defaults[key];
      else if (key in item.product) product[key] = item.product[key];
    }
    for (const key of ["shelf", "section", "locationType"]) {
      if (item.product[key] !== undefined) product[key] = item.product[key];
    }
    if (!product.locationType) product.locationType = "fixed";
    const shelf = shelves.find(item => String(item.id) === String(product.shelf)) || shelves[0];
    if (shelf) {
      product.shelf = String(shelf.id);
      if (!product.section) product.section = shelf.sections?.[0]?.id || "";
    }
    product.created = Date.now();
    return product;
  }

  function makeUpdatedProduct(item) {
    const existing = item.existing;
    const updated = { ...existing };
    for (const key of item.mappedFields) {
      const value = item.product[key];
      if (value !== undefined && value !== "") updated[key] = value;
    }
    for (const key of ["shelf", "section", "locationType"]) {
      if (item.product[key] !== undefined) updated[key] = item.product[key];
    }
    return updated;
  }

  function saveBatch() {
    const updateExisting = el("bulkDuplicatePolicy").value === "update";
    return new Promise((resolve, reject) => {
      let added = 0;
      let updated = 0;
      let skipped = 0;
      let transaction;
      try {
        transaction = db.transaction("products", "readwrite");
        const productStore = transaction.objectStore("products");
        const read = productStore.getAll();
        read.onsuccess = () => {
          const currentByKey = new Map();
          for (const product of read.result) {
            for (const key of identityKeys(product)) {
              if (!currentByKey.has(key)) currentByKey.set(key, product);
            }
          }
          const fileKeys = new Set();
          for (const item of state.validated) {
            if (item.state === "invalid") continue;
            const keys = matchKeys(item.product);
            const identity = primaryIdentity(item.product);
            if (identity && fileKeys.has(identity)) {
              skipped += 1;
              continue;
            }
            if (identity) fileKeys.add(identity);
            const existing = keys.map(key => currentByKey.get(key)).find(Boolean) || null;
            if (existing) {
              if (!updateExisting) {
                skipped += 1;
                continue;
              }
              item.existing = existing;
              const product = makeUpdatedProduct(item);
              productStore.put(product);
              currentByKey.set(identity, product);
              updated += 1;
            } else {
              const product = getNewProduct(item);
              productStore.add(product);
              for (const key of identityKeys(product)) currentByKey.set(key, product);
              added += 1;
            }
          }
        };
        read.onerror = () => {
          try { transaction.abort(); } catch {}
        };
        transaction.oncomplete = () => resolve({ added, updated, skipped });
        transaction.onerror = () => reject(transaction.error || new Error("تعذر حفظ المنتجات المستوردة."));
        transaction.onabort = () => reject(transaction.error || new Error("أُلغي حفظ المنتجات؛ لم تُضف أي بيانات."));
      } catch (error) {
        reject(error);
      }
    });
  }

  function resetImport() {
    state.workbook = null;
    state.rows = [];
    state.headers = [];
    state.mapping = {};
    state.fileName = "";
    state.isCSV = false;
    state.completed = false;
    el("bulkFile").value = "";
    el("bulkImportPanel").classList.add("hidden");
    el("workbookSheetWrap").classList.add("hidden");
    el("csvDelimiterWrap").classList.add("hidden");
    el("bulkColumnMapping").innerHTML = "";
    el("bulkSummary").innerHTML = "";
    el("bulkImportErrors").innerHTML = "";
    el("bulkImportErrors").classList.add("hidden");
    el("bulkPreviewHead").innerHTML = "";
    el("bulkPreviewBody").innerHTML = "";
    el("bulkPreviewCount").textContent = "";
    el("commitBulkImport").disabled = true;
    setStatus("");
  }

  el("bulkFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    resetImport();
    el("bulkImportPanel").classList.remove("hidden");
    el("bulkFileName").textContent = file.name;
    state.fileName = file.name;
    if (file.size > MAX_FILE_SIZE) {
      showError("حجم الملف يتجاوز الحد المسموح (50 ميغابايت).");
      return;
    }
    try {
      const extension = file.name.split(".").pop().toLowerCase();
      if (extension === "csv") {
        state.isCSV = true;
        await renderCSV(file);
      } else if (extension === "xlsx" || extension === "xls") {
        await importExcel(file);
      } else {
        throw new Error("صيغة غير مدعومة. اختر ملف CSV أو XLSX أو XLS.");
      }
    } catch (error) {
      console.error("Bulk import file reading failed", error);
      showError(error.message || "تعذرت قراءة الملف.");
    }
  });

  el("workbookSheet").addEventListener("change", () => {
    try {
      renderExcelSheet();
    } catch (error) {
      showError(error.message || "تعذرت قراءة ورقة Excel.");
    }
  });

  el("csvDelimiter").addEventListener("change", async () => {
    const file = el("bulkFile").files?.[0];
    if (!file || !state.isCSV) return;
    try {
      await renderCSV(file);
    } catch (error) {
      showError(error.message || "تعذرت قراءة ملف CSV.");
    }
  });

  el("bulkColumnMapping").addEventListener("change", event => {
    const key = event.target.dataset.importField;
    if (!key) return;
    state.mapping[key] = event.target.value;
    evaluateRows();
  });
  el("bulkDuplicatePolicy").addEventListener("change", () => evaluateRows());
  el("cancelBulkImport").addEventListener("click", () => {
    if (!state.saving) resetImport();
  });

  el("downloadImportTemplate").addEventListener("click", () => {
    const headers = fields.map(field => field.label);
    const sample = ["مثال منتج", "العلامة التجارية", "نكهة اختيارية", "500 مل", "1234567890123", "0", "12", "8", "4", "12", "1", "القسم العلوي", "A-01", "ثابت", "", "ملاحظة اختيارية"];
    const csv = `\uFEFF${headers.join(",")}\r\n${sample.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "نموذج-استيراد-المنتجات.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  el("commitBulkImport").addEventListener("click", async () => {
    if (state.saving || !state.validated?.length) return;
    state.saving = true;
    el("commitBulkImport").disabled = true;
    el("bulkFile").disabled = true;
    el("cancelBulkImport").disabled = true;
    setStatus("جارٍ التحقق من المنتجات وحفظها في قاعدة البيانات...");
    try {
      const result = await saveBatch();
      await reload();
      state.saving = false;
      state.completed = true;
      el("bulkFile").disabled = false;
      el("cancelBulkImport").disabled = false;
      const parts = [`أُضيف ${result.added} منتج`];
      if (result.updated) parts.push(`حُدّث ${result.updated}`);
      if (result.skipped) parts.push(`تُخطّي ${result.skipped} مكرر`);
      setStatus(`اكتمل الاستيراد: ${parts.join("، ")}. البيانات الحالية الأخرى لم تتغير.`);
      evaluateRows();
      el("commitBulkImport").disabled = true;
      setStatus(`اكتمل الاستيراد: ${parts.join("، ")}. البيانات الحالية الأخرى لم تتغير.`);
    } catch (error) {
      console.error("Bulk import save failed", error);
      state.saving = false;
      el("bulkFile").disabled = false;
      el("cancelBulkImport").disabled = false;
      evaluateRows();
      showError(error.message || "تعذر حفظ المنتجات؛ لم تُعتمد الدفعة.");
    }
  });

  (async () => {
    while (typeof db === "undefined" || !db || !shelves?.length) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    products = await all("products");
  })().catch(error => {
    console.error("Could not initialize bulk import", error);
    setStatus("تعذر تجهيز استيراد المنتجات.");
  });
})();
