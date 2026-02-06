// ================= MAP =================
const map = L.map("map").setView([41.02, 28.78], 12);

// =============== BASEMAPS ==============
const basemaps = {
  osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20 }),
  cartoLight: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 20 }),
  esriSat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20 })
};
let currentBasemap = basemaps.osm;
currentBasemap.addTo(map);

document.querySelectorAll("input[name='basemap']").forEach(radio => {
  radio.addEventListener("change", e => {
    if (currentBasemap) map.removeLayer(currentBasemap);
    currentBasemap = basemaps[e.target.value];
    currentBasemap.addTo(map);
  });
});

// ================== TABS ==================
const tabs = document.querySelectorAll(".tab");
const panels = {
  layers: document.getElementById("tab-layers"),
  basemaps: document.getElementById("tab-basemaps"),
  import: document.getElementById("tab-import")
};
function openTab(key){
  tabs.forEach(b => b.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${key}"]`)?.classList.add("active");
  Object.values(panels).forEach(p => p.classList.remove("active"));
  panels[key]?.classList.add("active");
}
tabs.forEach(btn => btn.addEventListener("click", () => openTab(btn.dataset.tab)));

// ================== STATE ==================
const groupListEl = document.getElementById("groupList");
const newGroupNameEl = document.getElementById("newGroupName");
const addGroupBtn = document.getElementById("addGroupBtn");

const layerStore = {};         // id -> {def, geojson, leaflet, byFid, style}
const groupOrder = [];         // group names in UI order
const groups = {};             // groupName -> [layerId,...]
const importedIds = new Set(); // to clear imports

// ======= Attribute Table UI =======
const attrDrawer = document.getElementById("attrDrawer");
const attrLayerSelect = document.getElementById("attrLayerSelect");
const attrFilter = document.getElementById("attrFilter");
const attrTable = document.getElementById("attrTable");
const attrSub = document.getElementById("attrSub");
const attrCount = document.getElementById("attrCount");
const attrClose = document.getElementById("attrClose");
const attrGoLayers = document.getElementById("attrGoLayers");
const attrClearFilter = document.getElementById("attrClearFilter");
const attrAddField = document.getElementById("attrAddField");
const attrExportCsv = document.getElementById("attrExportCsv");
const attrZoomSel = document.getElementById("attrZoomSel");
const attrClearSel = document.getElementById("attrClearSel");

let activeAttrLayerId = null;
let selectedFeatureKey = null;

// ======= Style Modal UI =======
const styleModal = document.getElementById("styleModal");
const styleTitle = document.getElementById("styleTitle");
const styleClose = document.getElementById("styleClose");
const styleReset = document.getElementById("styleReset");
const styleApply = document.getElementById("styleApply");
const lineColorEl = document.getElementById("lineColor");
const fillColorEl = document.getElementById("fillColor");
const fillOpacityEl = document.getElementById("fillOpacity");
const fillOpacityVal = document.getElementById("fillOpacityVal");
const lineWeightEl = document.getElementById("lineWeight");
const lineWeightVal = document.getElementById("lineWeightVal");
const lineDashEl = document.getElementById("lineDash");
let activeStyleLayerId = null;

// ======= Status =======
const statusbar = document.getElementById("statusbar");
function setStatus(msg){ statusbar.textContent = msg; }

// ================== HELPERS ==================
function safeStr(v){
  if (v === null || v === undefined) return "";
  return String(v);
}

function detectGeomFromGeojson(geojson){
  try{
    const f = geojson?.features?.[0];
    const t = f?.geometry?.type;
    if (!t) return "unknown";
    if (t.includes("Point")) return "point";
    if (t.includes("LineString")) return "line";
    if (t.includes("Polygon")) return "polygon";
  }catch(e){}
  return "unknown";
}

function dashArrayFromType(type){
  if (type === "dash") return "8 6";
  if (type === "dot") return "2 6";
  if (type === "dashdot") return "10 5 2 5";
  return null; // solid
}

function isPolygonGeom(geom){
  return geom === "polygon";
}
function isLineGeom(geom){
  return geom === "line";
}
function isPointGeom(geom){
  return geom === "point";
}

// Leaflet GeoJSON creation with dynamic style
function makeLeafletGeoJsonLayer(layerId){
  const item = layerStore[layerId];
  const { geojson } = item;

  const geom = item.def.geom || detectGeomFromGeojson(geojson);
  item.def.geom = geom;

  const style = item.style;

  const leaflet = L.geoJSON(geojson, {
    style: () => ({
      color: style.lineColor,
      weight: style.weight,
      dashArray: dashArrayFromType(style.dash),
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity
    }),
    pointToLayer: (f, latlng) => {
      // point style: circleMarker
      return L.circleMarker(latlng, {
        radius: 6,
        color: style.lineColor,
        weight: Math.max(1, style.weight),
        fillColor: style.fillColor || style.lineColor,
        fillOpacity: 0.9
      });
    },
    onEachFeature: (f, l) => {
      const fid = f?.properties?._fid ?? null;
      if (fid !== null) item.byFid[fid] = l;

      l.on("click", () => {
        // click on map -> select in attribute table (if open)
        if (activeAttrLayerId === layerId) {
          selectedFeatureKey = `${layerId}::${fid}`;
          renderAttributeTable(layerId);
        }
      });

      if (f.properties) {
        l.bindPopup(
          Object.entries(f.properties)
            .filter(([k]) => k !== "_fid")
            .map(([k, v]) => `<b>${k}</b>: ${safeStr(v)}`)
            .join("<br>")
        );
      }
    }
  });

  return leaflet;
}

function applyStyleToLeaflet(layerId){
  const item = layerStore[layerId];
  if (!item?.leaflet) return;
  const s = item.style;

  // Update vector styles
  item.leaflet.setStyle && item.leaflet.setStyle({
    color: s.lineColor,
    weight: s.weight,
    dashArray: dashArrayFromType(s.dash),
    fillColor: s.fillColor,
    fillOpacity: s.fillOpacity
  });

  // Update circleMarkers too
  item.leaflet.eachLayer(l => {
    if (l instanceof L.CircleMarker) {
      l.setStyle({
        color: s.lineColor,
        weight: Math.max(1, s.weight),
        fillColor: s.fillColor || s.lineColor,
        fillOpacity: 0.9
      });
    }
  });
}

// ================== GROUP UI ==================
function ensureGroup(name){
  if (!groups[name]) groups[name] = [];
  if (!groupOrder.includes(name)) groupOrder.push(name);
}

function rebuildGroupsUI(){
  groupListEl.innerHTML = "";

  groupOrder.forEach(groupName => {
    const card = document.createElement("div");
    card.className = "group-card";

    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `
      <div class="group-title">${groupName}</div>
      <div class="group-actions">
        <button class="pill" data-act="toggleAll">Hepsini Kapat</button>
        <button class="pill" data-act="hide">Gizle</button>
        <button class="pill danger" data-act="delete">Sil</button>
      </div>
    `;

    const drop = document.createElement("div");
    drop.className = "group-drop";
    drop.dataset.group = groupName;

    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      const layerId = e.dataTransfer.getData("text/layerId");
      if (!layerId) return;
      moveLayerToGroup(layerId, groupName);
    });

    // head actions
    head.querySelector('[data-act="hide"]').addEventListener("click", () => {
      drop.classList.toggle("hidden");
    });

    head.querySelector('[data-act="delete"]').addEventListener("click", () => {
      // delete group only if empty
      if ((groups[groupName] || []).length > 0) {
        alert("Önce gruptaki katmanları başka bir gruba taşı.");
        return;
      }
      delete groups[groupName];
      const idx = groupOrder.indexOf(groupName);
      if (idx >= 0) groupOrder.splice(idx, 1);
      rebuildGroupsUI();
      refreshAttrLayerSelect();
    });

    const toggleAllBtn = head.querySelector('[data-act="toggleAll"]');
    toggleAllBtn.addEventListener("click", () => {
      const ids = groups[groupName] || [];
      if (!ids.length) return;

      // if any visible -> close all, else open all
      const anyVisible = ids.some(id => map.hasLayer(layerStore[id]?.leaflet));
      ids.forEach(id => {
        const item = layerStore[id];
        if (!item?.leaflet) return;
        if (anyVisible) map.removeLayer(item.leaflet);
        else map.addLayer(item.leaflet);
        // checkbox sync
        const cb = document.querySelector(`input[data-layercheck="${id}"]`);
        if (cb) cb.checked = !anyVisible;
      });

      toggleAllBtn.textContent = anyVisible ? "Hepsini Aç" : "Hepsini Kapat";
    });

    card.appendChild(head);
    card.appendChild(drop);
    groupListEl.appendChild(card);

    // rows
    (groups[groupName] || []).forEach(layerId => {
      const row = buildLayerRow(layerId);
      drop.appendChild(row);
    });
  });
}

