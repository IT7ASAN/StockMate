(() => {
  let shelfImage = "";
  let scannerControls = null;
  let zxingReader = null;
  let zxingLoadPromise = null;
  let movementPreviewProductId = "";
  let previousAdjustment = false;
  let movementFilter = "all";
  const defaultShelves = () => [
    { id: "1", name: "الرف الأول", location: "المنطقة الأولى", image: "", sections: defaultSections("1"), created: Date.now() },
    { id: "2", name: "الرف الثاني", location: "المنطقة الثانية", image: "", sections: defaultSections("2"), created: Date.now() + 1 }
  ];

  function defaultSections(shelfId) {
    return [
      { id: `${shelfId}-a`, name: "القسم العلوي", type: "open-shelf", shape: "wide" },
      { id: `${shelfId}-b`, name: "القسم الأوسط", type: "open-shelf", shape: "standard" },
      { id: `${shelfId}-c`, name: "القسم السفلي", type: "box", shape: "square" }
    ];
  }

  const shelfLabel = id => shelves.find(shelf => String(shelf.id) === String(id))?.name || "رف غير محدد";
  const sectionName = (shelfId, sectionId) =>
    shelves.find(shelf => String(shelf.id) === String(shelfId))?.sections?.find(section => String(section.id) === String(sectionId))?.name || "قسم غير محدد";
  const sectionTypeName = type => ({
    "open-shelf": "رف مفتوح", drawer: "درج", box: "صندوق", cooler: "قسم مبرد"
  })[type] || "رف مفتوح";
  const formatNumber = value => new Intl.NumberFormat("ar-IQ").format(value);
  const movementCategory = movement => {
    if (movement.label === "جرد فعلي") return "adjust";
    if (movement.label?.includes("إضافة")) return "add";
    if (movement.label?.includes("سحب")) return "remove";
    return "transfer";
  };

  function renderMovementHistory() {
    const history = movements.filter(item => movementFilter === "all" || movementCategory(item) === movementFilter);
    $("movementHistory").className = history.length ? "stack movement-history" : "stack empty-state";
    $("movementHistory").innerHTML = history.slice(0, 30).map(item => {
      const category = movementCategory(item);
      const icon = category === "add" ? "＋" : category === "remove" ? "−" : category === "adjust" ? "≋" : "↗";
      return `<article class="movement-history-card type-${category}">
        <span class="movement-history-icon">${icon}</span>
        <div class="movement-history-info"><b>${escapeHTML(item.productName)}</b><span>${escapeHTML(item.label)}</span><small>${new Date(item.time).toLocaleString("ar-IQ")}${item.shelfName ? ` · ${escapeHTML(item.shelfName)}` : ""}${item.sectionName ? ` / ${escapeHTML(item.sectionName)}` : ""}</small>${item.note ? `<small>${escapeHTML(item.note)}</small>` : ""}</div>
        <strong>${formatNumber(item.qty)} <small>قطعة</small></strong>
      </article>`;
    }).join("") || "لا توجد حركات في هذا التصنيف.";
  }

  function syncShelfOptions() {
    const select = $("pShelf");
    if (!select) return;
    const selected = select.value;
    select.innerHTML = shelves.map(shelf =>
      `<option value="${escapeHTML(shelf.id)}">${escapeHTML(shelf.name)}</option>`
    ).join("");
    if (shelves.some(shelf => String(shelf.id) === String(selected))) select.value = selected;
    else if (shelves.length) select.value = String(shelves[0].id);
    syncSectionOptions();
  }

  function syncSectionOptions(selected) {
    const shelfId = $("pShelf").value || "1";
    const shelf = shelves.find(item => String(item.id) === String(shelfId));
    const select = $("pSection");
    if (!select) return;
    const value = selected ?? select.value;
    select.innerHTML = (shelf?.sections || []).map(section =>
      `<option value="${escapeHTML(section.id)}">${escapeHTML(section.name)} · ${escapeHTML(sectionTypeName(section.type))}</option>`
    ).join("");
    if (shelf?.sections?.some(section => String(section.id) === String(value))) select.value = value;
    else if (shelf?.sections?.length) select.value = shelf.sections[0].id;
  }

  function renderShelves() {
    const list = $("shelfList");
    if (!list) return;
    list.innerHTML = shelves.map(shelf => {
      return `<section class="shelf-section" aria-labelledby="shelf-heading-${escapeHTML(shelf.id)}">
        <header class="shelf-section-head">
          ${shelf.image ? `<img class="shelf-photo" src="${escapeHTML(shelf.image)}" alt="صورة ${escapeHTML(shelf.name)}">` : '<div class="shelf-photo shelf-placeholder">▤</div>'}
          <div class="shelf-card-info"><span class="eyebrow">الرف ${escapeHTML(shelf.id)}</span><h2 id="shelf-heading-${escapeHTML(shelf.id)}">${escapeHTML(shelf.name)}</h2><small>${escapeHTML(shelf.location || "لم يحدد الموقع")}</small><small>${formatNumber(shelf.sections.length)} أقسام</small></div>
          <button type="button" class="small-btn" data-edit-shelf="${escapeHTML(shelf.id)}">تعديل بيانات الرف</button>
        </header>
        <p class="shelf-section-help">قسّم الرف حسب نوع التخزين وشكله. أضف الأقسام وعدّلها هنا، ثم اختر القسم من نموذج المنتج.</p>
        <div class="section-grid">${shelf.sections.map(section => {
          const shelfProducts = products
            .filter(product => String(product.shelf || "1") === String(shelf.id) &&
              String(product.section || shelf.sections[0]?.id) === String(section.id))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          return `<article class="storage-section shape-${escapeHTML(section.shape || "standard")} type-${escapeHTML(section.type || "open-shelf")}">
            <header class="storage-section-head"><div class="section-shape-icon" aria-hidden="true"><i></i><i></i><i></i></div><div class="storage-section-title"><b>${escapeHTML(section.name)}</b><span>${escapeHTML(sectionTypeName(section.type))} · ${escapeHTML(({wide:"مستطيل عريض",standard:"مستطيل",square:"مربع"})[section.shape] || "مستطيل")}</span></div><div class="storage-section-actions"><button type="button" class="small-btn" data-edit-section="${escapeHTML(section.id)}" data-section-shelf="${escapeHTML(shelf.id)}">تعديل</button><button type="button" class="small-btn delete" data-delete-section="${escapeHTML(section.id)}" data-section-shelf="${escapeHTML(shelf.id)}">حذف</button></div></header>
            <div class="section-products">${shelfProducts.map(product =>
              `<article class="shelf-product"><div class="shelf-product-info"><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · "))}</small><small>الموقع: ${escapeHTML(product.location || "غير محدد")}</small></div><div class="shelf-product-quantities"><span>البراد <b>${formatNumber(product.fridge || 0)}</b></span><span>المخزن <b>${formatNumber(product.store || 0)}</b></span></div><button type="button" class="small-btn" data-edit="${escapeHTML(product.id)}">تعديل</button></article>`
            ).join("") || '<div class="shelf-empty">القسم فارغ — اختره عند إضافة أو تعديل منتج.</div>'}</div>
          </article>`;
        }).join("")}<button type="button" class="add-section-card" data-add-section="${escapeHTML(shelf.id)}"><span>＋</span><b>إضافة قسم</b><small>اختر نوعه وشكله</small></button></div>
      </section>`;
    }).join("");
  }

  window.renderMap = function () {
    return;
  };

  window.renderProducts = function () {
    const query = $("productSearch").value.trim().toLowerCase();
    let list = products.filter(product =>
      [product.name, product.brand, product.flavor, product.size, product.barcode, product.location]
        .join(" ").toLowerCase().includes(query)
    );
    if (currentFilter === "low") list = list.filter(low);
    if (currentFilter === "fixed") list = list.filter(product => product.locationType === "fixed");
    if (currentFilter === "variable") list = list.filter(product => product.locationType === "variable");
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    $("productList").className = list.length ? "stack" : "stack empty-state";
    $("productList").innerHTML = list.map(product =>
      `<article class="product-card">
        <div class="card-top"><div class="product-main">${product.image ? `<img class="product-thumb" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}">` : '<div class="product-thumb placeholder">▣</div>'}<div>
          <div class="product-name">${escapeHTML(product.name)}</div>
          <div class="subline">${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · "))}</div>
          <div class="subline">${product.barcode ? `باركود: ${escapeHTML(product.barcode)}` : "بدون باركود"}</div>
        </div></div><button class="small-btn" data-edit="${escapeHTML(product.id)}">تعديل</button></div>
        <div><span class="tag">${product.locationType === "fixed" ? "موقع ثابت" : "موقع متغير"}</span><span class="tag">${escapeHTML(shelfLabel(product.shelf))} · ${escapeHTML(sectionName(product.shelf || "1", product.section))} · ${escapeHTML(product.location || "غير محدد")}</span>${product.isDemo ? '<span class="tag demo-tag">بيانات تجريبية</span>' : ""}${low(product) ? '<span class="tag warn">نقص في البراد</span>' : ""}${storeLow(product) ? '<span class="tag bad">مخزون المخزن منخفض</span>' : ""}</div>
        <div class="qty-grid"><div class="qty-box"><small>البراد</small><b>${formatNumber(product.fridge || 0)}</b></div><div class="qty-box"><small>المخزن</small><b>${formatNumber(product.store || 0)}</b></div><div class="qty-box"><small>هدف البراد</small><b>${formatNumber(product.target || 0)}</b></div></div>
        <div class="card-actions"><button class="small-btn" data-move="${escapeHTML(product.id)}">تسجيل حركة</button><button class="small-btn" data-show-barcode="${escapeHTML(product.id)}">عرض الباركود</button><button class="small-btn delete" data-delete="${escapeHTML(product.id)}">حذف</button></div>
      </article>`
    ).join("") || "لا توجد نتائج مطابقة.";
  };

  window.renderReplenish = function () {
    const list = products.filter(product => refill(product) > 0).sort((a, b) =>
      String(a.shelf || "1").localeCompare(String(b.shelf || "1")) ||
      String(a.section || "").localeCompare(String(b.section || "")) ||
      String(a.location || "ZZ").localeCompare(String(b.location || "ZZ"))
    );
    $("replenishItems").textContent = list.length;
    $("replenishUnits").textContent = list.reduce((sum, product) => sum + availableToMove(product), 0);
    $("shortageUnits").textContent = list.reduce((sum, product) => sum + shortage(product), 0);
    $("replenishList").className = list.length ? "stack" : "stack empty-state";
    let activeGroup = "";
    $("replenishList").innerHTML = list.map(product => {
      const available = availableToMove(product);
      const group = `${product.shelf || "1"}:${product.section || ""}`;
      const heading = group === activeGroup ? "" : `<h3 class="replenish-group-head">${escapeHTML(shelfLabel(product.shelf))}<span>${escapeHTML(sectionName(product.shelf || "1", product.section))}</span></h3>`;
      activeGroup = group;
      return `${heading}<article class="replenish-card">
        <div class="replenish-product">
          <div class="replenish-product-heading"><div><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · "))}</small></div><span class="replenish-location">${escapeHTML(shelfLabel(product.shelf))} · ${escapeHTML(sectionName(product.shelf || "1", product.section))} · ${escapeHTML(product.location || "موقع غير محدد")}</span></div>
          <div class="replenish-metrics"><span>البراد <b>${formatNumber(product.fridge || 0)} / ${formatNumber(product.target || 0)}</b></span><span>المطلوب <b>${formatNumber(refill(product))} قطعة</b></span><span>المخزن <b>${formatNumber(product.store || 0)} قطعة</b></span></div>
          ${shortage(product) > 0 ? `<div class="replenish-shortage">المتاح ${formatNumber(available)} قطعة · ينقص المخزن ${formatNumber(shortage(product))} قطعة</div>` : `<div class="replenish-ready">متوفر بالمخزن ما يكفي للكمية المطلوبة</div>`}
          <div class="replenish-action"><label>الكمية المنقولة<input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="${available}" step="1" value="${available || ""}" data-refill-qty="${escapeHTML(product.id)}" ${available ? "" : "disabled"}></label><button type="button" class="primary" data-refill-product="${escapeHTML(product.id)}" ${available ? "" : "disabled"}>نقل للبراد</button></div>
        </div>
      </article>`;
    }).join("") || "لا توجد منتجات تحتاج إلى تعبئة.";
  };

  $("replenishList").addEventListener("click", async event => {
    const button = event.target.closest("[data-refill-product]");
    if (!button) return;
    const product = products.find(item => item.id === button.dataset.refillProduct);
    const quantityInput = [...$("replenishList").querySelectorAll("[data-refill-qty]")]
      .find(input => input.dataset.refillQty === button.dataset.refillProduct);
    const quantity = Number(quantityInput?.value);
    if (!product || !Number.isInteger(quantity) || quantity < 1) return toast("أدخل كمية نقل صحيحة");
    const max = availableToMove(product);
    if (quantity > max) return toast(`الحد الأقصى المتاح للنقل ${max} قطعة`);
    const updated = { ...product, store: Number(product.store || 0) - quantity, fridge: Number(product.fridge || 0) + quantity };
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "تعبئة من قائمة التعبئة", time: Date.now(),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section),
      note: `البراد ${Number(product.fridge || 0)} ← ${Number(product.fridge || 0) + quantity} · المخزن ${Number(product.store || 0)} ← ${Number(product.store || 0) - quantity}`
    };
    button.disabled = true;
    try {
      await saveMovementAtomically(updated, movement);
      await reload();
      toast(`تم نقل ${formatNumber(quantity)} قطعة إلى البراد`);
    } catch (error) {
      console.error("Could not save replenishment", error);
      button.disabled = false;
      toast("تعذر تسجيل التعبئة؛ لم يتغير المخزون");
    }
  });
  $("refreshTasks").onclick = window.renderReplenish;

  const originalRenderAll = window.renderAll;
  window.renderAll = function () {
    syncShelfOptions();
    originalRenderAll();
    renderShelves();
    renderMovementHistory();
  };
  document.querySelectorAll("[data-movement-filter]").forEach(button => button.addEventListener("click", () => {
    movementFilter = button.dataset.movementFilter;
    document.querySelectorAll("[data-movement-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderMovementHistory();
  }));
  const originalOpenProduct = window.openProduct;
  window.openProduct = function (product) {
    syncShelfOptions();
    originalOpenProduct(product);
    if (!shelves.some(shelf => String(shelf.id) === String($("pShelf").value)) && shelves.length) {
      $("pShelf").value = String(shelves[0].id);
    }
    syncSectionOptions(product?.section);
  };
  $("pShelf").addEventListener("change", () => syncSectionOptions());

  function openShelf(shelf) {
    $("shelfForm").reset();
    $("shelfId").value = shelf.id;
    $("shelfModalTitle").textContent = `تعديل بيانات ${shelf.name}`;
    $("shelfName").value = shelf?.name || "";
    $("shelfLocation").value = shelf?.location || "";
    shelfImage = shelf?.image || "";
    showShelfImagePreview();
    $("shelfModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    setTimeout(() => $("shelfName").focus({ preventScroll: true }), 100);
  }

  function openSection(shelf, section) {
    $("sectionForm").reset();
    $("sectionShelfId").value = shelf.id;
    $("sectionId").value = section?.id || "";
    $("sectionModalTitle").textContent = section ? `تعديل ${section.name}` : `إضافة قسم إلى ${shelf.name}`;
    $("sectionName").value = section?.name || "";
    $("sectionType").value = section?.type || "open-shelf";
    $("sectionShape").value = section?.shape || "standard";
    $("sectionModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    setTimeout(() => $("sectionName").focus({ preventScroll: true }), 100);
  }

  function showShelfImagePreview() {
    const preview = $("shelfImagePreview");
    if (shelfImage) {
      preview.classList.add("has-image");
      preview.innerHTML = `<img src="${escapeHTML(shelfImage)}" alt="معاينة صورة الرف"><button type="button" data-remove-shelf-image>حذف الصورة</button>`;
    } else {
      preview.classList.remove("has-image");
      preview.innerHTML = "<span>لم تتم إضافة صورة للرف</span>";
    }
  }

  $("shelfForm").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("shelfName").value.trim();
    if (!name) return toast("اكتب اسم الرف");
    const id = $("shelfId").value;
    const old = shelves.find(shelf => String(shelf.id) === String(id));
    if (!old) return toast("تعذر العثور على الرف");
    try {
      await put("shelves", {
        ...old,
        id, name, location: $("shelfLocation").value.trim(), image: shelfImage,
        created: old.created || Date.now()
      });
      closeModal("shelfModal");
      await reload();
      toast("تم تحديث بيانات الرف");
    } catch (error) {
      console.error("Could not save shelf", error);
      toast("تعذر حفظ بيانات الرف");
    }
  });
  $("shelfCamera").addEventListener("change", () => handleShelfImage("shelfCamera"));
  $("shelfGallery").addEventListener("change", () => handleShelfImage("shelfGallery"));
  $("sectionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const shelf = shelves.find(item => String(item.id) === $("sectionShelfId").value);
    if (!shelf) return toast("تعذر العثور على الرف");
    const name = $("sectionName").value.trim();
    if (!name) return toast("اكتب اسم القسم");
    const id = $("sectionId").value || uid();
    const sections = shelf.sections || [];
    const old = sections.find(item => String(item.id) === String(id));
    const section = {
      id, name, type: $("sectionType").value, shape: $("sectionShape").value
    };
    const updated = {
      ...shelf,
      sections: old ? sections.map(item => item.id === id ? section : item) : [...sections, section]
    };
    try {
      await put("shelves", updated);
      closeModal("sectionModal");
      await reload();
      toast(old ? "تم تعديل القسم" : "تمت إضافة القسم");
    } catch (error) {
      console.error("Could not save shelf section", error);
      toast("تعذر حفظ القسم");
    }
  });

  async function handleShelfImage(inputId) {
    const input = $(inputId);
    const file = input.files?.[0];
    if (!file) return;
    try {
      shelfImage = await compressImage(file);
      showShelfImagePreview();
      toast("تم تجهيز صورة الرف");
    } catch (error) {
      console.error("Shelf image processing failed", error);
      toast("تعذر قراءة الصورة، جرّب صورة أخرى");
    } finally {
      input.value = "";
    }
  }

  document.addEventListener("click", async event => {
    if (event.target.closest("[data-remove-shelf-image]")) {
      shelfImage = "";
      showShelfImagePreview();
      return;
    }
    const edit = event.target.closest("[data-edit-shelf]");
    const editProduct = event.target.closest("#shelfList [data-edit]");
    const addSection = event.target.closest("[data-add-section]");
    const editSection = event.target.closest("[data-edit-section]");
    const deleteSection = event.target.closest("[data-delete-section]");
    if (addSection) {
      const shelf = shelves.find(item => String(item.id) === addSection.dataset.addSection);
      if (shelf) openSection(shelf);
    }
    if (editSection) {
      const shelf = shelves.find(item => String(item.id) === editSection.dataset.sectionShelf);
      const section = shelf?.sections.find(item => String(item.id) === editSection.dataset.editSection);
      if (shelf && section) openSection(shelf, section);
    }
    if (deleteSection) {
      const shelf = shelves.find(item => String(item.id) === deleteSection.dataset.sectionShelf);
      const sectionId = deleteSection.dataset.deleteSection;
      if (!shelf) return;
      if (shelf.sections.length <= 1) return toast("يجب أن يحتوي كل رف على قسم واحد على الأقل");
      if (products.some(product => String(product.shelf || "1") === String(shelf.id) &&
          String(product.section || shelf.sections[0].id) === String(sectionId))) {
        return toast("انقل منتجات هذا القسم إلى قسم آخر قبل حذفه");
      }
      if (!confirm("هل تريد حذف هذا القسم؟")) return;
      try {
        await put("shelves", { ...shelf, sections: shelf.sections.filter(item => String(item.id) !== String(sectionId)) });
        await reload();
        toast("تم حذف القسم");
      } catch (error) {
        console.error("Could not delete shelf section", error);
        toast("تعذر حذف القسم");
      }
    }
    if (edit) {
      const shelf = shelves.find(item => String(item.id) === edit.dataset.editShelf);
      if (shelf) openShelf(shelf);
    }
    if (editProduct) openProduct(products.find(product => product.id === editProduct.dataset.edit));
  });
  $("shelfModal").addEventListener("click", event => {
    if (event.target.id === "shelfModal") closeModal("shelfModal");
  });
  $("sectionModal").addEventListener("click", event => {
    if (event.target.id === "sectionModal") closeModal("sectionModal");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("shelfModal").classList.contains("hidden")) closeModal("shelfModal");
    if (event.key === "Escape" && !$("sectionModal").classList.contains("hidden")) closeModal("sectionModal");
  });

  function updateMovementPreview() {
    const product = products.find(item => item.id === $("movementProduct").value);
    const type = $("movementType").value;
    const adjustment = type === "adjust";
    $("movementQuantity").classList.toggle("hidden", adjustment);
    $("adjustmentFields").hidden = !adjustment;
    $("cartonSizeWrap").classList.toggle("hidden", $("movementUnit").value !== "carton" || adjustment);
    $("movementQty").required = !adjustment;
    $("actualFridge").required = adjustment;
    $("actualStore").required = adjustment;
    if (!product) {
      movementPreviewProductId = "";
      previousAdjustment = false;
      $("movementPreview").textContent = "اختر منتجاً لعرض الكمية المتاحة.";
      $("saveMovementBtn").disabled = true;
      return;
    }
    $("saveMovementBtn").disabled = false;
    if (movementPreviewProductId !== product.id || (adjustment && !previousAdjustment)) {
      $("actualFridge").value = product.fridge || 0;
      $("actualStore").value = product.store || 0;
    }
    movementPreviewProductId = product.id;
    previousAdjustment = adjustment;
    if (adjustment) {
      const actualFridge = Number($("actualFridge").value);
      const actualStore = Number($("actualStore").value);
      $("movementPreview").textContent = Number.isInteger(actualFridge) && Number.isInteger(actualStore)
        ? `${shelfLabel(product.shelf)} · ${sectionName(product.shelf || "1", product.section)} · بعد الجرد: البراد ${actualFridge} (${actualFridge - (product.fridge || 0) >= 0 ? "+" : ""}${actualFridge - (product.fridge || 0)}) · المخزن ${actualStore} (${actualStore - (product.store || 0) >= 0 ? "+" : ""}${actualStore - (product.store || 0)})`
        : `الكمية الحالية: البراد ${product.fridge || 0} · المخزن ${product.store || 0}`;
      return;
    }
    const qty = Math.max(0, Number($("movementQty").value) || 0);
    const unit = $("movementUnit").value;
    const pieces = unit === "carton" ? qty * (Number($("cartonSize").value) || 1) : qty;
    const destination = type === "transfer" ? `المتاح للنقل من المخزن: ${product.store || 0} قطعة` :
      type === "removeFridge" ? `المتاح للسحب من البراد: ${product.fridge || 0} قطعة` :
        `رصيد المخزن الحالي: ${product.store || 0} قطعة`;
    const result = type === "transfer"
    ? `بعد النقل: البراد ${Number(product.fridge || 0) + pieces} · المخزن ${Number(product.store || 0) - pieces}`
    : type === "removeFridge"
      ? `بعد السحب: البراد ${Math.max(0, Number(product.fridge || 0) - pieces)}`
      : `بعد الإضافة: المخزن ${Number(product.store || 0) + pieces}`;
    $("movementPreview").textContent = `${shelfLabel(product.shelf)} · ${sectionName(product.shelf || "1", product.section)} · ${pieces} قطعة ${unit === "carton" ? `(${qty} كرتون)` : ""} · ${destination} · ${result}`;
  }

  $("movementType").addEventListener("change", updateMovementPreview);
  document.querySelectorAll("[data-movement-type]").forEach(button => button.addEventListener("click", () => {
    $("movementType").value = button.dataset.movementType;
    document.querySelectorAll("[data-movement-type]").forEach(item => item.classList.toggle("active", item === button));
    updateMovementPreview();
  }));
  ["movementProduct", "movementQty", "movementUnit", "cartonSize", "actualFridge", "actualStore"].forEach(id =>
    $(id).addEventListener("input", updateMovementPreview)
  );
  $("movementProduct").addEventListener("change", () => {
    const product = products.find(item => item.id === $("movementProduct").value);
    if (product) $("cartonSize").value = product.cartonSize || 1;
    updateMovementPreview();
  });
  document.addEventListener("click", event => {
    if (event.target.closest("[data-move], [data-scan-move]")) {
      setTimeout(() => {
        const product = products.find(item => item.id === $("movementProduct").value);
        if (product) $("cartonSize").value = product.cartonSize || 1;
        updateMovementPreview();
      }, 0);
    }
  });
  $("qtyMinus").addEventListener("click", () => {
    $("movementQty").value = Math.max(1, Number($("movementQty").value || 1) - 1);
    updateMovementPreview();
  });
  $("qtyPlus").addEventListener("click", () => {
    $("movementQty").value = Math.max(1, Number($("movementQty").value || 0) + 1);
    updateMovementPreview();
  });
  document.getElementById("movementForm").addEventListener("submit", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const product = products.find(item => item.id === $("movementProduct").value);
    if (!product) return toast("اختر المنتج أولاً");
    const type = $("movementType").value;
    const before = { fridge: Number(product.fridge) || 0, store: Number(product.store) || 0 };
    let quantity;
    let label;
    let note = $("movementNote").value.trim();
    if (type === "adjust") {
      const fridge = Number($("actualFridge").value);
      const storeQuantity = Number($("actualStore").value);
      if (![fridge, storeQuantity].every(value => Number.isInteger(value) && value >= 0)) return toast("أدخل كميات جرد صحيحة");
      if (fridge === before.fridge && storeQuantity === before.store) return toast("لم تتغير الكميات");
      product.fridge = fridge;
      product.store = storeQuantity;
      quantity = Math.abs(fridge - before.fridge) + Math.abs(storeQuantity - before.store);
      label = "جرد فعلي";
      const details = `البراد: ${before.fridge} ← ${fridge}، المخزن: ${before.store} ← ${storeQuantity}`;
      note = note ? `${details} · ${note}` : details;
    } else {
      const entered = Number($("movementQty").value);
      if (!Number.isInteger(entered) || entered < 1) return toast("أدخل كمية صحيحة");
      quantity = $("movementUnit").value === "carton" ? entered * Math.max(1, Number($("cartonSize").value) || Number(product.cartonSize) || 1) : entered;
      if (!Number.isSafeInteger(quantity) || quantity < 1) return toast("الكمية المدخلة أكبر من المسموح");
      if (type === "transfer") {
        if (before.store < quantity) return toast("الكمية في المخزن غير كافية");
        product.store = before.store - quantity;
        product.fridge = before.fridge + quantity;
        label = "نقل إلى البراد";
      } else if (type === "addStore") {
        product.store = before.store + quantity;
        label = "إضافة للمخزن";
      } else {
        if (before.fridge < quantity) return toast("الكمية في البراد غير كافية");
        product.fridge = before.fridge - quantity;
        label = "سحب من البراد";
      }
      if (!Number.isSafeInteger(product.fridge) || !Number.isSafeInteger(product.store)) return toast("تعذر تحديث الكمية بسبب تجاوز الحد");
      if ($("movementUnit").value === "carton") note = `${entered} كرتون (${quantity} قطعة)${note ? ` · ${note}` : ""}`;
      const after = `البراد ${product.fridge} · المخزن ${product.store}`;
      note = note ? `${after} · ${note}` : after;
    }
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label, time: Date.now(), note,
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section)
    };
    try {
      await saveMovementAtomically(product, movement);
      $("movementQty").value = 1;
      $("movementNote").value = "";
      await reload();
      updateMovementPreview();
      toast("تم تسجيل الحركة وتحديث الأرصدة");
    } catch (error) {
      console.error("Could not save inventory movement", error);
      toast("تعذر حفظ الحركة؛ لم يتم تأكيد التغيير");
    }
  }, true);

  function saveMovementAtomically(product, movement) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["products", "movements"], "readwrite");
      transaction.objectStore("products").put(product);
      transaction.objectStore("movements").put(movement);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("تعذر حفظ الحركة"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء حفظ الحركة"));
    });
  }

  function loadZXing() {
    if (window.ZXing?.BrowserMultiFormatReader) return Promise.resolve();
    if (zxingLoadPromise) return zxingLoadPromise;
    zxingLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.integrity = "sha384-BzBxP10ZE72aitqj5UMmUsbKFliP/DZqA8Wq+BNNhlIJDGoEd1tpkMYXOg9+n6sB";
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (window.ZXing?.BrowserMultiFormatReader) resolve();
        else {
          zxingLoadPromise = null;
          reject(new Error("تعذر تهيئة قارئ الباركود"));
        }
      };
      script.onerror = () => {
        zxingLoadPromise = null;
        script.remove();
        reject(new Error("تعذر تحميل قارئ الباركود"));
      };
      document.head.appendChild(script);
    });
    return zxingLoadPromise;
  }

  async function startScanner() {
    if (!navigator.mediaDevices?.getUserMedia) {
      $("scannerStatus").textContent = "الكاميرا تحتاج إلى HTTPS وإذن الوصول. استخدم صورة الباركود أو أدخل الرقم يدوياً.";
      return;
    }
    stopScanner();
    $("scannerStatus").textContent = "جارٍ تجهيز الكاميرا...";
    try {
      const video = $("scannerVideo");
      video.classList.remove("hidden");
      if ("BarcodeDetector" in window) {
        try {
          const formats = typeof BarcodeDetector.getSupportedFormats === "function" ? await BarcodeDetector.getSupportedFormats() : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
          const wanted = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"].filter(format => formats.includes(format));
          if (wanted.length) {
            detector = new BarcodeDetector({ formats: wanted });
            scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
            video.srcObject = scanStream;
            await video.play();
            $("scannerStatus").textContent = "الكاميرا تعمل. ثبّت الرمز داخل الإطار.";
            $("startScanBtn").classList.add("hidden");
            $("stopScanBtn").classList.remove("hidden");
            scanFrame = requestAnimationFrame(scanLoop);
            return;
          }
        } catch (nativeError) {
          stopScanner();
          if (nativeError.name === "NotAllowedError" || nativeError.name === "PermissionDeniedError") throw nativeError;
          console.warn("Native barcode reader unavailable; trying ZXing", nativeError);
        }
      }
      await loadZXing();
      zxingReader = new ZXing.BrowserMultiFormatReader();
      video.classList.remove("hidden");
      scannerControls = await zxingReader.decodeFromVideoDevice(undefined, video, result => {
        if (result) finishScan(result.getText());
      });
      $("scannerStatus").textContent = "الكاميرا تعمل بقارئ متوافق مع هذا المتصفح.";
      $("startScanBtn").classList.add("hidden");
      $("stopScanBtn").classList.remove("hidden");
    } catch (error) {
      console.error("Barcode scanner failed", error);
      stopScanner();
      $("scannerStatus").textContent = error.message.includes("قارئ الباركود")
        ? "تعذر تحميل قارئ الكاميرا. تحقق من اتصال الإنترنت، أو امسح صورة الباركود أو أدخل الرقم يدوياً."
        : "تعذر تشغيل الكاميرا. تحقق من إذن الكاميرا وفتح الموقع عبر HTTPS.";
      toast("تعذر تشغيل قارئ الباركود");
    }
  }

  function finishScan(value) {
    if (!value) return;
    $("scanCode").value = value;
    stopScanner();
    lookupBarcode(value);
    $("scannerStatus").textContent = `تم التقاط الباركود: ${value}`;
  }

  window.scanLoop = async function () {
    if (!scanStream || scanBusy) return;
    const video = $("scannerVideo");
    if (video.readyState >= 2) {
      scanBusy = true;
      try {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) {
          finishScan(codes[0].rawValue);
          return;
        }
      } catch (error) {
        console.error("Barcode detection failed", error);
      } finally {
        scanBusy = false;
      }
    }
    if (scanStream) scanFrame = requestAnimationFrame(scanLoop);
  };

  window.stopScanner = function () {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    scanStream?.getTracks().forEach(track => track.stop());
    scanStream = null;
    scannerControls?.stop();
    scannerControls = null;
    zxingReader?.reset();
    const video = $("scannerVideo");
    if (video) {
      video.pause();
      video.srcObject = null;
      video.classList.add("hidden");
    }
    if ($("startScanBtn")) $("startScanBtn").classList.remove("hidden");
    if ($("stopScanBtn")) $("stopScanBtn").classList.add("hidden");
    scanBusy = false;
  };
  $("startScanBtn").onclick = startScanner;
  $("stopScanBtn").onclick = () => {
    stopScanner();
    $("scannerStatus").textContent = "تم إيقاف الكاميرا.";
  };
  $("scanImage").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    try {
      await loadZXing();
      const reader = new ZXing.BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(imageUrl);
      finishScan(result.getText());
    } catch (error) {
      console.error("Barcode image scan failed", error);
      toast("لم يتم التعرف على الباركود في الصورة؛ جرّب صورة أوضح");
    } finally {
      URL.revokeObjectURL(imageUrl);
      event.target.value = "";
    }
  });

  function validBackup(data) {
    const validImage = image => !image || (typeof image === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(image));
    return data && Array.isArray(data.products) && Array.isArray(data.movements) &&
      data.products.every(item => item && typeof item.id === "string" && typeof item.name === "string" && validImage(item.image) && validImage(item.barcodeImage)) &&
      data.movements.every(item => item && typeof item.id === "string" && typeof item.productId === "string") &&
      (data.shelves === undefined || (Array.isArray(data.shelves) && data.shelves.every(item =>
        item && typeof item.id === "string" && typeof item.name === "string" && validImage(item.image)
      )));
  }

  function normalizeShelfData(productRows, shelfRows) {
    const saved = (Array.isArray(shelfRows) ? shelfRows : [])
      .slice()
      .sort((a, b) => (a.created || 0) - (b.created || 0));
    const defaults = defaultShelves();
    const first = saved.find(shelf => String(shelf.id) === "1") ||
      saved.find(shelf => String(shelf.id) !== "2") || defaults[0];
    const second = saved.find(shelf => String(shelf.id) === "2" && String(shelf.id) !== String(first.id)) ||
      saved.find(shelf => String(shelf.id) !== String(first.id)) || defaults[1];
    const normalizeSections = (shelf, shelfId) => {
      const current = Array.isArray(shelf.sections) ? shelf.sections.filter(section =>
        section && typeof section.id === "string" && typeof section.name === "string"
      ) : [];
      const sections = current.length ? current : defaultSections(shelfId);
      return {
        ...shelf,
        id: shelfId,
        sections: sections.map(section => ({
          ...section,
          type: ["open-shelf", "drawer", "box", "cooler"].includes(section.type) ? section.type : "open-shelf",
          shape: ["wide", "standard", "square"].includes(section.shape) ? section.shape : "standard"
        }))
      };
    };
    const shelves = [normalizeSections(first, "1"), normalizeSections(second, "2")];
    const firstId = String(first.id);
    const secondId = String(second.id);
    const products = productRows.map(product => {
      const oldShelf = String(product.shelf || "1");
      const shelf = oldShelf === firstId || oldShelf === "1" ? "1" :
        oldShelf === secondId || oldShelf === "2" ? "2" : "2";
      const targetShelf = shelves.find(item => item.id === shelf);
      const section = targetShelf.sections.some(item => String(item.id) === String(product.section))
        ? product.section : targetShelf.sections[0].id;
      return product.shelf === shelf && product.section === section
        ? product : { ...product, shelf, section };
    });
    return { products, shelves };
  }

  function replaceBackup(data) {
    const normalized = normalizeShelfData(data.products, data.shelves);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["products", "movements", "shelves"], "readwrite");
      for (const name of ["products", "movements", "shelves"]) transaction.objectStore(name).clear();
      for (const item of normalized.products) transaction.objectStore("products").put(item);
      for (const item of data.movements) transaction.objectStore("movements").put(item);
      for (const item of normalized.shelves) transaction.objectStore("shelves").put(item);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("تعذر استيراد النسخة"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء الاستيراد"));
    });
  }

  async function addDemoProductsOnce() {
    const seedKey = "stockmate-demo-products-v1";
    try {
      if (localStorage.getItem(seedKey) === "done") return;
    } catch (error) {
      console.error("Could not read demo product seed status", error);
    }
    if ((await all("products")).some(product => product.isDemo)) {
      try {
        localStorage.setItem(seedKey, "done");
      } catch (error) {
        console.error("Could not save demo product seed status", error);
      }
      return;
    }
    const first = shelves[0];
    const second = shelves[1];
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 120);
    const demos = [
      {
        id: "demo-water-001", name: "مياه معدنية - تجريبي", brand: "بيانات اختبار",
        flavor: "طبيعية", size: "500 مل", barcode: "2900000000017",
        fridge: 4, store: 24, target: 12, minStore: 6, cartonSize: 12,
        shelf: first.id, section: first.sections[0].id, location: "A-01",
        locationType: "fixed", expiry: futureDate.toISOString().slice(0, 10),
        notes: "منتج تجريبي مضاف تلقائياً", created: Date.now(), isDemo: true
      },
      {
        id: "demo-juice-002", name: "عصير برتقال - تجريبي", brand: "بيانات اختبار",
        flavor: "برتقال", size: "250 مل", barcode: "2900000000024",
        fridge: 8, store: 18, target: 18, minStore: 5, cartonSize: 24,
        shelf: first.id, section: first.sections[1]?.id || first.sections[0].id,
        location: "A-02", locationType: "fixed", expiry: futureDate.toISOString().slice(0, 10),
        notes: "منتج تجريبي مضاف تلقائياً", created: Date.now() + 1, isDemo: true
      },
      {
        id: "demo-soda-003", name: "مشروب غازي - تجريبي", brand: "بيانات اختبار",
        flavor: "ليمون", size: "330 مل", barcode: "2900000000031",
        fridge: 3, store: 0, target: 12, minStore: 4, cartonSize: 12,
        shelf: second.id, section: second.sections[0].id, location: "B-01",
        locationType: "variable", expiry: futureDate.toISOString().slice(0, 10),
        notes: "منتج تجريبي مضاف تلقائياً", created: Date.now() + 2, isDemo: true
      }
    ];
    for (const product of demos) await put("products", product);
    try {
      localStorage.setItem(seedKey, "done");
    } catch (error) {
      console.error("Could not save demo product seed status", error);
    }
  }

  $("exportBtn").addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const data = {
        version: 3, exportedAt: new Date().toISOString(),
        products: await all("products"), movements: await all("movements"), shelves: await all("shelves")
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `رفيق-المخزون-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("تم إنشاء النسخة الاحتياطية");
    } catch (error) {
      console.error("Backup export failed", error);
      toast("تعذر إنشاء النسخة الاحتياطية");
    }
  }, true);
  $("importFile").addEventListener("change", async event => {
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!validBackup(data)) throw new Error("بنية النسخة الاحتياطية غير صالحة");
      if (!confirm("سيتم استبدال المنتجات والحركات والرفوف الحالية. هل أنشأت نسخة احتياطية؟ متابعة؟")) return;
      await replaceBackup(data);
      await reload();
      toast("تم استيراد النسخة الاحتياطية");
    } catch (error) {
      console.error("Backup import failed", error);
      toast("تعذر استيراد النسخة؛ تأكد من سلامة الملف");
    } finally {
      event.target.value = "";
    }
  }, true);
  $("clearData").addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!confirm("سيتم حذف المنتجات والحركات والرفوف وإعادة رفّين افتراضيين. هل تريد المتابعة؟")) return;
    const backup = { products: [], movements: [], shelves: defaultShelves() };
    try {
      await replaceBackup(backup);
      await reload();
      toast("تم مسح البيانات وإعادة الرفوف الافتراضية");
    } catch (error) {
      console.error("Data clear failed", error);
      toast("تعذر حذف البيانات");
    }
  }, true);

  async function initializeEnhancements() {
    while (!db) await new Promise(resolve => setTimeout(resolve, 20));
    const normalized = normalizeShelfData(await all("products"), await all("shelves"));
    shelves = normalized.shelves;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["products", "shelves"], "readwrite");
      const productStore = transaction.objectStore("products");
      productStore.clear();
      transaction.objectStore("shelves").clear();
      normalized.products.forEach(product => productStore.put(product));
      shelves.forEach(shelf => transaction.objectStore("shelves").put(shelf));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("تعذر تهيئة الرفوف"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء تهيئة الرفوف"));
    });
    await addDemoProductsOnce();
    products = await all("products");
    syncShelfOptions();
    window.renderAll();
    updateMovementPreview();
  }
  window.enhancementsReady = initializeEnhancements().catch(error => {
    console.error("Could not initialize shelves", error);
    toast("تعذر تحميل بيانات الرفوف");
    throw error;
  });
})();
