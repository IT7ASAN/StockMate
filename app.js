const DB_NAME="stockmate-db", DB_VERSION=3;
let db, products=[], movements=[], shelves=[], inventoryLots=[], currentFilter="all", currentShelf="1", toastTimer, productImage="", barcodeImage="", scanStream=null, scanFrame=0, detector=null, scanBusy=false;
const $=id=>document.getElementById(id);
const today=new Date(); $("today").textContent=today.toLocaleDateString("ar-IQ",{weekday:"short",day:"numeric",month:"short"});
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("products"))d.createObjectStore("products",{keyPath:"id"});if(!d.objectStoreNames.contains("movements"))d.createObjectStore("movements",{keyPath:"id"});if(!d.objectStoreNames.contains("shelves")){const shelfStore=d.createObjectStore("shelves",{keyPath:"id"});shelfStore.add({id:"1",name:"الرف الأول",location:"المنطقة الأولى",image:"",created:Date.now()});shelfStore.add({id:"2",name:"الرف الثاني",location:"المنطقة الثانية",image:"",created:Date.now()});}if(!d.objectStoreNames.contains("inventoryLots"))d.createObjectStore("inventoryLots",{keyPath:"id"});if(!d.objectStoreNames.contains("snapshots"))d.createObjectStore("snapshots",{keyPath:"id"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function all(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(name,obj){return new Promise((res,rej)=>{const r=store(name,"readwrite").put(obj);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function del(name,id){return new Promise((res,rej)=>{const r=store(name,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function uid(){return crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2500)}
function escapeHTML(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function formatNumber(value){return Number(value||0).toLocaleString("ar-IQ")}
function formatPrice(value){if(value===null||value===undefined||value==="")return"غير محدد";const price=Number(value);return Number.isFinite(price)&&price>=0?`${price.toLocaleString("ar-IQ",{maximumFractionDigits:2})} د.ع`:"غير محدد"}
let barcodeAudioContext;
window.prepareBarcodeAudio=async()=>{try{const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return;barcodeAudioContext??=new AudioContextClass();if(barcodeAudioContext.state==="suspended")await barcodeAudioContext.resume()}catch(error){console.warn("Barcode audio could not be initialized",error)}};
window.playBarcodeBeep=()=>{try{if(!barcodeAudioContext||barcodeAudioContext.state!=="running")return;const oscillator=barcodeAudioContext.createOscillator(),gain=barcodeAudioContext.createGain();oscillator.type="sine";oscillator.frequency.value=880;gain.gain.setValueAtTime(.0001,barcodeAudioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.16,barcodeAudioContext.currentTime+.015);gain.gain.exponentialRampToValueAtTime(.0001,barcodeAudioContext.currentTime+.16);oscillator.connect(gain);gain.connect(barcodeAudioContext.destination);oscillator.start();oscillator.stop(barcodeAudioContext.currentTime+.17)}catch(error){console.warn("Barcode confirmation sound failed",error)}};
function normalizeProductSearch(value){return String(value??"").normalize("NFKC").replace(/[\u064B-\u065F\u0670ـ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/[٠-٩۰-۹]/g,digit=>String(digit.charCodeAt(0)>=0x06f0?digit.charCodeAt(0)-0x06f0:digit.charCodeAt(0)-0x0660)).toLocaleLowerCase("ar").trim().replace(/\s+/g," ")}
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
  const fields={pPrice:"price",pDiscountPrice:"discountPrice",pCarton:"cartonSize",pShelf:"shelf",pLocation:"location",pLocationType:"locationType",pTarget:"target",pMin:"minStore"};
  for(const [field,key] of Object.entries(fields))$(field).value=defaults[key]??"";
  setProductSize(defaults.size);
  $("pShelf").dispatchEvent(new Event("change",{bubbles:true}));
  $("pSection").value=defaults.section??$("pSection").value;
  status.textContent=`تمت تعبئة البيانات المشتركة من أحدث منتج محفوظ للماركة ${defaults.brand}. الباركود والصورة والصلاحية والملاحظات والكميات تبقى خاصة بكل نكهة.`;
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
function low(p){return p.needsRefill===true||(!unavailable(p)&&Number(p.fridge||0)<Number(p.target||0))}
function refill(p){const requested=Number(p.refillRequest);return p.needsRefill===true&&Number.isSafeInteger(requested)&&requested>0?requested:Math.max(0,Number(p.target||0)-Number(p.fridge||0))}
function availableToMove(p){return Math.min(refill(p),Math.max(0,Number(p.store||0)))}
function shortage(p){return Math.max(0,refill(p)-availableToMove(p))}
function daysTo(date){if(!date)return null;return Math.ceil((new Date(date+"T23:59:59")-new Date())/86400000)}
function expiryAlert(p){const lotDays=(inventoryLots||[]).filter(lot=>String(lot.productId)===String(p.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry).map(lot=>daysTo(lot.expiry));if(lotDays.length)return lotDays.some(days=>days!==null&&days<=30);const d=daysTo(p.expiry);return d!==null&&d<=30}
function storeLow(p){return !unavailable(p)&&(Number(p.store||0)<=0||Number(p.store||0)<Number(p.minStore||0))}
function unavailable(p){return p.availability==="unavailable"&&Number(p.store||0)<=0&&Number(p.fridge||0)<=0}
function pieceCount(q,unit,carton){return unit==="carton"?q*carton:q}
async function reload(){[products,movements,shelves,inventoryLots]=await Promise.all([all("products"),all("movements"),all("shelves"),all("inventoryLots")]);movements.sort((a,b)=>b.time-a.time);shelves.sort((a,b)=>a.created-b.created);renderAll()}
function go(page){stopScanner();document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id==="page-"+page));const navPage=page==="low-products"?"products":["home","products","scan","replenish","movement","more"].includes(page)?page:"more";document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.page===navPage));if(page==="map")renderMap();if(page==="replenish")renderReplenish();if(page==="low-products")renderLowProducts();window.scrollTo({top:0,behavior:"smooth"})}
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
function renderDashboard(){const lows=products.filter(p=>low(p)&&refill(p)>0),ex=products.filter(expiryAlert),tasks=lows.filter(p=>refill(p)>0);$("totalProducts").textContent=products.length;$("lowCount").textContent=lows.length;$("expiryCount").textContent=ex.length;$("taskCount").textContent=tasks.length;const alerts=[...products.filter(unavailable).map(p=>({p,type:"unavailable"})),...products.filter(storeLow).sort((a,b)=>Number(a.store||0)-Number(b.store||0)).map(p=>({p,type:"store"})),...lows.map(p=>({p,type:"low"})),...ex.map(p=>({p,type:"expiry"}))].slice(0,5);$("homeAlerts").className=alerts.length?"stack":"stack empty-state";$("homeAlerts").innerHTML=alerts.length?alerts.map(a=>alertHTML(a.p,a.type)).join(""):"لا توجد تنبيهات حالياً.";renderLowProducts();const recent=movements.slice(0,4);$("homeRecentMovements").className=recent.length?"home-recent-list":"home-recent-movements empty-state";$("homeRecentMovements").innerHTML=recent.map(m=>`<div class="home-recent-item"><span class="home-recent-icon">${m.label?.includes("إضافة")?"＋":m.label?.includes("سحب")?"−":"↗"}</span><div><b>${escapeHTML(m.productName)}</b><small>${escapeHTML(m.label)} · ${new Date(m.time).toLocaleDateString("ar-IQ")}</small></div><strong>${Number(m.qty||0).toLocaleString("ar-IQ")} قطعة</strong></div>`).join("")||"لا توجد حركات مسجلة بعد."}
function alertHTML(p,type){let label="",detail="";if(type==="expiry"){const lot=p._alertLot||inventoryLots.filter(item=>String(item.productId)===String(p.id)&&Number(item.storeQty)+Number(item.fridgeQty)>0&&item.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];const expiry=lot?.expiry||p.expiry;const d=daysTo(expiry);label=d<0?"منتهي الصلاحية":d<=7?"خلال 7 أيام":d<=14?"خلال 14 يوماً":"خلال 30 يوماً";detail=`الصلاحية: ${expiry} · ${d<0?`منتهي منذ ${Math.abs(d)} يوم`:`متبقي ${d} يوم`} · الكمية: ${lot?Number(lot.storeQty||0)+Number(lot.fridgeQty||0):Number(p.store||0)+Number(p.fridge||0)}`}else if(type==="unavailable"){label="غير متوفر حالياً";detail="تم تحديد المنتج على أنه غير متوفر؛ أضف الكمية عند استلامها."}else if(type==="store"){label=Number(p.store||0)<=0?"المخزن فارغ":"مخزون المخزن منخفض";detail=`المخزن: ${p.store||0} قطعة · حد التنبيه: ${p.minStore||0}`}else{label="نقص في البراد";detail=`البراد: ${p.fridge||0} / الهدف: ${p.target||0} · المطلوب: ${refill(p)} قطعة`};const action=["store","unavailable"].includes(type)?`<button type="button" class="small-btn" data-restock-alert="${escapeHTML(p.id)}">إضافة كمية للمخزن</button>`:"";return `<div class="alert-card"><div class="card-top"><div><b class="product-name">${escapeHTML(p.name)}</b><div class="subline">${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))}</div></div><span class="tag ${type==="expiry"||type==="unavailable"?"bad":"warn"}">${label}</span></div><div class="subline">${detail}</div>${action}</div>`}
function productImageHTML(p){return p.image?`<img class="product-thumb" src="${p.image}" alt="${escapeHTML(p.name)}">`:`<div class="product-thumb placeholder">▣</div>`}
function renderProducts(){
  const terms=normalizeProductSearch($("productSearch").value).split(/\s+/).filter(Boolean);
  let list=products.filter(product=>{const searchable=productSearchText(product);return terms.every(term=>searchable.includes(term))});
  if(currentFilter==="low")list=list.filter(low);
  if(currentFilter==="fixed")list=list.filter(p=>p.locationType==="fixed");
  if(currentFilter==="variable")list=list.filter(p=>p.locationType==="variable");
  $("productList").className=list.length?"stack product-grid":"stack empty-state";
  $("productList").innerHTML=list.length?list.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(p=>`<article class="product-card" data-product-card="${escapeHTML(p.id)}" tabindex="0" aria-label="فتح تفاصيل ${escapeHTML(p.name)}">
    <div class="card-top"><div class="product-main">${productImageHTML(p)}<div><div class="product-name">${escapeHTML(p.name)}</div><div class="subline">${escapeHTML([p.brand,p.flavor,p.size].filter(Boolean).join(" · "))}</div><div class="subline">${p.barcode?`باركود: ${escapeHTML(p.barcode)}`:"بدون باركود"}</div><div class="product-price">${escapeHTML(formatPrice(p.price))}</div></div></div><button class="small-btn" data-edit="${escapeHTML(p.id)}">تعديل</button></div>
    <div><span class="tag">${p.locationType==="fixed"?"موقع ثابت":"موقع متغير"}</span><span class="tag">${p.shelf==="2"?"الرف الثاني":"الرف الأول"} · ${escapeHTML(p.location||"غير محدد")}</span>${low(p)?'<span class="tag warn">نقص في البراد</span>':""}${storeLow(p)?'<span class="tag bad">مخزون المخزن منخفض</span>':""}</div>
    <div class="qty-grid"><div class="qty-box"><small>البراد</small><b>${p.fridge||0}</b></div><div class="qty-box"><small>المخزن</small><b>${p.store||0}</b></div><div class="qty-box"><small>هدف البراد</small><b>${p.target||0}</b></div></div>
    <div class="card-actions"><button class="small-btn" data-move="${escapeHTML(p.id)}">تسجيل حركة</button><button class="small-btn" data-show-barcode="${escapeHTML(p.id)}">عرض الباركود</button><button class="small-btn delete" data-delete="${escapeHTML(p.id)}">حذف</button></div></article>`).join(""):"لا توجد نتائج مطابقة."
}
function renderReplenish(){const list=products.filter(p=>refill(p)>0).sort((a,b)=>String(a.shelf||"1").localeCompare(String(b.shelf||"1"))||String(a.location||"ZZ").localeCompare(String(b.location||"ZZ")));$("replenishItems").textContent=list.length;$("replenishUnits").textContent=list.reduce((s,p)=>s+refill(p),0);$("shortageUnits").textContent=list.reduce((s,p)=>s+shortage(p),0);$("replenishList").className=list.length?"stack":"stack empty-state";$("replenishList").innerHTML=list.length?list.map(p=>`<article class="task-card"><div class="task-row"><input type="checkbox" data-task="${p.id}" ${availableToMove(p)===0?"disabled":""}><div class="task-info"><b>${escapeHTML(p.name)}</b><small>${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))} · ${escapeHTML(p.location||"موقع غير محدد")} · ${p.shelf==="2"?"الرف الثاني":"الرف الأول"}</small><small>المطلوب: ${refill(p)} قطعة · المتوفر بالمخزن: ${p.store||0} قطعة · يمكن نقله: ${availableToMove(p)} قطعة</small>${shortage(p)>0?`<small style="color:#d34d55;font-weight:700">عجز بالمخزن: ${shortage(p)} قطعة</small>`:""}</div><div class="task-qty ${shortage(p)>0?"short":""}">+${availableToMove(p)}</div></div></article>`).join(""):"لا توجد نواقص حالياً."}
function renderMovementOptions(){const val=$("movementProduct").value;$("movementProduct").innerHTML='<option value="">اختر المنتج</option>'+products.map(p=>`<option value="${p.id}">${escapeHTML(p.name)} — البراد ${p.fridge||0} · المخزن ${p.store||0}</option>`).join("");if(products.some(p=>p.id===val))$("movementProduct").value=val}
function renderHistory(){$("movementHistory").className=movements.length?"stack":"stack empty-state";$("movementHistory").innerHTML=movements.slice(0,30).map(m=>`<div class="history-card"><div><b>${escapeHTML(m.productName)}</b><small>${escapeHTML(m.label)} · ${new Date(m.time).toLocaleString("ar-IQ")}${m.shelfName?" · "+escapeHTML(m.shelfName):""}${m.sectionName?" / "+escapeHTML(m.sectionName):""}${m.note?" · "+escapeHTML(m.note):""}</small></div><strong>${m.qty} قطعة</strong></div>`).join("")||"لا توجد حركات مسجلة."}
function renderAlerts(){const arr=[];products.forEach(p=>{if(unavailable(p))arr.push(alertHTML(p,"unavailable"));if(storeLow(p))arr.push(alertHTML(p,"store"));if(low(p)&&!storeLow(p))arr.push(alertHTML(p,"low"));const lots=inventoryLots.filter(lot=>String(lot.productId)===String(p.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry&&daysTo(lot.expiry)<=30);if(lots.length)lots.sort((a,b)=>a.expiry.localeCompare(b.expiry)).forEach(lot=>arr.push(alertHTML({...p,_alertLot:lot},"expiry")));else if(expiryAlert(p))arr.push(alertHTML(p,"expiry"))});$("alertsList").className=arr.length?"stack":"stack empty-state";$("alertsList").innerHTML=arr.join("")||"لا توجد تنبيهات حالياً."}
function renderMap(){const list=products.filter(p=>String(p.shelf||"1")===String(currentShelf));const slots=Array.from({length:12},(_,i)=>{const code=`R${currentShelf}-${String(i+1).padStart(2,"0")}`;const found=list.filter(p=>p.location===code);return `<div class="slot"><b>${code}</b><small>${found.length?found.map(p=>escapeHTML(p.name)).join("، "):"فارغ / غير مسجل"}</small></div>`});$("mapGrid").innerHTML=slots.join("")}
function showImagePreview(id,src,emptyText){const el=$(id);if(src){el.classList.add("has-image");el.innerHTML=`<img src="${src}" alt="معاينة الصورة"><div class="image-preview-actions"><button type="button" data-crop-image="${id}">قص وتعديل الصورة</button><button type="button" data-remove-image="${id}">حذف الصورة</button></div>`}else{el.classList.remove("has-image");el.innerHTML=`<span>${emptyText}</span>`}}
function setProductImages(p){productImage=p?.image||"";barcodeImage=p?.barcodeImage||"";showImagePreview("pImagePreview",productImage,"لم تتم إضافة صورة المنتج");showImagePreview("pBarcodePreview",barcodeImage,"لم تتم إضافة صورة الباركود")}
function renderBatchFlavorInputs(count,values=[]){
  const container=$("batchFlavorInputs");
  container.replaceChildren(...Array.from({length:count},(_,index)=>{
    const label=document.createElement("label");
    label.className="batch-flavor-item";
    label.append(document.createTextNode(`النكهة ${formatNumber(index+1)}`));
    const input=document.createElement("input");
    input.type="text";
    input.required=true;
    input.maxLength=60;
    input.autocomplete="off";
    input.placeholder="اختر أو اكتب النكهة";
    input.setAttribute("list","batchFlavorOptions");
    input.dataset.batchFlavor="";
    input.value=values[index]||"";
    label.append(input);
    return label;
  }));
}
function updateBatchFlavorOptions(){
  const flavors=[...new Set([...commonFlavors,...savedFlavors(),...products.map(product=>product.flavor)].map(value=>String(value||"").trim()).filter(Boolean))];
  $("batchFlavorOptions").replaceChildren(...flavors.map(flavor=>new Option(flavor,flavor)));
}
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
function openProduct(p){
  $("productForm").reset();
  lastAutofilledBrand="";
  $("productId").value=p?.id||"";
  $("modalTitle").textContent=p?"تعديل منتج":"إضافة مجموعة نكهات";
  $("saveProductBtn").textContent=p?"حفظ المنتج":"حفظ المنتجات";
  $("batchFlavorPanel").classList.toggle("hidden",!!p);
  document.querySelectorAll(".product-single-only").forEach(element=>element.classList.toggle("hidden",!p));
  $("pName").required=!!p;
  $("pBrand").required=!p;
  $("pPrice").required=!p;
  const fields={pName:"name",pBrand:"brand",pFlavor:"flavor",pPrice:"price",pDiscountPrice:"discountPrice",pBarcode:"barcode",pFridge:"fridge",pStore:"store",pAvailability:"availability",pTarget:"target",pMin:"minStore",pCarton:"cartonSize",pShelf:"shelf",pLocation:"location",pLocationType:"locationType",pExpiry:"expiry",pNotes:"notes"};
  Object.entries(fields).forEach(([id,key])=>$(id).value=p?.[key]??({pFridge:0,pStore:0,pAvailability:"available",pTarget:10,pMin:5,pCarton:1,pShelf:"1",pLocationType:"fixed"}[id]??""));
  setProductSize(p?.size);
  $("pBatchCount").value="1";
  $("brandAutofillStatus").textContent="عند اختيار ماركة محفوظة ستُعبأ بياناتها المشتركة تلقائياً.";
  renderBatchFlavorInputs(1);
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
  const input=$("pBatchCount");
  const count=Number(input.value);
  if(!Number.isInteger(count)||count<1||count>30){
    toast("يمكن إضافة من نكهة واحدة إلى 30 نكهة في المرة الواحدة");
    input.value=String(Math.min(30,Math.max(1,Number.isFinite(count)?count:1)));
  }
  const values=[...$("batchFlavorInputs").querySelectorAll("[data-batch-flavor]")].map(element=>element.value);
  renderBatchFlavorInputs(Number(input.value),values);
});
function closeModal(id){$(id).classList.add("hidden");document.body.classList.remove("modal-open")}
function fileToDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
async function compressImage(file){if(!file||!file.type.startsWith("image/"))throw new Error("الملف المختار ليس صورة");const data=await fileToDataURL(file);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=data});const max=1400,scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/jpeg",.78)}
async function handleImageInput(inputId,target){
  const input=$(inputId),file=input.files?.[0];
  if(!file)return;
  try{
    let recognizedBarcode="";
    if(target==="barcode"&&window.decodeBarcodeImage){
      try{recognizedBarcode=await window.decodeBarcodeImage(file)}
      catch(error){console.warn("Could not read barcode from product image",error);toast("تعذر قراءة الرقم تلقائياً؛ يمكنك إدخاله يدوياً")}
    }
    if(recognizedBarcode){
      $("pBarcode").value=recognizedBarcode;
      toast(`تمت قراءة الباركود ${recognizedBarcode} ويمكنك تعديله`);
    }
    const data=await window.cropProductImage(file);
    if(!data)return;
    if(target==="product"){productImage=data;showImagePreview("pImagePreview",productImage,"")}
    else{
      barcodeImage=data;
      showImagePreview("pBarcodePreview",barcodeImage,"");
      if(recognizedBarcode){
        const match=products.find(product=>String(product.barcode||"").trim()===recognizedBarcode);
        if(match)showBarcodeProduct(match);
      }else toast("تم تجهيز صورة الباركود؛ أدخل الرقم يدوياً إذا لم يُقرأ تلقائياً");
    }
    if(target==="product")toast("تم تجهيز الصورة");
  }catch(error){console.error("Image processing failed",error);toast(error.message||"تعذر قراءة الصورة، جرّب صورة أخرى")}
  finally{input.value=""}
}
$("pImageCamera").onchange=()=>handleImageInput("pImageCamera","product");$("pImageGallery").onchange=()=>handleImageInput("pImageGallery","product");$("pBarcodeCamera").onchange=()=>handleImageInput("pBarcodeCamera","barcode");$("pBarcodeGallery").onchange=()=>handleImageInput("pBarcodeGallery","barcode");
document.addEventListener("click",async e=>{
  const crop=e.target.closest("[data-crop-image]");
  if(crop){
    const target=crop.dataset.cropImage==="pBarcodePreview"?"barcode":"product";
    const source=target==="product"?productImage:barcodeImage;
    try{
      const edited=await window.cropProductImage(source);
      if(edited){
        if(target==="product"){productImage=edited;showImagePreview("pImagePreview",productImage,"")}
        else{barcodeImage=edited;showImagePreview("pBarcodePreview",barcodeImage,"")}
      }
    }catch(error){console.error(`Product ${target} image crop failed`,error);toast(error.message||"تعذر قص الصورة")}
    return;
  }
  const remove=e.target.closest("[data-remove-image]");
  if(!remove)return;
  if(remove.dataset.removeImage==="pImagePreview"){productImage="";showImagePreview("pImagePreview","","لم تتم إضافة صورة المنتج")}
  else{barcodeImage="";showImagePreview("pBarcodePreview","","لم تتم إضافة صورة الباركود")}
});
$("productForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const oldId=$("productId").value;
  const old=products.find(product=>product.id===oldId);
  const priceValue=$("pPrice").value.trim();
  const price=priceValue===""?null:Number(priceValue);
  if(priceValue!==""&&(!Number.isFinite(price)||price<0)){toast("أدخل سعراً صحيحاً غير سالب");$("pPrice").focus();return}
  if(!old){
    const brand=$("pBrand").value.trim();
    const count=Number($("pBatchCount").value);
    const flavors=[...$("batchFlavorInputs").querySelectorAll("[data-batch-flavor]")].map(input=>input.value.trim());
    if(!brand)return toast("اكتب اسم العلامة التجارية");
    if(!Number.isInteger(count)||count<1||count>30||flavors.length!==count)return toast("تحقق من عدد النكهات");
    if(flavors.some(flavor=>!flavor))return toast("أدخل اسم كل نكهة");
    if(priceValue===""||price===null)return toast("أدخل سعر البيع لهذه المجموعة");
    const discountValue=$("pDiscountPrice").value.trim();
    const discountPrice=discountValue===""?null:Number(discountValue);
    if(discountValue!==""&&(!Number.isFinite(discountPrice)||discountPrice<0||discountPrice>=price)){
      toast("يجب أن يكون سعر التخفيض أقل من سعر البيع");
      $("pDiscountPrice").focus();
      return;
    }
    const normalizedFlavors=flavors.map(normalizeProductSearch);
    if(new Set(normalizedFlavors).size!==normalizedFlavors.length)return toast("توجد نكهة مكررة في القائمة");
    const size=getProductSize();
    if(size===null)return toast("أدخل حجماً رقمياً أكبر من صفر");
    const brandKey=normalizeProductSearch(brand);
    const sizeKey=normalizeProductSearch(size);
    const duplicate=products.find(product=>normalizeProductSearch(product.brand)===brandKey&&normalizeProductSearch(product.size)===sizeKey&&normalizedFlavors.includes(normalizeProductSearch(product.flavor)));
    if(duplicate)return toast(`النكهة «${duplicate.flavor}» موجودة مسبقاً لهذه الماركة والحجم`);
    const name=$("pName").value.trim()||brand;
    const created=Date.now();
    const newProducts=flavors.map(flavor=>({
      id:uid(),name,brand,flavor,size,price,discountPrice,barcode:"",image:"",barcodeImage:"",
      fridge:0,store:0,availability:"available",target:Number($("pTarget").value)||0,minStore:Number($("pMin").value)||0,cartonSize:Math.max(1,Number($("pCarton").value)||1),
      shelf:$("pShelf").value,section:$("pSection").value,location:$("pLocation").value.trim(),locationType:$("pLocationType").value||"fixed",
      expiry:"",notes:"",created,isDemo:false,needsRefill:false
    }));
    try{await putProductsAtomically(newProducts)}
    catch(error){console.error("Could not save flavor products",error);toast("تعذر حفظ المنتجات؛ لم تتم إضافة المجموعة");return}
    closeModal("productModal");
    await reload();
    toast(`تم حفظ ${formatNumber(newProducts.length)} نكهة مستقلة للماركة ${brand}`);
    return;
  }
  const id=oldId;
  const barcode=$("pBarcode").value.trim();
  const duplicate=barcode&&products.find(p=>p.barcode===barcode&&p.id!==id);
  if(duplicate){toast("هذا الباركود مسجل مسبقاً للمنتج: "+duplicate.name);return}
  const discountValue=$("pDiscountPrice").value.trim();
  const discountPrice=discountValue===""?null:Number(discountValue);
  if(discountValue!==""&&(!Number.isFinite(discountPrice)||discountPrice<0||price===null||discountPrice>=price)){
    toast("يجب أن يكون سعر التخفيض أقل من سعر البيع");
    $("pDiscountPrice").focus();
    return;
  }
  const cartonSize=Math.max(1,Number($("pCarton").value)||1);
  const store=(Number($("pStore").value)||0)*($("pStoreUnit").value==="carton"?cartonSize:1);
  const fridge=(Number($("pFridge").value)||0)*($("pFridgeUnit").value==="carton"?cartonSize:1);
  if(!Number.isSafeInteger(store)||!Number.isSafeInteger(fridge)){toast("الكمية المدخلة أكبر من المسموح");return}
  const flavor=$("pFlavor").value.trim();
  if(flavor&&!savedFlavors().includes(flavor)&&!commonFlavors.includes(flavor)&&!saveFlavor(flavor))return;
  const size=getProductSize();
  if(size===null){toast("أدخل حجماً رقمياً أكبر من صفر");$("pSize").focus();return}
  const p={id,name:$("pName").value.trim(),brand:$("pBrand").value.trim(),flavor,size,price,discountPrice,barcode,image:productImage,barcodeImage,fridge,store,availability:store+fridge>0?"available":$("pAvailability").value,target:+$("pTarget").value,minStore:+$("pMin").value,cartonSize,shelf:$("pShelf").value,section:$("pSection").value,location:$("pLocation").value.trim(),locationType:$("pLocationType").value,expiry:$("pExpiry").value,notes:$("pNotes").value,created:old?.created||Date.now(),isDemo:old?.isDemo||false,needsRefill:old?.needsRefill||false,refillRequest:old?.refillRequest,importBatchId:old?.importBatchId,importFileName:old?.importFileName,importedAt:old?.importedAt};
  const stockChanged=!old?(p.fridge>0||p.store>0):p.fridge!==Number(old.fridge||0)||p.store!==Number(old.store||0);
  if(stockChanged){
    try{await window.saveProductWithInventory(p,old,"المستخدم")}
    catch(error){console.error("Could not save product stock adjustment",error);toast("تعذر حفظ الرصيد؛ لم يتغير المخزون");return}
  }else await put("products",p);
  closeModal("productModal");
  await reload();
  toast("تم حفظ المنتج وصوره");
});
function openProductDetails(product){
  if(!product)return;
  const shelf=shelves.find(item=>String(item.id)===String(product.shelf));
  const section=shelf?.sections?.find(item=>String(item.id)===String(product.section));
  const expiryLot=inventoryLots.filter(lot=>String(lot.productId)===String(product.id)&&Number(lot.storeQty)+Number(lot.fridgeQty)>0&&lot.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  $("productDetailsTitle").textContent=product.name||"تفاصيل المنتج";
  $("productDetailsName").textContent=product.name||"";
  $("productDetailsBrand").textContent=product.brand||"";
  $("productDetailsDescription").textContent=[product.flavor,product.size].filter(Boolean).join(" · ");
  $("productDetailsPrice").textContent=formatPrice(product.price);
  $("productDetailsImage").src=product.image||"icon.svg";
  $("productDetailsImage").alt=product.name?`صورة ${product.name}`:"صورة المنتج";
  $("productDetailsFridge").textContent=String(product.fridge||0);
  $("productDetailsStore").textContent=String(product.store||0);
  $("productDetailsTarget").textContent=String(product.target||0);
  const cartonSize=Math.max(1,Number(product.cartonSize)||1);
  const fridge=Math.max(0,Number(product.fridge)||0);
  const store=Math.max(0,Number(product.store)||0);
  $("productDetailsFridgeBoxes").textContent=`${Math.floor(fridge/cartonSize)} كرتون كامل · ${fridge%cartonSize} قطعة متبقية`;
  $("productDetailsStoreBoxes").textContent=`${Math.floor(store/cartonSize)} كرتون كامل · ${store%cartonSize} قطعة متبقية (${cartonSize} قطعة في الكرتون)`;
  const details=[
    ["سعر التخفيض",product.discountPrice===null||product.discountPrice===undefined||product.discountPrice===""?"لا يوجد":formatPrice(product.discountPrice)],
    ["الباركود",product.barcode||"غير مسجل"],
    ["الموقع",`${window.locationCode?.(product)||`${shelf?.name||"غير محدد"}${section?` · ${section.name}`:""}`}${product.location?` · ${product.location}`:""}`],
    ["أقرب صلاحية",expiryLot?`${expiryLot.expiry} · ${Number(expiryLot.storeQty||0)+Number(expiryLot.fridgeQty||0)} قطعة`:(product.expiry||"غير محددة")],
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
  if(e.target.closest("[data-mark-refill],[data-mark-filled],[data-expand-image],.product-stock-editor"))return;
  if(detail){openProductDetails(products.find(p=>p.id===detail.dataset.productDetail));return}
  if(edit){openProduct(products.find(p=>p.id===edit.dataset.edit));return}
  if(remove&&confirm("هل تريد حذف المنتج؟")){for(const lot of inventoryLots.filter(item=>String(item.productId)===String(remove.dataset.delete)))await del("inventoryLots",lot.id);await del("products",remove.dataset.delete);await reload();toast("تم حذف المنتج");return}
  if(move){go("movement");if(window.selectMovementProduct)window.selectMovementProduct(move.dataset.move);else $("movementProduct").value=move.dataset.move;return}
  if(show){const p=products.find(x=>x.id===show.dataset.showBarcode);if(p){go("scan");$("scanCode").value=p.barcode||"";renderScanResult(p);showBarcodeProduct(p)}return}
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
function closeImageViewer(){$("productImageModal").classList.add("hidden");$("productImageViewer").removeAttribute("src");document.body.classList.remove("modal-open")}
document.querySelectorAll("[data-close-image]").forEach(button=>button.addEventListener("click",closeImageViewer));
$("productImageModal").addEventListener("click",event=>{if(event.target.id==="productImageModal")closeImageViewer()});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));["productModal","productDetailsModal","refillModal","barcodeProductModal"].forEach(id=>$(id).addEventListener("click",event=>{if(event.target.id===id){closeModal(id);if(id==="refillModal")refillModalProduct=null}}));document.addEventListener("keydown",event=>{if(event.key!=="Escape")return;if(!$("productImageModal").classList.contains("hidden")){closeImageViewer();return}if(!$("imageCropModal").classList.contains("hidden")){$("cancelImageCrop").click();return}for(const id of ["refillModal","barcodeProductModal","productDetailsModal","productModal"])if(!$(id).classList.contains("hidden")){closeModal(id);if(id==="refillModal")refillModalProduct=null;break}});
$("productSearch").addEventListener("input",()=>{renderProducts();$("clearProductSearch").classList.toggle("hidden",!$("productSearch").value)});$("clearProductSearch").addEventListener("click",()=>{$("productSearch").value="";$("clearProductSearch").classList.add("hidden");renderProducts();$("productSearch").focus()});document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));renderProducts()});
$("movementUnit").onchange=()=>{$("cartonSizeWrap").style.opacity=$("movementUnit").value==="carton"?"1":".65"};
$("movementForm").addEventListener("submit",async e=>{e.preventDefault();const p=products.find(x=>x.id===$("movementProduct").value);if(!p)return toast("اختر المنتج أولاً");const qty=+$("movementQty").value;if(!Number.isFinite(qty)||qty<1)return toast("أدخل كمية صحيحة");const q=pieceCount(qty,$("movementUnit").value,+$("cartonSize").value||p.cartonSize||1);const type=$("movementType").value;let label="";if(type==="transfer"){if(p.store<q)return toast("الكمية في المخزن غير كافية");p.store-=q;p.fridge+=q;label="نقل إلى البراد"}else if(type==="addStore"){p.store+=q;label="إضافة للمخزن"}else if(type==="removeFridge"){if(p.fridge<q)return toast("الكمية في البراد غير كافية");p.fridge-=q;label="سحب من البراد"}else{const f=prompt("أدخل كمية البراد الفعلية الجديدة بالقطعة:",String(p.fridge));if(f===null)return;const s=prompt("أدخل كمية المخزن الفعلية الجديدة بالقطعة:",String(p.store));if(s===null)return;if(!/^\d+$/.test(f)||!/^\d+$/.test(s))return toast("أدخل أرقاماً صحيحة للجرد");p.fridge=+f;p.store=+s;label="تعديل جرد فعلي"}await put("products",p);await put("movements",{id:uid(),productId:p.id,productName:p.name,qty:q,label,time:Date.now(),note:$("movementNote").value});$("movementQty").value=1;$("movementNote").value="";await reload();toast("تم تحديث المخزون بنجاح")});
$("refreshTasks").onclick=renderReplenish;
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));document.querySelectorAll("[data-action='add-product']").forEach(b=>b.onclick=()=>openProduct());document.querySelectorAll("[data-shelf]").forEach(b=>b.onclick=()=>{currentShelf=+b.dataset.shelf;document.querySelectorAll("[data-shelf]").forEach(x=>x.classList.toggle("active",x===b));renderMap()});
$("addProductBtn").addEventListener("click",()=>openProduct());
function renderScanResult(p){const el=$("scanResult");if(!p){el.className="scan-result panel";el.innerHTML=`<div class="subline">لم نعثر على منتج بهذا الباركود. يمكنك تسجيله الآن كمنتج جديد.</div><button class="primary wide" type="button" data-add-scanned>＋ إضافة هذا الباركود كمنتج</button>`;return}const lot=(inventoryLots||[]).filter(item=>String(item.productId)===String(p.id)&&Number(item.storeQty)+Number(item.fridgeQty)>0&&item.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];const expiry=lot?.expiry||p.expiry;const expiryDays=daysTo(expiry),expiryDetail=!Number.isFinite(expiryDays)?"":expiryDays<0?` · منتهي منذ ${Math.abs(expiryDays)} يوم`:expiryDays===0?" · ينتهي اليوم":` · متبقي ${expiryDays} يوم`,expiryText=expiry?`${escapeHTML(expiry)}${expiryDetail}`:"غير محددة";el.className="scan-result panel";el.innerHTML=`<div class="scan-result-card">${p.image?`<img src="${p.image}" alt="${escapeHTML(p.name)}">`:"<div class='product-thumb placeholder'>▣</div>"}<div class="scan-result-info"><b>${escapeHTML(p.name)}</b><small>${escapeHTML([p.flavor,p.size].filter(Boolean).join(" · "))}</small><div class="scan-highlights"><div class="scan-price"><small>سعر البيع</small><strong>${escapeHTML(formatPrice(p.price))}</strong></div><div class="scan-expiry${Number.isFinite(expiryDays)&&expiryDays<=7?" urgent":""}"><small>تاريخ الصلاحية</small><strong>${expiryText}</strong></div></div><small>الباركود: ${escapeHTML(p.barcode||"غير مسجل")}</small><small>المخزن: ${p.store||0} · البراد: ${p.fridge||0} · الموقع: ${escapeHTML(window.locationCode?.(p)||p.location||"غير محدد")}</small></div></div><div class="card-actions"><button class="small-btn" data-scan-edit="${escapeHTML(p.id)}">تعديل المنتج</button><button class="small-btn" data-scan-move="${escapeHTML(p.id)}">تسجيل حركة</button></div>`}
function showBarcodeProduct(product){
  if(!product)return;
  window.prepareBarcodeAudio?.().then(()=>window.playBarcodeBeep?.());
  const lot=(inventoryLots||[]).filter(item=>String(item.productId)===String(product.id)&&Number(item.storeQty)+Number(item.fridgeQty)>0&&item.expiry).sort((a,b)=>a.expiry.localeCompare(b.expiry))[0];
  $("barcodeProductName").textContent=product.name||"منتج";
  $("barcodeProductBrand").textContent=product.brand||"العلامة التجارية غير محددة";
  $("barcodeProductFlavor").textContent=[product.flavor,product.size].filter(Boolean).join(" · ")||"";
  $("barcodeProductPrice").textContent=formatPrice(product.discountPrice??product.price);
  $("barcodeProductExpiry").textContent=`الصلاحية: ${lot?.expiry||product.expiry||"غير محددة"}`;
  $("barcodeProductDetails").onclick=()=>{closeModal("barcodeProductModal");openProductDetails(product)};
  $("barcodeProductMove").onclick=()=>{closeModal("barcodeProductModal");go("movement");window.selectMovementProduct?.(product.id)};
  $("barcodeProductModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function lookupBarcode(code){const normalized=String(code||"").trim();if(!normalized)return toast("أدخل رقم الباركود أولاً");const p=products.find(x=>String(x.barcode||"").trim()===normalized);renderScanResult(p);if(p)showBarcodeProduct(p);else toast("الباركود غير مسجل في العصائر")}
window.lookupBarcode=lookupBarcode;
$("barcodeLookupForm").addEventListener("submit",e=>{e.preventDefault();lookupBarcode($("scanCode").value)});$("scanResult").addEventListener("click",e=>{const edit=e.target.closest("[data-scan-edit]"),move=e.target.closest("[data-scan-move]"),add=e.target.closest("[data-add-scanned]");if(edit)openProduct(products.find(p=>p.id===edit.dataset.scanEdit));if(move){go("movement");if(window.selectMovementProduct)window.selectMovementProduct(move.dataset.scanMove);else $("movementProduct").value=move.dataset.scanMove}if(add){const code=$("scanCode").value.trim();openProduct();$("pBarcode").value=code}});
async function startScanner(){if(!navigator.mediaDevices?.getUserMedia){$("scannerStatus").textContent="الكاميرا غير متاحة في هذا المتصفح أو أن الموقع ليس HTTPS. أدخل الرقم يدوياً.";return}if(!("BarcodeDetector"in window)){ $("scannerStatus").textContent="ميزة قراءة الباركود بالكاميرا غير مدعومة في هذا المتصفح حالياً. استخدم الإدخال اليدوي، وسيبقى البحث متاحاً.";toast("قارئ الباركود الأصلي غير مدعوم هنا");return}try{const supported=typeof BarcodeDetector.getSupportedFormats==="function"?await BarcodeDetector.getSupportedFormats():["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf","qr_code"];const wanted=["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf","qr_code"].filter(x=>supported.includes(x));if(!wanted.length){$("scannerStatus").textContent="لا توجد صيغ باركود مدعومة في هذا المتصفح. أدخل الرقم يدوياً.";return}detector=new BarcodeDetector({formats:wanted});scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});const video=$("scannerVideo");video.srcObject=scanStream;video.classList.remove("hidden");$("startScanBtn").classList.add("hidden");$("stopScanBtn").classList.remove("hidden");$("scannerStatus").textContent="الكاميرا تعمل. وجّهها إلى الباركود وثبّت الهاتف للحظة.";await video.play();scanFrame=requestAnimationFrame(scanLoop)}catch(err){stopScanner();$("scannerStatus").textContent="تعذر تشغيل الكاميرا. تأكد من منح إذن الكاميرا وفتح الموقع عبر HTTPS.";toast("تعذر الوصول إلى الكاميرا")}}
async function scanLoop(){if(!scanStream||scanBusy)return;const video=$("scannerVideo");if(video.readyState>=2){scanBusy=true;try{const codes=await detector.detect(video);if(codes.length&&codes[0].rawValue){const value=codes[0].rawValue;$("scanCode").value=value;stopScanner();lookupBarcode(value);$("scannerStatus").textContent="تم التقاط الباركود: "+value;scanBusy=false;return}}catch(e){}scanBusy=false}scanFrame=requestAnimationFrame(scanLoop)}
function stopScanner(){if(scanFrame)cancelAnimationFrame(scanFrame);scanFrame=0;if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null}const video=$("scannerVideo");if(video){video.pause();video.srcObject=null;video.classList.add("hidden")}if($("startScanBtn"))$("startScanBtn").classList.remove("hidden");if($("stopScanBtn"))$("stopScanBtn").classList.add("hidden");scanBusy=false}
$("startScanBtn").onclick=startScanner;$("stopScanBtn").onclick=()=>{stopScanner();$("scannerStatus").textContent="تم إيقاف الكاميرا."};document.addEventListener("visibilitychange",()=>{if(document.hidden)stopScanner()});
$("exportBtn").onclick=async()=>{const data={version:2,exportedAt:new Date().toISOString(),products:await all("products"),movements:await all("movements")};const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`العصائر-نسخة-احتياطية-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("تم إنشاء النسخة الاحتياطية مع الصور")};
$("importFile").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());if(!Array.isArray(d.products)||!Array.isArray(d.movements))throw Error();if(!confirm("سيتم استبدال البيانات الحالية بالنسخة المستوردة. متابعة؟"))return;for(const p of await all("products"))await del("products",p.id);for(const m of await all("movements"))await del("movements",m.id);for(const p of d.products)await put("products",p);for(const m of d.movements)await put("movements",m);await reload();toast("تم استيراد النسخة الاحتياطية")}catch(err){toast("ملف النسخة الاحتياطية غير صالح أو تالف")}e.target.value=""};
$("clearData").onclick=async()=>{if(!confirm("تحذير: سيتم حذف كل المنتجات والحركات والصور نهائياً من هذا الجهاز. هل أنت متأكد؟"))return;for(const p of await all("products"))await del("products",p.id);for(const m of await all("movements"))await del("movements",m.id);await reload();toast("تم حذف البيانات")};
async function enableNotifications(){if(!("Notification"in window))return toast("هذا المتصفح لا يدعم إشعارات الويب في طريقة الفتح الحالية");const p=await Notification.requestPermission();if(p==="granted"){toast("تم تفعيل الإشعارات عند فتح التطبيق");notifyCurrent()}else toast("لم يتم منح إذن الإشعارات")}
function notifyCurrent(){if(!("Notification"in window)||Notification.permission!=="granted")return;const lowList=products.filter(p=>low(p)||storeLow(p));const unavailableList=products.filter(unavailable);const exp=products.filter(expiryAlert);if(lowList.length||unavailableList.length||exp.length)new Notification("العصائر — تنبيه المخزون",{body:`${lowList.length} منتجات تحتاج متابعة مخزون، و${unavailableList.length} غير متوفرة، و${exp.length} صلاحيتها قريبة أو منتهية.`})}
$("notifyBtn").onclick=enableNotifications;$("enableNotify").onclick=enableNotifications;
(async()=>{db=await openDB();if(window.enhancementsReady)await window.enhancementsReady;await reload();if("serviceWorker"in navigator&&location.protocol!=="file:"){try{await navigator.serviceWorker.register("./sw.js")}catch(e){console.warn("SW",e)}}if("Notification"in window&&Notification.permission==="granted")notifyCurrent()})().catch(e=>{console.error(e);toast("تعذر فتح قاعدة البيانات")});