function moveLayerToGroup(layerId, newGroup){
  // remove from current group
  Object.keys(groups).forEach(g => {
    const idx = groups[g].indexOf(layerId);
    if (idx >= 0) groups[g].splice(idx, 1);
  });
  ensureGroup(newGroup);
  groups[newGroup].push(layerId);

  layerStore[layerId].def.group = newGroup;
  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

function geomIconClass(geom){
  if (geom === "point") return "geom-icon point";
  if (geom === "line") return "geom-icon line";
  if (geom === "polygon") return "geom-icon poly";
  return "geom-icon";
}

function buildLayerRow(layerId){
  const item = layerStore[layerId];
  const def = item.def;

  const row = document.createElement("div");
  row.className = "layer-row";
  row.draggable = true;

  row.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/layerId", layerId);
  });

  row.innerHTML = `
    <div class="layer-left">
      <input class="layer-check" data-layercheck="${layerId}" type="checkbox" ${map.hasLayer(item.leaflet) ? "checked": ""}/>
      <span class="${geomIconClass(def.geom)}"></span>
      <span class="swatch" style="background:${item.style.lineColor}"></span>
      <span class="layer-name" title="${def.name}">${def.name}</span>
    </div>

    <div class="layer-right">
      <div class="dropdown">
        <button class="morebtn" title="İşlemler">⋯</button>
        <div class="menu hidden">
          <button data-act="style"><span>🎨 Stil</span><small>çizgi/dolgu</small></button>
          <button data-act="attr"><span>▦ Öznitelik</span><small>tablo</small></button>
          <button data-act="zoom"><span>⤢ Katmana Git</span><small>zoom</small></button>
        </div>
      </div>
    </div>
  `;

  // checkbox
  const cb = row.querySelector(".layer-check");
  cb.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(item.leaflet);
    else map.removeLayer(item.leaflet);
  });

  // dropdown
  const dd = row.querySelector(".dropdown");
  const moreBtn = dd.querySelector(".morebtn");
  const menu = dd.querySelector(".menu");

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".menu").forEach(m => { if (m !== menu) m.classList.add("hidden"); });
    menu.classList.toggle("hidden");
  });

  // menu actions
  menu.querySelector('[data-act="style"]').addEventListener("click", () => {
    menu.classList.add("hidden");
    openStyleModal(layerId);
  });
  menu.querySelector('[data-act="attr"]').addEventListener("click", () => {
    menu.classList.add("hidden");
    openAttributeTable(layerId);
  });
  menu.querySelector('[data-act="zoom"]').addEventListener("click", () => {
    menu.classList.add("hidden");
    const b = item.leaflet.getBounds?.();
    if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] });
  });

  return row;
}

