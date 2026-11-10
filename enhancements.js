(() => {
  let shelfImage = "";
  let scannerControls = null;
  let zxingReader = null;
  let zxingLoadPromise = null;
  let movementPreviewProductId = "";
  let movementFilter = "all";
  let movementHistorySearch = "";
  let productDisplayLimit = 100;
  let lastProductQuery = "";
  let lastProductFilter = "all";
  const stocktakeEntries = new Map();
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
    }).join("") || "لا توجد تحديثات في هذا التصنيف.";
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
    </button>`).join("") || `<div class="movement-product-empty">${products.length ? "لا توجد نتائج مطابقة." : "أضف منتجاتك أولاً لتسجيل تحديثات المخزون."}</div>`;
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

  function productSearchRank(product, terms, query) {
    const name = normalizeProductSearch(product.name || "");
    const barcode = normalizeProductSearch(product.barcode || "");
    const primary = normalizeProductSearch([product.name, product.brand, product.flavor, product.size, product.barcode].filter(Boolean).join(" "));
    if (barcode && barcode === query) return 0;
    if (name === query) return 1;
    if (name.startsWith(query)) return 2;
    if (terms.every(term => primary.includes(term))) return 3;
    return 4;
  }

  window.renderProducts = function () {
    const terms = normalizeProductSearch($("productSearch").value).split(/\s+/).filter(Boolean);
    const queryKey = terms.join(" ");
    if (queryKey !== lastProductQuery || currentFilter !== lastProductFilter) {
      productDisplayLimit = 100;
      lastProductQuery = queryKey;
      lastProductFilter = currentFilter;
    }
    let list = products.filter(product => product.displayInProducts !== false).filter(product => {
      const searchable = productSearchText(product);
      return terms.every(term => searchable.includes(term));
    });
    if (currentFilter === "low") list = list.filter(low);
    if (currentFilter === "fixed") list = list.filter(product => product.locationType === "fixed");
    if (currentFilter === "variable") list = list.filter(product => product.locationType === "variable");
    list.sort((a, b) => (terms.length ? productSearchRank(a, terms, queryKey) - productSearchRank(b, terms, queryKey) : 0) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ar", { numeric: true }));
    const visibleProducts = list.slice(0, productDisplayLimit);
    $("productList").className = list.length ? "stack product-grid" : "stack empty-state";
    $("productResultCount").textContent = `${formatNumber(list.length)} ${list.length === 1 ? "منتج" : "منتجات"}`;
    $("clearProductSearch").classList.toggle("hidden", !$("productSearch").value);
    $("productList").innerHTML = visibleProducts.map(product => {
      const fridge = Math.max(0, Number(product.fridge) || 0);
      const store = Math.max(0, Number(product.store) || 0);
      const target = Math.max(0, Number(product.target) || 0);
      const minStore = Math.max(0, Number(product.minStore) || 0);
      const fridgePercent = target ? Math.min(100, Math.round(fridge / target * 100)) : fridge ? 100 : 0;
      const storePercent = minStore ? Math.min(100, Math.round(store / minStore * 100)) : store ? 100 : 0;
      const hasOffer = Number(product.offerQuantity) > 1 && product.offerPrice !== null &&
        product.offerPrice !== undefined && product.offerPrice !== "";
      const hasDiscount = product.discountPrice !== null && product.discountPrice !== undefined && product.discountPrice !== "";
      const unavailable = product.availability === "unavailable" && fridge <= 0 && store <= 0;
      const isLow = low(product);
      return `<article class="product-card product-card-redesigned ${isLow ? "product-card-low" : ""}" data-product-card="${escapeHTML(product.id)}" tabindex="0" aria-label="فتح تفاصيل ${escapeHTML(product.name)}">
        <div class="product-card-heading">
          ${product.image ? `<button type="button" class="product-image-trigger" data-expand-image data-image-src="${escapeHTML(product.image)}" data-image-caption="${escapeHTML(product.name)}" aria-label="عرض صورة ${escapeHTML(product.name)}"><img loading="lazy" class="product-thumb" src="${escapeHTML(product.image)}" alt=""></button>` : '<div class="product-thumb placeholder">▣</div>'}
          <div class="product-card-identity">
            <button type="button" class="product-name product-detail-trigger" data-product-detail="${escapeHTML(product.id)}">${escapeHTML(product.name)}</button>
            <div class="product-card-meta">${escapeHTML([product.brand, product.flavor, product.size].filter(Boolean).join(" · ") || "بدون تفاصيل إضافية")}</div>
            <div class="product-card-location"><span aria-hidden="true">⌖</span> ${escapeHTML(getLocationCode(product))}</div>
          </div>
          <span class="product-state ${unavailable ? "is-unavailable" : isLow ? "is-low" : "is-ready"}">${unavailable ? "غير متوفر" : isLow ? "يحتاج تعبئة" : "متوفر"}</span>
          <button class="product-card-edit" type="button" data-edit="${escapeHTML(product.id)}" aria-label="تعديل ${escapeHTML(product.name)}">✎</button>
        </div>
        <div class="product-card-prices">
          <div class="price-highlight regular-price"><small>سعر القطعة</small><strong>${escapeHTML(formatPrice(product.price))}</strong></div>
          ${hasDiscount ? `<div class="price-highlight discount-price"><small>تخفيض القطعة</small><strong>${escapeHTML(formatPrice(product.discountPrice))}</strong></div>` : ""}
          ${hasOffer ? `<div class="price-highlight offer-price"><small>عرض ${formatNumber(product.offerQuantity)} قطع · الإجمالي</small><strong>${escapeHTML(formatPrice(product.offerPrice))}</strong></div>` : ""}
        </div>
        <div class="product-stock-summary" aria-label="ملخص الكميات">
          <div class="product-stock-tile fridge-tile">
            <div class="product-stock-tile-head"><span>▣ البراد</span><b>${formatNumber(fridge)} <small>قطعة</small></b></div>
            <div class="product-stock-meter" role="progressbar" aria-label="كمية البراد مقارنة بالهدف" aria-valuenow="${fridgePercent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${fridgePercent}%"></span></div>
            <small>${target ? `الهدف ${formatNumber(target)} قطعة` : "لم يُحدد هدف"}</small>
          </div>
          <div class="product-stock-tile store-tile">
            <div class="product-stock-tile-head"><span>▤ المخزن</span><b>${formatNumber(store)} <small>قطعة</small></b></div>
            <div class="product-stock-meter" role="progressbar" aria-label="كمية المخزن مقارنة بحد المتابعة" aria-valuenow="${storePercent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${storePercent}%"></span></div>
            <small>${minStore ? `حد المتابعة ${formatNumber(minStore)} قطعة` : "الكمية المتوفرة"}</small>
          </div>
        </div>
        <div class="product-card-tags">${product.isDemo ? '<span class="tag demo-tag">بيانات تجريبية</span>' : ""}${unavailable ? '<span class="tag bad">غير متوفر حالياً</span>' : ""}${isLow ? `<span class="tag bad">نقص البراد · ${formatNumber(refill(product))} قطعة</span>` : ""}${storeLow(product) ? '<span class="tag warn">كمية المخزن منخفضة</span>' : ""}</div>
        ${isLow ? `<div class="product-shortage-hint">يلزم ${formatNumber(refill(product))} قطعة · نحو ${formatNumber(Math.ceil(refill(product) / Math.max(1, Number(product.cartonSize) || 1)))} كرتون</div>` : ""}
        <details class="product-stock-disclosure">
          <summary><span>تعديل الكميات</span><small>تحديث يدوي للبراد أو المخزن</small></summary>
          <div class="product-stock-editor" aria-label="كميات المنتج القابلة للتعديل">
            <div class="product-stock-field fridge-stock-field"><label for="stock-fridge-${escapeHTML(product.id)}">▣ البراد</label><small>الهدف ${formatNumber(target)} قطعة</small><div><input id="stock-fridge-${escapeHTML(product.id)}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${fridge}" data-stock-qty="${escapeHTML(product.id)}" data-stock-zone="fridge"><span>قطعة</span></div><button type="button" data-save-stock="${escapeHTML(product.id)}" data-stock-zone="fridge">حفظ كمية البراد</button></div>
            <div class="product-stock-field store-stock-field"><label for="stock-store-${escapeHTML(product.id)}">▤ المخزن</label><small>${storeLow(product) ? "يحتاج متابعة" : "كمية متاحة"}</small><div><input id="stock-store-${escapeHTML(product.id)}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${store}" data-stock-qty="${escapeHTML(product.id)}" data-stock-zone="store"><span>قطعة</span></div><button type="button" data-save-stock="${escapeHTML(product.id)}" data-stock-zone="store">حفظ كمية المخزن</button></div>
          </div>
        </details>
        <div class="card-actions product-card-actions"><button class="small-btn product-action-detail" type="button" data-product-detail="${escapeHTML(product.id)}">التفاصيل <span aria-hidden="true">←</span></button><button class="small-btn" type="button" data-mark-refill="${escapeHTML(product.id)}">تحديد النقص</button>${isLow ? `<button class="small-btn product-filled-button" type="button" data-mark-filled="${escapeHTML(product.id)}">تمت تعبئة البراد</button>` : ""}<button class="small-btn" type="button" data-move="${escapeHTML(product.id)}">حركة</button><button class="small-btn" type="button" data-show-barcode="${escapeHTML(product.id)}">الباركود</button></div>
      </article>`;
    }).join("") + (list.length > visibleProducts.length ? `<button type="button" class="soft wide" data-show-more-products>عرض 100 منتج إضافي (${formatNumber(list.length - visibleProducts.length)} متبقٍ)</button>` : "") || "لا توجد نتائج مطابقة.";
  };
  $("productList").addEventListener("click", event => {
    if (!event.target.closest("[data-show-more-products]")) return;
    productDisplayLimit += 100;
    window.renderProducts();
  });
  $("productList").addEventListener("click", async event => {
    const button = event.target.closest("[data-save-stock]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const product = products.find(item => String(item.id) === button.dataset.saveStock);
    const input = [...$("productList").querySelectorAll("[data-stock-qty]")]
      .find(element => element.dataset.stockQty === button.dataset.saveStock && element.dataset.stockZone === button.dataset.stockZone);
    if (!product || !input) return;
    const quantity = Number(input.value);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      toast("أدخل كمية صحيحة من صفر أو أكثر");
      input.focus();
      return;
    }
    const zone = button.dataset.stockZone;
    const before = { fridge: Number(product.fridge) || 0, store: Number(product.store) || 0 };
    if (quantity === before[zone]) return toast("الكمية لم تتغير");
    const updated = { ...product, [zone]: quantity };
    if (zone === "fridge" && updated.needsRefill) {
      updated.needsRefill = false;
      delete updated.refillRequest;
    }
    const movement = {
      id: uid(), productId: product.id, productName: product.name,
      qty: Math.abs(quantity - before[zone]),
      label: zone === "fridge" ? "تعديل كمية البراد" : "تعديل كمية المخزن",
      type: "adjust", time: Date.now(), actor: "المستخدم",
      reason: "تعديل مباشر من قائمة المنتجات", locationCode: getLocationCode(product),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section),
      note: `${zone === "fridge" ? "البراد" : "المخزن"}: ${before[zone]} ← ${quantity}`
    };
    button.disabled = true;
    try {
      await saveMovementAtomically(updated, movement, { before });
      await reload();
      toast(`تم تحديث كمية ${zone === "fridge" ? "البراد" : "المخزن"} وتسجيل التحديث`);
    } catch (error) {
      console.error("Could not update product stock from product list", error);
      toast("تعذر تحديث الكمية؛ لم يتغير المخزون");
      button.disabled = false;
    }
  });

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-mark-filled]");
    if (!button) return;
    const product = products.find(item => String(item.id) === button.dataset.markFilled);
    if (!product) return;
    const quantity = refill(product);
    const before = { fridge: Number(product.fridge) || 0, store: Number(product.store) || 0 };
    if (!Number.isSafeInteger(quantity) || quantity < 1) return toast("لا توجد كمية تعبئة مطلوبة");
    if (before.store < quantity) return toast(`المخزن لا يكفي؛ يلزم ${formatNumber(quantity)} قطعة والمتوفر ${formatNumber(before.store)} قطعة`);
    const updated = { ...product, fridge: before.fridge + quantity, store: before.store - quantity, needsRefill: false };
    delete updated.refillRequest;
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "نقل من المخزن إلى البراد", type: "transfer", time: Date.now(),
      actor: "المستخدم", reason: "إتمام تعبئة البراد",
      note: `البراد ${before.fridge} ← ${updated.fridge} · المخزن ${before.store} ← ${updated.store}`,
      locationCode: getLocationCode(product), shelfName: shelfLabel(product.shelf),
      sectionName: sectionName(product.shelf || "1", product.section)
    };
    try {
      await saveMovementAtomically(updated, movement, { before });
      await reload();
      toast(`تم نقل ${formatNumber(quantity)} قطعة؛ البراد مكتمل حسب الكمية المحددة`);
    } catch (error) {
      console.error("Could not complete product refill", error);
      toast("تعذر تسجيل التعبئة؛ لم يتغير المخزون");
    }
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
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "تعبئة من قائمة التعبئة", time: Date.now(),
      type: "transfer", actor: "المستخدم",
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

  let warehouseFilter = "all";
  window.renderWarehouse = function () {
    const terms = normalizeProductSearch($("warehouseSearch").value).split(/\s+/).filter(Boolean);
    const addProductSelect = $("warehouseAddProduct");
    const selectedAddProduct = addProductSelect.value;
    addProductSelect.innerHTML = `<option value="">اختر المنتج</option>${[...products]
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar", { numeric: true }))
      .map(product => `<option value="${escapeHTML(product.id)}">${escapeHTML(product.name || "منتج")} · ${escapeHTML(product.barcode || "بدون باركود")}</option>`)
      .join("")}`;
    if (products.some(product => String(product.id) === selectedAddProduct)) addProductSelect.value = selectedAddProduct;
    updateWarehouseAddUnit();
    const closestLotExpiry = new Map();
    inventoryLots.forEach(lot => {
      if (Number(lot.storeQty) + Number(lot.fridgeQty) <= 0 || !lot.expiry) return;
      const productId = String(lot.productId);
      if (!closestLotExpiry.has(productId) || String(lot.expiry) < closestLotExpiry.get(productId)) {
        closestLotExpiry.set(productId, lot.expiry);
      }
    });
    const stockedProducts = products.filter(product => Number(product.store || 0) > 0);
    $("warehouseProductCount").textContent = formatNumber(products.length);
    $("warehouseStockedCount").textContent = formatNumber(stockedProducts.length);
    $("warehouseTotalStock").textContent = `${formatNumber(products.reduce((sum, product) => sum + (Number(product.store) || 0), 0))} قطعة`;
    const list = products.filter(product => {
      const quantity = Number(product.store) || 0;
      if (warehouseFilter === "stocked" && quantity <= 0) return false;
      if (warehouseFilter === "empty" && quantity > 0) return false;
      const searchable = productSearchText(product);
      return terms.every(term => searchable.includes(term));
    }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar", { numeric: true }));
    $("warehouseProducts").className = list.length ? "stack warehouse-grid" : "stack empty-state";
    $("warehouseProducts").innerHTML = list.map(product => {
      const quantity = Number(product.store) || 0;
      const cartonSize = Math.max(1, Number(product.cartonSize) || 1);
      const cartons = cartonSize > 1 ? Math.floor(quantity / cartonSize) : 0;
      const pieces = cartonSize > 1 ? quantity % cartonSize : quantity;
      const unit = cartonSize > 1 && quantity % cartonSize === 0 ? "carton" : "piece";
      const inputValue = unit === "carton" ? cartons : quantity;
      const expiry = product.expiry || closestLotExpiry.get(String(product.id)) || "";
      const expiryDays = expiry ? daysTo(expiry) : null;
      const expiryLabel = !expiry ? "غير محددة" :
        expiryDays < 0 ? `${expiry} · منتهية منذ ${formatNumber(Math.abs(expiryDays))} يوم` :
          expiryDays === 0 ? `${expiry} · تنتهي اليوم` :
            `${expiry} · متبقي ${formatNumber(expiryDays)} يوم`;
      const expiryClass = Number.isFinite(expiryDays) && expiryDays <= 30 ? "warehouse-expiry urgent" : "warehouse-expiry";
      const details = [product.brand, product.flavor, product.size].filter(Boolean).join(" · ") || "بدون تفاصيل إضافية";
      const hasDiscount = product.discountPrice !== null && product.discountPrice !== undefined && product.discountPrice !== "";
      const hasBundleOffer = Number(product.offerQuantity) > 1 && product.offerPrice !== null && product.offerPrice !== undefined && product.offerPrice !== "";
      const price = `<div class="warehouse-price-card warehouse-unit-price"><small>سعر القطعة</small><b>${escapeHTML(formatPrice(product.price))}</b></div>${
        hasDiscount ? `<div class="warehouse-price-card warehouse-discount-price"><small>تخفيض القطعة</small><b>${escapeHTML(formatPrice(product.discountPrice))}</b></div>` : ""}${
        hasBundleOffer ? `<div class="warehouse-price-card warehouse-bundle-price"><small>عرض ${formatNumber(product.offerQuantity)} قطع · الإجمالي</small><b>${escapeHTML(formatPrice(product.offerPrice))}</b><del>${escapeHTML(formatPrice(Number(product.price) * Number(product.offerQuantity)))}</del></div>` : ""}`;
      return `<article class="warehouse-card">
        <div class="warehouse-card-head">
          ${product.image
            ? `<button type="button" class="product-image-trigger" data-expand-image data-image-src="${escapeHTML(product.image)}" data-image-caption="${escapeHTML(product.name)}" aria-label="عرض صورة ${escapeHTML(product.name)}"><img loading="lazy" class="product-thumb" src="${escapeHTML(product.image)}" alt=""></button>`
            : '<div class="product-thumb placeholder">▣</div>'}
          <div class="warehouse-identity"><b>${escapeHTML(product.name || "منتج")}</b><small>${escapeHTML(details)}</small><small>${escapeHTML(product.barcode ? `الباركود: ${product.barcode}` : "بدون باركود")}</small></div>
          <span class="warehouse-stock-status ${quantity > 0 ? "has-stock" : "no-stock"}">${quantity > 0 ? "متوفر" : "الكمية صفر"}</span>
        </div>
        <div class="warehouse-price">${price}</div>
        <div class="warehouse-quantity" aria-label="كمية المخزن">
          <div><small>الكمية المتوفرة في المخزن</small><b>${cartonSize > 1 && cartons ? `${formatNumber(cartons)} كرتون` : ""}${cartonSize > 1 && cartons && pieces ? " و " : ""}${pieces || !cartons ? `${formatNumber(pieces)} قطعة` : ""}</b></div>
          ${cartonSize > 1 ? `<small>${formatNumber(cartonSize)} قطعة في الكرتون</small>` : ""}
        </div>
        <div class="${expiryClass}"><small>أقرب تاريخ صلاحية</small><b>${escapeHTML(expiryLabel)}</b></div>
        <div class="warehouse-details"><span>الموقع</span><b>${escapeHTML(`${getLocationCode(product)}${product.location ? ` · ${product.location}` : ""}`)}</b><span>تاريخ الإضافة</span><b>${product.created ? new Date(product.created).toLocaleDateString("en-GB") : "غير محدد"}</b></div>
        <div class="warehouse-stock-editor">
          <label for="warehouse-qty-${escapeHTML(product.id)}">الكمية الجديدة في المخزن</label>
          <div class="warehouse-stock-controls">
            <input id="warehouse-qty-${escapeHTML(product.id)}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" value="${inputValue}" data-warehouse-qty="${escapeHTML(product.id)}" aria-label="كمية ${escapeHTML(product.name)}">
            <select data-warehouse-unit="${escapeHTML(product.id)}" aria-label="وحدة الكمية للمنتج ${escapeHTML(product.name)}">
              ${cartonSize > 1 ? `<option value="carton" ${unit === "carton" ? "selected" : ""}>كرتون</option>` : ""}
              <option value="piece" ${unit === "piece" ? "selected" : ""}>قطعة</option>
            </select>
          </div>
          <small>${cartonSize > 1 ? `كل كرتون = ${formatNumber(cartonSize)} قطعة` : "الكمية بالقطعة"}</small>
          <small>ستصبح هذه الكمية الجديدة هي المتوفرة؛ لإضافة وارد استخدم زر «إضافة كمية».</small>
          <label for="warehouse-price-${escapeHTML(product.id)}">سعر البيع للقطعة (د.ع)</label>
          <input id="warehouse-price-${escapeHTML(product.id)}" type="number" inputmode="decimal" lang="en" dir="ltr" min="0" step="any" value="${product.price ?? ""}" data-warehouse-price="${escapeHTML(product.id)}" aria-label="سعر بيع ${escapeHTML(product.name)}">
          <label for="warehouse-discount-${escapeHTML(product.id)}">تخفيض سعر القطعة (اختياري)</label>
          <input id="warehouse-discount-${escapeHTML(product.id)}" type="number" inputmode="decimal" lang="en" dir="ltr" min="0" step="any" value="${product.discountPrice ?? ""}" data-warehouse-discount="${escapeHTML(product.id)}" aria-label="سعر تخفيض ${escapeHTML(product.name)}">
          <label for="warehouse-offer-quantity-${escapeHTML(product.id)}">عدد القطع المشمولة بالعرض (اختياري)</label>
          <input id="warehouse-offer-quantity-${escapeHTML(product.id)}" type="number" inputmode="numeric" min="2" step="1" value="${product.offerQuantity ?? ""}" data-warehouse-offer-quantity="${escapeHTML(product.id)}" aria-label="عدد القطع المشمولة بالعرض ${escapeHTML(product.name)}">
          <label for="warehouse-offer-price-${escapeHTML(product.id)}">سعر العرض الإجمالي (اختياري)</label>
          <input id="warehouse-offer-price-${escapeHTML(product.id)}" type="number" inputmode="decimal" lang="en" dir="ltr" min="0" step="any" value="${product.offerPrice ?? ""}" data-warehouse-offer-price="${escapeHTML(product.id)}" aria-label="سعر العرض الإجمالي ${escapeHTML(product.name)}">
          <small class="warehouse-promo-hint">سعر العرض للمجموعة كاملة، ويُقارن بسعر القطعة × عدد القطع. تخفيض القطعة مستقل عنه.</small>
          <label for="warehouse-expiry-${escapeHTML(product.id)}">تاريخ انتهاء الصلاحية</label>
          <input id="warehouse-expiry-${escapeHTML(product.id)}" type="date" value="${escapeHTML(expiry)}" data-original-expiry="${escapeHTML(expiry)}" data-warehouse-expiry="${escapeHTML(product.id)}" aria-label="صلاحية ${escapeHTML(product.name)}">
          <button type="button" class="soft" data-warehouse-save="${escapeHTML(product.id)}">حفظ الأسعار والعرض والصلاحية والكمية</button>
        </div>
        <div class="warehouse-card-actions">
          <button type="button" class="primary" data-warehouse-add="${escapeHTML(product.id)}">＋ إضافة كمية</button>
          ${product.displayInProducts === false
            ? `<button type="button" class="soft" data-warehouse-display="${escapeHTML(product.id)}">إضافة المنتج إلى العرض</button>`
            : `<button type="button" class="small-btn" data-warehouse-hide="${escapeHTML(product.id)}">إخفاء من صفحة المنتجات</button>`}
          <button type="button" class="soft" data-warehouse-details="${escapeHTML(product.id)}">تفاصيل المنتج</button>
        </div>
      </article>`;
    }).join("") || (products.length ? "لا توجد منتجات مطابقة." : "لا توجد منتجات مسجلة. أضف منتجاً من صفحة المنتجات.");
  };
  function updateWarehouseAddUnit() {
    const product = products.find(item => String(item.id) === $("warehouseAddProduct").value);
    const cartonOption = $("warehouseAddUnit").querySelector('option[value="carton"]');
    cartonOption.disabled = !product || Number(product.cartonSize) <= 1;
    if (!product || Number(product.cartonSize) <= 1) $("warehouseAddUnit").value = "piece";
    else if (!$("warehouseAddQty").value) $("warehouseAddUnit").value = "carton";
    $("warehouseAddUnitHint").textContent = product
      ? Number(product.cartonSize) > 1
        ? `كل كرتون من ${product.name} يحتوي ${formatNumber(product.cartonSize)} قطعة.`
        : "هذا المنتج يُحسب بالقطعة."
      : "اختر منتجاً لمعرفة عدد القطع في الكرتون.";
  }
  $("warehouseAddProduct").addEventListener("change", () => {
    $("warehouseAddQty").value = "";
    updateWarehouseAddUnit();
  });
  $("warehouseAddUnit").addEventListener("change", updateWarehouseAddUnit);
  $("warehouseAddForm").addEventListener("submit", async event => {
    event.preventDefault();
    const product = products.find(item => String(item.id) === $("warehouseAddProduct").value);
    if (!product) return toast("اختر المنتج الذي تريد إضافته إلى المخزن");
    const entered = Number($("warehouseAddQty").value);
    const cartonSize = Math.max(1, Number(product.cartonSize) || 1);
    const unit = $("warehouseAddUnit").value;
    const quantity = unit === "carton" ? entered * cartonSize : entered;
    if (!Number.isSafeInteger(entered) || entered < 1 || !Number.isSafeInteger(quantity) || quantity < 1) {
      toast("أدخل كمية صحيحة بالكرتون أو القطعة");
      $("warehouseAddQty").focus();
      return;
    }
    const before = { ...product, store: Number(product.store) || 0 };
    const updated = { ...product, store: before.store + quantity, availability: "available" };
    if (!Number.isSafeInteger(updated.store)) return toast("الكمية الكلية أكبر من المسموح");
    const expiry = $("warehouseAddExpiry").value;
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "إضافة كمية للمخزن", type: "receipt", time: Date.now(), actor: "المستخدم",
      reason: "إضافة وارد من صفحة المخزن", expiry,
      locationCode: getLocationCode(product), shelfName: shelfLabel(product.shelf),
      sectionName: sectionName(product.shelf || "1", product.section),
      note: $("warehouseAddNote").value.trim() ||
        `إضافة ${formatNumber(entered)} ${unit === "carton" ? "كرتون" : "قطعة"} (${formatNumber(quantity)} قطعة)`
    };
    const submitButton = $("warehouseAddForm").querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await saveMovementAtomically(updated, movement, { before, expiry, source: "receipt" });
      $("warehouseAddForm").reset();
      await reload();
      toast(`تمت إضافة ${formatNumber(quantity)} قطعة إلى مخزن ${product.name}`);
    } catch (error) {
      console.error("Could not add warehouse stock", error);
      toast("تعذرت إضافة الكمية؛ لم تتغير كمية المخزن");
    } finally {
      submitButton.disabled = false;
      updateWarehouseAddUnit();
    }
  });
  document.querySelector("[data-scroll-warehouse-add]").addEventListener("click", () => {
    window.setInventoryTab?.("products");
    $("warehouseAddSection").scrollIntoView({ behavior: "smooth", block: "start" });
    $("warehouseAddProduct").focus({ preventScroll: true });
  });
  $("warehouseSearch").addEventListener("input", window.renderWarehouse);
  document.querySelectorAll("[data-warehouse-filter]").forEach(button => button.addEventListener("click", () => {
    warehouseFilter = button.dataset.warehouseFilter;
    document.querySelectorAll("[data-warehouse-filter]").forEach(filter => filter.classList.toggle("active", filter === button));
    window.renderWarehouse();
  }));
  $("warehouseProducts").addEventListener("click", async event => {
    const saveButton = event.target.closest("[data-warehouse-save]");
    if (saveButton) {
      event.preventDefault();
      event.stopPropagation();
      const product = products.find(item => String(item.id) === saveButton.dataset.warehouseSave);
      const input = [...$("warehouseProducts").querySelectorAll("[data-warehouse-qty]")]
        .find(item => item.dataset.warehouseQty === saveButton.dataset.warehouseSave);
      const unit = [...$("warehouseProducts").querySelectorAll("[data-warehouse-unit]")]
        .find(item => item.dataset.warehouseUnit === saveButton.dataset.warehouseSave)?.value;
      const priceInput = [...$("warehouseProducts").querySelectorAll("[data-warehouse-price]")]
        .find(item => item.dataset.warehousePrice === saveButton.dataset.warehouseSave);
      const discountInput = [...$("warehouseProducts").querySelectorAll("[data-warehouse-discount]")]
        .find(item => item.dataset.warehouseDiscount === saveButton.dataset.warehouseSave);
      const offerQuantityInput = [...$("warehouseProducts").querySelectorAll("[data-warehouse-offer-quantity]")]
        .find(item => item.dataset.warehouseOfferQuantity === saveButton.dataset.warehouseSave);
      const offerPriceInput = [...$("warehouseProducts").querySelectorAll("[data-warehouse-offer-price]")]
        .find(item => item.dataset.warehouseOfferPrice === saveButton.dataset.warehouseSave);
      const expiryInput = [...$("warehouseProducts").querySelectorAll("[data-warehouse-expiry]")]
        .find(item => item.dataset.warehouseExpiry === saveButton.dataset.warehouseSave);
      if (!product || !input || !priceInput || !discountInput || !offerQuantityInput || !offerPriceInput || !expiryInput) return;
      const entered = Number(input.value);
      const cartonSize = Math.max(1, Number(product.cartonSize) || 1);
      const quantity = unit === "carton" ? entered * cartonSize : entered;
      if (!Number.isSafeInteger(entered) || entered < 0 || !Number.isSafeInteger(quantity)) {
        toast("أدخل كمية صحيحة بالكرتون أو القطعة");
        input.focus();
        return;
      }
      const priceValue = priceInput.value.trim();
      const price = priceValue ? Number(priceValue) : null;
      const discountValue = discountInput.value.trim();
      const discountPrice = discountValue ? Number(discountValue) : null;
      const offerPriceValue = offerPriceInput.value.trim();
      const offerPrice = offerPriceValue ? Number(offerPriceValue) : null;
      const offerQuantityValue = offerQuantityInput.value.trim();
      const offerQuantity = offerQuantityValue ? Number(offerQuantityValue) : null;
      if (priceValue && (!Number.isFinite(price) || price < 0)) {
        toast("أدخل سعر بيع صحيحاً");
        priceInput.focus();
        return;
      }
      if (discountValue && (!Number.isFinite(discountPrice) || discountPrice < 0 || price === null || discountPrice >= price)) {
        toast("يجب أن يكون تخفيض القطعة أقل من سعرها الأساسي");
        discountInput.focus();
        return;
      }
      if ((offerPriceValue === "") !== (offerQuantityValue === "")) {
        toast("أدخل سعر العرض الإجمالي وعدد القطع معاً");
        (offerPriceValue === "" ? offerPriceInput : offerQuantityInput).focus();
        return;
      }
      if (offerQuantity !== null && (!Number.isSafeInteger(offerQuantity) || offerQuantity < 2)) {
        toast("أدخل عدداً صحيحاً لا يقل عن قطعتين للعرض");
        offerQuantityInput.focus();
        return;
      }
      if (offerPriceValue && (!Number.isFinite(offerPrice) || offerPrice < 0 || price === null || offerPrice >= price * offerQuantity)) {
        toast("يجب أن يكون سعر العرض أقل من مجموع أسعار القطع قبل العرض");
        offerPriceInput.focus();
        return;
      }
      const before = { ...product, store: Number(product.store) || 0 };
      const expiry = expiryInput.value;
      const expiryChanged = expiry !== expiryInput.dataset.originalExpiry;
      const quantityChanged = quantity !== before.store;
      const updated = { ...product, store: quantity, price, discountPrice, offerPrice, offerQuantity, expiry };
      const movement = {
        id: uid(), productId: product.id, productName: product.name, qty: Math.abs(quantity - before.store),
        label: "تعديل بيانات المخزن", type: "adjust", time: Date.now(), actor: "المستخدم",
        reason: "تعديل الأسعار والعرض والصلاحية والكمية", locationCode: getLocationCode(product),
        shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section),
        note: `كمية المخزن: ${formatNumber(before.store)} ← ${formatNumber(quantity)} قطعة · السعر الأساسي: ${formatPrice(price)}${discountPrice === null ? "" : ` · تخفيض القطعة: ${formatPrice(discountPrice)}`}${offerPrice === null ? "" : ` · عرض ${formatNumber(offerQuantity)} قطع: ${formatPrice(offerPrice)}`} · الصلاحية: ${expiry || "غير محددة"}`
      };
      saveButton.disabled = true;
      try {
        await saveMovementAtomically(updated, movement, {
          before, expiry, updateExpiry: expiryChanged, recordMovement: quantityChanged
        });
        await reload();
        toast("تم حفظ بيانات المنتج في المخزن");
      } catch (error) {
        console.error("Could not update warehouse product", error);
        saveButton.disabled = false;
        toast("تعذر حفظ بيانات المنتج؛ لم تتغير البيانات");
      }
      return;
    }
    const addButton = event.target.closest("[data-warehouse-add]");
    if (addButton) {
      $("warehouseAddProduct").value = addButton.dataset.warehouseAdd;
      $("warehouseAddQty").value = "";
      updateWarehouseAddUnit();
      $("warehouseAddSection").scrollIntoView({ behavior: "smooth", block: "start" });
      $("warehouseAddQty").focus({ preventScroll: true });
      return;
    }
    const displayButton = event.target.closest("[data-warehouse-display],[data-warehouse-hide]");
    if (displayButton) {
      const product = products.find(item => String(item.id) === (displayButton.dataset.warehouseDisplay || displayButton.dataset.warehouseHide));
      if (!product) return;
      const displayInProducts = Boolean(displayButton.dataset.warehouseDisplay);
      try {
        await put("products", { ...product, displayInProducts });
        await reload();
        toast(displayInProducts ? "تمت إضافة المنتج إلى صفحة المنتجات" : "تم إخفاء المنتج من صفحة المنتجات؛ بقي محفوظاً في المخزن");
      } catch (error) {
        console.error("Could not change warehouse product display status", error);
        toast("تعذر تغيير ظهور المنتج");
      }
      return;
    }
    const detailsButton = event.target.closest("[data-warehouse-details]");
    if (detailsButton) {
      openProductDetails(products.find(item => String(item.id) === detailsButton.dataset.warehouseDetails));
      return;
    }
    const editButton = event.target.closest("[data-warehouse-edit]");
    if (editButton) openProduct(products.find(item => String(item.id) === editButton.dataset.warehouseEdit));
  });
  const originalRenderAll = window.renderAll;
  window.renderAll = function () {
    syncShelfOptions();
    originalRenderAll();
    renderShelves();
    renderMovementHistory();
    renderMovementProductPicker("", false);
    renderInventoryTools();
    window.renderWarehouse();
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
  window.openProduct = function (product, options) {
    syncShelfOptions();
    originalOpenProduct(product, options);
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
    $("cartonSizeWrap").classList.toggle("hidden", $("movementUnit").value !== "carton");
    $("movementQty").required = true;
    if (!product) {
      movementPreviewProductId = "";
      $("movementPreview").textContent = "اختر منتجاً لعرض الكمية المتاحة.";
      $("saveMovementBtn").disabled = true;
      return;
    }
    $("saveMovementBtn").disabled = false;
    movementPreviewProductId = product.id;
    const qty = Math.max(0, Number($("movementQty").value) || 0);
    const unit = $("movementUnit").value;
    const pieces = unit === "carton" ? qty * (Number($("cartonSize").value) || 1) : qty;
    const destination = type === "transfer" ? `المتاح للنقل من المخزن: ${product.store || 0} قطعة` :
      type === "removeFridge" ? `المتاح للسحب من البراد: ${product.fridge || 0} قطعة` :
        `الكمية الحالية في المخزن: ${product.store || 0} قطعة`;
    const result = type === "transfer"
    ? `بعد النقل: البراد ${Number(product.fridge || 0) + pieces} · المخزن ${Number(product.store || 0) - pieces}`
    : type === "removeFridge"
      ? `بعد السحب: البراد ${Math.max(0, Number(product.fridge || 0) - pieces)}`
      : `بعد الإضافة: المخزن ${Number(product.store || 0) + pieces}`;
    $("movementPreview").textContent = `${getLocationCode(product)} · ${pieces} قطعة ${unit === "carton" ? `(${qty} كرتون)` : ""} · ${destination} · ${result}`;
  }

  $("movementType").addEventListener("change", updateMovementPreview);
  document.querySelectorAll("[data-movement-type]").forEach(button => button.addEventListener("click", () => {
    $("movementType").value = button.dataset.movementType;
    document.querySelectorAll("[data-movement-type]").forEach(item => item.classList.toggle("active", item === button));
    updateMovementPreview();
  }));
  ["movementProduct", "movementQty", "movementUnit", "cartonSize"].forEach(id =>
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
    const entered = Number($("movementQty").value);
    if (!Number.isInteger(entered) || entered < 1) return toast("أدخل كمية صحيحة");
    const quantity = $("movementUnit").value === "carton"
      ? entered * Math.max(1, Number($("cartonSize").value) || Number(product.cartonSize) || 1)
      : entered;
    if (!Number.isSafeInteger(quantity) || quantity < 1) return toast("الكمية المدخلة أكبر من المسموح");
    let label;
    let note = $("movementNote").value.trim();
    if (type === "transfer") {
      if (before.store < quantity) return toast("الكمية في المخزن غير كافية");
      product.store = before.store - quantity;
      product.fridge = before.fridge + quantity;
      label = "نقل من المخزن إلى البراد";
    } else if (type === "addStore") {
      product.store = before.store + quantity;
      label = "إضافة إلى المخزن";
    } else {
      if (before.fridge < quantity) return toast("الكمية في البراد غير كافية");
      product.fridge = before.fridge - quantity;
      label = "سحب من البراد";
    }
    if (product.needsRefill === true) {
      if (type === "transfer") {
        const remainingRequest = Math.max(0, Number(product.refillRequest || 0) - quantity);
        if (remainingRequest) product.refillRequest = remainingRequest;
        else {
          product.needsRefill = false;
          delete product.refillRequest;
        }
      } else if (type === "removeFridge") {
        product.refillRequest = (Number(product.refillRequest) || 0) + quantity;
      }
    }
    if (!Number.isSafeInteger(product.fridge) || !Number.isSafeInteger(product.store)) return toast("تعذر تحديث الكمية بسبب تجاوز الحد");
    if ($("movementUnit").value === "carton") note = `${entered} صندوق (${quantity} قطعة)${note ? ` · ${note}` : ""}`;
    const after = `البراد ${product.fridge} · المخزن ${product.store}`;
    note = note ? `${after} · ${note}` : after;
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label, type, time: Date.now(), note, actor: "المستخدم", reason: label, locationCode: getLocationCode(product),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section)
    };
    try {
      await saveMovementAtomically(product, movement, { before });
      $("movementQty").value = 1;
      $("movementNote").value = "";
      await reload();
      updateMovementPreview();
      toast("تم تسجيل التحديث وتحديث الكميات");
    } catch (error) {
      console.error("Could not save inventory movement", error);
      toast("تعذر حفظ التحديث؛ لم يتم تأكيد التغيير");
    }
  }, true);

  function prepareLotsForChange(product, previous, metadata = {}) {
    const rows = inventoryLots.filter(lot => String(lot.productId) === String(product.id)).map(lot => ({ ...lot }));
    const originalRows = rows.map(lot => ({ ...lot }));
    if (metadata.updateExpiry) {
      rows.forEach(lot => {
        if (Number(lot.storeQty) + Number(lot.fridgeQty) > 0) lot.expiry = metadata.expiry || "";
      });
    }
    for (const zone of ["store", "fridge"]) {
      const field = `${zone}Qty`;
      const sum = rows.reduce((total, lot) => total + Math.max(0, Number(lot[field]) || 0), 0);
      const difference = Number(previous[zone] || 0) - sum;
      if (difference > 0) rows.push({
        id: uid(), productId: product.id, productName: product.name,
        supplier: "كمية افتتاحية / تسوية", unitCost: null,
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
      if (metadata.recordMovement !== false) transaction.objectStore("movements").put(movement);
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
      label: previous ? "تسوية مخزون من بيانات المنتج" : "كمية افتتاحية للمنتج",
      type: "adjust", time: Date.now(), actor,
      reason: previous ? "تسوية يدوية" : "كمية افتتاحية",
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
      card("منتجات راكدة 30 يوماً أو أكثر", stagnant, product => `<p>${escapeHTML(product.name)} · ${movementByProduct.get(String(product.id)) ? new Date(movementByProduct.get(String(product.id))).toLocaleDateString("ar-IQ") : "لا توجد تحديثات مسجلة"}</p>`) +
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
    if (!product) return toast("اختر المنتج أولاً");
    if (!Number.isSafeInteger(quantity) || quantity < 1) return toast("أدخل كمية استلام صحيحة");
    if (!supplier || !Number.isFinite(unitCost) || unitCost < 0) return toast("أكمل المورد والتكلفة");
    if (!$("receivingExpiry").value) return toast("أدخل تاريخ انتهاء صلاحية الدفعة");
    const before = { store: Number(product.store) || 0, fridge: Number(product.fridge) || 0, expiry: product.expiry };
    const updated = { ...product, store: before.store + quantity };
    if (!Number.isSafeInteger(updated.store)) return toast("الكمية المدخلة أكبر من المسموح");
    const expiry = $("receivingExpiry").value;
    const movement = {
      id: uid(), productId: product.id, productName: product.name, qty: quantity,
      label: "استلام توريد", type: "receipt", time: Date.now(), supplier, unitCost, expiry,
      actor: "المستخدم", reason: "استلام توريد", locationCode: getLocationCode(product),
      shelfName: shelfLabel(product.shelf), sectionName: sectionName(product.shelf || "1", product.section),
      note: $("receivingNote").value.trim() || `إضافة ${quantity} قطعة للمخزن`
    };
    try {
      await saveMovementAtomically(updated, movement, { before, supplier, unitCost, expiry, source: "receipt" });
      event.target.reset();
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
      if (entry.zone === "fridge") {
        updated.needsRefill = false;
        delete updated.refillRequest;
      }
      const difference = entry.counted - Number(before[entry.zone] || 0);
      if (!difference) continue;
      const movement = {
        id: uid(), productId: updated.id, productName: updated.name,
        qty: Math.abs(difference), label: "جرد فعلي", type: "adjust", time: Date.now(),
        actor: "المستخدم", reason: "فرق جرد", locationCode: getLocationCode(updated),
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

  window.decodeBarcodeImage = async function (file) {
    if (!(file instanceof Blob)) throw new TypeError("ملف صورة الباركود غير صالح");
    if ("BarcodeDetector" in window && typeof window.createImageBitmap === "function") {
      try {
        const formats = typeof BarcodeDetector.getSupportedFormats === "function"
          ? await BarcodeDetector.getSupportedFormats()
          : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
        const supported = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
          .filter(format => formats.includes(format));
        if (supported.length) {
          const bitmap = await createImageBitmap(file);
          try {
            const results = await new BarcodeDetector({ formats: supported }).detect(bitmap);
            if (results[0]?.rawValue) return results[0].rawValue;
          } finally {
            bitmap.close();
          }
        }
      } catch (error) {
        console.warn("Native image barcode detection failed; trying ZXing", error);
      }
    }
    await loadZXing();
    const url = URL.createObjectURL(file);
    const reader = new ZXing.BrowserMultiFormatReader();
    try {
      const result = await reader.decodeFromImageUrl(url);
      if (!result?.getText()) throw new Error("لم يُعثر على باركود في الصورة");
      return result.getText();
    } finally {
      reader.reset();
      URL.revokeObjectURL(url);
    }
  };

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
        supplier: "كمية افتتاحية", unitCost: null, expiry: product.expiry || "",
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

  function svgImage(svg) {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  function demoProductImage(primary, secondary) {
    return svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${secondary}"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="drink" x2="0" y2="1"><stop stop-color="${primary}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs><rect width="320" height="320" rx="36" fill="url(#bg)"/><circle cx="75" cy="74" r="32" fill="${primary}" opacity=".24"/><circle cx="254" cy="238" r="42" fill="${secondary}" opacity=".7"/><path d="M130 53h60v27l18 25v143c0 18-14 32-32 32h-32c-18 0-32-14-32-32V105l18-25z" fill="#ffffff" stroke="${primary}" stroke-width="8"/><path d="M120 133h80v112c0 13-10 23-23 23h-34c-13 0-23-10-23-23z" fill="url(#drink)"/><path d="M140 53h40v30h-40z" rx="8" fill="${primary}"/><rect x="125" y="146" width="70" height="58" rx="16" fill="#fff" opacity=".92"/><text x="160" y="182" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="${primary}">JUICE</text><path d="M146 222c10-15 20-15 30 0-5 11-25 11-30 0z" fill="#fff" opacity=".8"/><text x="160" y="294" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#344054">SAMPLE PRODUCT</text></svg>`);
  }

  function demoBarcodeImage(code) {
    const leftOdd = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
    const leftEven = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
    const right = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
    const parity = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
    const digits = String(code);
    const leftPattern = parity[Number(digits[0])];
    let bits = "101";
    for (let index = 1; index < 7; index++) {
      const digit = Number(digits[index]);
      bits += leftPattern[index - 1] === "L" ? leftOdd[digit] : leftEven[digit];
    }
    bits += "01010";
    for (let index = 7; index < 13; index++) bits += right[Number(digits[index])];
    bits += "101";
    const moduleWidth = 2.5, startX = (320 - bits.length * moduleWidth) / 2;
    const bars = [...bits].flatMap((bit, index) => bit === "1"
      ? [`<rect x="${startX + index * moduleWidth}" y="8" width="${moduleWidth}" height="${index < 3 || index >= 45 && index < 50 || index >= 92 ? 78 : 66}"/>`]
      : []);
    return svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="130" viewBox="0 0 320 130"><rect width="100%" height="100%" rx="12" fill="#fff"/><g fill="#111">${bars.join("")}</g><text x="160" y="112" text-anchor="middle" font-family="monospace" font-size="17">${digits}</text></svg>`);
  }

  async function addDemoProductsOnce() {
    const first = shelves[0];
    const second = shelves[1];
    const legacyDemoBarcodes = {
      "demo-water-001": "2900000000017",
      "demo-juice-002": "2900000000024",
      "demo-soda-003": "2900000000031",
      "demo-berry-004": "2900000000048",
      "demo-mango-005": "2900000000055"
    };
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 120);
    const demos = [
      {
        id: "demo-water-001", name: "مياه معدنية - تجريبي", brand: "بيانات اختبار",
        flavor: "طبيعية", size: "500 مل", barcode: "2900000000018",
        fridge: 4, store: 24, target: 12, minStore: 6, cartonSize: 12,
        shelf: first.id, section: first.sections[0].id, location: "A-01",
        locationType: "fixed", expiry: futureDate.toISOString().slice(0, 10),
        notes: "بيانات توضيحية قابلة للحذف", created: Date.now(), isDemo: true
      },
      {
        id: "demo-juice-002", name: "عصير برتقال - تجريبي", brand: "بيانات اختبار",
        flavor: "برتقال", size: "250 مل", barcode: "2900000000025",
        fridge: 8, store: 18, target: 18, minStore: 5, cartonSize: 24,
        shelf: first.id, section: first.sections[1]?.id || first.sections[0].id,
        location: "A-02", locationType: "fixed", expiry: futureDate.toISOString().slice(0, 10),
        notes: "بيانات توضيحية قابلة للحذف", created: Date.now() + 1, isDemo: true
      },
      {
        id: "demo-soda-003", name: "مشروب غازي - تجريبي", brand: "بيانات اختبار",
        flavor: "ليمون", size: "330 مل", barcode: "2900000000032",
        fridge: 3, store: 0, target: 12, minStore: 4, cartonSize: 12,
        shelf: second.id, section: second.sections[0].id, location: "B-01",
        locationType: "variable", expiry: futureDate.toISOString().slice(0, 10),
        notes: "بيانات توضيحية قابلة للحذف", created: Date.now() + 2, isDemo: true
      },
      {
        id: "demo-berry-004", name: "عصير توت - تجريبي", brand: "بيانات اختبار",
        flavor: "توت", size: "300 مل", barcode: "2900000000049",
        fridge: 5, store: 15, target: 12, minStore: 4, cartonSize: 12,
        shelf: second.id, section: second.sections[1]?.id || second.sections[0].id,
        location: "B-02", locationType: "fixed", expiry: futureDate.toISOString().slice(0, 10),
        notes: "بيانات توضيحية قابلة للحذف", created: Date.now() + 3, isDemo: true
      },
      {
        id: "demo-mango-005", name: "عصير مانجو - تجريبي", brand: "بيانات اختبار",
        flavor: "مانجو", size: "250 مل", barcode: "2900000000056",
        fridge: 6, store: 12, target: 12, minStore: 3, cartonSize: 12,
        shelf: first.id, section: first.sections[2]?.id || first.sections[0].id,
        location: "A-03", locationType: "variable", expiry: futureDate.toISOString().slice(0, 10),
        notes: "بيانات توضيحية قابلة للحذف", created: Date.now() + 4, isDemo: true
      }
    ].map((product, index) => ({
      ...product,
      image: demoProductImage(["#f59e0b","#f97316","#22c55e","#8b5cf6","#eab308"][index], ["#fde68a","#fdba74","#bbf7d0","#ddd6fe","#fef08a"][index]),
      barcodeImage: demoBarcodeImage(product.barcode)
    }));
    const existingRows = await all("products");
    const existingById = new Map(existingRows.map(product => [String(product.id), product]));
    const lotProductIds = new Set((await all("inventoryLots")).map(lot => String(lot.productId)));
    for (const product of demos) {
      const saved = existingById.get(String(product.id));
      if (saved) {
        if (saved?.isDemo) {
          const legacyBarcode = saved.barcode === legacyDemoBarcodes[product.id];
          await put("products", {
            ...saved,
            barcode: legacyBarcode ? product.barcode : saved.barcode,
            image: saved.image || product.image,
            barcodeImage: legacyBarcode ? product.barcodeImage : saved.barcodeImage || product.barcodeImage
          });
        }
        if (!lotProductIds.has(String(product.id)) && Number(saved?.store) + Number(saved?.fridge) > 0) await put("inventoryLots", {
          id: `demo-opening-${product.id}`, productId: product.id, productName: product.name,
          supplier: "بيانات تجريبية", unitCost: null, expiry: product.expiry,
          receivedAt: product.created, source: "demo",
          storeQty: Number(saved.store) || 0, fridgeQty: Number(saved.fridge) || 0
        });
        continue;
      }
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
  $("exportProductsCsv").addEventListener("click", async () => {
    try {
      const [productRows, shelfRows] = await Promise.all([all("products"), all("shelves")]);
      const headers = [
        ["name", "اسم المنتج"], ["brand", "العلامة التجارية"], ["flavor", "النكهة"],
        ["size", "الحجم"], ["price", "سعر البيع (د.ع)"], ["discountPrice", "تخفيض سعر القطعة (د.ع)"],
        ["offerPrice", "سعر العرض الإجمالي (د.ع)"], ["offerQuantity", "عدد القطع المشمولة بالعرض"],
        ["barcode", "الباركود"], ["fridge", "كمية البراد"], ["store", "كمية المخزن"],
        ["target", "هدف البراد"], ["minStore", "حد المخزن الأدنى"], ["cartonSize", "عدد القطع في الكرتون"],
        ["shelfName", "اسم الرف"], ["section", "القسم"], ["location", "الموقع"],
        ["locationType", "نوع الموقع"], ["availability", "حالة التوفر"], ["expiry", "تاريخ الصلاحية"],
        ["notes", "ملاحظات"]
      ];
      const rows = productRows.map(product => {
        const shelf = shelfRows.find(item => String(item.id) === String(product.shelf));
        return headers.map(([key]) => {
          if (key === "shelfName") return shelf?.name || product.shelf || "";
          const value = product[key];
          return value === undefined || value === null ? "" : value;
        });
      });
      const csvCell = value => `"${String(value).replace(/"/g, '""')}"`;
      const csv = `\uFEFF${headers.map(([, label]) => csvCell(label)).join(",")}\r\n${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `منتجات-العصائر-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`تم تصدير ${formatNumber(productRows.length)} منتج إلى CSV`);
    } catch (error) {
      console.error("Product CSV export failed", error);
      toast("تعذر تصدير المنتجات إلى CSV");
    }
  });
  $("importFile").addEventListener("change", async event => {
    event.stopImmediatePropagation();
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!validBackup(data)) throw new Error("بنية النسخة الاحتياطية غير صالحة");
      if (!confirm("سيتم استبدال المنتجات وسجل تحديثات المخزون والرفوف الحالية. هل أنشأت نسخة احتياطية؟ متابعة؟")) return;
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
    if (!confirm("سيتم حذف المنتجات وسجل تحديثات المخزون والرفوف وإعادة رفّين افتراضيين. هل تريد المتابعة؟")) return;
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
        supplier: "كمية افتتاحية", unitCost: null, expiry: product.expiry || "",
        receivedAt: Number(product.created) || Date.now(), source: "opening", storeQty, fridgeQty
      }] : [];
    });
    if (openingLots.length) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("inventoryLots", "readwrite");
        openingLots.forEach(lot => transaction.objectStore("inventoryLots").put(lot));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("تعذر ترحيل الكميات إلى الدفعات"));
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
