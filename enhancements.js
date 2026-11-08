(() => {
  let shelfImage = "";
  let scannerControls = null;
  let zxingReader = null;
  let zxingLoadPromise = null;
  let movementPreviewProductId = "";
  let previousAdjustment = false;
  let movementFilter = "all";
  let movementHistorySearch = "";
  let productDisplayLimit = 100;
  let lastProductQuery = "";
  let lastProductFilter = "all";
  const stocktakeEntries = new Map();
  function getLastActor() {
    try { return localStorage.getItem("stockmate-last-actor") || ""; }
    catch (error) { console.warn("Could not read the last operator name", error); return ""; }
  }
  try {
    const savedActor = getLastActor();
    $("movementActor").value = savedActor;
    $("receivingActor").value = savedActor;
    $("stocktakeActor").value = savedActor;
  } catch (error) {
    console.warn("Could not load the last operator name", error);
  }
  const defaultShelves = () => [
    { id: "1", name: "الرف الأول", location: "المنطقة الأولى", image: "", sections: defaultSections("1"), created: Date.now() },
    { id: "2", name: "الرف الثاني", location: "المنطقة الثانية", image: "", sections: defaultSections("2"), created: Date.now() + 1 }
  ];

  function defaultSections(shelfId) {
    return ["front", "back"].flatMap(face => [1, 2, 3].map(level => ({
      id: `${shelfId}-${face}-${level}`,
      name: `${face === "front" ? "الواجهة الأمامية" : "الواجهة الخلفية"} · الطابق ${level}`,
      type: level === 3 ? "box" : "open-shelf",
      shape: "standard",
      face,
      level
    })));
  }

  const shelfLabel = id => shelves.find(shelf => String(shelf.id) === String(id))?.name || "رف غير محدد";
  const sectionName = (shelfId, sectionId) =>
    shelves.find(shelf => String(shelf.id) === String(shelfId))?.sections?.find(section => String(section.id) === String(sectionId))?.name || "قسم غير محدد";
  const getLocationCode = product => {
    const shelf = shelves.find(item => String(item.id) === String(product?.shelf || "1"));
    const section = shelf?.sections?.find(item => String(item.id) === String(product?.section));
    if (!section) return `رف ${String(product?.shelf || "1")} / موقع غير محدد`;
    const face = section.face === "back" ? "خلفي" : "أمامي";
    const level = Math.min(3, Math.max(1, Number(section.level) || 1));
    const siblings = shelf.sections.filter(item => item.face === section.face && Number(item.level) === level)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const slot = Math.max(1, Number(section.slot) || siblings.findIndex(item => item.id === section.id) + 1);
    return `رف ${String(shelf.id)} / ${face} / طابق ${level}${siblings.length > 1 || slot > 1 ? ` / خانة ${slot}` : ""}`;
  };
  window.locationCode = getLocationCode;
  const sectionTypeName = type => ({
    "open-shelf": "رف مفتوح", drawer: "درج", box: "صندوق", cooler: "قسم مبرد"
  })[type] || "رف مفتوح";
  const formatNumber = value => new Intl.NumberFormat("ar-IQ").format(value);
  const movementCategory = movement => {
    if (movement.type === "waste" || movement.type === "damage") return "remove";
    if (movement.type === "return" || movement.type === "receipt") return "add";
    if (movement.label === "جرد فعلي") return "adjust";
    if (movement.label?.includes("إضافة")) return "add";
    if (movement.label?.includes("سحب")) return "remove";
    return "transfer";
  };

  function renderMovementHistory() {
    const terms = normalizeProductSearch(movementHistorySearch).split(/\s+/).filter(Boolean);
    const history = movements.filter(item => {
      if (movementFilter !== "all" && movementCategory(item) !== movementFilter) return false;
      const searchable = normalizeProductSearch([item.productName, item.label, item.note, item.shelfName, item.sectionName, item.locationCode, item.supplier, item.actor, item.reason].filter(Boolean).join(" "));
      return terms.every(term => searchable.includes(term));
    });
    $("movementHistory").className = history.length ? "stack movement-history" : "stack empty-state";
    $("movementHistory").innerHTML = history.slice(0, 30).map(item => {
      const category = movementCategory(item);
      const icon = category === "add" ? "＋" : category === "remove" ? "−" : category === "adjust" ? "≋" : "↗";
      return `<article class="movement-history-card type-${category}">
        <span class="movement-history-icon">${icon}</span>
        <div class="movement-history-info"><b>${escapeHTML(item.productName)}</b><span>${escapeHTML(item.label)}</span><small>${new Date(item.time).toLocaleString("ar-IQ")}${item.locationCode ? ` · ${escapeHTML(item.locationCode)}` : ""}</small>${item.actor ? `<small>المنفذ: ${escapeHTML(item.actor)}</small>` : ""}${item.reason ? `<small>السبب: ${escapeHTML(item.reason)}</small>` : ""}${item.note ? `<small>${escapeHTML(item.note)}</small>` : ""}</div>
        <strong>${formatNumber(item.qty)} <small>قطعة</small></strong>
      </article>`;
    }).join("") || "لا توجد حركات في هذا التصنيف.";
  }

  function movementProductSummary(product) {
    return `${product.name}${[product.flavor, product.size].filter(Boolean).length ? ` · ${[product.flavor, product.size].filter(Boolean).join(" · ")}` : ""}`;
  }

  function renderMovementProductPicker(query = "", show = false) {
    const search = $("movementProductSearch");
    const results = $("movementProductResults");
    const select = $("movementProduct");
    const selected = products.find(product => String(product.id) === String(select.value));
    if (selected) {
      $("movementSelectedProduct").innerHTML = `<b>${escapeHTML(selected.name)}</b><span>${escapeHTML([selected.flavor, selected.size].filter(Boolean).join(" · ") || "بدون تفاصيل إضافية")}</span><small>البراد ${formatNumber(selected.fridge || 0)} · المخزن ${formatNumber(selected.store || 0)} · ${escapeHTML(shelfLabel(selected.shelf))}</small>`;
      if (document.activeElement !== search || !query) search.value = movementProductSummary(selected);
    } else {
      $("movementSelectedProduct").textContent = "لم يتم اختيار منتج بعد";
      if (!query) search.value = "";
    }

    const terms = normalizeProductSearch(query).split(/\s+/).filter(Boolean);
    const matches = products.filter(product => {
      const searchable = productSearchText(product);
      return terms.every(term => searchable.includes(term));
    }).slice(0, 30);
    results.innerHTML = matches.map(product => `<button type="button" class="movement-product-option" role="option" aria-selected="${selected?.id === product.id}" data-select-movement-product="${escapeHTML(product.id)}">
      <span class="movement-option-image">${product.image ? `<img loading="lazy" src="${product.image}" alt="">` : "▣"}</span>
      <span class="movement-option-info"><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.flavor, product.size, product.barcode].filter(Boolean).join(" · ") || "بدون تفاصيل")}</small></span>
      <span class="movement-option-stock"><small>البراد</small><b>${formatNumber(product.fridge || 0)}</b><small>المخزن</small><b>${formatNumber(product.store || 0)}</b></span>
    </button>`).join("") || `<div class="movement-product-empty">${products.length ? "لا توجد نتائج مطابقة." : "أضف منتجاتك أولاً لتسجيل الحركات."}</div>`;
    results.classList.toggle("open", show);
    search.setAttribute("aria-expanded", String(show));
  }

  window.selectMovementProduct = function (id) {
    const select = $("movementProduct");
    select.value = String(id || "");
    const product = products.find(item => String(item.id) === String(select.value));
    $("movementProductSearch").value = product ? movementProductSummary(product) : "";
    renderMovementProductPicker("", false);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  $("movementProductSearch").addEventListener("focus", () => renderMovementProductPicker($("movementProductSearch").value, true));
  $("movementProductSearch").addEventListener("input", () => {
    $("movementProduct").value = "";
    $("movementSelectedProduct").textContent = "اختر منتجاً من نتائج البحث.";
    updateMovementPreview();
    renderMovementProductPicker($("movementProductSearch").value, true);
  });
  $("movementProductSearch").addEventListener("keydown", event => {
    if (event.key === "Escape") {
      $("movementProductResults").classList.remove("open");
      $("movementProductSearch").setAttribute("aria-expanded", "false");
      return;
    }
    if (event.key !== "Enter") return;
    const first = $("movementProductResults").querySelector("[data-select-movement-product]");
    if (first) {
      event.preventDefault();
      window.selectMovementProduct(first.dataset.selectMovementProduct);
    }
  });
  $("movementProductResults").addEventListener("click", event => {
    const option = event.target.closest("[data-select-movement-product]");
    if (option) window.selectMovementProduct(option.dataset.selectMovementProduct);
  });
  document.addEventListener("click", event => {
    if (event.target.closest("#movementProductPicker")) return;
    $("movementProductResults").classList.remove("open");
    $("movementProductSearch").setAttribute("aria-expanded", "false");
  });
  $("movementHistorySearch").addEventListener("input", () => {
    movementHistorySearch = $("movementHistorySearch").value;
    renderMovementHistory();
  });

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
      const renderFace = (face, title) => `<section class="shelf-face">
        <header class="shelf-face-heading"><b>${title}</b><span>3 طوابق</span></header>
        <div class="shelf-floors">${[1, 2, 3].map(level => {
          const sections = shelf.sections.filter(section => section.face === face && Number(section.level) === level);
          const slotProducts = products
            .filter(product => String(product.shelf || "1") === String(shelf.id) &&
              sections.some(section => String(section.id) === String(product.section || shelf.sections[0]?.id)))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
          return `<article class="shelf-floor">
            <header><span class="floor-number">${level}</span><b>الطابق ${level}</b><small>${formatNumber(slotProducts.length)} منتجات</small></header>
            <div class="shelf-floor-content">${slotProducts.map(product => {
              const section = sections.find(item => String(item.id) === String(product.section));
              return `<article class="shelf-slot-product">
                <span class="slot-product-image">${product.image ? `<img loading="lazy" src="${product.image}" alt="">` : "▣"}</span>
                <span class="slot-product-info"><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.flavor, product.size].filter(Boolean).join(" · ") || section?.name || "منتج")}</small><small>البراد ${formatNumber(product.fridge || 0)} · المخزن ${formatNumber(product.store || 0)}</small></span>
                <button type="button" class="small-btn" data-edit="${escapeHTML(product.id)}">تعديل</button>
              </article>`;
            }).join("") || `<div class="shelf-empty">لا توجد منتجات في هذا الطابق</div>`}
            ${sections.length ? "" : `<button type="button" class="small-btn shelf-add-slot" data-add-section="${escapeHTML(shelf.id)}" data-face="${face}" data-level="${level}">＋ إضافة خانة للطابق</button>`}
            </div>
          </article>`;
        }).join("")}</div>
      </section>`;
      return `<section class="shelf-section" aria-labelledby="shelf-heading-${escapeHTML(shelf.id)}">
        <header class="shelf-section-head">
          ${shelf.image ? `<img loading="lazy" class="shelf-photo" src="${escapeHTML(shelf.image)}" alt="صورة ${escapeHTML(shelf.name)}">` : '<div class="shelf-photo shelf-placeholder">▤</div>'}
          <div class="shelf-card-info"><span class="eyebrow">مخزن مستقل</span><h2 id="shelf-heading-${escapeHTML(shelf.id)}">${escapeHTML(shelf.name)}</h2><small>${escapeHTML(shelf.location || "لم يحدد الموقع")}</small><small>${formatNumber(products.filter(product => String(product.shelf || "1") === String(shelf.id)).length)} منتجات · وجهان · 3 طوابق لكل وجه</small></div>
          <button type="button" class="small-btn" data-edit-shelf="${escapeHTML(shelf.id)}">تعديل بيانات الرف</button>
        </header>
        <div class="shelf-faces">${renderFace("front", "الواجهة الأمامية")}${renderFace("back", "الواجهة الخلفية")}</div>
        <details class="shelf-settings"><summary>إدارة خانات الرف</summary><div class="shelf-section-settings">${shelf.sections.map(section => `<article class="shelf-section-setting"><span><b>${escapeHTML(section.name)}</b><small>${escapeHTML(sectionTypeName(section.type))}</small></span><div><button type="button" class="small-btn" data-edit-section="${escapeHTML(section.id)}" data-section-shelf="${escapeHTML(shelf.id)}">تعديل</button><button type="button" class="small-btn delete" data-delete-section="${escapeHTML(section.id)}" data-section-shelf="${escapeHTML(shelf.id)}">حذف</button></div></article>`).join("")}<button type="button" class="small-btn shelf-add-section" data-add-section="${escapeHTML(shelf.id)}">＋ إضافة خانة</button></div></details>
      </section>`;
    }).join("");
  }

  window.renderMap = function () {
    return;
  };

  window.renderProducts = function () {
    const terms = normalizeProductSearch($("productSearch").value).split(/\s+/).filter(Boolean);
    const queryKey = terms.join(" ");
    if (queryKey !== lastProductQuery || currentFilter !== lastProductFilter) {
      productDisplayLimit = 100;
      lastProductQuery = queryKey;
      lastProductFilter = currentFilter;
    }
    let list = products.filter(product => {
      const searchable = productSearchText(product);
      return terms.every(term => searchable.includes(term));
    });
    if (currentFilter === "low") list = list.filter(low);
    if (currentFilter === "fixed") list = list.filter(product => product.locationType === "fixed");
    if (currentFilter === "variable") list = list.filter(product => product.locationType === "variable");
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const visibleProducts = list.slice(0, productDisplayLimit);
    $("productList").className = list.length ? "stack product-grid" : "stack empty-state";
    $("productList").innerHTML = visibleProducts.map(product =>
      `<article class="product-card" data-product-card="${escapeHTML(product.id)}" tabindex="0" aria-label="فتح تفاصيل ${escapeHTML(product.name)}">
        <div class="card-top"><div class="product-main">${product.image ? `<img loading="lazy" class="product-thumb" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}">` : '<div class="product-thumb placeholder">▣</div>'}<div>
          <button type="button" class="product-name product-detail-trigger" data-product-detail="${escapeHTML(product.id)}">${escapeHTML(product.name)}</button>
          <div class="subline">${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · "))}</div>
          <div class="subline">${product.barcode ? `باركود: ${escapeHTML(product.barcode)}` : "بدون باركود"}</div>
        </div></div><button class="small-btn" data-edit="${escapeHTML(product.id)}">تعديل</button></div>
        <div><span class="tag">${product.locationType === "fixed" ? "موقع ثابت" : "موقع متغير"}</span><span class="tag">${escapeHTML(getLocationCode(product))}</span>${product.isDemo ? '<span class="tag demo-tag">بيانات تجريبية</span>' : ""}${product.availability === "unavailable" && Number(product.store || 0) <= 0 && Number(product.fridge || 0) <= 0 ? '<span class="tag bad">غير متوفر حالياً</span>' : ""}${low(product) ? '<span class="tag warn">نقص في البراد</span>' : ""}${storeLow(product) ? '<span class="tag bad">مخزون المخزن منخفض</span>' : ""}</div>
        <div class="qty-grid"><div class="qty-box"><small>البراد</small><b>${formatNumber(product.fridge || 0)}</b></div><div class="qty-box"><small>المخزن</small><b>${formatNumber(product.store || 0)}</b></div><div class="qty-box"><small>هدف البراد</small><b>${formatNumber(product.target || 0)}</b></div></div>
        <div class="card-actions"><button class="small-btn" data-move="${escapeHTML(product.id)}">تسجيل حركة</button><button class="small-btn" data-show-barcode="${escapeHTML(product.id)}">عرض الباركود</button><button class="small-btn delete" data-delete="${escapeHTML(product.id)}">حذف</button></div>
      </article>`
    ).join("") + (list.length > visibleProducts.length ? `<button type="button" class="soft wide" data-show-more-products>عرض 100 منتج إضافي (${formatNumber(list.length - visibleProducts.length)} متبقٍ)</button>` : "") || "لا توجد نتائج مطابقة.";
  };
  $("productList").addEventListener("click", event => {
    if (!event.target.closest("[data-show-more-products]")) return;
    productDisplayLimit += 100;
    window.renderProducts();
  });

  window.renderReplenish = function () {
    const terms = normalizeProductSearch($("replenishSearch").value).split(/\s+/).filter(Boolean);
    const allItems = products.filter(product => refill(product) > 0).sort((a, b) =>
      Number(a.shelf || 1) - Number(b.shelf || 1) ||
      getLocationCode(a).localeCompare(getLocationCode(b), "ar", { numeric: true }) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ar")
    );
    const list = allItems.filter(product => {
      const searchable = productSearchText(product);
      return terms.every(term => searchable.includes(term));
    });
    $("replenishItems").textContent = allItems.length;
    $("replenishUnits").textContent = allItems.reduce((sum, product) => sum + availableToMove(product), 0);
    $("shortageUnits").textContent = allItems.reduce((sum, product) => sum + shortage(product), 0);
    $("replenishList").className = list.length ? "stack" : "stack empty-state";
    let activeGroup = "";
    $("replenishList").innerHTML = list.map(product => {
      const available = availableToMove(product);
      const group = `${product.shelf || "1"}:${product.section || ""}`;
      const heading = group === activeGroup ? "" : `<h3 class="replenish-group-head">${escapeHTML(shelfLabel(product.shelf))}<span>${escapeHTML(sectionName(product.shelf || "1", product.section))}</span></h3>`;
      activeGroup = group;
      const target = Math.max(1, Number(product.target) || 0);
      const progress = Math.min(100, Math.round((Number(product.fridge || 0) / target) * 100));
      const noStock = available === 0;
      return `${heading}<article class="replenish-card ${noStock ? "needs-stock" : ""}">
        <div class="replenish-card-top">
          <div class="replenish-title"><span class="replenish-product-icon">${product.image ? `<img loading="lazy" src="${product.image}" alt="">` : "▣"}</span><div><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · ") || "بدون تفاصيل إضافية")}</small></div></div>
          <span class="replenish-status ${noStock ? "empty" : "ready"}">${noStock ? "المخزن فارغ" : `نقل حتى ${formatNumber(available)}`}</span>
        </div>
        <div class="replenish-location">${escapeHTML(getLocationCode(product))}</div>
        <div class="replenish-progress-label"><span>تقدم تعبئة البراد</span><b>${formatNumber(product.fridge || 0)} <small>من ${formatNumber(product.target || 0)}</small></b></div>
        <div class="replenish-progress"><i style="width:${progress}%"></i></div>
        <div class="replenish-metrics"><span><small>المخزن</small><b>${formatNumber(product.store || 0)} <small>قطعة</small></b></span><span><small>المطلوب للوصول للهدف</small><b>${formatNumber(refill(product))} <small>قطعة</small></b></span><span><small>عجز المخزن</small><b>${formatNumber(shortage(product))} <small>قطعة</small></b></span></div>
        <div class="replenish-action"><label>الكمية المراد نقلها<input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="${available}" step="1" value="${available || ""}" data-refill-qty="${escapeHTML(product.id)}" ${available ? "" : "disabled"}></label>${noStock ? `<button type="button" class="soft" data-add-stock="${escapeHTML(product.id)}">＋ إضافة للمخزن</button>` : `<button type="button" class="primary" data-refill-product="${escapeHTML(product.id)}">نقل إلى البراد <span>←</span></button>`}</div>
      </article>`;
    }).join("") || (allItems.length ? "لا توجد نتائج مطابقة للبحث." : "لا توجد منتجات تحتاج إلى تعبئة.");
  };

  $("replenishList").addEventListener("click", async event => {
    const addStock = event.target.closest("[data-add-stock]");
    if (addStock) {
      go("movement");
      $("movementType").value = "addStore";
      document.querySelectorAll("[data-movement-type]").forEach(item => item.classList.toggle("active", item.dataset.movementType === "addStore"));
      window.selectMovementProduct(addStock.dataset.addStock);
      return;
    }
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
    const actor = getLastActor() || prompt("أدخل اسم منفذ التعبئة")?.trim();
    if (!actor) return;
    try { localStorage.setItem("stockmate-last-actor", actor); } catch (error) { console.warn("Could not remember the operator name", error); }
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "تعبئة من قائمة التعبئة", time: Date.now(),
      type: "transfer", actor,
      reason: "تعبئة", locationCode: getLocationCode(product),
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
  $("replenishSearch").addEventListener("input", window.renderReplenish);

  const originalRenderAll = window.renderAll;
  window.renderAll = function () {
    syncShelfOptions();
    originalRenderAll();
    renderShelves();
    renderMovementHistory();
    renderMovementProductPicker("", false);
    renderInventoryTools();
    createDailySnapshot().catch(error => {
      console.error("Could not update local daily backup", error);
      $("automaticBackupStatus").textContent = "تعذر تحديث النسخة المحلية التلقائية. أنشئ نسخة يدوية من الإعدادات.";
    });
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
    const editing = Boolean(section?.id);
    $("sectionForm").reset();
    $("sectionShelfId").value = shelf.id;
    $("sectionId").value = section?.id || "";
    $("sectionModalTitle").textContent = editing ? `تعديل ${section.name}` : `إضافة خانة إلى ${shelf.name}`;
    $("sectionName").value = section?.name || "";
    $("sectionType").value = section?.type || "open-shelf";
    $("sectionShape").value = section?.shape || "standard";
    $("sectionFace").value = section?.face || "front";
    $("sectionLevel").value = String(section?.level || 1);
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
      id, name, type: $("sectionType").value, shape: $("sectionShape").value,
      face: $("sectionFace").value, level: Number($("sectionLevel").value)
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
      if (shelf) openSection(shelf, {
        face: addSection.dataset.face || "front",
        level: Number(addSection.dataset.level || 1)
      });
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
    $("movementZone").disabled = !["waste", "damage", "return"].includes(type);
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
    const zone = type === "removeFridge" ? "fridge" : type === "addStore" ? "store" : $("movementZone").value;
    const currentZone = zone === "fridge" ? Number(product.fridge || 0) : Number(product.store || 0);
    const destination = type === "transfer" ? `المتاح للنقل من المخزن: ${product.store || 0} قطعة` :
      type === "removeFridge" ? `المتاح للسحب من البراد: ${product.fridge || 0} قطعة` :
        `${zone === "fridge" ? "رصيد البراد" : "رصيد المخزن"} الحالي: ${currentZone} قطعة`;
    const result = type === "transfer"
    ? `بعد النقل: البراد ${Number(product.fridge || 0) + pieces} · المخزن ${Number(product.store || 0) - pieces}`
    : type === "removeFridge"
      ? `بعد السحب: البراد ${Math.max(0, Number(product.fridge || 0) - pieces)}`
      : type === "return" ? `بعد الإضافة: ${zone === "fridge" ? "البراد" : "المخزن"} ${currentZone + pieces}`
      : type === "waste" || type === "damage" ? `بعد الخصم: ${zone === "fridge" ? "البراد" : "المخزن"} ${Math.max(0, currentZone - pieces)}`
      : `بعد الإضافة: المخزن ${Number(product.store || 0) + pieces}`;
    $("movementPreview").textContent = `${getLocationCode(product)} · ${pieces} قطعة ${unit === "carton" ? `(${qty} كرتون)` : ""} · ${destination} · ${result}`;
  }

  $("movementType").addEventListener("change", updateMovementPreview);
  document.querySelectorAll("[data-movement-type]").forEach(button => button.addEventListener("click", () => {
    $("movementType").value = button.dataset.movementType;
    document.querySelectorAll("[data-movement-type]").forEach(item => item.classList.toggle("active", item === button));
    updateMovementPreview();
  }));
  ["movementProduct", "movementQty", "movementUnit", "cartonSize", "actualFridge", "actualStore", "movementZone"].forEach(id =>
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
        label = "تسوية كمية المخزن";
      } else if (type === "removeFridge" || type === "waste" || type === "damage") {
        const zone = type === "removeFridge" ? "fridge" : $("movementZone").value;
        if (before[zone] < quantity) return toast(`الكمية في ${zone === "fridge" ? "البراد" : "المخزن"} غير كافية`);
        product[zone] = before[zone] - quantity;
        label = type === "waste" ? "هدر" : type === "damage" ? "تالف" : "سحب من البراد";
      } else if (type === "return") {
        const zone = $("movementZone").value;
        product[zone] = before[zone] + quantity;
        label = "مرتجع للمخزون";
      }
      if (!Number.isSafeInteger(product.fridge) || !Number.isSafeInteger(product.store)) return toast("تعذر تحديث الكمية بسبب تجاوز الحد");
      if ($("movementUnit").value === "carton") note = `${entered} كرتون (${quantity} قطعة)${note ? ` · ${note}` : ""}`;
      const after = `البراد ${product.fridge} · المخزن ${product.store}`;
      note = note ? `${after} · ${note}` : after;
    }
    const actor = $("movementActor").value.trim();
    const reason = $("movementReason").value;
    if (!actor) return toast("أدخل اسم منفذ الحركة");
    if (!reason) return toast("اختر سبب الحركة");
    try { localStorage.setItem("stockmate-last-actor", actor); } catch (error) { console.warn("Could not remember the operator name", error); }
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label, type, time: Date.now(), note, actor, reason, locationCode: getLocationCode(product),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section)
    };
    try {
      await saveMovementAtomically(product, movement, { before });
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

  function prepareLotsForChange(product, previous, metadata = {}) {
    const rows = inventoryLots.filter(lot => String(lot.productId) === String(product.id)).map(lot => ({ ...lot }));
    const originalRows = rows.map(lot => ({ ...lot }));
    for (const zone of ["store", "fridge"]) {
      const field = `${zone}Qty`;
      const sum = rows.reduce((total, lot) => total + Math.max(0, Number(lot[field]) || 0), 0);
      const difference = Number(previous[zone] || 0) - sum;
      if (difference > 0) rows.push({
        id: uid(), productId: product.id, productName: product.name,
        supplier: "رصيد افتتاحي / تسوية", unitCost: null,
        expiry: previous.expiry || product.expiry || "", receivedAt: Date.now(),
        source: "opening", storeQty: zone === "store" ? difference : 0,
        fridgeQty: zone === "fridge" ? difference : 0
      });
      if (difference < 0) adjustLotZone(rows, zone, -difference, false);
    }

    const deltas = {
      store: Number(product.store || 0) - Number(previous.store || 0),
      fridge: Number(product.fridge || 0) - Number(previous.fridge || 0)
    };
    if (deltas.store < 0 && deltas.fridge > 0 && deltas.store === -deltas.fridge) {
      moveLotZone(rows, "store", "fridge", deltas.fridge);
    } else {
      for (const zone of ["store", "fridge"]) {
        if (deltas[zone] < 0) adjustLotZone(rows, zone, -deltas[zone], false);
        if (deltas[zone] > 0) {
          rows.push({
            id: uid(), productId: product.id, productName: product.name,
            supplier: metadata.supplier || (movementLabelIsReturn(metadata.label) ? "مرتجع" : "إضافة مخزون"),
            unitCost: metadata.unitCost ?? null,
            expiry: metadata.expiry || "", receivedAt: Date.now(),
            source: metadata.source || "movement",
            storeQty: zone === "store" ? deltas[zone] : 0,
            fridgeQty: zone === "fridge" ? deltas[zone] : 0
          });
        }
      }
    }
    const changed = rows.filter(row => {
      const before = originalRows.find(item => item.id === row.id);
      return !before || JSON.stringify(before) !== JSON.stringify(row);
    });
    const removed = originalRows.filter(before => !rows.some(row => row.id === before.id));
    return { changed, removed };
  }

  function movementLabelIsReturn(label) {
    return String(label || "").includes("مرتجع");
  }

  function sortedLots(rows, zone) {
    const field = `${zone}Qty`;
    return rows.filter(lot => Number(lot[field]) > 0).sort((a, b) => {
      const dateA = a.expiry || "9999-12-31";
      const dateB = b.expiry || "9999-12-31";
      return dateA.localeCompare(dateB) || Number(a.receivedAt || 0) - Number(b.receivedAt || 0);
    });
  }

  function adjustLotZone(rows, zone, quantity, add) {
    let remaining = quantity;
    if (add) return remaining;
    for (const lot of sortedLots(rows, zone)) {
      const field = `${zone}Qty`;
      const amount = Math.min(remaining, Number(lot[field]) || 0);
      lot[field] -= amount;
      remaining -= amount;
      if (!remaining) break;
    }
    return remaining;
  }

  function moveLotZone(rows, from, to, quantity) {
    let remaining = quantity;
    for (const lot of sortedLots(rows, from)) {
      const source = `${from}Qty`, destination = `${to}Qty`;
      const amount = Math.min(remaining, Number(lot[source]) || 0);
      lot[source] -= amount;
      lot[destination] = (Number(lot[destination]) || 0) + amount;
      remaining -= amount;
      if (!remaining) break;
    }
    return remaining;
  }

  function saveMovementAtomically(product, movement, metadata = {}) {
    return new Promise((resolve, reject) => {
      if (Number(product.store) + Number(product.fridge) > 0) product.availability = "available";
      const previous = metadata.before ? { ...product, ...metadata.before } :
        products.find(item => String(item.id) === String(product.id)) || product;
      const { changed, removed } = prepareLotsForChange(product, previous, { ...metadata, label: movement.label });
      const transaction = db.transaction(["products", "movements", "inventoryLots"], "readwrite");
      transaction.objectStore("products").put(product);
      transaction.objectStore("movements").put(movement);
      changed.forEach(lot => transaction.objectStore("inventoryLots").put(lot));
      removed.forEach(lot => transaction.objectStore("inventoryLots").delete(lot.id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("تعذر حفظ الحركة"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء حفظ الحركة"));
    });
  }

  window.saveProductWithInventory = async function (product, previous, actor) {
    const before = previous || { ...product, store: 0, fridge: 0 };
    const quantity = Math.abs(Number(product.store || 0) - Number(before.store || 0)) +
      Math.abs(Number(product.fridge || 0) - Number(before.fridge || 0));
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: previous ? "تسوية مخزون من بيانات المنتج" : "رصيد افتتاحي للمنتج",
      type: "adjust", time: Date.now(), actor,
      reason: previous ? "تسوية يدوية" : "رصيد افتتاحي",
      locationCode: getLocationCode(product), shelfName: shelfLabel(product.shelf),
      sectionName: sectionName(product.shelf || "1", product.section),
      note: `البراد ${Number(before.fridge || 0)} ← ${Number(product.fridge || 0)} · المخزن ${Number(before.store || 0)} ← ${Number(product.store || 0)}`
    };
    await saveMovementAtomically(product, movement, { before });
  };

  function renderInventoryTools() {
    const receivingProduct = $("receivingProduct");
    if (receivingProduct) {
      const selected = receivingProduct.value;
      receivingProduct.innerHTML = `<option value="">اختر المنتج</option>${products.map(product =>
        `<option value="${escapeHTML(product.id)}">${escapeHTML(movementProductSummary(product))}</option>`
      ).join("")}`;
      if (products.some(product => String(product.id) === selected)) receivingProduct.value = selected;
    }

    const lotList = $("lotList");
    if (lotList) {
      const activeLots = inventoryLots.filter(lot => Number(lot.storeQty) + Number(lot.fridgeQty) > 0)
        .sort((a, b) => String(a.expiry || "9999-12-31").localeCompare(String(b.expiry || "9999-12-31")));
      lotList.className = activeLots.length ? "stack" : "stack empty-state";
      lotList.innerHTML = activeLots.map(lot => `<article class="panel">
        <b>${escapeHTML(lot.productName || products.find(product => product.id === lot.productId)?.name || "منتج محذوف")}</b>
        <small>المورد: ${escapeHTML(lot.supplier || "غير محدد")} · تكلفة الوحدة: ${lot.unitCost == null ? "غير محددة" : `${formatNumber(lot.unitCost)} د.ع`}</small>
        <small>الصلاحية: ${escapeHTML(lot.expiry || "غير محددة")} · المخزن ${formatNumber(lot.storeQty || 0)} · البراد ${formatNumber(lot.fridgeQty || 0)}</small>
      </article>`).join("") || "لا توجد دفعات مسجلة بعد.";
    }

    renderStocktake();
    renderReports();
  }

  function renderStocktake() {
    const container = $("stocktakeList");
    if (!container) return;
    const rows = [...stocktakeEntries.values()].map(entry => {
      const product = products.find(item => String(item.id) === String(entry.productId));
      const current = Number(product?.[entry.zone] || 0);
      return { ...entry, product, current, difference: entry.counted - current };
    });
    container.className = rows.length ? "stack" : "stack empty-state";
    container.innerHTML = rows.map(row => `<article class="panel">
      <b>${escapeHTML(row.product?.name || "منتج غير موجود")}</b>
      <small>${escapeHTML(getLocationCode(row.product || {}))} · ${row.zone === "store" ? "المخزن" : "البراد"}</small>
      <small>النظام: ${formatNumber(row.current)} · الفعلي: ${formatNumber(row.counted)} · الفرق: ${row.difference > 0 ? "+" : ""}${formatNumber(row.difference)}</small>
      <button type="button" class="small-btn delete" data-remove-stocktake="${escapeHTML(row.productId)}">إزالة من الجرد</button>
    </article>`).join("") || "لم تتم إضافة منتجات للجرد.";
    $("confirmStocktake").disabled = rows.length === 0;
    $("stocktakeZone").disabled = stocktakeEntries.size > 0;
  }

  function renderReports() {
    const container = $("inventoryReports");
    if (!container) return;
    const movementByProduct = new Map();
    for (const movement of movements) {
      movementByProduct.set(String(movement.productId), Math.max(movementByProduct.get(String(movement.productId)) || 0, Number(movement.time) || 0));
    }
    const today = new Date();
    const expiryRows = inventoryLots.filter(lot => lot.expiry && Number(lot.storeQty) + Number(lot.fridgeQty) > 0)
      .map(lot => ({ lot, days: daysTo(lot.expiry) })).filter(item => item.days <= 30)
      .sort((a, b) => a.days - b.days);
    const stagnant = products.filter(product => {
      const last = movementByProduct.get(String(product.id));
      return !last || (today.getTime() - last) / 86400000 >= 30;
    });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const damaged = movements.filter(item => (item.type === "waste" || item.type === "damage") && Number(item.time) >= startOfDay.getTime())
      .slice(0, 20);
    const lowStock = products.filter(product => storeLow(product) || low(product));
    const card = (title, items, render) => `<section class="panel"><h3>${title} (${formatNumber(items.length)})</h3>${items.length ? items.slice(0, 30).map(render).join("") : "<p>لا توجد عناصر حالياً.</p>"}</section>`;
    container.innerHTML =
      card("النواقص", lowStock, product => `<p>${escapeHTML(product.name)} · ${escapeHTML(getLocationCode(product))} · مخزن ${formatNumber(product.store || 0)} / براد ${formatNumber(product.fridge || 0)}</p>`) +
      card("الصلاحية خلال 30 يوماً — الأقرب أولاً", expiryRows, ({ lot, days }) => `<p>${escapeHTML(lot.productName || "منتج")} · ${escapeHTML(lot.expiry)} (${days < 0 ? `منتهي منذ ${Math.abs(days)} يوم` : `${days} يوم`}) · ${formatNumber(Number(lot.storeQty || 0) + Number(lot.fridgeQty || 0))} قطعة</p>`) +
      card("منتجات راكدة 30 يوماً أو أكثر", stagnant, product => `<p>${escapeHTML(product.name)} · ${movementByProduct.get(String(product.id)) ? new Date(movementByProduct.get(String(product.id))).toLocaleDateString("ar-IQ") : "لا توجد حركة مسجلة"}</p>`) +
      card("الهدر والتالف اليوم", damaged, item => `<p>${escapeHTML(item.productName)} · ${escapeHTML(item.label)} · ${formatNumber(item.qty)} قطعة · ${new Date(item.time).toLocaleTimeString("ar-IQ")}</p>`);
  }

  async function createDailySnapshot() {
    const snapshotId = new Date().toISOString().slice(0, 10);
    const existing = (await all("snapshots")).find(item => item.id === snapshotId);
    if (existing && Date.now() - existing.createdAt < 15 * 60 * 1000) return;
    const [productRows, movementRows, shelfRows, lots] = await Promise.all([
      all("products"), all("movements"), all("shelves"), all("inventoryLots")
    ]);
    const withoutImages = rows => rows.map(({ image, barcodeImage, ...row }) => row);
    await put("snapshots", {
      id: snapshotId, createdAt: Date.now(),
      data: {
        version: 3, products: withoutImages(productRows), movements: movementRows,
        shelves: withoutImages(shelfRows), lots
      }
    });
    const retained = (await all("snapshots")).sort((a, b) => b.id.localeCompare(a.id));
    for (const old of retained.slice(7)) await del("snapshots", old.id);
    const select = $("automaticBackupSelect");
    if (select) {
      select.innerHTML = `<option value="">اختر نسخة يومية</option>${retained.map(item =>
        `<option value="${escapeHTML(item.id)}">${escapeHTML(item.id)}</option>`
      ).join("")}`;
      $("automaticBackupStatus").textContent = `آخر نسخة تلقائية محلية: ${retained[0]?.id || "لا توجد"} (آخر 7 أيام، دون الصور).`;
    }
  }

  $("restoreAutomaticBackup").addEventListener("click", async () => {
    const snapshot = (await all("snapshots")).find(item => item.id === $("automaticBackupSelect").value);
    if (!snapshot) return toast("اختر نسخة تلقائية صالحة");
    if (!confirm(`استعادة نسخة ${snapshot.id} ستستبدل البيانات الحالية. الصور لا تدخل في النسخ التلقائي. هل تريد المتابعة؟`)) return;
    try {
      const currentProducts = new Map((await all("products")).map(product => [String(product.id), product]));
      const currentShelves = new Map((await all("shelves")).map(shelf => [String(shelf.id), shelf]));
      const data = {
        ...snapshot.data,
        products: snapshot.data.products.map(product => ({ ...currentProducts.get(String(product.id)), ...product })),
        shelves: snapshot.data.shelves.map(shelf => ({ ...currentShelves.get(String(shelf.id)), ...shelf }))
      };
      await replaceBackup(data);
      await reload();
      toast("تمت استعادة النسخة المحلية");
    } catch (error) {
      console.error("Could not restore local snapshot", error);
      toast("تعذرت استعادة النسخة");
    }
  });
  $("automaticBackupSelect").addEventListener("change", () => {
    $("restoreAutomaticBackup").disabled = !$("automaticBackupSelect").value;
  });

  $("receivingForm").addEventListener("submit", async event => {
    event.preventDefault();
    const product = products.find(item => String(item.id) === $("receivingProduct").value);
    const quantity = Number($("receivingQty").value);
    const supplier = $("receivingSupplier").value.trim();
    const unitCost = Number($("receivingCost").value);
    const actor = $("receivingActor").value.trim();
    if (!product) return toast("اختر المنتج أولاً");
    if (!Number.isSafeInteger(quantity) || quantity < 1) return toast("أدخل كمية استلام صحيحة");
    if (!supplier || !actor || !Number.isFinite(unitCost) || unitCost < 0) return toast("أكمل المورد والتكلفة واسم المستلم");
    if (!$("receivingExpiry").value) return toast("أدخل تاريخ انتهاء صلاحية الدفعة");
    try { localStorage.setItem("stockmate-last-actor", actor); } catch (error) { console.warn("Could not remember the operator name", error); }
    const before = { store: Number(product.store) || 0, fridge: Number(product.fridge) || 0, expiry: product.expiry };
    const updated = { ...product, store: before.store + quantity };
    if (!Number.isSafeInteger(updated.store)) return toast("الكمية المدخلة أكبر من المسموح");
    const expiry = $("receivingExpiry").value;
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "استلام توريد", type: "receipt", time: Date.now(), supplier, unitCost, expiry,
      actor, reason: "استلام توريد", locationCode: getLocationCode(product),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section),
      note: $("receivingNote").value.trim() || `إضافة ${quantity} قطعة للمخزن`
    };
    try {
      await saveMovementAtomically(updated, movement, { before, supplier, unitCost, expiry, source: "receipt" });
      event.target.reset();
      $("receivingActor").value = actor;
      await reload();
      toast("تم تسجيل الاستلام والدفعة");
    } catch (error) {
      console.error("Could not save receipt", error);
      toast("تعذر حفظ الاستلام؛ لم يتغير المخزون");
    }
  });

  $("stocktakeSearch").addEventListener("input", () => {
    delete $("stocktakeSearch").dataset.productId;
    const query = normalizeProductSearch($("stocktakeSearch").value);
    const barcodeMatch = products.find(product => String(product.barcode || "").trim() === $("stocktakeSearch").value.trim());
    const matches = !query ? [] : barcodeMatch ? [barcodeMatch] : products.filter(product => productSearchText(product).includes(query)).slice(0, 12);
    $("stocktakeResults").innerHTML = matches.map(product => `<button type="button" class="movement-product-option" data-stocktake-product="${escapeHTML(product.id)}"><span class="movement-option-info"><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.barcode, product.flavor, product.size].filter(Boolean).join(" · "))}</small></span><small>${escapeHTML(getLocationCode(product))}</small></button>`).join("");
    $("stocktakeResults").classList.toggle("open", matches.length > 0);
    if (barcodeMatch) {
      $("stocktakeResults").querySelector("[data-stocktake-product]")?.click();
      window.playBarcodeBeep?.();
    }
  });
  $("stocktakeResults").addEventListener("click", event => {
    const option = event.target.closest("[data-stocktake-product]");
    if (!option) return;
    const product = products.find(item => String(item.id) === option.dataset.stocktakeProduct);
    if (!product) return;
    $("stocktakeSearch").value = product.barcode || movementProductSummary(product);
    $("stocktakeSearch").dataset.productId = product.id;
    $("stocktakeQty").value = Number(product[$("stocktakeZone").value]) || 0;
    $("stocktakeResults").innerHTML = "";
    $("stocktakeResults").classList.remove("open");
  });
  $("stocktakeZone").addEventListener("change", () => {
    const product = products.find(item => String(item.id) === $("stocktakeSearch").dataset.productId);
    if (product) $("stocktakeQty").value = Number(product[$("stocktakeZone").value]) || 0;
    renderStocktake();
  });
  $("stocktakeForm").addEventListener("submit", event => {
    event.preventDefault();
    const product = products.find(item => String(item.id) === $("stocktakeSearch").dataset.productId);
    const count = Number($("stocktakeQty").value);
    if (!product) return toast("امسح باركود المنتج أو اختره من نتائج البحث");
    if (!Number.isSafeInteger(count) || count < 0) return toast("أدخل كمية فعلية صحيحة");
    const zone = $("stocktakeZone").value;
    stocktakeEntries.set(String(product.id), { productId: product.id, zone, counted: count });
    $("stocktakeSearch").value = "";
    delete $("stocktakeSearch").dataset.productId;
    $("stocktakeQty").value = "0";
    renderStocktake();
  });
  $("stocktakeList").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-stocktake]");
    if (!button) return;
    stocktakeEntries.delete(button.dataset.removeStocktake);
    renderStocktake();
  });
  $("clearStocktake").addEventListener("click", () => {
    stocktakeEntries.clear();
    renderStocktake();
  });
  $("confirmStocktake").addEventListener("click", async () => {
    const actor = $("stocktakeActor").value.trim();
    if (!actor) return toast("أدخل اسم منفذ الجرد");
    try { localStorage.setItem("stockmate-last-actor", actor); } catch (error) { console.warn("Could not remember the operator name", error); }
    const rows = [...stocktakeEntries.values()];
    if (!rows.length) return;
    const productsToSave = [];
    const movementsToSave = [];
    const lotsToSave = new Map();
    for (const entry of rows) {
      const previousProduct = products.find(item => String(item.id) === String(entry.productId));
      if (!previousProduct) continue;
      const before = { ...previousProduct };
      const updated = { ...previousProduct, [entry.zone]: entry.counted };
      const difference = entry.counted - Number(before[entry.zone] || 0);
      if (!difference) continue;
      const movement = {
        id: uid(), productId: updated.id, productName: updated.name,
        qty: Math.abs(difference), label: "جرد فعلي", type: "adjust", time: Date.now(),
        actor, reason: "فرق جرد", locationCode: getLocationCode(updated),
        shelfName: shelfLabel(updated.shelf), sectionName: sectionName(updated.shelf || "1", updated.section),
        note: `${entry.zone === "store" ? "المخزن" : "البراد"}: ${before[entry.zone]} ← ${entry.counted}`
      };
      productsToSave.push(updated);
      movementsToSave.push(movement);
      const lots = prepareLotsForChange(updated, before, { label: movement.label });
      for (const lot of lots.changed) lotsToSave.set(lot.id, lot);
      for (const lot of lots.removed) lotsToSave.set(lot.id, null);
    }
    if (!movementsToSave.length) return toast("لا توجد فروقات لتسجيلها");
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(["products", "movements", "inventoryLots"], "readwrite");
        productsToSave.forEach(product => transaction.objectStore("products").put(product));
        movementsToSave.forEach(movement => transaction.objectStore("movements").put(movement));
        lotsToSave.forEach((lot, id) => lot ? transaction.objectStore("inventoryLots").put(lot) : transaction.objectStore("inventoryLots").delete(id));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("تعذر حفظ الجرد"));
        transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء حفظ الجرد"));
      });
      stocktakeEntries.clear();
      await reload();
      toast(`تم حفظ ${movementsToSave.length} فرق جرد`);
    } catch (error) {
      console.error("Could not save stocktake differences", error);
      toast("تعذر حفظ الجرد؛ لم يتم تأكيد الفروقات");
    }
  });

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
    await window.prepareBarcodeAudio?.();
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
    window.playBarcodeBeep?.();
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
    await window.prepareBarcodeAudio?.();
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
      (data.lots === undefined || (Array.isArray(data.lots) && data.lots.every(item =>
        item && typeof item.id === "string" && typeof item.productId === "string" &&
        Number.isFinite(Number(item.storeQty || 0)) && Number(item.storeQty || 0) >= 0 &&
        Number.isFinite(Number(item.fridgeQty || 0)) && Number(item.fridgeQty || 0) >= 0
      ))) &&
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
      const layout = defaultSections(shelfId);
      const sections = current.length ? current.map((section, index) => {
        const fallback = layout[index % layout.length];
        return {
          ...section,
          face: ["front", "back"].includes(section.face) ? section.face : fallback.face,
          level: [1, 2, 3].includes(Number(section.level)) ? Number(section.level) : fallback.level
        };
      }) : layout;
      const nextSlots = new Map();
      for (const section of sections) {
        const key = `${section.face}:${section.level}`;
        const next = nextSlots.get(key) || 1;
        section.slot = Number(section.slot) > 0 ? Number(section.slot) : next;
        nextSlots.set(key, Math.max(next, section.slot + 1));
      }
      const occupied = new Set(sections.map(section => `${section.face}:${section.level}`));
      for (const section of layout) {
        const position = `${section.face}:${section.level}`;
        if (!occupied.has(position)) {
          sections.push(section);
          occupied.add(position);
        }
      }
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
    const lots = Array.isArray(data.lots) ? data.lots : normalized.products.flatMap(product => {
      const storeQty = Math.max(0, Number(product.store) || 0);
      const fridgeQty = Math.max(0, Number(product.fridge) || 0);
      return storeQty || fridgeQty ? [{
        id: `opening-${product.id}`, productId: product.id, productName: product.name,
        supplier: "رصيد افتتاحي", unitCost: null, expiry: product.expiry || "",
        receivedAt: Number(product.created) || Date.now(), source: "opening", storeQty, fridgeQty
      }] : [];
    });
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["products", "movements", "shelves", "inventoryLots"], "readwrite");
      for (const name of ["products", "movements", "shelves", "inventoryLots"]) transaction.objectStore(name).clear();
      for (const item of normalized.products) transaction.objectStore("products").put(item);
      for (const item of data.movements) transaction.objectStore("movements").put(item);
      for (const item of normalized.shelves) transaction.objectStore("shelves").put(item);
      for (const item of lots) transaction.objectStore("inventoryLots").put(item);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("تعذر استيراد النسخة"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء الاستيراد"));
    });
  }

  async function addDemoProductsOnce() {
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
    const existing = new Set((await all("products")).map(product => String(product.id)));
    for (const product of demos) {
      if (existing.has(String(product.id))) continue;
      await put("products", product);
      if (Number(product.store) + Number(product.fridge) > 0) await put("inventoryLots", {
        id: uid(), productId: product.id, productName: product.name, supplier: "بيانات تجريبية",
        unitCost: null, expiry: product.expiry, receivedAt: product.created, source: "demo",
        storeQty: product.store, fridgeQty: product.fridge
      });
    }
  }

  $("addDemoProducts").addEventListener("click", async () => {
    try {
      await addDemoProductsOnce();
      await reload();
      toast("أضيفت البيانات التجريبية؛ يمكنك حذفها من قائمة المنتجات");
    } catch (error) {
      console.error("Adding optional demo products failed", error);
      toast("تعذرت إضافة البيانات التجريبية");
    }
  });

  $("exportBtn").addEventListener("click", async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const data = {
        version: 3, exportedAt: new Date().toISOString(),
        products: await all("products"), movements: await all("movements"), shelves: await all("shelves"),
        lots: await all("inventoryLots")
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
    const [existingProducts, existingShelves] = await Promise.all([all("products"), all("shelves")]);
    const normalized = normalizeShelfData(existingProducts, existingShelves);
    shelves = normalized.shelves;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["products", "shelves"], "readwrite");
      const productStore = transaction.objectStore("products");
      const shelfStore = transaction.objectStore("shelves");
      const oldProducts = new Map(existingProducts.map(product => [String(product.id), JSON.stringify(product)]));
      normalized.products.forEach(product => {
        if (oldProducts.get(String(product.id)) !== JSON.stringify(product)) productStore.put(product);
      });
      const oldShelves = new Map(existingShelves.map(shelf => [String(shelf.id), JSON.stringify(shelf)]));
      shelves.forEach(shelf => {
        if (oldShelves.get(String(shelf.id)) !== JSON.stringify(shelf)) shelfStore.put(shelf);
      });
      existingShelves.filter(shelf => !["1", "2"].includes(String(shelf.id))).forEach(shelf => shelfStore.delete(shelf.id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("تعذر تهيئة الرفوف"));
      transaction.onabort = () => reject(transaction.error || new Error("تم إلغاء تهيئة الرفوف"));
    });
    const oldLots = await all("inventoryLots");
    const lotProductIds = new Set(oldLots.map(lot => String(lot.productId)));
    const openingLots = normalized.products.flatMap(product => {
      if (lotProductIds.has(String(product.id))) return [];
      const storeQty = Math.max(0, Number(product.store) || 0);
      const fridgeQty = Math.max(0, Number(product.fridge) || 0);
      return storeQty || fridgeQty ? [{
        id: `opening-${product.id}`, productId: product.id, productName: product.name,
        supplier: "رصيد افتتاحي", unitCost: null, expiry: product.expiry || "",
        receivedAt: Number(product.created) || Date.now(), source: "opening", storeQty, fridgeQty
      }] : [];
    });
    if (openingLots.length) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("inventoryLots", "readwrite");
        openingLots.forEach(lot => transaction.objectStore("inventoryLots").put(lot));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("تعذر ترحيل الأرصدة إلى الدفعات"));
        transaction.onabort = () => reject(transaction.error || new Error("أُلغي ترحيل الدفعات"));
      });
    }
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