// click outside closes menus
document.addEventListener("click", () => {
  document.querySelectorAll(".menu").forEach(m => m.classList.add("hidden"));
});

// ================== LOAD LAYERS ==================
function initLayer(def, geojson, isImported=false){
  // assign stable fid
  let fid = 0;
  geojson.features = geojson.features || [];
  geojson.features.forEach(f => {
    f.properties = f.properties || {};
    if (f.properties._fid === undefined) f.properties._fid = fid++;
  });

  layerStore[def.id] = {
    def: {
      id: def.id,
      name: def.name,
      group: def.group || (isImported ? "İçe Aktarılanlar" : "Genel"),
      geom: def.geom || detectGeomFromGeojson(geojson)
    },
    geojson,
    byFid: {},
    style: {
      lineColor: def.color || "#2563eb",
      fillColor: def.fillColor || (def.color || "#2563eb"),
      fillOpacity: (def.fillOpacity ?? 0.2),
      weight: (def.weight ?? 2),
      dash: (def.dash ?? "solid")
    },
    leaflet: null,
    isImported
  };

  const item = layerStore[def.id];
  item.leaflet = makeLeafletGeoJsonLayer(def.id);

  ensureGroup(item.def.group);
  groups[item.def.group].push(def.id);

  // add to map
  map.addLayer(item.leaflet);

  // first fit
  if (!window.__didFit) {
    const b = item.leaflet.getBounds?.();
    if (b && b.isValid()) {
      window.__didFit = true;
      map.fitBounds(b, { padding:[20,20] });
    }
  }

  rebuildGroupsUI();
  refreshAttrLayerSelect();
}

