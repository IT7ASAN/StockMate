const DB_NAME="stockmate-db", DB_VERSION=3;
let db, products=[], movements=[], shelves=[], inventoryLots=[], currentFilter="all", currentCategoryFilter="all", currentShelf="1", toastTimer, productImage="", barcodeImage="", scanStream=null, scanFrame=0, detector=null, scanBusy=false, lastBarcodeLookup="";
let selectedPromotionProductIds=new Set(), selectedBatchPromotionSizes=new Set(), barcodeImageNeedsNumber=false;
const $=id=>document.getElementById(id);
try{localStorage.removeItem("stockmate-theme")}catch(error){}
const today=new Date(); $("today").textContent=today.toLocaleDateString("ar-IQ",{weekday:"short",day:"numeric",month:"short"});
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("products"))d.createObjectStore("products",{keyPath:"id"});if(!d.objectStoreNames.contains("movements"))d.createObjectStore("movements",{keyPath:"id"});if(!d.objectStoreNames.contains("shelves")){const shelfStore=d.createObjectStore("shelves",{keyPath:"id"});shelfStore.add({id:"1",name:"الرف الأول",location:"المنطقة الأولى",image:"",created:Date.now()});shelfStore.add({id:"2",name:"الرف الثاني",location:"المنطقة الثانية",image:"",created:Date.now()});}if(!d.objectStoreNames.contains("inventoryLots"))d.createObjectStore("inventoryLots",{keyPath:"id"});if(!d.objectStoreNames.contains("snapshots"))d.createObjectStore("snapshots",{keyPath:"id"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function all(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(name,obj){return new Promise((res,rej)=>{const r=store(name,"readwrite").put(obj);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function get(name,id){return new Promise((res,rej)=>{const r=store(name).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function del(name,id){return new Promise((res,rej)=>{const r=store(name,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function uid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2500)}
const PERMISSION_SETUP_KEY="stockmate-permission-setup-v1";
function readPermissionSetup(){try{return JSON.parse(localStorage.getItem(PERMISSION_SETUP_KEY)||"{}")}catch(error){return{}}}
function savePermissionState(name,state){const setup=readPermissionSetup();setup.version=1;setup[name]=String(state||"unknown");setup[name+"CheckedAt"]=Date.now();try{localStorage.setItem(PERMISSION_SETUP_KEY,JSON.stringify(setup))}catch(error){}}
window.savePermissionState=savePermissionState;
if("Notification"in window)savePermissionState("notifications",Notification.permission);
function escapeHTML(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function formatNumber(value){return Number(value||0).toLocaleString("ar-IQ")}
function formatPrice(value){if(value===null||value===undefined||value==="")return"غير محدد";const price=Number(value);return Number.isFinite(price)&&price>=0?`${price.toLocaleString("en-US",{maximumFractionDigits:2})} د.ع`:"غير محدد"}
function hasPriceValue(value){return value!==null&&value!==undefined&&value!==""}
function readPromotionInputs(price){
  const discountValue=$("pDiscountPrice").value.trim(),offerPriceValue=$("pOfferPrice").value.trim(),offerQuantityValue=$("pOfferQuantity").value.trim();
  const discountPrice=discountValue===""?null:Number(discountValue),offerPrice=offerPriceValue===""?null:Number(offerPriceValue),offerQuantity=offerQuantityValue===""?null:Number(offerQuantityValue);
  if(discountValue!==""&&(!Number.isFinite(discountPrice)||discountPrice<0||price===null||discountPrice>=price)){toast("يجب أن يكون تخفيض القطعة أقل من سعرها الأساسي");$("pDiscountPrice").focus();return null}
  if((offerPriceValue==="")!==(offerQuantityValue==="")){toast("أدخل سعر العرض الإجمالي وعدد القطع معاً");$(offerPriceValue===""?"pOfferPrice":"pOfferQuantity").focus();return null}
  if(offerQuantity!==null&&(!Number.isSafeInteger(offerQuantity)||offerQuantity<2)){toast("أدخل عدداً صحيحاً لا يقل عن قطعتين للعرض");$("pOfferQuantity").focus();return null}
  if(offerPriceValue!==""&&(!Number.isFinite(offerPrice)||offerPrice<0||price===null||offerPrice>=price*offerQuantity)){toast("يجب أن يكون سعر العرض الإجمالي أقل من مجموع أسعار القطع قبل العرض");$("pOfferPrice").focus();return null}
  return{discountPrice,offerPrice,offerQuantity,scope:$("pPromotionScope")?.value||"product"};
}
function renderPromotionProductPicker(){
  const picker=$("promotionProductPicker");
  if(!picker)return;
  const enabled=$("pPromotionScope").value==="selected";
  picker.classList.toggle("hidden",!enabled);
  if(!enabled){picker.innerHTML="";return}
  const currentId=$("productId").value;
  const eligible=products.filter(product=>String(product.id)!==String(currentId))
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ar")||String(a.flavor||"").localeCompare(String(b.flavor||""),"ar"));
  const eligibleIds=new Set(eligible.map(product=>String(product.id)));
  selectedPromotionProductIds=new Set([...selectedPromotionProductIds].filter(id=>eligibleIds.has(String(id))));
  picker.innerHTML=eligible.length
    ? `<b>حدد المنتجات المستهدفة</b><input type="search" data-promotion-search placeholder="ابحث باسم المنتج أو الشركة أو النكهة"><div class="promotion-product-options">${eligible.map(product=>{const id=String(product.id),label=[product.name,product.brand,product.flavor,product.size].filter(Boolean).join(" · ");return `<label data-promotion-option><input type="checkbox" data-promotion-product="${escapeHTML(id)}" ${selectedPromotionProductIds.has(id)?"checked":""}><span>${escapeHTML(label)}</span></label>`}).join("")}</div><small>سيُطبّق العرض أو التخفيض على المنتج الحالي والمنتجات التي تحددها.</small>`
    : '<b>لا توجد منتجات أخرى للاختيار</b><small>أضف منتجات إلى الكتالوج أولاً، أو طبّق العرض على المنتج الحالي فقط.</small>';
  picker.querySelectorAll("[data-promotion-product]").forEach(input=>input.addEventListener("change",()=>{const id=String(input.dataset.promotionProduct);if(input.checked)selectedPromotionProductIds.add(id);else selectedPromotionProductIds.delete(id)}));
  picker.querySelector("[data-promotion-search]")?.addEventListener("input",event=>{
    const terms=normalizeProductSearch(event.target.value).split(/\s+/).filter(Boolean);
    picker.querySelectorAll("[data-promotion-option]").forEach(option=>option.hidden=!terms.every(term=>normalizeProductSearch(option.textContent).includes(term)));
  });
}
function productPriceHighlightsHTML(product){const hasDiscount=hasPriceValue(product.discountPrice),hasOffer=Number(product.offerQuantity)>1&&hasPriceValue(product.offerPrice);return `<div class="product-card-prices"><div class="price-highlight regular-price"><small>سعر القطعة</small><strong>${escapeHTML(formatPrice(product.price))}</strong></div>${hasDiscount?`<div class="price-highlight discount-price"><small>تخفيض القطعة</small><strong>${escapeHTML(formatPrice(product.discountPrice))}</strong></div>`:""}${hasOffer?`<div class="price-highlight offer-price"><small>عرض ${formatNumber(product.offerQuantity)} قطع · الإجمالي</small><strong>${escapeHTML(formatPrice(product.offerPrice))}</strong></div>`:""}</div>`}
let barcodeAudioContext, barcodeLastSoundAt=0;
window.prepareBarcodeAudio=async()=>{try{const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return false;if(!barcodeAudioContext){try{barcodeAudioContext=new AudioContextClass({latencyHint:"interactive"})}catch(error){barcodeAudioContext=new AudioContextClass()}}if(barcodeAudioContext.state!=="running")await barcodeAudioContext.resume();if(barcodeAudioContext.state!=="running")return false;const oscillator=barcodeAudioContext.createOscillator(),gain=barcodeAudioContext.createGain();gain.gain.setValueAtTime(.00001,barcodeAudioContext.currentTime);oscillator.connect(gain);gain.connect(barcodeAudioContext.destination);oscillator.start();oscillator.stop(barcodeAudioContext.currentTime+.012);return true}catch(error){console.warn("Barcode audio could not be initialized",error);return false}};
window.playBarcodeBeep=()=>{try{if(!barcodeAudioContext||barcodeAudioContext.state!=="running")return false;const oscillator=barcodeAudioContext.createOscillator(),gain=barcodeAudioContext.createGain(),now=barcodeAudioContext.currentTime;oscillator.type="sine";oscillator.frequency.setValueAtTime(880,now);oscillator.frequency.setValueAtTime(1174.66,now+.075);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.18,now+.012);gain.gain.setValueAtTime(.18,now+.075);gain.gain.exponentialRampToValueAtTime(.0001,now+.16);oscillator.connect(gain);gain.connect(barcodeAudioContext.destination);oscillator.start(now);oscillator.stop(now+.17);return true}catch(error){console.warn("Barcode confirmation sound failed",error);return false}};
window.acknowledgeBarcode=()=>{const now=Date.now();if(now-barcodeLastSoundAt<400)return;barcodeLastSoundAt=now;try{navigator.vibrate?.(35)}catch(error){}if(barcodeAudioContext?.state==="running"){window.playBarcodeBeep();return}window.prepareBarcodeAudio?.().then(ready=>{if(ready)window.playBarcodeBeep()})};
document.addEventListener("pointerdown",()=>{window.prepareBarcodeAudio?.()},{once:true,capture:true});
function normalizeProductSearch(value){return String(value??"").normalize("NFKC").replace(/[\u064B-\u065F\u0670ـ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)>=0x06f0?digit.charCodeAt(0)-0x06f0:digit.charCodeAt(0)-0x0660)).toLocaleLowerCase("ar").trim().replace(/\s+/g," ")}
function normalizeBarcode(value){return String(value??"").normalize("NFKC").replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)>=0x06f0?digit.charCodeAt(0)-0x06f0:digit.charCodeAt(0)-0x0660)).replace(/[^0-9]/g,"").trim()}
function productSizeInMl(value){const text=normalizeProductSearch(value).replace(/,/g,"."),match=text.match(/[0-9]+(?:\.[0-9]+)?/);if(!match)return NaN;const amount=Number(match[0]);return /لتر|liter|litre|(^|\s)l(\s|$)/i.test(text)?amount*1000:amount}
function categoryForProduct(product){const explicit=String(product.category||"").toLowerCase();if(["juice","soda","energy","coffee","other"].includes(explicit))return explicit;const text=normalizeProductSearch([product.name,product.brand,product.flavor].filter(Boolean).join(" "));if(/طاقة|energy|ريدبول|redbull|monster/.test(text))return"energy";if(/غازي|كولا|cola|soda|pepsi|بيبسي|كوكا|7up|سفن/.test(text))return"soda";if(/قهو|coffee|نسكافيه|nascafe|latte|لاتيه/.test(text))return"coffee";return"juice"}
function productSearchText(product){
  const shelf=shelves.find(item=>String(item.id)===String(product.shelf));
  const section=shelf?.sections?.find(item=>String(item.id)===String(product.section));
  return normalizeProductSearch([
    ...Object.entries(product).filter(([key,value])=>!["image","barcodeImage","id","created","importedAt","importBatchId"].includes(key)&&["string","number","boolean"].includes(typeof value)).map(([,value])=>value),
    shelf?.name,shelf?.location,section?.name
  ].filter(value=>value!==undefined&&value!==null).join(" "));
}
function updateProductOptionLists(){
  const choices=[
    ["brandOptions",["العلامة التجارية","الشركة","علامة خاصة"],products.map(product=>product.brand)],
    ["locationOptions",[],products.map(product=>product.location)]
  ];
  for(const [id,presets,existing] of choices){
    const list=$(id);
    if(!list)continue;
    const values=[...new Set([...presets,...existing].map(value=>String(value??"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
    list.replaceChildren(...values.map(value=>{const option=document.createElement("option");option.value=value;return option}));
  }
}
function setProductSize(size){
  const raw=String(size??"").trim();
  const normalized=raw.replace(/[٠-٩]/g,digit=>String(digit.charCodeAt(0)-0x0660)).replace(/[۰-۹]/g,digit=>String(digit.charCodeAt(0)-0x06f0)).replace(/٫/g,".").replace(/٬/g,"");
  const amount=normalized.match(/\d+(?:[.,]\d+)?/);
  $("pSize").value=amount?amount[0].replace(",","."):"";
  $("pSizeUnit").value=/لتر|liter|litre|\bl\b/i.test(raw)?"L":"ml";
}
function getProductSize(){
  const amount=$("pSize").value.trim();
  if(!amount)return"";
  const numeric=Number(amount);
  if(!Number.isFinite(numeric)||numeric<=0)return null;
  return `${amount} ${$("pSizeUnit").value==="L"?"لتر":"مل"}`;
}
function getBrandDefaults(brand){
  const key=normalizeProductSearch(brand);
  if(!key)return null;
  return products
    .filter(product=>normalizeProductSearch(product.brand)===key)
    .sort((a,b)=>Number(b.created||0)-Number(a.created||0)||String(a.id).localeCompare(String(b.id)))[0]||null;
}
function applyBrandDefaults(brand){
  const defaults=getBrandDefaults(brand);
  const status=$("brandAutofillStatus");
  if(!defaults){
    status.textContent="لا توجد بيانات محفوظة لهذه الماركة؛ أدخل التفاصيل المشتركة يدوياً.";
    return false;
  }
  const fields={pCarton:"cartonSize",pShelf:"shelf",pLocation:"location",pLocationType:"locationType",pTarget:"target",pMin:"minStore"};
  for(const [field,key] of Object.entries(fields))$(field).value=defaults[key]??"";
  $("pShelf").dispatchEvent(new Event("change",{bubbles:true}));
  $("pSection").value=defaults.section??$("pSection").value;
  status.textContent=`تم اختيار الماركة ${defaults.brand}. لن تُنسخ الأسعار والعروض أو الأحجام تلقائياً حتى لا تنتقل بيانات حجم إلى آخر.`;
  return true;
}
let lastAutofilledBrand="";
function handleBrandInput(){
  if($("productId").value)return;
  const brand=$("pBrand").value.trim();
  const key=normalizeProductSearch(brand);
  if(!key){lastAutofilledBrand="";$("brandAutofillStatus").textContent="عند اختيار ماركة محفوظة ستُعبأ بياناتها المشتركة تلقائياً.";return}
  if(getBrandDefaults(brand)&&key!==lastAutofilledBrand){
    applyBrandDefaults(brand);
    lastAutofilledBrand=key;
  }
}
$("pBrand").addEventListener("input",handleBrandInput);
$("pBrand").addEventListener("change",handleBrandInput);
$("pPromotionScope").addEventListener("change",renderPromotionProductPicker);
const commonFlavors=["برتقال","تفاح","مانجو","فراولة","ليمون","ليمون ونعناع","طبيعية","مشكل"];
function savedFlavors(){
  try{
    const stored=JSON.parse(localStorage.getItem("stockmate-custom-flavors")||"[]");
    return Array.isArray(stored)?stored.filter(value=>typeof value==="string"&&value.trim()):[];
  }catch(error){console.warn("Could not load custom flavors",error);return[]}
}
function saveFlavor(value){
  const flavor=value.trim();
  if(!flavor)return false;
  try{
    const values=[...new Set([...savedFlavors(),flavor])];
    localStorage.setItem("stockmate-custom-flavors",JSON.stringify(values));
    return true;
  }catch(error){console.error("Could not save custom flavor",error);toast("تعذر حفظ النكهة الجديدة");return false}
}
function renderFlavorOptions(query="",show=false){
  const results=$("flavorPickerResults");
  if(!results)return;
  const terms=normalizeProductSearch(query);
  const choices=[...new Set([...commonFlavors,...savedFlavors(),...products.map(product=>product.flavor)].map(value=>String(value||"").trim()).filter(Boolean))]
    .filter(value=>!terms||normalizeProductSearch(value).includes(terms)).slice(0,10);
  results.innerHTML=choices.map(value=>`<button type="button" class="flavor-option" role="option" data-flavor-option="${escapeHTML(value)}">${escapeHTML(value)}</button>`).join("")||`<div class="flavor-empty">لا توجد نكهات مطابقة. اكتب النكهة ثم اضغط «إضافة نكهة جديدة».</div>`;
  results.classList.toggle("open",show);
}
$("pFlavor").addEventListener("focus",()=>renderFlavorOptions($("pFlavor").value,true));
$("pFlavor").addEventListener("input",()=>renderFlavorOptions($("pFlavor").value,true));
$("flavorPickerResults").addEventListener("click",event=>{
  const option=event.target.closest("[data-flavor-option]");
  if(!option)return;
  $("pFlavor").value=option.dataset.flavorOption;
  $("flavorPickerResults").classList.remove("open");
});
$("addFlavor").addEventListener("click",()=>{
  const flavor=$("pFlavor").value.trim()||prompt("اكتب اسم النكهة الجديدة")?.trim();
  if(!flavor)return toast("اكتب اسم النكهة أولاً");
  if(!saveFlavor(flavor))return;
  $("pFlavor").value=flavor;
  renderFlavorOptions(flavor,true);
  toast("تمت إضافة النكهة");
});
document.addEventListener("click",event=>{
  if(!event.target.closest(".flavor-picker"))$("flavorPickerResults").classList.remove("open");
});
function updateProductBoxSummary(){
  const boxSize=Math.max(1,Number($("pCarton").value)||1);
  const summarize=(id,unitId,label)=>{
    const entered=Math.max(0,Number($(id).value)||0);
    const pieces=entered*($(unitId).value==="carton"?boxSize:1);
    const whole=Math.floor(pieces/boxSize),loose=pieces%boxSize;
    return `${label}: ${whole>0?`${whole} صندوق كامل`:"لا يوجد صندوق كامل"}${loose?` و${loose} قطعة متبقية`:""}`;
  };
  $("productBoxSummary").textContent=`${summarize("pStore","pStoreUnit","المخزن")} · ${summarize("pFridge","pFridgeUnit","البراد")}`;
}
["pStore","pFridge","pCarton","pStoreUnit","pFridgeUnit"].forEach(id=>{
  $(id).addEventListener("input",updateProductBoxSummary);
  $(id).addEventListener("change",updateProductBoxSummary);
});
for(const [unitId,quantityId] of [["pStoreUnit","pStore"],["pFridgeUnit","pFridge"]]){
  $(unitId).dataset.lastUnit="piece";
  $(unitId).addEventListener("change",()=>{
    const select=$(unitId),quantity=$(quantityId),boxSize=Math.max(1,Number($("pCarton").value)||1);
    const oldUnit=select.dataset.lastUnit||"piece",newUnit=select.value;
    const pieces=(Number(quantity.value)||0)*(oldUnit==="carton"?boxSize:1);
    if(newUnit==="carton"&&pieces%boxSize!==0){
      select.value=oldUnit;
      toast("الكمية تحتوي قطعاً غير مكتملة؛ أبقِ الوحدة قطعة أو عدّل الكمية");
      updateProductBoxSummary();
      return;
    }
    quantity.value=newUnit==="carton"?pieces/boxSize:pieces;
    select.dataset.lastUnit=newUnit;
    updateProductBoxSummary();
  });
}
function fridgeAlertThreshold(p){return Math.max(0,Number(p.target||0)-6)}
function low(p){return p.needsRefill===true||(!unavailable(p)&&Number(p.fridge||0)<fridgeAlertThreshold(p))}
function refill(p){const requested=Number(p.refillRequest);return p.needsRefill===true&&Number.isSafeInteger(requested)&&requested>0?requested:Math.max(0,Number(p.target||0)-Number(p.fridge||0))}
function availableToMove(p){return Math.min(refill(p),Math.max(0,Number(p.store||0)))}
function shortage(p){return Math.max(0,refill(p)-availableToMove(p))}
function daysTo(date){if(!date)return null;return Math.ceil((new Date(date+"T23:59:59")-new Date())/86400000)}
function expiryAlert(p){const lotDays=(inventoryLots||[]).filter(lot=>String(lot.productId)===String(p.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry).map(lot=>daysTo(lot.expiry));if(lotDays.length)return lotDays.some(days=>days!==null&&days<=30);const d=daysTo(p.expiry);return d!==null&&d<=30}
function storeLow(p){return !unavailable(p)&&(Number(p.store||0)<=0||Number(p.store||0)<Number(p.minStore||0))}
function storeRestockNeed(p){const request=Number(p.storeRequest);if(Number.isSafeInteger(request)&&request>0)return request;const threshold=Math.max(0,Number(p.minStore)||0);return Math.max(0,threshold-Number(p.store||0))||(Number(p.store||0)<=0?1:0)}
function unavailable(p){return p.availability==="unavailable"&&Number(p.store||0)<=0&&Number(p.fridge||0)<=0}
function pieceCount(q,unit,carton){return unit==="carton"?q*carton:q}
async function reload(){
  const [storedProducts,storedMovements,storedShelves,storedLots]=await Promise.all([all("products"),all("movements"),all("shelves"),all("inventoryLots")]);
  products=await Promise.all(storedProducts.map(async product=>{
    if(!Object.prototype.hasOwnProperty.call(product,"discountQuantity"))return product;
    const migrated={...product};
    if(Number(product.discountQuantity)>1&&hasPriceValue(product.discountPrice)&&!hasPriceValue(product.offerPrice)&&!hasPriceValue(product.offerQuantity)){
      migrated.offerPrice=product.discountPrice;
      migrated.offerQuantity=Number(product.discountQuantity);
      migrated.discountPrice=null;
    }
    delete migrated.discountQuantity;
    try{await put("products",migrated)}catch(error){console.warn("Legacy offer fields could not be migrated",error)}
    return migrated;
  }));
  movements=storedMovements; shelves=storedShelves; inventoryLots=storedLots;
  movements.sort((a,b)=>b.time-a.time);shelves.sort((a,b)=>a.created-b.created);renderAll()
}
function setInventoryTab(tab){
  const selected=tab==="updates"?"updates":"products";
  document.querySelectorAll("[data-inventory-tab]").forEach(button=>{
    const active=button.dataset.inventoryTab===selected;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll(".inventory-tab-panel").forEach(panel=>{
    panel.hidden=panel.id===(selected==="updates"?"inventoryProductsPanel":"inventoryUpdatesPanel");
  });
}
window.setInventoryTab=setInventoryTab;
function go(page){
  const destination=page==="movement"?"inventory":page;
  if(destination!=="scan")window.stopScanner?.({resetState:true});
  if(page==="movement")setInventoryTab("updates");
  else if(page==="inventory")setInventoryTab("products");
  document.querySelectorAll(".page").forEach(section=>section.classList.toggle("active",section.id==="page-"+destination));
  const navPage=destination==="low-products"?"products":["home","products","inventory","scan","replenish","more"].includes(destination)?destination:"more";
  document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.page===navPage));
  if(destination==="map")renderMap();
  if(destination==="replenish")renderReplenish();
  if(destination==="low-products")renderLowProducts();
  if(destination==="inventory")window.renderWarehouse?.();
  if(destination==="scan")window.startScanner?.();
  window.scrollTo({top:0,behavior:"smooth"});
}
function renderAll(){updateProductOptionLists();renderDashboard();renderProducts();renderReplenish();renderMovementOptions();renderHistory();renderAlerts();renderMap()}
function refillCardHTML(product){
  const quantity=refill(product),boxSize=Math.max(1,Number(product.cartonSize)||1),cartons=Math.ceil(quantity/boxSize);
  return `<article class="low-product-card">
    <div class="low-product-main">${product.image?`<button type="button" class="low-product-image-trigger" data-expand-image data-image-src="${escapeHTML(product.image)}" data-image-caption="${escapeHTML(product.name)}" aria-label="عرض صورة ${escapeHTML(product.name)}"><img class="low-product-image" src="${escapeHTML(product.image)}" alt="" loading="lazy"></button>`:'<div class="low-product-image placeholder">▣</div>'}
      <div class="low-product-info"><b>${escapeHTML(product.name)}</b><small>${escapeHTML([product.brand,product.flavor,product.size].filter(Boolean).join(" · ")||"منتج")}</small><small>${escapeHTML(window.locationCode?.(product)||product.location||"موقع غير محدد")}</small></div>
      <span class="low-status-tag">نقص في البراد</span>
    </div>
    <div class="low-product-need"><b>النقص: ${formatNumber(quantity)} قطعة</b><span>حوالي ${formatNumber(cartons)} ${cartons===1?"كرتون":"كراتين"} · المتوفر بالمخزن ${formatNumber(product.store||0)} قطعة</span></div>
    <div class="low-product-actions"><button type="button" class="soft" data-mark-refill="${escapeHTML(product.id)}">تحديد كمية النقص</button><button type="button" class="primary" data-mark-filled="${escapeHTML(product.id)}">تمت تعبئة البراد</button></div>
  </article>`;
}
function renderLowProducts(){
  const items=products.filter(product=>low(product)&&refill(product)>0).sort((a,b)=>Number(b.needsRefill===true)-Number(a.needsRefill===true)||refill(b)-refill(a)||String(a.name||"").localeCompare(String(b.name||""),"ar"));
  const query=normalizeProductSearch($("lowProductsSearch")?.value||"").split(/\s+/).filter(Boolean);
  const filtered=items.filter(product=>{const searchable=productSearchText(product);return query.every(term=>searchable.includes(term))});
  $("lowProductsCount").textContent=formatNumber(items.length);
  $("lowProductsQuantity").textContent=formatNumber(items.reduce((sum,product)=>sum+refill(product),0));
  $("lowProductsList").className=filtered.length?"stack low-products-list":"stack empty-state";
  $("lowProductsList").innerHTML=filtered.map(refillCardHTML).join("")|| (items.length?"لا توجد نتائج مطابقة.":"لا توجد منتجات ناقصة في البراد.");
  $("homeLowProducts").className=items.length?"stack low-products-list low-products-home":"stack empty-state";
  $("homeLowProducts").innerHTML=items.slice(0,4).map(refillCardHTML).join("")||(items.length?"":"لا توجد منتجات ناقصة في البراد.");
}
function renderDashboard(){const lows=products.filter(p=>low(p)&&refill(p)>0),ex=products.filter(expiryAlert),tasks=lows.filter(p=>refill(p)>0);$("totalProducts").textContent=products.length;$("lowCount").textContent=lows.length;$("expiryCount").textContent=ex.length;$("taskCount").textContent=tasks.length;const alerts=[...products.filter(unavailable).map(p=>({p,type:"unavailable"})),...products.filter(storeLow).sort((a,b)=>Number(a.store||0)-Number(b.store||0)).map(p=>({p,type:"store"})),...lows.map(p=>({p,type:"low"})),...ex.map(p=>({p,type:"expiry"}))].slice(0,5);$("homeAlerts").className=alerts.length?"stack":"stack empty-state";$("homeAlerts").innerHTML=alerts.length?alerts.map(a=>alertHTML(a.p,a.type)).join(""):"لا توجد تنبيهات حالياً.";renderLowProducts();const recent=movements.slice(0,4);$("homeRecentMovements").className=recent.length?"home-recent-list":"home-recent-movements empty-state";$("homeRecentMovements").innerHTML=recent.map(m=>`<div class="home-recent-item"><span class="home-recent-icon">${m.label?.includes("إضافة")?"＋":m.label?.includes("سحب")?"−":"↗"}</span><div><b>${escapeHTML(m.productName)}</b><small>${escapeHTML(m.label)} · ${new Date(m.time).toLocaleDateString("ar-IQ")}</small></div><strong>${Number(m.qty||0).toLocaleString("ar-IQ")} قطعة</strong></div>`).join("")||"لا توجد تحديثات مسجلة بعد."}
function alertHTML(p,type){let label="",detail="";if(type==="expiry"){const lot=p._alertLot||inventoryLots.filter(item=>String(item.productId)===String(p.id)&&Number(item.storeQty)+Number(item.fridgeQty)>0&&item.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];const expiry=lot?.expiry||p.expiry;const d=daysTo(expiry);label=d<0?"منتهي الصلاحية":d<=7?"خلال 7 أيام":d<=14?"خلال 14 يوماً":"خلال 30 يوماً";detail=`الصلاحية: ${expiry} · ${d<0?`منتهي منذ ${Math.abs(d)} يوم`:`متبقي ${d} يوم`} · الكمية: ${lot?Number(lot.storeQty||0)+Number(lot.fridgeQty||0):Number(p.store||0)+Number(p.fridge||0)}`}else if(type==="unavailable"){label="غير متوفر حالياً";detail="تم تحديد المنتج على أنه غير متوفر؛ أضف الكمية عند استلامها."}else if(type==="store"){label=Number(p.store||0)<=0?"المخزن فارغ":"مخزون المخزن منخفض";detail=`المخزن: ${p.store||0} قطعة · حد التنبيه: ${p.minStore||0}`}else{label="نقص في البراد";detail=`البراد: ${p.fridge||0} / الهدف: ${p.target||0} · المطلوب: ${refill(p)} قطعة`};const action=["store","unavailable"].includes(type)?`<button type="button" class="small-btn" data-restock-alert="${escapeHTML(p.id)}">إضافة كمية للمخزن</button>`:"";return `<div class="alert-card"><div class="card-top"><div><b class="product-name">${escapeHTML(p.name)}</b><div class="subline">${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))}</div></div><span class="tag ${type==="expiry"||type==="unavailable"?"bad":"warn"}">${label}</span></div><div class="subline">${detail}</div>${action}</div>`}
function productImageHTML(p){return p.image?`<img class="product-thumb" src="${p.image}" alt="${escapeHTML(p.name)}">`:`<div class="product-thumb placeholder">▣</div>`}
function renderProducts(){
  const terms=normalizeProductSearch($("productSearch").value).split(/\s+/).filter(Boolean);
  let list=products.filter(product=>product.displayInProducts!==false).filter(product=>{const searchable=productSearchText(product);return terms.every(term=>searchable.includes(term))});
  if(currentFilter==="low")list=list.filter(low);
  if(currentFilter==="fixed")list=list.filter(p=>p.locationType==="fixed");
  if(currentFilter==="variable")list=list.filter(p=>p.locationType==="variable");
  $("productList").className=list.length?"stack product-grid":"stack empty-state";
  $("productList").innerHTML=list.length?list.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(p=>`<article class="product-card" data-product-card="${escapeHTML(p.id)}" tabindex="0" aria-label="فتح تفاصيل ${escapeHTML(p.name)}">
    <div class="card-top"><div class="product-main">${productImageHTML(p)}<div><div class="product-name">${escapeHTML(p.name)}</div><div class="subline">${escapeHTML([p.brand,p.flavor,p.size].filter(Boolean).join(" · "))}</div><div class="subline">${p.barcode?`باركود: ${escapeHTML(p.barcode)}`:"بدون باركود"}</div>${productPriceHighlightsHTML(p)}</div></div><button class="small-btn" data-edit="${escapeHTML(p.id)}">تعديل</button></div>
    <div><span class="tag">${p.locationType==="fixed"?"موقع ثابت":"موقع متغير"}</span><span class="tag">${p.shelf==="2"?"الرف الثاني":"الرف الأول"} · ${escapeHTML(p.location||"غير محدد")}</span>${low(p)?'<span class="tag warn">نقص في البراد</span>':""}${storeLow(p)?'<span class="tag bad">مخزون المخزن منخفض</span>':""}</div>
    <div class="qty-grid"><div class="qty-box"><small>البراد</small><b>${p.fridge||0}</b></div><div class="qty-box"><small>المخزن</small><b>${p.store||0}</b></div><div class="qty-box"><small>هدف البراد</small><b>${p.target||0}</b></div></div>
    <div class="card-actions"><button class="small-btn" data-move="${escapeHTML(p.id)}">تحديث الكمية</button><button class="small-btn" data-show-barcode="${escapeHTML(p.id)}">عرض الباركود</button><button class="small-btn delete" data-delete="${escapeHTML(p.id)}">حذف</button></div></article>`).join(""):"لا توجد نتائج مطابقة."
}
function renderReplenish(){const list=products.filter(p=>refill(p)>0).sort((a,b)=>String(a.shelf||"1").localeCompare(String(b.shelf||"1"))||String(a.location||"ZZ").localeCompare(String(b.location||"ZZ")));$("replenishItems").textContent=list.length;$("replenishUnits").textContent=list.reduce((s,p)=>s+refill(p),0);$("shortageUnits").textContent=list.reduce((s,p)=>s+shortage(p),0);$("replenishList").className=list.length?"stack":"stack empty-state";$("replenishList").innerHTML=list.length?list.map(p=>`<article class="task-card"><div class="task-row"><input type="checkbox" data-task="${p.id}" ${availableToMove(p)===0?"disabled":""}><div class="task-info"><b>${escapeHTML(p.name)}</b><small>${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))} · ${escapeHTML(p.location||"موقع غير محدد")} · ${p.shelf==="2"?"الرف الثاني":"الرف الأول"}</small><small>المطلوب: ${refill(p)} قطعة · المتوفر بالمخزن: ${p.store||0} قطعة · يمكن نقله: ${availableToMove(p)} قطعة</small>${shortage(p)>0?`<small style="color:#d34d55;font-weight:700">عجز بالمخزن: ${shortage(p)} قطعة</small>`:""}</div><div class="task-qty ${shortage(p)>0?"short":""}">+${availableToMove(p)}</div></div></article>`).join(""):"لا توجد نواقص حالياً."}
function renderMovementOptions(){const val=$("movementProduct").value;$("movementProduct").innerHTML='<option value="">اختر المنتج</option>'+products.map(p=>`<option value="${p.id}">${escapeHTML(p.name)} — البراد ${p.fridge||0} · المخزن ${p.store||0}</option>`).join("");if(products.some(p=>p.id===val))$("movementProduct").value=val}
function renderHistory(){$("movementHistory").className=movements.length?"stack":"stack empty-state";$("movementHistory").innerHTML=movements.slice(0,30).map(m=>`<div class="history-card"><div><b>${escapeHTML(m.productName)}</b><small>${escapeHTML(m.label)} · ${new Date(m.time).toLocaleString("ar-IQ")}${m.shelfName?" · "+escapeHTML(m.shelfName):""}${m.sectionName?" / "+escapeHTML(m.sectionName):""}${m.note?" · "+escapeHTML(m.note):""}</small></div><strong>${m.qty} قطعة</strong></div>`).join("")||"لا توجد تحديثات مسجلة."}
function renderAlerts(){const arr=[];products.forEach(p=>{if(unavailable(p))arr.push(alertHTML(p,"unavailable"));if(storeLow(p))arr.push(alertHTML(p,"store"));if(low(p)&&!storeLow(p))arr.push(alertHTML(p,"low"));const lots=inventoryLots.filter(lot=>String(lot.productId)===String(p.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry&&daysTo(lot.expiry)<=30);if(lots.length)lots.sort((a,b)=>a.expiry.localeCompare(b.expiry)).forEach(lot=>arr.push(alertHTML({...p,_alertLot:lot},"expiry")));else if(expiryAlert(p))arr.push(alertHTML(p,"expiry"))});$("alertsList").className=arr.length?"stack":"stack empty-state";$("alertsList").innerHTML=arr.join("")||"لا توجد تنبيهات حالياً."}
function renderMap(){const list=products.filter(p=>String(p.shelf||"1")===String(currentShelf));const slots=Array.from({length:12},(_,i)=>{const code=`R${currentShelf}-${String(i+1).padStart(2,"0")}`;const found=list.filter(p=>p.location===code);return `<div class="slot"><b>${code}</b><small>${found.length?found.map(p=>escapeHTML(p.name)).join("، "):"فارغ / غير مسجل"}</small></div>`});$("mapGrid").innerHTML=slots.join("")}
function showImagePreview(id,src,emptyText){const el=$(id);if(src){el.classList.add("has-image");el.innerHTML=`<img src="${src}" alt="معاينة الصورة"><div class="image-preview-actions"><button type="button" data-crop-image="${id}">قص وتعديل الصورة</button><button type="button" data-remove-image="${id}">حذف الصورة</button></div>`}else{el.classList.remove("has-image");el.innerHTML=`<span>${emptyText}</span>`}}
function setProductImages(p){productImage=p?.image||"";barcodeImage=p?.barcodeImage||"";barcodeImageNeedsNumber=false;showImagePreview("pImagePreview",productImage,"لم تتم إضافة صورة المنتج");showImagePreview("pBarcodePreview",barcodeImage,"لم تتم إضافة صورة الباركود")}
function variantField(label,key,{type="text",value="",placeholder="",required=false,unitOptions=null,accept=""}={}){
  if(unitOptions)return `<label>${label}<select data-variant-field="${key}">${unitOptions.map(([option,text])=>`<option value="${option}" ${value===option?"selected":""}>${text}</option>`).join("")}</select></label>`;
  const fileAttrs=type==="file"?` accept="${accept}" ${["image","dateLabel"].includes(key)?'capture="environment"':""}`:"";
  return `<label>${label}<input type="${type}" data-variant-field="${key}" value="${type==="file"?"":escapeHTML(value)}" ${placeholder?`placeholder="${placeholder}"`:""} ${required?"required":""} ${type==="number"?`min="${key==="size"?"0.1":key==="offerQuantity"?"2":"0"}" step="${key==="offerQuantity"||["target","fridge","store","minStore","cartonSize"].includes(key)?"1":"any"}" inputmode="${key==="offerQuantity"||["target","fridge","store","minStore","cartonSize"].includes(key)?"numeric":"decimal"}" lang="en" dir="ltr"`:""}${fileAttrs}></label>`;
}
function batchVariantHTML(values={}){
  const value=key=>values[key]??"",sizeOptions=[["ml","مل"],["L","لتر"]];
  return `<div class="batch-variant-card" data-batch-variant>
    <div class="batch-variant-heading"><b>حجم وصنف</b><button type="button" class="small-btn" data-remove-size>حذف هذا الحجم</button></div>
    <div class="batch-variant-grid">
      ${variantField("الحجم","size",{type:"number",value:value("size"),placeholder:"مثلاً 250",required:true})}
      ${variantField("الوحدة","sizeUnit",{value:value("sizeUnit")||"ml",unitOptions:sizeOptions})}
      ${variantField("ملاحظات المنتج","notes",{value:value("notes"),placeholder:"ملاحظة خاصة بهذا الصنف"})}
      ${variantField("تاريخ الإنتاج","productionDate",{type:"date",value:value("productionDate")})}
      ${variantField("تاريخ انتهاء الصلاحية","expiry",{type:"date",value:value("expiry")})}
      ${variantField("تصوير ملصق التاريخ","dateLabel",{type:"file",accept:"image/*"})}
      ${variantField("السعر الأساسي للقطعة (د.ع)","price",{type:"number",value:value("price"),placeholder:"السعر",required:true})}
      ${variantField("تخفيض سعر القطعة (اختياري)","discountPrice",{type:"number",value:value("discountPrice"),placeholder:"تخفيض القطعة"})}
      ${variantField("عدد القطع في العرض","offerQuantity",{type:"number",value:value("offerQuantity"),placeholder:"اختياري"})}
      ${variantField("سعر العرض الإجمالي (د.ع)","offerPrice",{type:"number",value:value("offerPrice"),placeholder:"اختياري"})}
      ${variantField("رقم الباركود","barcode",{value:value("barcode"),placeholder:"امسح أو اكتب الرقم"})}
      ${variantField("عدد العرض في البراد (تنبيه أقل بـ٦)","target",{type:"number",value:value("target")||"10",placeholder:"قطع"})}
      ${variantField("كمية البراد","fridge",{type:"number",value:value("fridge")||"0",placeholder:"0"})}
      ${variantField("كمية المخزن","store",{type:"number",value:value("store")||"0",placeholder:"0"})}
      ${variantField("حد تنبيه المخزن","minStore",{type:"number",value:value("minStore")||"5",placeholder:"قطع"})}
      ${variantField("القطع في الكرتون","cartonSize",{type:"number",value:value("cartonSize")||"1",placeholder:"1"})}
      ${variantField("التقاط صورة المنتج","image",{type:"file",accept:"image/*"})}
      ${variantField("صورة الباركود","barcodeImage",{type:"file",accept:"image/*"})}
    </div>
  </div>`;
}
function collectBatchDrafts(){
  return [...$("batchFlavorInputs").querySelectorAll("[data-batch-flavor-group]")].map(group=>({
    flavor:group.querySelector("[data-batch-flavor-name]")?.value||"",
    variants:[...group.querySelectorAll("[data-batch-variant]")].map(row=>{const fields={};row.querySelectorAll("[data-variant-field]").forEach(input=>{fields[input.dataset.variantField]=input.type==="file"?input.files?.[0]||null:input.value});return fields})
  }));
}
function renderBatchFlavorInputs(count,drafts=[]){
  const container=$("batchFlavorInputs");
  if(!Number.isInteger(count)||count<1||count>30){container.innerHTML='<p class="hint">أدخل عدد النكهات لبدء إضافة الأصناف.</p>';refreshBatchPromotionSizeOptions();return}
  const existing=[...container.querySelectorAll("[data-batch-flavor-group]")],groups=[];
  for(let index=0;index<count;index++){
    let group=existing[index];
    if(!group){
      const draft=drafts[index]||{};
      group=document.createElement("section");group.className="batch-flavor-group";group.dataset.batchFlavorGroup="";
      group.innerHTML=`<div class="batch-flavor-item-head"><label>النكهة ${formatNumber(index+1)}<input type="text" data-batch-flavor-name required maxlength="60" list="batchFlavorOptions" placeholder="مثلاً برتقال"></label><button type="button" class="soft" data-add-size>＋ إضافة حجم وبياناته</button></div><div class="batch-variant-list">${(draft.variants?.length?draft.variants:[{}]).map(batchVariantHTML).join("")}</div>`;
      group.querySelector("[data-batch-flavor-name]").value=draft.flavor||"";
    }
    const label=group.querySelector(".batch-flavor-item-head label");
    if(label)label.firstChild.textContent=`النكهة ${formatNumber(index+1)}`;
    groups.push(group);
  }
  container.replaceChildren(...groups);
  updateBatchFlavorOptions();
  refreshBatchPromotionSizeOptions();
}
$("batchFlavorInputs").addEventListener("input",event=>{
  if(event.target.matches("[data-batch-flavor-name], [data-variant-field=\"size\"], [data-variant-field=\"sizeUnit\"]"))refreshBatchPromotionSizeOptions();
});
$("batchFlavorInputs").addEventListener("click",event=>{
  const add=event.target.closest("[data-add-size]"),remove=event.target.closest("[data-remove-size]");if(!add&&!remove)return;
  const group=(add||remove).closest("[data-batch-flavor-group]");
  if(!group)return;
  const list=group.querySelector(".batch-variant-list");
  if(add){
    list.insertAdjacentHTML("beforeend",batchVariantHTML());
    const row=list.lastElementChild;
    refreshBatchPromotionSizeOptions();
    requestAnimationFrame(()=>{row.scrollIntoView({behavior:"smooth",block:"nearest"});row.querySelector('[data-variant-field="size"]')?.focus({preventScroll:true})});
    return;
  }
  if(list.querySelectorAll("[data-batch-variant]").length<=1)return toast("يجب أن تحتوي النكهة على حجم واحد على الأقل");
  remove.closest("[data-batch-variant]").remove();
  refreshBatchPromotionSizeOptions();
});
$("batchFlavorInputs").addEventListener("change",async event=>{
  const input=event.target.closest("[data-variant-field]");
  if(!input)return;
  if(["size","sizeUnit"].includes(input.dataset.variantField))refreshBatchPromotionSizeOptions();
  const file=input.files?.[0];
  if(!file)return;
  if(input.dataset.variantField==="dateLabel"){
    const row=input.closest("[data-batch-variant]");
    await fillProductDatesFromImage(file,row.querySelector('[data-variant-field="productionDate"]'),row.querySelector('[data-variant-field="expiry"]'));
    input.value="";
    return;
  }
  if(input.dataset.variantField!=="barcodeImage")return;
  const barcodeInput=input.closest("[data-batch-variant]").querySelector('[data-variant-field="barcode"]');
  barcodeInput.value="";
  try{const recognized=await window.decodeBarcodeImage?.(file);if(recognized){barcodeInput.value=normalizeBarcode(String(recognized));window.acknowledgeBarcode?.();toast(`تمت قراءة الباركود ${barcodeInput.value}`)}else toast("لم يُعثر على رقم واضح في الصورة؛ أدخله يدوياً")}
  catch(error){console.warn("Could not read variant barcode image",error);toast("تعذر قراءة الرقم؛ اكتب الباركود يدوياً")}
});
function updateBatchFlavorOptions(){
  const flavors=[...new Set([...commonFlavors,...savedFlavors(),...products.map(product=>product.flavor)].map(value=>String(value||"").trim()).filter(Boolean))];
  $("batchFlavorOptions").replaceChildren(...flavors.map(flavor=>new Option(flavor,flavor)));
}
function refreshBatchPromotionSizeOptions(){
  const container=$("batchPromotionSizes");
  if(!container)return;
  const groups=new Map();
  $("batchFlavorInputs").querySelectorAll("[data-batch-variant]").forEach(row=>{
    const raw=row.querySelector('[data-variant-field="size"]')?.value.trim(),unit=row.querySelector('[data-variant-field="sizeUnit"]')?.value||"ml";
    const amount=Number(raw);if(!Number.isFinite(amount)||amount<=0)return;
    const key=String(amount*(unit==="L"?1000:1));
    const group=row.closest("[data-batch-flavor-group]");
    const flavor=group?.querySelector("[data-batch-flavor-name]")?.value.trim()||"نكهة";
    if(!groups.has(key))groups.set(key,{label:`${amount} ${unit==="L"?"لتر":"مل"}`,flavors:new Set(),variants:0});
    const item=groups.get(key);item.flavors.add(flavor);item.variants++;
  });
  const brandKey=normalizeProductSearch($("pBrand").value);
  if(brandKey)products.filter(product=>normalizeProductSearch(product.brand)===brandKey).forEach(product=>{
    const key=String(productSizeInMl(product.size)),item=groups.get(key);
    if(item)item.flavors.add(String(product.flavor||product.id));
  });
  selectedBatchPromotionSizes=new Set([...selectedBatchPromotionSizes].filter(key=>groups.has(key)));
  const productName=$("pName").value.trim()||$("pBrand").value.trim()||"المنتج";
  container.innerHTML=groups.size?[...groups.entries()].sort((a,b)=>Number(a[0])-Number(b[0])).map(([key,item],index)=>{
    const flavors=[...item.flavors].filter(Boolean),shown=flavors.slice(0,3).join("، "),more=flavors.length>3?` و${formatNumber(flavors.length-3)} أخرى`:"";
    const accent=`hsl(${Math.round((index*137.508)%360)} 43% 42%)`;
    return `<label class="batch-promotion-size-option" style="--batch-size-accent:${accent}"><input type="checkbox" data-batch-promo-size="${escapeHTML(key)}" ${selectedBatchPromotionSizes.has(key)?"checked":""}><span><b>${escapeHTML(productName)} · ${escapeHTML(item.label)}</b><small>النكهات: ${escapeHTML(shown||"غير محددة")}${escapeHTML(more)} · ${formatNumber(flavors.length)} نكهة</small></span></label>`;
  }).join(""):'<span>أضف النكهات والأحجام أولاً.</span>';
  renderBatchPromotionSelectionStatus();
}
function renderBatchPromotionSelectionStatus(){
  const status=$("batchPromotionSelectionStatus"),container=$("batchPromotionSizes");
  if(!status||!container)return;
  const selected=[...container.querySelectorAll("[data-batch-promo-size]:checked")].map(input=>input.closest("label")?.querySelector("b")?.textContent.trim()).filter(Boolean);
  status.classList.toggle("has-selection",selected.length>0);
  status.textContent=selected.length?`تم اختيار ${formatNumber(selected.length)} ${selected.length===1?"حجم":"أحجام"}: ${selected.join(" · ")} — سيُوحّد العرض لهذه الأحجام فقط.`:"لم يتم اختيار أحجام؛ ستبقى العروض مستقلة لكل صنف.";
}
$("batchPromotionSizes").addEventListener("change",event=>{
  const input=event.target.closest("[data-batch-promo-size]");if(!input)return;
  const key=String(input.dataset.batchPromoSize);
  if(input.checked)selectedBatchPromotionSizes.add(key);else selectedBatchPromotionSizes.delete(key);
  renderBatchPromotionSelectionStatus();
});
$("pBrand").addEventListener("input",refreshBatchPromotionSizeOptions);
$("pName").addEventListener("input",refreshBatchPromotionSizeOptions);
async function putProductsAtomically(items){
  await new Promise((resolve,reject)=>{
    const transaction=db.transaction("products","readwrite");
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error||new Error("تعذر حفظ المنتجات"));
    transaction.onabort=()=>reject(transaction.error||new Error("تم إلغاء حفظ المنتجات"));
    const productsStore=transaction.objectStore("products");
    items.forEach(item=>productsStore.put(item));
  });
}
function openProduct(p,options={}){
  $("productForm").reset();
  $("productForm").dataset.warehouseOnly=String(Boolean(options.warehouseOnly&&!p));
  lastAutofilledBrand="";
  $("productId").value=p?.id||"";
  $("modalTitle").textContent=p?"تعديل منتج":"إضافة مجموعة نكهات";
  $("saveProductBtn").textContent=p?"حفظ المنتج":"حفظ المنتجات";
  $("batchFlavorPanel").classList.toggle("hidden",!!p);
  document.querySelectorAll(".product-single-only").forEach(element=>element.classList.toggle("hidden",!p));
  $("pName").required=!!p;
  $("pBrand").required=!p;
  $("pPrice").required=!!p;
  const fields={pName:"name",pBrand:"brand",pFlavor:"flavor",pPrice:"price",pDiscountPrice:"discountPrice",pOfferPrice:"offerPrice",pOfferQuantity:"offerQuantity",pBarcode:"barcode",pFridge:"fridge",pStore:"store",pAvailability:"availability",pTarget:"target",pMin:"minStore",pCarton:"cartonSize",pShelf:"shelf",pSection:"section",pLocation:"location",pLocationType:"locationType",pLocationNote:"locationNote",pProductionDate:"productionDate",pExpiry:"expiry",pNotes:"notes"};
  Object.entries(fields).forEach(([id,key])=>$(id).value=p?.[key]??({pFridge:0,pStore:0,pAvailability:"available",pTarget:10,pMin:5,pCarton:1,pShelf:"1",pLocationType:"fixed"}[id]??""));
  setProductSize(p?.size);
  $("pBatchCount").value="";
  selectedBatchPromotionSizes=new Set();
  refreshBatchPromotionSizeOptions();
  $("pPromotionScope").value="product";
  selectedPromotionProductIds=new Set();
  renderPromotionProductPicker();
  $("pCategory").value=categoryForProduct(p||{});
  $("brandAutofillStatus").textContent="ستكون الصور والباركود والأسعار والعروض والملاحظات مستقلة لكل نكهة وحجم.";
  renderBatchFlavorInputs(0);
  $("pBatchCount").disabled=!!p;
  updateBatchFlavorOptions();
  $("pFridgeUnit").value="piece";
  $("pStoreUnit").value="piece";
  $("pFridgeUnit").dataset.lastUnit="piece";
  $("pStoreUnit").dataset.lastUnit="piece";
  renderFlavorOptions($("pFlavor").value,false);
  updateProductBoxSummary();
  setProductImages(p);
  $("productModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(()=>$("pName").focus({preventScroll:true}),180);
}
$("pBatchCount").addEventListener("change",()=>{
  const input=$("pBatchCount"),count=Number(input.value),drafts=collectBatchDrafts();
  if(!input.value)return renderBatchFlavorInputs(0);
  if(!Number.isInteger(count)||count<1||count>30){toast("يمكن إضافة من نكهة واحدة إلى 30 نكهة في المرة الواحدة");input.value=String(Math.min(30,Math.max(1,Number.isFinite(count)?count:1)))}
  renderBatchFlavorInputs(Number(input.value),drafts);
  refreshBatchPromotionSizeOptions();
});
function closeModal(id){$(id).classList.add("hidden");document.body.classList.remove("modal-open")}
function fileToDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
async function decodeBarcodeImageSource(source){
  if(!window.decodeBarcodeImage)throw new Error("قارئ الباركود غير جاهز");
  let blob=source;
  if(!(blob instanceof Blob)){
    if(typeof source!=="string"||!/^data:image\//i.test(source))throw new Error("صورة الباركود المخزنة غير صالحة");
    const response=await fetch(source);
    if(!response.ok)throw new Error("تعذرت قراءة صورة الباركود");
    blob=await response.blob();
  }
  return normalizeBarcode(String(await window.decodeBarcodeImage(blob)||""));
}
async function synchronizeProductBarcodesFromImages(){
  if(!window.decodeBarcodeImage)return;
  const candidates=products.filter(product=>product.barcodeImage);
  let changed=0,conflicts=0;
  for(const candidate of candidates){
    try{
      const recognized=await decodeBarcodeImageSource(candidate.barcodeImage);
      if(!recognized)continue;
      const latest=await get("products",candidate.id);
      if(!latest||latest.barcodeImage!==candidate.barcodeImage||normalizeBarcode(latest.barcode)===recognized)continue;
      const duplicate=products.find(product=>String(product.id)!==String(candidate.id)&&normalizeBarcode(product.barcode)===recognized);
      if(duplicate){conflicts++;continue}
      const updated={...latest,barcode:recognized};
      await put("products",updated);
      products=products.map(product=>String(product.id)===String(updated.id)?updated:product);
      changed++;
    }catch(error){console.warn(`Could not synchronize barcode image for ${candidate.name||candidate.id}`,error)}
  }
  if(changed){renderAll();console.info(`Barcode numbers synchronized from product images: ${changed}`)}
  if(conflicts)toast(`تعذر تحديث باركود ${formatNumber(conflicts)} منتج لتجنب تكرار الرقم مع منتج آخر`)
}
async function compressImage(file){if(!file||!file.type.startsWith("image/"))throw new Error("الملف المختار ليس صورة");const data=await fileToDataURL(file);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=data});const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/jpeg",.78)}
async function handleImageInput(inputId,target){
  const input=$(inputId),file=input.files?.[0];
  if(!file)return;
  try{
    let recognizedBarcode="";
    if(target==="barcode")$("pBarcode").value="";
    if(target==="barcode"&&window.decodeBarcodeImage){
      try{recognizedBarcode=normalizeBarcode(String(await window.decodeBarcodeImage(file)||""))}
      catch(error){console.warn("Could not read barcode from product image",error);toast("تعذر قراءة الرقم تلقائياً؛ يمكنك إدخاله يدوياً")}
    }
    if(recognizedBarcode){
      window.acknowledgeBarcode?.();
      $("pBarcode").value=recognizedBarcode;
      toast(`تمت قراءة الباركود ${recognizedBarcode} ويمكنك تعديله`);
    }
    const data=await window.cropProductImage(file);
    if(!data)return;
    if(target==="product"){productImage=data;showImagePreview("pImagePreview",productImage,"")}
    else{
      barcodeImage=data;
      barcodeImageNeedsNumber=true;
      showImagePreview("pBarcodePreview",barcodeImage,"");
      if(recognizedBarcode)toast("تم إرفاق صورة الباركود وحُفظ الرقم في حقل الباركود؛ اضغط حفظ المنتج لإضافته");
      else toast("تم تجهيز صورة الباركود؛ أدخل الرقم يدوياً إذا لم يُقرأ تلقائياً");
    }
    if(target==="product")toast("تم تجهيز الصورة");
  }catch(error){console.error("Image processing failed",error);toast(error.message||"تعذر قراءة الصورة، جرّب صورة أخرى")}
  finally{input.value=""}
}
$("pImageCamera").onchange=()=>handleImageInput("pImageCamera","product");$("pImageGallery").onchange=()=>handleImageInput("pImageGallery","product");$("pBarcodeCamera").onchange=()=>handleImageInput("pBarcodeCamera","barcode");$("pBarcodeGallery").onchange=()=>handleImageInput("pBarcodeGallery","barcode");
$("pDateLabel").addEventListener("change",async event=>{const input=event.currentTarget,file=input.files?.[0];if(!file)return;await fillProductDatesFromImage(file,$("pProductionDate"),$("pExpiry"));input.value=""});
async function fillProductDatesFromImage(file,productionInput,expiryInput){
  if(!file||!window.readProductDatesFromImage)return toast("ميزة قراءة التواريخ غير جاهزة");
  try{
    toast("جار قراءة تواريخ الملصق...");
    const result=await window.readProductDatesFromImage(file);
    if(result.productionDate)productionInput.value=result.productionDate;
    if(result.expiryDate)expiryInput.value=result.expiryDate;
    if(result.productionDate||result.expiryDate)toast(`تم تسجيل التواريخ تلقائياً${result.productionDate?" · الإنتاج "+result.productionDate:""}${result.expiryDate?" · الانتهاء "+result.expiryDate:""}`);
    else toast("لم يتعرف التطبيق على تاريخ واضح؛ أدخله يدوياً");
  }catch(error){console.error("Date label OCR failed",error);toast("تعذرت قراءة الملصق؛ تحقق من الاتصال أو أدخل التاريخ يدوياً")}
}
document.addEventListener("click",async e=>{
  const crop=e.target.closest("[data-crop-image]");
  if(crop){
    const target=crop.dataset.cropImage==="pBarcodePreview"?"barcode":"product";
    const source=target==="product"?productImage:barcodeImage;
    try{
      const edited=await window.cropProductImage(source);
      if(edited){
        if(target==="product"){productImage=edited;showImagePreview("pImagePreview",productImage,"")}
        else{barcodeImage=edited;barcodeImageNeedsNumber=true;showImagePreview("pBarcodePreview",barcodeImage,"")}
      }
    }catch(error){console.error(`Product ${target} image crop failed`,error);toast(error.message||"تعذر قص الصورة")}
    return;
  }
  const remove=e.target.closest("[data-remove-image]");
  if(!remove)return;
  if(remove.dataset.removeImage==="pImagePreview"){productImage="";showImagePreview("pImagePreview","","لم تتم إضافة صورة المنتج")}
  else{barcodeImage="";barcodeImageNeedsNumber=false;showImagePreview("pBarcodePreview","","لم تتم إضافة صورة الباركود")}
});
$("productForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const saveButton=$("saveProductBtn"), originalButtonText=saveButton.textContent;
  if(saveButton.disabled)return;
  saveButton.disabled=true;
  saveButton.setAttribute("aria-busy","true");
  saveButton.textContent="جارٍ الحفظ...";
  try{
  const oldId=$("productId").value;
  const old=products.find(product=>product.id===oldId);
  const priceValue=$("pPrice").value.trim();
  const price=priceValue===""?null:Number(priceValue);
  if(priceValue!==""&&(!Number.isFinite(price)||price<0)){toast("أدخل سعراً صحيحاً غير سالب");$("pPrice").focus();return}
  if(!old){
    const brand=$("pBrand").value.trim(),count=Number($("pBatchCount").value),groups=collectBatchDrafts();
    if(!brand)return toast("اكتب اسم العلامة التجارية");
    if(!Number.isInteger(count)||count<1||count>30||groups.length!==count)return toast("أدخل عدد النكهات أولاً");
    if(groups.some(group=>!group.flavor.trim()))return toast("أدخل اسم كل نكهة");
    const name=$("pName").value.trim()||brand,brandKey=normalizeProductSearch(brand),created=Date.now(),newProducts=[];
    const seenVariantKeys=new Set(),seenBarcodes=new Set();
    for(const group of groups){
      const flavor=group.flavor.trim(),flavorKey=normalizeProductSearch(flavor),seenSizes=new Set();
      if(!savedFlavors().includes(flavor)&&!commonFlavors.includes(flavor)&&!saveFlavor(flavor))return;
      for(const row of group.variants){
        const sizeNumber=Number(row.size),unit=row.sizeUnit||"ml";
        if(!Number.isFinite(sizeNumber)||sizeNumber<=0){toast(`أدخل حجماً صحيحاً لنكهة ${flavor}`);return}
        const sizeInMl=sizeNumber*(unit==="L"?1000:1),size=`${sizeNumber} ${unit==="L"?"لتر":"مل"}`,sizeKey=String(sizeInMl);
        if(seenSizes.has(sizeKey)){toast(`الحجم مكرر في نكهة ${flavor}`);return}seenSizes.add(sizeKey);
        const priceValue=String(row.price||"").trim(),price=priceValue===""?null:Number(priceValue);
        if(price===null||!Number.isFinite(price)||price<0){toast(`أدخل سعر القطعة لنكهة ${flavor} وحجم ${size}`);return}
        const discountValue=String(row.discountPrice||"").trim(),discountPrice=discountValue===""?null:Number(discountValue);
        if(discountValue!==""&&(!Number.isFinite(discountPrice)||discountPrice<0||discountPrice>=price)){toast("يجب أن يكون تخفيض القطعة أقل من سعرها الأساسي");return}
        const offerPriceValue=String(row.offerPrice||"").trim(),offerQuantityValue=String(row.offerQuantity||"").trim(),offerPrice=offerPriceValue===""?null:Number(offerPriceValue),offerQuantity=offerQuantityValue===""?null:Number(offerQuantityValue);
        if((offerPriceValue==="")!==(offerQuantityValue==="")){toast("أدخل سعر العرض الإجمالي وعدد القطع معاً");return}
        if(offerQuantity!==null&&(!Number.isSafeInteger(offerQuantity)||offerQuantity<2)){toast("عدد القطع في العرض يجب أن يكون عدداً صحيحاً لا يقل عن 2");return}
        if(offerPriceValue!==""&&(!Number.isFinite(offerPrice)||offerPrice<0||offerPrice>=price*offerQuantity)){toast("يجب أن يكون سعر العرض أقل من مجموع أسعار القطع قبل العرض");return}
        const barcodeFile=row.barcodeImage,productFile=row.image;
        let barcode=normalizeBarcode(String(row.barcode||""));
        if(barcodeFile&&!barcode){try{barcode=normalizeBarcode(String(await window.decodeBarcodeImage?.(barcodeFile)||""))}catch(error){console.warn("Barcode decode failed for batch variant",error)}}
        if(barcodeFile&&!barcode){toast(`تعذر قراءة الباركود لنكهة ${flavor} وحجم ${size}؛ أدخل الرقم يدوياً قبل الحفظ`);return}
        if(barcode){
          const duplicate=products.find(product=>normalizeBarcode(product.barcode)===barcode)||seenBarcodes.has(barcode);
          if(duplicate){toast(`الباركود ${barcode} مسجل مسبقاً أو مكرر في القائمة`);return}
          seenBarcodes.add(barcode);
        }
        const duplicateVariant=products.find(product=>normalizeProductSearch(product.brand)===brandKey&&normalizeProductSearch(product.flavor)===flavorKey&&productSizeInMl(product.size)===sizeInMl);
        const variantKey=`${flavorKey}|${sizeKey}`;
        if(duplicateVariant||seenVariantKeys.has(variantKey)){toast(`النكهة «${flavor}» والحجم ${size} مسجلان مسبقاً`);return}
        seenVariantKeys.add(variantKey);
        const readInteger=(key,fallback,min=0)=>{const raw=String(row[key]??"").trim(),value=raw===""?fallback:Number(raw);return Number.isSafeInteger(value)&&value>=min?value:null};
        const fridge=readInteger("fridge",0),store=readInteger("store",0),target=readInteger("target",10),minStore=readInteger("minStore",5),cartonSize=readInteger("cartonSize",1,1);
        if([fridge,store,target,minStore,cartonSize].some(value=>value===null)){toast(`تحقق من كميات نكهة ${flavor} وحجم ${size}`);return}
        let image="",barcodeImage="";
        try{if(productFile)image=await compressImage(productFile);if(barcodeFile)barcodeImage=await compressImage(barcodeFile)}catch(error){console.error("Could not process a variant image",error);toast(`تعذر تجهيز صور نكهة ${flavor}؛ اختر صورة أخرى`);return}
        newProducts.push({id:uid(),name,brand,category:$("pCategory").value||"juice",flavor,size,price,discountPrice,offerPrice,offerQuantity,barcode,image,barcodeImage,fridge,store,availability:"available",target,minStore,cartonSize,shelf:$("pShelf").value,section:$("pSection").value,location:$("pLocation").value.trim(),locationType:$("pLocationType").value||"fixed",locationNote:$("pLocationNote").value.trim(),productionDate:String(row.productionDate||""),expiry:String(row.expiry||""),notes:String(row.notes||"").trim(),created,isDemo:false,needsRefill:false,displayInProducts:$("productForm").dataset.warehouseOnly!=="true"});
      }
    }
    const selectedPromoSizes=new Set([...$("batchPromotionSizes").querySelectorAll("[data-batch-promo-size]:checked")].map(input=>String(input.dataset.batchPromoSize)));
    const existingUpdates=new Map();
    if(selectedPromoSizes.size){
      const sizeMasters=new Map();
      for(const product of newProducts){
        const key=String(productSizeInMl(product.size));if(!selectedPromoSizes.has(key))continue;
        if(!sizeMasters.has(key))sizeMasters.set(key,{discountPrice:null,offerPrice:null,offerQuantity:null});
        const master=sizeMasters.get(key);
        for(const field of ["discountPrice","offerPrice","offerQuantity"])if((master[field]===null||master[field]===undefined)&&(product[field]!==null&&product[field]!==undefined&&product[field]!==""))master[field]=product[field];
      }
      for(const [key,promo] of [...sizeMasters])if(promo.discountPrice===null&&promo.offerPrice===null&&promo.offerQuantity===null)sizeMasters.delete(key);
      for(const product of newProducts){
        const promo=sizeMasters.get(String(productSizeInMl(product.size)));if(!promo)continue;
        if(promo.discountPrice!==null&&promo.discountPrice!==undefined&&promo.discountPrice>=Number(product.price)){toast(`تخفيض الحجم ${product.size} أعلى من سعر نكهة ${product.flavor}`);return}
        if(promo.offerPrice!==null&&promo.offerPrice!==undefined&&promo.offerPrice>=Number(product.price)*Number(promo.offerQuantity)){toast(`سعر العرض لا يناسب سعر نكهة ${product.flavor} بالحجم ${product.size}`);return}
        Object.assign(product,promo);
      }
      for(const existing of products){
        if(normalizeProductSearch(existing.brand)!==brandKey)continue;
        const promo=sizeMasters.get(String(productSizeInMl(existing.size)));if(!promo)continue;
        if(promo.discountPrice!==null&&promo.discountPrice!==undefined&&promo.discountPrice>=Number(existing.price)){toast(`تخفيض الحجم ${existing.size} أعلى من سعر ${existing.flavor||existing.name}`);return}
        if(promo.offerPrice!==null&&promo.offerPrice!==undefined&&promo.offerPrice>=Number(existing.price)*Number(promo.offerQuantity)){toast(`سعر العرض لا يناسب سعر ${existing.flavor||existing.name} بالحجم ${existing.size}`);return}
        existingUpdates.set(existing.id,{...existing,...promo});
      }
    }
    try{await putProductsAtomically([...newProducts,...existingUpdates.values()])}
    catch(error){console.error("Could not save flavor and size products",error);toast("تعذر حفظ المنتجات؛ لم تتم إضافة المجموعة");return}
    closeModal("productModal");await reload();toast(`تم حفظ ${formatNumber(newProducts.length)} صنفاً بنكهات وأحجام مستقلة للماركة ${brand}`);return;
  }
  const id=oldId;
  let barcode=normalizeBarcode($("pBarcode").value);
  if(!barcode&&barcodeImage){
    try{barcode=await decodeBarcodeImageSource(barcodeImage)}
    catch(error){console.warn("Could not read barcode image before saving product",error)}
    if(barcode){$("pBarcode").value=barcode;barcodeImageNeedsNumber=false;window.acknowledgeBarcode?.()}
  }
  if((barcodeImageNeedsNumber||barcodeImage)&&!barcode){toast("تعذر قراءة رقم الباركود من الصورة؛ أدخله يدوياً قبل الحفظ");$("pBarcode").focus();return}
  const duplicate=barcode&&products.find(p=>normalizeBarcode(p.barcode)===barcode&&p.id!==id);
  if(duplicate){toast("هذا الباركود مسجل مسبقاً للمنتج: "+duplicate.name);return}
  const promotion=readPromotionInputs(price);
  if(!promotion)return;
  const{discountPrice,offerPrice,offerQuantity,scope:promotionScope}=promotion;
  const brandKey=normalizeProductSearch($("pBrand").value),sizeInMl=productSizeInMl(getProductSize());
  const promotionTargets=promotionScope==="same-size"
    ? products.filter(item=>item.id!==old?.id&&normalizeProductSearch(item.brand)===brandKey&&productSizeInMl(item.size)===sizeInMl)
    : promotionScope==="selected"
      ? products.filter(item=>selectedPromotionProductIds.has(String(item.id)))
      : [];
  if(promotionScope==="selected"&&!promotionTargets.length){toast("حدد منتجاً واحداً على الأقل لتطبيق العرض عليه");return}
  for(const target of promotionTargets){
    const targetPrice=Number(target.price);
    if(discountPrice!==null&&(!Number.isFinite(targetPrice)||discountPrice>=targetPrice)){toast(`لا يمكن تطبيق سعر التخفيض على «${target.name}» لأنه ليس أقل من سعره الأساسي`);return}
    if(offerPrice!==null&&(!Number.isFinite(targetPrice)||offerPrice>=targetPrice*offerQuantity)){toast(`سعر العرض لا يناسب السعر الأساسي للمنتج «${target.name}»`);return}
  }
  const cartonSize=Math.max(1,Number($("pCarton").value)||1);
  const store=(Number($("pStore").value)||0)*($("pStoreUnit").value==="carton"?cartonSize:1);
  const fridge=(Number($("pFridge").value)||0)*($("pFridgeUnit").value==="carton"?cartonSize:1);
  if(!Number.isSafeInteger(store)||!Number.isSafeInteger(fridge)){toast("الكمية المدخلة أكبر من المسموح");return}
  const flavor=$("pFlavor").value.trim();
  if(flavor&&!savedFlavors().includes(flavor)&&!commonFlavors.includes(flavor)&&!saveFlavor(flavor))return;
  const size=getProductSize();
  if(size===null){toast("أدخل حجماً رقمياً أكبر من صفر");$("pSize").focus();return}
  const p={id,name:$("pName").value.trim(),brand:$("pBrand").value.trim(),category:$("pCategory").value||"juice",flavor,size,price,discountPrice,offerPrice,offerQuantity,barcode,image:productImage,barcodeImage,fridge,store,availability:store+fridge>0?"available":$("pAvailability").value,target:+$("pTarget").value,minStore:+$("pMin").value,cartonSize,shelf:$("pShelf").value,section:$("pSection").value,location:$("pLocation").value.trim(),locationType:$("pLocationType").value,locationNote:$("pLocationNote").value.trim(),productionDate:$("pProductionDate").value,expiry:$("pExpiry").value,notes:$("pNotes").value,created:old?.created||Date.now(),isDemo:old?.isDemo||false,needsRefill:old?.needsRefill||false,refillRequest:old?.refillRequest,displayInProducts:old?.displayInProducts??true,importBatchId:old?.importBatchId,importFileName:old?.importFileName,importedAt:old?.importedAt};
  const stockChanged=!old?(p.fridge>0||p.store>0):p.fridge!==Number(old.fridge||0)||p.store!==Number(old.store||0);
  const productionChanged=Boolean(old&&p.productionDate!==String(old.productionDate||"")),expiryChanged=Boolean(old&&p.expiry!==String(old.expiry||""));
  if(stockChanged||productionChanged||expiryChanged){
    try{await window.saveProductWithInventory(p,old,"المستخدم",{recordMovement:stockChanged,updateProductionDate:productionChanged,updateExpiry:expiryChanged,productionDate:p.productionDate,expiry:p.expiry})}
    catch(error){console.error("Could not save product stock adjustment",error);toast("تعذر حفظ الكمية؛ لم يتغير المخزون");return}
  }else await put("products",p);
  if(promotionTargets.length){
    const siblings=promotionTargets.map(item=>({...item,discountPrice,offerPrice,offerQuantity}));
    await putProductsAtomically(siblings);
  }
  closeModal("productModal");
  await reload();
  toast("تم حفظ المنتج وصوره");
  }catch(error){
    console.error("Could not save product",error);
    toast("تعذر حفظ المنتج؛ تحقق من البيانات وحاول مجدداً");
  }finally{
    saveButton.disabled=false;
    saveButton.removeAttribute("aria-busy");
    saveButton.textContent=originalButtonText;
  }
});
function openProductDetails(product){
  if(!product)return;
  const shelf=shelves.find(item=>String(item.id)===String(product.shelf));
  const section=shelf?.sections?.find(item=>String(item.id)===String(product.section));
  const expiryLot=inventoryLots.filter(lot=>String(lot.productId)===String(product.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  $("productDetailsTitle").textContent=product.name||"تفاصيل المنتج";
  $("productDetailsBrand").textContent=product.brand||"منتج";
  $("productDetailsDescription").textContent=[product.flavor,product.size].filter(Boolean).join(" · ");
  $("productDetailsPrice").textContent=formatPrice(product.price);
  const status=$("productDetailsStatus");
  const fridgeQuantity=Math.max(0,Number(product.fridge)||0);
  const storeQuantity=Math.max(0,Number(product.store)||0);
  const productUnavailable=product.availability==="unavailable"&&fridgeQuantity===0&&storeQuantity===0;
  const productNeedsRefill=!productUnavailable&&low(product);
  status.textContent=productUnavailable?"غير متوفر":productNeedsRefill?"يحتاج تعبئة":"متوفر";
  status.className=`product-details-status ${productUnavailable?"is-unavailable":productNeedsRefill?"is-low":"is-ready"}`;
  const detailsPricing=$("productDetailsPricing");
  const detailsDiscount=$("productDetailsDiscount");
  const detailsOffer=$("productDetailsOffer");
  const detailsSavings=$("productDetailsSavings");
  const detailsBasePrice=detailsPricing.querySelector(".product-details-price");
  detailsPricing.classList.remove("has-pricing-promo");
  detailsBasePrice.classList.remove("hidden");
  for(const card of [detailsDiscount,detailsOffer]){
    card.classList.add("hidden");
    card.replaceChildren();
  }
  detailsSavings.classList.add("hidden");
  detailsSavings.classList.remove("has-offer-savings");
  detailsSavings.replaceChildren();
  const hasDiscountPrice=hasPriceValue(product.discountPrice);
  const hasBundleOffer=Number(product.offerQuantity)>1&&hasPriceValue(product.offerPrice);
  detailsPricing.classList.toggle("has-pricing-promo",hasDiscountPrice||hasBundleOffer);
  const regularPrice=Math.max(0,Number(product.price)||0);
  if(hasDiscountPrice){
    const discountPrice=Math.max(0,Number(product.discountPrice)||0);
    const unitSaving=Math.max(0,regularPrice-discountPrice);
    const unitPercent=regularPrice>0?Math.round(unitSaving/regularPrice*100):0;
    detailsDiscount.classList.remove("hidden");
    detailsDiscount.innerHTML=`<small class="price-card-label">تخفيض القطعة</small><div class="unit-discount-compare"><del dir="ltr">${escapeHTML(formatPrice(regularPrice))}</del><b dir="ltr">${escapeHTML(formatPrice(discountPrice))}</b></div><small class="unit-discount-note">وفرت ${escapeHTML(formatPrice(unitSaving))} للقطعة${unitPercent?` · خصم ${formatNumber(unitPercent)}٪`:""}</small>`;
  }
  if(hasBundleOffer){
    const quantity=Number(product.offerQuantity),offerTotal=Math.max(0,Number(product.offerPrice)||0);
    const regularTotal=regularPrice*quantity,saving=Math.max(0,regularTotal-offerTotal),savingPercent=regularTotal>0?Math.round(saving/regularTotal*100):0;
    detailsSavings.classList.remove("hidden");
    detailsSavings.classList.add("has-offer-savings");
    detailsSavings.setAttribute("aria-label","إجمالي العرض والتوفير مقارنة بالسعر الأساسي");
    detailsSavings.innerHTML=`<div class="offer-saving-tile offer-saving-total"><small>عرض · ${formatNumber(quantity)} قطع</small><b dir="ltr">${escapeHTML(formatPrice(offerTotal))}</b><small>الإجمالي بعد العرض</small></div><div class="offer-saving-tile offer-saving-before"><small>الإجمالي قبل العرض</small><b dir="ltr">${escapeHTML(formatPrice(regularTotal))}</b><small>${formatNumber(quantity)} × ${escapeHTML(formatPrice(regularPrice))} للقطعة</small></div><div class="offer-saving-tile offer-saving-result"><small>توفيرك عند شراء ${formatNumber(quantity)} قطع</small><b dir="ltr">${escapeHTML(formatPrice(saving))}</b>${savingPercent?`<small class="offer-saving-percent">خصم ${formatNumber(savingPercent)}٪ من الإجمالي</small>`:""}</div>`;
  }else if(hasDiscountPrice){
    const discountPrice=Math.max(0,Number(product.discountPrice)||0),saving=Math.max(0,regularPrice-discountPrice),savingPercent=regularPrice>0?Math.round(saving/regularPrice*100):0;
    detailsSavings.classList.remove("hidden");
    detailsSavings.setAttribute("aria-label","التوفير من تخفيض سعر القطعة");
    detailsSavings.innerHTML=`<span class="savings-mark" aria-hidden="true">↓</span><span class="savings-label">توفيرك لكل قطعة</span><b dir="ltr">${escapeHTML(formatPrice(saving))}</b>${savingPercent?`<small class="savings-percent">خصم ${formatNumber(savingPercent)}٪</small>`:""}`;
  }
  $("productDetailsImage").src=product.image||"icon.svg";
  $("productDetailsImage").alt=product.name?`صورة ${product.name}`:"صورة المنتج";
  $("productDetailsFridge").textContent=String(product.fridge||0);
  $("productDetailsStore").textContent=String(product.store||0);
  $("productDetailsTarget").textContent=String(product.target||0);
  const cartonSize=Math.max(1,Number(product.cartonSize)||1);
  const fridge=Math.max(0,Number(product.fridge)||0);
  const store=Math.max(0,Number(product.store)||0);
  const fridgeTarget=Math.max(0,Number(product.target)||0);
  const storeLimit=Math.max(0,Number(product.minStore)||0);
  const fridgePercent=fridgeTarget?Math.min(100,Math.round(fridge/fridgeTarget*100)):fridge?100:0;
  const storePercent=storeLimit?Math.min(100,Math.round(store/storeLimit*100)):store?100:0;
  const fridgeMeter=$("productDetailsFridgeMeter");
  const storeMeter=$("productDetailsStoreMeter");
  fridgeMeter.style.width=`${fridgePercent}%`;
  storeMeter.style.width=`${storePercent}%`;
  fridgeMeter.parentElement.setAttribute("aria-valuenow",String(fridgePercent));
  fridgeMeter.parentElement.setAttribute("aria-valuemin","0");
  fridgeMeter.parentElement.setAttribute("aria-valuemax","100");
  storeMeter.parentElement.setAttribute("aria-valuenow",String(storePercent));
  storeMeter.parentElement.setAttribute("aria-valuemin","0");
  storeMeter.parentElement.setAttribute("aria-valuemax","100");
  $("productDetailsFridgeBoxes").textContent=`${Math.floor(fridge/cartonSize)} كرتون كامل · ${fridge%cartonSize} قطعة متبقية`;
  $("productDetailsStoreBoxes").textContent=`${Math.floor(store/cartonSize)} كرتون كامل · ${store%cartonSize} قطعة متبقية (${cartonSize} قطعة في الكرتون)`;
  $("productDetailsBarcode").textContent=product.barcode||"غير مسجل";
  $("productDetailsCopyBarcode").disabled=!product.barcode;
  $("productDetailsCopyBarcode").onclick=async()=>{
    if(!product.barcode)return;
    try{
      let copied=false;
      if(navigator.clipboard?.writeText){
        try{
          await navigator.clipboard.writeText(String(product.barcode));
          copied=true;
        }catch(error){
          console.warn("Clipboard API unavailable; trying browser copy fallback",error);
        }
      }
      if(!copied){
        const copyField=document.createElement("textarea");
        copyField.value=String(product.barcode);
        copyField.setAttribute("readonly","");
        copyField.style.position="fixed";
        copyField.style.opacity="0";
        document.body.append(copyField);
        try{
          copyField.select();
          copied=document.execCommand("copy");
        }finally{
          copyField.remove();
        }
      }
      if(!copied)throw new Error("Browser clipboard command failed");
      toast("تم نسخ رقم الباركود");
    }catch(error){
      console.error("Could not copy product barcode",error);
      toast("تعذر نسخ الباركود؛ يمكنك تحديد الرقم ونسخه يدوياً");
    }
  };
  const details=[
    ["الموقع",`${window.locationCode?.(product)||`${shelf?.name||"غير محدد"}${section?` · ${section.name}`:""}`}${product.location?` · ${product.location}`:""}`],
    ["ملاحظة الرف",product.locationNote||"لا توجد ملاحظة"],
    ["تاريخ الإنتاج",product.productionDate||"غير محدد"],
    ["أقرب صلاحية",expiryLot?`${expiryLot.expiry} · ${Number(expiryLot.storeQty||0)+Number(expiryLot.fridgeQty||0)} قطعة`:(product.expiry||"غير محددة")],
    ["القطع في الكرتون",formatNumber(cartonSize)],
    ["ملاحظات",product.notes||"لا توجد ملاحظات"]
  ];
  $("productDetailsList").replaceChildren(...details.flatMap(([label,value])=>{
    const term=document.createElement("dt");term.textContent=label;
    const description=document.createElement("dd");description.textContent=value;
    return [term,description];
  }));
  $("productDetailsEdit").onclick=()=>{closeModal("productDetailsModal");openProduct(product)};
  $("productDetailsMove").onclick=()=>{closeModal("productDetailsModal");go("movement");if(window.selectMovementProduct)window.selectMovementProduct(product.id);else $("movementProduct").value=product.id};
  $("productDetailsModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}
$("productList").addEventListener("click",async e=>{
  const detail=e.target.closest("[data-product-detail]"),edit=e.target.closest("[data-edit]"),remove=e.target.closest("[data-delete]"),move=e.target.closest("[data-move]"),show=e.target.closest("[data-show-barcode]"),card=e.target.closest("[data-product-card]");
  if(e.target.closest("[data-mark-refill],[data-mark-filled],[data-expand-image],.product-stock-editor,.product-stock-disclosure"))return;
  if(detail){openProductDetails(products.find(p=>p.id===detail.dataset.productDetail));return}
  if(edit){openProduct(products.find(p=>p.id===edit.dataset.edit));return}
  if(remove&&confirm("هل تريد حذف المنتج؟")){for(const lot of inventoryLots.filter(item=>String(item.productId)===String(remove.dataset.delete)))await del("inventoryLots",lot.id);await del("products",remove.dataset.delete);await reload();toast("تم حذف المنتج");return}
  if(move){go("movement");if(window.selectMovementProduct)window.selectMovementProduct(move.dataset.move);else $("movementProduct").value=move.dataset.move;return}
  if(show){const p=products.find(x=>x.id===show.dataset.showBarcode);if(p){go("scan");$("scanCode").value=p.barcode||"";updateScanBarcodeCopy(p.barcode||"");renderScanResult(p);showBarcodeProduct(p)}return}
  if(card)openProductDetails(products.find(p=>p.id===card.dataset.productCard));
});
$("productList").addEventListener("keydown",event=>{
  if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-product-card]")){
    event.preventDefault();
    openProductDetails(products.find(p=>p.id===event.target.dataset.productCard));
  }
});
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-restock-alert]");
  if(!button)return;
  const product=products.find(item=>String(item.id)===button.dataset.restockAlert);
  if(!product)return;
  go("movement");
  $("movementType").value="addStore";
  document.querySelectorAll("[data-movement-type]").forEach(item=>item.classList.toggle("active",item.dataset.movementType==="addStore"));
  window.selectMovementProduct?.(product.id);
});
let refillModalProduct=null;
function updateRefillRequestPreview(){
  const product=refillModalProduct,entered=Math.max(0,Number($("refillRequestQty").value)||0);
  const boxSize=Math.max(1,Number(product?.cartonSize)||1);
  const pieces=entered*($("refillRequestUnit").value==="carton"?boxSize:1);
  const cartons=Math.ceil(pieces/boxSize);
  $("refillRequestPreview").textContent=product?`${formatNumber(pieces)} قطعة · نحو ${formatNumber(cartons)} ${cartons===1?"كرتون":"كراتين"} · المتوفر في المخزن ${formatNumber(product.store)} قطعة`:"";
}
function openRefillModal(productId){
  refillModalProduct=products.find(product=>String(product.id)===String(productId));
  if(!refillModalProduct)return;
  $("refillProductName").textContent=refillModalProduct.name;
  $("refillRequestQty").value=String(Math.max(1,refill(refillModalProduct)));
  $("refillRequestUnit").value="piece";
  updateRefillRequestPreview();
  $("refillModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(()=>$("refillRequestQty").focus({preventScroll:true}),100);
}
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-mark-refill]");
  if(button)openRefillModal(button.dataset.markRefill);
});
["refillRequestQty","refillRequestUnit"].forEach(id=>["input","change"].forEach(type=>$(id).addEventListener(type,updateRefillRequestPreview)));
$("saveRefillRequest").addEventListener("click",async()=>{
  if(!refillModalProduct)return;
  const entered=Number($("refillRequestQty").value);
  const boxSize=Math.max(1,Number(refillModalProduct.cartonSize)||1);
  const quantity=entered*($("refillRequestUnit").value==="carton"?boxSize:1);
  if(!Number.isSafeInteger(entered)||entered<1||!Number.isSafeInteger(quantity)||quantity<1)return toast("أدخل كمية تعبئة صحيحة");
  try{
    await put("products",{...refillModalProduct,needsRefill:true,refillRequest:quantity});
    closeModal("refillModal");
    refillModalProduct=null;
    await reload();
    toast("تم تحديد النقص وإظهاره باللون الأحمر");
  }catch(error){console.error("Could not save product refill request",error);toast("تعذر حفظ كمية النقص")}
});
$("lowProductsSearch").addEventListener("input",renderLowProducts);
document.addEventListener("click",event=>{
  const image=event.target.closest("[data-expand-image],.product-thumb,.scan-result-card>img,.replenish-product-icon img,.shelf-slot-product img");
  const imageElement=image?.matches("img")?image:image?.querySelector("img");
  const source=image?.dataset.imageSrc||imageElement?.currentSrc||imageElement?.src;
  if(!image||!source)return;
  $("productImageViewer").src=source;
  $("productImageViewer").alt=image.dataset.imageCaption||imageElement?.alt||"صورة المنتج";
  $("productImageCaption").textContent=image.dataset.imageCaption||(imageElement?.alt||"").replace(/^تكبير صورة /,"")||"صورة المنتج";
  $("productImageModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  event.preventDefault();
  event.stopPropagation();
},true);
function closeImageViewer(){$("productImageModal").classList.add("hidden");$("productImageViewer").removeAttribute("src");if(document.querySelector(".modal:not(.hidden):not(#productImageModal)"))document.body.classList.add("modal-open");else document.body.classList.remove("modal-open")}
document.querySelectorAll("[data-close-image]").forEach(button=>button.addEventListener("click",closeImageViewer));
$("productImageModal").addEventListener("click",event=>{if(event.target.id==="productImageModal")closeImageViewer()});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));["productModal","productDetailsModal","refillModal","barcodeProductModal"].forEach(id=>$(id).addEventListener("click",event=>{if(event.target.id===id){closeModal(id);if(id==="refillModal")refillModalProduct=null}}));document.addEventListener("keydown",event=>{if(event.key!=="Escape")return;if(!$("productImageModal").classList.contains("hidden")){closeImageViewer();return}if(!$("imageCropModal").classList.contains("hidden")){$("cancelImageCrop").click();return}for(const id of ["refillModal","barcodeProductModal","productDetailsModal","productModal"])if(!$(id).classList.contains("hidden")){closeModal(id);if(id==="refillModal")refillModalProduct=null;break}});
$("productSearch").addEventListener("input",()=>{renderProducts();$("clearProductSearch").classList.toggle("hidden",!$("productSearch").value)});$("clearProductSearch").addEventListener("click",()=>{$("productSearch").value="";$("clearProductSearch").classList.add("hidden");renderProducts();$("productSearch").focus()});document.querySelectorAll("#page-products [data-filter]").forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;document.querySelectorAll("#page-products [data-filter]").forEach(x=>x.classList.toggle("active",x===b));renderProducts()});
$("movementUnit").onchange=()=>{$("cartonSizeWrap").style.opacity=$("movementUnit").value==="carton"?"1":".65"};
$("movementForm").addEventListener("submit",async e=>{e.preventDefault();const p=products.find(x=>x.id===$("movementProduct").value);if(!p)return toast("اختر المنتج أولاً");const qty=+$("movementQty").value;if(!Number.isFinite(qty)||qty<1)return toast("أدخل كمية صحيحة");const q=pieceCount(qty,$("movementUnit").value,+$("cartonSize").value||p.cartonSize||1);const type=$("movementType").value;let label="";if(type==="transfer"){if(p.store<q)return toast("الكمية في المخزن غير كافية");p.store-=q;p.fridge+=q;label="نقل إلى البراد"}else if(type==="addStore"){p.store+=q;label="إضافة للمخزن"}else return toast("اختر نقلاً أو إضافة، أو ابدأ الجرد الفعلي");await put("products",p);await put("movements",{id:uid(),productId:p.id,productName:p.name,qty:q,label,time:Date.now(),note:$("movementNote").value});$("movementQty").value=1;$("movementNote").value="";await reload();toast("تم تحديث المخزون بنجاح")});
$("refreshTasks").onclick=renderReplenish;
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));document.querySelectorAll("[data-action='add-product']").forEach(b=>b.onclick=()=>openProduct());document.querySelectorAll("[data-action='add-warehouse-product']").forEach(b=>b.onclick=()=>{go("inventory");window.openProduct(undefined,{warehouseOnly:true})});document.querySelectorAll("[data-shelf]").forEach(b=>b.onclick=()=>{currentShelf=+b.dataset.shelf;document.querySelectorAll("[data-shelf]").forEach(x=>x.classList.toggle("active",x===b));renderMap()});
$("addProductBtn").addEventListener("click",()=>openProduct());
function renderScanResult(p){const el=$("scanResult");if(!p){el.className="scan-result panel";el.innerHTML=`<div class="subline">لم نعثر على منتج بهذا الباركود. يمكنك تسجيله الآن كمنتج جديد.</div><button class="primary wide" type="button" data-add-scanned>＋ إضافة هذا الباركود كمنتج</button>`;return}const lot=(inventoryLots||[]).filter(item=>String(item.productId)===String(p.id)&&Number(item.storeQty)+Number(item.fridgeQty)>0&&item.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];const expiry=lot?.expiry||p.expiry;const expiryDays=daysTo(expiry),expiryDetail=!Number.isFinite(expiryDays)?"":expiryDays<0?` · منتهي منذ ${Math.abs(expiryDays)} يوم`:expiryDays===0?" · ينتهي اليوم":` · متبقي ${expiryDays} يوم`,expiryText=expiry?`${escapeHTML(expiry)}${expiryDetail}`:"غير محددة",offer=Number(p.offerQuantity)>1&&hasPriceValue(p.offerPrice)?`<strong class="barcode-offer">عرض ${formatNumber(p.offerQuantity)} قطع · الإجمالي ${escapeHTML(formatPrice(p.offerPrice))} · التوفير ${escapeHTML(formatPrice(Math.max(0,(Number(p.price)||0)*Number(p.offerQuantity)-Number(p.offerPrice))))}</strong>`:"",unitDiscount=hasPriceValue(p.discountPrice)?`<strong class="barcode-offer">تخفيض القطعة: ${escapeHTML(formatPrice(p.discountPrice))} بدلاً من ${escapeHTML(formatPrice(p.price))}</strong>`:"";el.className="scan-result panel";el.innerHTML=`<div class="scan-result-card">${p.image?`<img src="${p.image}" alt="${escapeHTML(p.name)}">`:"<div class='product-thumb placeholder'>▣</div>"}<div class="scan-result-info"><b>${escapeHTML(p.name)}</b><small>${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))}</small><div class="scan-highlights"><div class="scan-price"><small>سعر البيع للقطعة</small><strong>${escapeHTML(formatPrice(p.price))}</strong></div><div class="scan-expiry${Number.isFinite(expiryDays)&&expiryDays<=7?" urgent":""}"><small>تاريخ الصلاحية</small><strong>${expiryText}</strong></div></div>${unitDiscount}${offer}<small>الباركود: ${escapeHTML(p.barcode||"غير مسجل")}</small><small>المخزن: ${p.store||0} قطعة · البراد: ${p.fridge||0} قطعة · الموقع: ${escapeHTML(window.locationCode?.(p)||p.location||"غير محدد")}</small></div></div><div class="card-actions"><button class="small-btn" data-scan-edit="${escapeHTML(p.id)}">تعديل المنتج</button><button class="small-btn" data-scan-move="${escapeHTML(p.id)}">تحديث الكمية</button></div>`}
function showBarcodeProduct(product){if(!product)return;if(window.isScannerRunning?.())window.stopScanner?.({resetState:true});openProductDetails(product)}
function updateScanBarcodeCopy(value){const code=normalizeBarcode(value);$("scanBarcodeValue").textContent=code;$("scanBarcodeCopy").classList.toggle("hidden",!code);return code}
window.updateScanBarcodeCopy=updateScanBarcodeCopy;
async function copyScannedBarcode(){const code=updateScanBarcodeCopy($("scanCode").value);if(!code)return toast("لا يوجد رقم باركود لنسخه");try{let copied=false;if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(code);copied=true}catch(error){console.warn("Clipboard API unavailable; trying browser copy fallback",error)}}if(!copied){const field=document.createElement("textarea");field.value=code;field.setAttribute("readonly","");field.style.position="fixed";field.style.opacity="0";document.body.append(field);try{field.select();copied=document.execCommand("copy")}finally{field.remove()}}if(!copied)throw new Error("Browser clipboard command failed");toast("تم نسخ رقم الباركود")}catch(error){console.error("Could not copy scanned barcode",error);toast("تعذر النسخ؛ يمكنك تحديد الرقم الظاهر ونسخه يدوياً")}}
$("copyScannedBarcode").addEventListener("click",copyScannedBarcode);
function lookupBarcode(code,{notifyUnknown=true}={}){const normalized=normalizeBarcode(code);if(!normalized)return notifyUnknown&&toast("أدخل رقم الباركود أولاً");$("scanCode").value=normalized;updateScanBarcodeCopy(normalized);window.acknowledgeBarcode?.();const p=products.find(x=>normalizeBarcode(x.barcode)===normalized);if(p){$("scanResult").classList.add("hidden");showBarcodeProduct(p)}else{renderScanResult(null);if(notifyUnknown)toast("الباركود غير مسجل في العصائر")}return Boolean(p)}
window.lookupBarcode=lookupBarcode;
$("scanCode").addEventListener("input",()=>{const code=normalizeBarcode($("scanCode").value);updateScanBarcodeCopy(code);if(!code){lastBarcodeLookup="";return}const match=products.find(product=>normalizeBarcode(product.barcode)===code);if(match&&code!==lastBarcodeLookup){lastBarcodeLookup=code;lookupBarcode(code,{notifyUnknown:false})}else if(!match)lastBarcodeLookup=""});
$("barcodeLookupForm").addEventListener("submit",e=>{e.preventDefault();lastBarcodeLookup=normalizeBarcode($("scanCode").value);lookupBarcode($("scanCode").value)});$("scanResult").addEventListener("click",e=>{const edit=e.target.closest("[data-scan-edit]"),move=e.target.closest("[data-scan-move]"),add=e.target.closest("[data-add-scanned]");if(edit)openProduct(products.find(p=>p.id===edit.dataset.scanEdit));if(move){go("movement");if(window.selectMovementProduct)window.selectMovementProduct(move.dataset.scanMove);else $("movementProduct").value=move.dataset.scanMove}if(add){const code=normalizeBarcode($("scanCode").value);openProduct();$("pBatchCount").value="1";renderBatchFlavorInputs(1);const barcodeInput=$("batchFlavorInputs").querySelector('[data-variant-field="barcode"]');if(barcodeInput)barcodeInput.value=code}});
function createBackupFile(){
  const data={version:4,exportedAt:new Date().toISOString(),products,movements,shelves,inventoryLots,customFlavors:savedFlavors()};
  const date=new Date().toISOString().slice(0,10);
  const name=`العصائر-نسخة-احتياطية-${date}.json`;
  return new File([JSON.stringify(data,null,2)],name,{type:"application/json",lastModified:Date.now()});
}
function downloadBackupFile(file){
  const url=URL.createObjectURL(file),link=document.createElement("a");
  link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("exportBtn").onclick=()=>{try{downloadBackupFile(createBackupFile());toast("تم تنزيل النسخة الاحتياطية مع الصور والرفوف ودفعات المخزون")}catch(error){console.error("Backup export failed",error);toast("تعذر إنشاء النسخة الاحتياطية")}};
$("shareBackupBtn").onclick=async()=>{
  let file;
  try{file=createBackupFile()}catch(error){console.error("Backup file could not be created",error);toast("تعذر إنشاء ملف المشاركة");return}
  const shareData={title:"نسخة احتياطية من العصائر",files:[file]};
  let supportsFileShare=typeof navigator.share==="function"&&typeof File==="function";
  if(supportsFileShare&&typeof navigator.canShare==="function"){
    try{supportsFileShare=navigator.canShare({files:[file]})}catch(error){supportsFileShare=false}
  }
  if(supportsFileShare){
    try{await navigator.share(shareData);toast("تمت مشاركة ملف النسخة الاحتياطية. استورده في التطبيق على الجهاز الآخر.");return}
    catch(error){if(error?.name==="AbortError")return;console.warn("Native backup sharing failed",error)}
  }
  downloadBackupFile(file);
  toast("تعذرت المشاركة المباشرة؛ تم تنزيل ملف النسخة الكامل. أرسله عبر AirDrop ثم استورده في التطبيق.");
};
$("importFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());if(!Array.isArray(d.products)||!Array.isArray(d.movements))throw Error();if(!confirm("سيتم استبدال البيانات الحالية بالنسخة المستوردة. متابعة؟"))return;for(const p of await all("products"))await del("products",p.id);for(const m of await all("movements"))await del("movements",m.id);for(const p of d.products)await put("products",p);for(const m of d.movements)await put("movements",m);if(Array.isArray(d.shelves)){for(const shelf of await all("shelves"))await del("shelves",shelf.id);for(const shelf of d.shelves)await put("shelves",shelf)}if(Array.isArray(d.inventoryLots)){for(const lot of await all("inventoryLots"))await del("inventoryLots",lot.id);for(const lot of d.inventoryLots)await put("inventoryLots",lot)}if(Array.isArray(d.customFlavors)){const flavors=[...new Set(d.customFlavors.filter(value=>typeof value==="string").map(value=>value.trim()).filter(Boolean))];try{localStorage.setItem("stockmate-custom-flavors",JSON.stringify(flavors))}catch(storageError){console.warn("Custom flavors could not be restored",storageError)}}await reload();void synchronizeProductBarcodesFromImages();toast("تم استيراد النسخة الاحتياطية")}catch(err){console.error("Backup import failed",err);toast("ملف النسخة الاحتياطية غير صالح أو تالف")}e.target.value=""};
$("clearData").onclick=async()=>{if(!confirm("تحذير: سيتم حذف كل المنتجات وسجل تحديثات المخزون والصور نهائياً من هذا الجهاز. هل أنت متأكد؟"))return;for(const p of await all("products"))await del("products",p.id);for(const m of await all("movements"))await del("movements",m.id);await reload();toast("تم حذف البيانات")};
async function enableNotifications(){
  if(!("Notification"in window))return toast("هذا المتصفح لا يدعم إشعارات الويب في طريقة الفتح الحالية");
  const current=Notification.permission;
  savePermissionState("notifications",current);
  if(current==="granted"){toast("إشعارات الجهاز مفعلة بالفعل");notifyCurrent();return}
  if(current==="denied"){toast("إذن الإشعارات مرفوض. غيّره من إعدادات الموقع أو Safari على iPhone.");return}
  try{
    const permission=await Notification.requestPermission();
    savePermissionState("notifications",permission);
    if(permission==="granted"){toast("تم تفعيل إشعارات الجهاز");notifyCurrent()}
    else if(permission==="denied")toast("تم رفض الإشعارات. يمكنك تفعيلها من إعدادات الموقع أو Safari.")
    else toast("لم يتم اختيار إذن الإشعارات؛ لن نطلبه تلقائياً.")
  }catch(error){savePermissionState("notifications",Notification.permission);toast("تعذر طلب إذن الإشعارات من هذا المتصفح")}
}
function notifyCurrent(){if(!("Notification"in window)||Notification.permission!=="granted")return;const lowList=products.filter(p=>low(p)||storeLow(p));const unavailableList=products.filter(unavailable);const exp=products.filter(expiryAlert);if(lowList.length||unavailableList.length||exp.length)new Notification("العصائر — تنبيه المخزون",{body:`${lowList.length} منتجات تحتاج متابعة مخزون، و${unavailableList.length} غير متوفرة، و${exp.length} صلاحيتها قريبة أو منتهية.`})}
$("notifyBtn").onclick=enableNotifications;$("enableNotify").onclick=enableNotifications;
document.querySelectorAll("[data-inventory-tab]").forEach(button=>button.addEventListener("click",()=>setInventoryTab(button.dataset.inventoryTab)));
document.querySelector(".inventory-tabs").addEventListener("keydown",event=>{
  if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  const tabs=[...document.querySelectorAll("[data-inventory-tab]")];
  const current=tabs.indexOf(event.target.closest("[data-inventory-tab]"));
  if(current<0)return;
  event.preventDefault();
  const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(current+(event.key==="ArrowLeft"?1:-1)+tabs.length)%tabs.length;
  tabs[next].focus();
  setInventoryTab(tabs[next].dataset.inventoryTab);
});
setInventoryTab("products");
(async()=>{db=await openDB();if(window.enhancementsReady)await window.enhancementsReady;await reload();void synchronizeProductBarcodesFromImages();if("serviceWorker"in navigator&&location.protocol!=="file:"){try{await navigator.serviceWorker.register("./sw.js")}catch(e){console.warn("SW",e)}}if("Notification"in window&&Notification.permission==="granted")notifyCurrent()})().catch(e=>{console.error(e);toast("تعذر فتح قاعدة البيانات")});