fetch("data/layers.json")
  .then(r => r.json())
  .then(defs => Promise.all(defs.map(async def => {
    const geojson = await fetch(`data/${def.file}`).then(r => r.json());
    initLayer(def, geojson, false);
  })))
  .catch(err => console.error("layers.json okunamadı:", err));

// ================== TOOLBAR ==================
document.getElementById("zoomToAll").onclick = () => {
  const group = L.featureGroup(Object.values(layerStore).map(x => x.leaflet));
  if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding:[20,20] });
};

// ================== IMPORT ==================
document.getElementById("geojsonFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const geojson = JSON.parse(await file.text());
    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#2563eb" }, geojson, true);
    e.target.value = "";
  }catch(err){
    console.error(err);
    alert("GeoJSON okunamadı.");
  }
});

document.getElementById("shpZipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const arrayBuffer = await file.arrayBuffer();
    const geojson = await shp(arrayBuffer);
    const id = `import_${Date.now()}`;
    importedIds.add(id);
    initLayer({ id, name: file.name, group: "İçe Aktarılanlar", color:"#16a34a" }, geojson, true);
    e.target.value = "";
  }catch(err){
    console.error(err);
    alert("Shapefile ZIP okunamadı.");
  }
});

document.getElementById("clearImports").onclick = () => {
  for (const id of importedIds) {
    const item = layerStore[id];
    if (!item) continue;
    map.removeLayer(item.leaflet);
    // remove from group arrays
    Object.keys(groups).forEach(g => {
      const idx = groups[g].indexOf(id);
      if (idx >= 0) groups[g].splice(idx, 1);
    });
    delete layerStore[id];
  }
  importedIds.clear();
  rebuildGroupsUI();
  refreshAttrLayerSelect();
};

// ================== GROUP CREATE ==================
addGroupBtn.addEventListener("click", () => {
  const name = (newGroupNameEl.value || "").trim();
  if (!name) return;
  ensureGroup(name);
  rebuildGroupsUI();
  refreshAttrLayerSelect();
  newGroupNameEl.value = "";
});

// ================== STYLE MODAL ==================
function openStyleModal(layerId){
  activeStyleLayerId = layerId;
  const item = layerStore[layerId];
  if (!item) return;

  styleTitle.textContent = item.def.name;

  lineColorEl.value = item.style.lineColor;
  fillColorEl.value = item.style.fillColor;

  fillOpacityEl.value = item.style.fillOpacity;
  fillOpacityVal.textContent = Number(item.style.fillOpacity).toFixed(2);

  lineWeightEl.value = item.style.weight;
  lineWeightVal.textContent = String(item.style.weight);

  lineDashEl.value = item.style.dash;

  styleModal.classList.remove("hidden");
}

styleClose.addEventListener("click", () => styleModal.classList.add("hidden"));
fillOpacityEl.addEventListener("input", () => fillOpacityVal.textContent = Number(fillOpacityEl.value).toFixed(2));
lineWeightEl.addEventListener("input", () => lineWeightVal.textContent = String(lineWeightEl.value));

styleReset.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId];
  if (!item) return;
  // back to layer.json defaults (approx)
  item.style.lineColor = "#2563eb";
  item.style.fillColor = "#2563eb";
  item.style.fillOpacity = 0.2;
  item.style.weight = 2;
  item.style.dash = "solid";
  openStyleModal(activeStyleLayerId);
});

styleApply.addEventListener("click", () => {
  const item = layerStore[activeStyleLayerId];
  if (!item) return;

  item.style.lineColor = lineColorEl.value;
  item.style.fillColor = fillColorEl.value;
  item.style.fillOpacity = Number(fillOpacityEl.value);
  item.style.weight = Number(lineWeightEl.value);
  item.style.dash = lineDashEl.value;

  applyStyleToLeaflet(activeStyleLayerId);

  // update swatch in sidebar row
  document.querySelectorAll(`input[data-layercheck="${activeStyleLayerId}"]`).forEach(cb => {
    const row = cb.closest(".layer-row");
    const sw = row?.querySelector(".swatch");
    if (sw) sw.style.background = item.style.lineColor;
  });

  styleModal.classList.add("hidden");
});

// ================== ATTRIBUTE TABLE ==================
function refreshAttrLayerSelect(){
  const ids = Object.keys(layerStore);
  const current = attrLayerSelect.value || activeAttrLayerId;

  attrLayerSelect.innerHTML = "";
  ids.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = layerStore[id].def.name;
    attrLayerSelect.appendChild(opt);
  });

  if (current && layerStore[current]) attrLayerSelect.value = current;
}

function openAttributeTable(layerId){
  activeAttrLayerId = layerId;

  refreshAttrLayerSelect();
  attrLayerSelect.value = layerId;

  attrFilter.value = "";
  selectedFeatureKey = null;

  renderAttributeTable(layerId);
  attrDrawer.classList.remove("hidden");
}

function closeAttributeTable(){
  activeAttrLayerId = null;
  selectedFeatureKey = null;
  attrDrawer.classList.add("hidden");
}

attrClose.addEventListener("click", closeAttributeTable);

attrGoLayers.addEventListener("click", () => {
  openTab("layers");
});

attrLayerSelect.addEventListener("change", () => {
  activeAttrLayerId = attrLayerSelect.value;
  selectedFeatureKey = null;
  renderAttributeTable(activeAttrLayerId);
});

attrClearFilter.addEventListener("click", () => {
  attrFilter.value = "";
  renderAttributeTable(activeAttrLayerId);
});

attrFilter.addEventListener("input", () => {
  renderAttributeTable(activeAttrLayerId);
});

attrClearSel.addEventListener("click", () => {
  selectedFeatureKey = null;
  renderAttributeTable(activeAttrLayerId);
});

attrZoomSel.addEventListener("click", () => {
  if (!selectedFeatureKey) return;
  const [lid, fidStr] = selectedFeatureKey.split("::");
  const fid = Number(fidStr);
  const item = layerStore[lid];
  const lyr = item?.byFid?.[fid];
  if (!lyr) return;
  const b = lyr.getBounds?.();
  if (b && b.isValid()) map.fitBounds(b, { padding:[20,20] });
  else if (lyr.getLatLng) map.setView(lyr.getLatLng(), Math.max(map.getZoom(), 16));
});

function parseFilterExpr(expr){
  // supports "col=value" OR plain "search"
  const s = (expr || "").trim();
  if (!s) return { type:"none" };
  const eq = s.indexOf("=");
  if (eq > 0) {
    const col = s.slice(0, eq).trim();
    const val = s.slice(eq+1).trim();
    return { type:"eq", col, val };
  }
  return { type:"search", q:s.toLowerCase() };
}

function getAllColumns(features){
  const set = new Set();
  features.forEach(f => {
    Object.keys(f.properties || {}).forEach(k => {
      if (k !== "_fid") set.add(k);
    });
  });
  return Array.from(set);
}

function featurePassesFilter(f, filter){
  const props = f.properties || {};
  if (filter.type === "none") return true;
  if (filter.type === "eq") {
    const v = safeStr(props[filter.col]);
    return v.toLowerCase().includes(filter.val.toLowerCase());
  }
  if (filter.type === "search") {
    const q = filter.q;
    return Object.entries(props).some(([k,v]) => {
      if (k === "_fid") return false;
      return safeStr(v).toLowerCase().includes(q);
    });
  }
  return true;
}

function renderAttributeTable(layerId){
  const item = layerStore[layerId];
  if (!item) return;

  const all = item.geojson.features || [];
  const filter = parseFilterExpr(attrFilter.value);
  const rows = all.filter(f => featurePassesFilter(f, filter));

  const cols = getAllColumns(rows.length ? rows : all);

  attrSub.textContent = `${item.def.name} • ${rows.length}/${all.length} kayıt`;
  attrCount.textContent = `${rows.length} kayıt`;

  // build table
  const thead = `
    <thead>
      <tr>
        <th style="width:42px;">#</th>
        ${cols.map(c => `<th>${c}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbodyRows = rows.map((f, idx) => {
    const fid = f.properties?._fid;
    const key = `${layerId}::${fid}`;
    const selClass = (selectedFeatureKey === key) ? "selected" : "";
    return `
      <tr class="${selClass}" data-fid="${fid}">
        <td>${idx+1}</td>
        ${cols.map(c => `<td title="${safeStr(f.properties?.[c])}">${safeStr(f.properties?.[c])}</td>`).join("")}
      </tr>
    `;
  }).join("");

  attrTable.innerHTML = thead + `<tbody>${tbodyRows}</tbody>`;

  // row click select + pan
  attrTable.querySelectorAll("tbody tr").forEach(tr => {
    tr.addEventListener("click", () => {
      const fid = Number(tr.dataset.fid);
      selectedFeatureKey = `${layerId}::${fid}`;
      // highlight in map
      const lyr = item.byFid?.[fid];
      if (lyr) {
        try{ lyr.openPopup?.(); }catch(e){}
      }
      renderAttributeTable(layerId);
    });
  });
}

attrAddField.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value;
  const item = layerStore[layerId];
  if (!item) return;

  const name = prompt("Yeni kolon adı (örn: status):");
  if (!name) return;

  const defVal = prompt("Varsayılan değer (boş bırakılabilir):", "") ?? "";

  // add to all features
  item.geojson.features.forEach(f => {
    f.properties = f.properties || {};
    if (f.properties[name] === undefined) f.properties[name] = defVal;
  });

  // refresh table
  renderAttributeTable(layerId);
});

function toCsv(rows, cols){
  const esc = (v) => {
    const s = safeStr(v);
    // quote if contains comma, quote or newline
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const header = cols.map(esc).join(",");
  const body = rows.map(f => cols.map(c => esc(f.properties?.[c])).join(",")).join("\n");
  return header + "\n" + body;
}

attrExportCsv.addEventListener("click", () => {
  const layerId = activeAttrLayerId || attrLayerSelect.value;
  const item = layerStore[layerId];
  if (!item) return;

  const all = item.geojson.features || [];
  const filter = parseFilterExpr(attrFilter.value);
  const rows = all.filter(f => featurePassesFilter(f, filter));
  const cols = getAllColumns(rows.length ? rows : all);

  const csv = toCsv(rows, cols);
  const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${item.def.name}_attribute_table.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// ================== TOOLBOX (basic stub) ==================
const toolbox = document.getElementById("toolbox");
const toolsBtn = document.getElementById("toolsBtn");
const toolboxClose = document.getElementById("toolboxClose");
const toolboxBody = document.getElementById("toolboxBody");
const toolStatus = document.getElementById("toolStatus");

toolsBtn.addEventListener("click", () => {
  toolbox.classList.toggle("hidden");
});
toolboxClose.addEventListener("click", () => toolbox.classList.add("hidden"));

function renderToolbox(){
  toolboxBody.innerHTML = `
    <div class="tb-group">
      <button class="tb-group-head"><span class="caret">▾</span> Ölçüm</button>
      <div class="tb-items">
        <button class="tb-item" data-tool="measureDistance"><span class="tb-ico">📏</span><span class="tb-text">Mesafe Ölç</span></button>
        <button class="tb-item" data-tool="measureArea"><span class="tb-ico">📐</span><span class="tb-text">Alan Ölç</span></button>
        <button class="tb-item" data-tool="clearToolDraw" class="danger"><span class="tb-ico">🧹</span><span class="tb-text">Araç Çizimlerini Temizle</span></button>
      </div>
    </div>

    <div class="tb-group">
      <button class="tb-group-head"><span class="caret">▾</span> Yeni Katman</button>
      <div class="tb-items">
        <div class="tb-form">
          <label class="tb-label">Katman adı</label>
          <input id="newEditLayerName" class="tb-input" placeholder="örn: test"/>

          <label class="tb-label">Geometri tipi</label>
          <select id="newEditGeom" class="tb-select">
            <option value="point">Nokta</option>
            <option value="line">Çizgi</option>
            <option value="polygon">Poligon</option>
          </select>

          <button id="createEditLayerBtn" class="btn primary tb-create">Oluştur</button>
          <div class="tb-mini">Oluşturduktan sonra Katmanlar sekmesinde görünecek.</div>
        </div>
      </div>
    </div>
  `;

  const caretButtons = toolboxBody.querySelectorAll(".tb-group-head");
  caretButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const items = btn.parentElement.querySelector(".tb-items");
      items.classList.toggle("hidden");
      btn.querySelector(".caret").textContent = items.classList.contains("hidden") ? "▸" : "▾";
    });
  });

  toolboxBody.querySelectorAll(".tb-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tool;
      toolStatus.textContent = `Seçildi: ${t}`;
      setStatus(`Araç: ${t}`);
      // ölçüm/draw mantığını senin önceki tool koduna bağlaman gerekir.
      // Burada sadece UI iskeleti bırakıyorum.
      if (t === "clearToolDraw") {
        alert("Ölçüm çizimleri temizleme: önceki ölçüm katmanını burada temizleyeceğiz.");
      } else {
        alert(`Araç seçildi: ${t} (ölçüm/draw kodunu buraya bağlayacağız)`);
      }
    });
  });

  const createBtn = toolboxBody.querySelector("#createEditLayerBtn");
  createBtn.addEventListener("click", () => {
    const name = (toolboxBody.querySelector("#newEditLayerName").value || "").trim();
    const geom = toolboxBody.querySelector("#newEditGeom").value;
    if (!name) { alert("Katman adı gir."); return; }

    // create empty geojson
    const id = `edit_${Date.now()}`;
    const geojson = { type:"FeatureCollection", features:[] };
    initLayer({
      id,
      name,
      group: "İçe Aktarılanlar",
      geom,
      color: "#2563eb",
      fillColor: "#2563eb",
      fillOpacity: 0.2,
      weight: 2,
      dash: "solid"
    }, geojson, true);

    // go to layers tab + close toolbox
    openTab("layers");
    toolbox.classList.add("hidden");
  });
}
renderToolbox();
