(() => {
  "use strict";

  const SEED_RECORDS = Array.isArray(window.FLAVOR_SEED_RECORDS) ? window.FLAVOR_SEED_RECORDS : [];
  const API_BASE = String(window.FLAVOR_API_BASE || "api").replace(/\/+$/, "");
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const LOCAL_RECORDS_KEY = "flavor-atlas-local-records-v1";
  const AUTHOR_KEY = "flavor-atlas-author";
  const $ = (id) => document.getElementById(id);

  const dom = {
    welcomeView: $("welcomeView"),
    mapView: $("mapView"),
    chooseQuery: $("chooseQuery"),
    chooseRecord: $("chooseRecord"),
    brandHome: $("brandHome"),
    modePill: $("modePill"),
    modePillText: $("modePillText"),
    modeNoteLabel: $("modeNoteLabel"),
    modeNoteText: $("modeNoteText"),
    modeNote: $("modeNote"),
    mapTitle: $("mapTitle"),
    mapKicker: $("mapKicker"),
    mapSubtitle: $("mapSubtitle"),
    mapCueText: $("mapCueText"),
    mapIndex: $("mapIndex"),
    mapLevelText: $("mapLevelText"),
    mapLoading: $("mapLoading"),
    mapCanvas: $("chinaMap"),
    mapFrame: document.querySelector(".map-frame"),
    breadcrumbRoot: $("breadcrumbRoot"),
    breadcrumbCurrent: $("breadcrumbCurrent"),
    backButton: $("backButton"),
    regionIndex: $("regionIndex"),
    regionIndexList: $("regionIndexList"),
    regionIndexCount: $("regionIndexCount"),
    statRecords: $("statRecords"),
    statRegions: $("statRegions"),
    zoomIn: $("zoomIn"),
    zoomOut: $("zoomOut"),
    resetMap: $("resetMap"),
    drawer: $("regionDrawer"),
    drawerScrim: $("drawerScrim"),
    closeDrawer: $("closeDrawer"),
    regionTitle: $("regionTitle"),
    drawerCount: $("drawerCount"),
    drawerMeta: $("drawerMeta"),
    drawerNotice: $("drawerNotice"),
    recordList: $("recordList"),
    recordFab: $("recordFab"),
    recordDialog: $("recordDialog"),
    closeRecordDialog: $("closeRecordDialog"),
    cancelRecord: $("cancelRecord"),
    recordForm: $("recordForm"),
    recordRegionName: $("recordRegionName"),
    photoInput: $("photoInput"),
    uploadDropzone: $("uploadDropzone"),
    uploadEmpty: $("uploadEmpty"),
    uploadPreview: $("uploadPreview"),
    uploadPreviewImage: $("uploadPreviewImage"),
    uploadPreviewMeta: $("uploadPreviewMeta"),
    uploadProcessing: $("uploadProcessing"),
    uploadError: $("uploadError"),
    authorInput: $("authorInput"),
    dishNameInput: $("dishNameInput"),
    descriptionInput: $("descriptionInput"),
    descriptionCount: $("descriptionCount"),
    formError: $("formError"),
    submitRecord: $("submitRecord"),
    toastStack: $("toastStack")
  };

  const state = {
    mode: "query",
    view: "welcome",
    level: "country",
    province: null,
    nationalGeo: null,
    geo: null,
    features: [],
    chart: null,
    mapReady: false,
    mapRequestToken: 0,
    selectedRegion: null,
    drawerOpen: false,
    recordRequestToken: 0,
    pendingImage: null,
    imageProcessing: false,
    dialogClosing: false,
    backendAvailable: location.protocol === "http:" || location.protocol === "https:",
    localRecords: loadLocalRecords(),
    stats: { total: 0, regions: 0, byProvince: {} },
    geoCache: new Map()
  };

  function icon(name) {
    return `<i data-lucide="${name}" aria-hidden="true"></i>`;
  }

  function createIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ attrs: { "stroke-width": 1.6 } });
    }
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function loadLocalRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_RECORDS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function persistLocalRecords() {
    try {
      localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(state.localRecords));
      return true;
    } catch {
      return false;
    }
  }

  function computeFallbackStats() {
    const records = [...SEED_RECORDS, ...state.localRecords];
    const byProvince = {};
    const regions = new Set();
    records.forEach((record) => {
      regions.add(String(record.regionId));
      byProvince[String(record.provinceId)] = (byProvince[String(record.provinceId)] || 0) + 1;
    });
    return { total: records.length, regions: regions.size, byProvince };
  }

  function renderStats() {
    dom.statRecords.textContent = new Intl.NumberFormat("zh-CN").format(state.stats.total || 0);
    dom.statRegions.textContent = new Intl.NumberFormat("zh-CN").format(state.stats.regions || 0);
  }

  async function refreshStats() {
    if (state.backendAvailable) {
      try {
        const response = await fetch(`${API_BASE}/stats`, { cache: "no-store" });
        if (!response.ok) throw new Error("stats unavailable");
        const data = await response.json();
        state.stats = {
          total: Number(data.total) || 0,
          regions: Number(data.regions) || 0,
          byProvince: data.byProvince || {}
        };
        renderStats();
        return state.stats;
      } catch {
        state.backendAvailable = false;
      }
    }
    state.stats = computeFallbackStats();
    renderStats();
    return state.stats;
  }

  function shortProvinceName(name) {
    return String(name || "")
      .replace(/维吾尔自治区$/, "")
      .replace(/壮族自治区$/, "")
      .replace(/回族自治区$/, "")
      .replace(/特别行政区$/, "")
      .replace(/自治区$/, "")
      .replace(/[省市]$/, "");
  }

  function shortMapLabel(name) {
    return String(name || "").replace(/(特别行政区|自治州|地区|市|盟)$/u, "");
  }

  function formatRecordDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "近日";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date).replace(/\//g, ".");
  }

  function avatarInitial(name) {
    return Array.from(String(name || "味").trim())[0] || "味";
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " is-error" : ""}`;
    toast.innerHTML = `${icon(type === "error" ? "circle-alert" : "check")}<span>${escapeHTML(message)}</span>`;
    dom.toastStack.appendChild(toast);
    createIcons();
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 260);
    }, 3200);
  }

  function switchView(nextView) {
    const enteringMap = nextView === "map";
    state.view = nextView;
    dom.welcomeView.classList.toggle("is-active", !enteringMap);
    dom.mapView.classList.toggle("is-active", enteringMap);
    dom.welcomeView.setAttribute("aria-hidden", String(enteringMap));
    dom.mapView.setAttribute("aria-hidden", String(!enteringMap));
    dom.welcomeView.inert = enteringMap;
    dom.mapView.inert = !enteringMap;
    document.body.classList.toggle("in-map", enteringMap);
  }

  function setMode(mode, options = {}) {
    if (mode !== "query" && mode !== "record") return;
    state.mode = mode;
    document.body.dataset.mode = mode;
    const isQuery = mode === "query";
    dom.modePillText.textContent = isQuery ? "查询" : "记录";
    dom.modePill.setAttribute("aria-label", `当前为${isQuery ? "查询" : "记录"}模式，点击切换模式`);
    const modeIcon = dom.modePill.querySelector(".mode-pill__icon");
    if (modeIcon) modeIcon.innerHTML = icon(isQuery ? "search" : "notebook-pen");
    dom.modeNoteLabel.textContent = isQuery ? "查询模式" : "记录模式";
    dom.modeNoteText.textContent = isQuery ? "只读浏览大家留下的风味档案。" : "走进地区，把刚出锅的这一味留下。";
    dom.mapCueText.textContent = state.level === "province"
      ? (isQuery ? "点开地区，翻阅风味档案" : "选一座城，记下你的这一味")
      : "移动鼠标，选择一方水土";
    createIcons();
    if (state.drawerOpen) {
      updateDrawerModeCopy();
      updateRecordFab();
    }
    if (!options.silent) {
      showToast(`已切换到${isQuery ? "查询" : "记录"}模式`);
    }
  }

  function enterMap(mode) {
    setMode(mode, { silent: true });
    switchView("map");
    if (state.chart) {
      window.setTimeout(() => state.chart && state.chart.resize(), 120);
    } else {
      window.setTimeout(initMap, 90);
    }
  }

  function goHome() {
    if (dom.recordDialog.open) closeRecordDialog(true);
    closeDrawer(true);
    switchView("welcome");
  }

  function setMapLoading(visible, text = "正在铺开这方地图...") {
    dom.mapLoading.hidden = !visible;
    if (visible && text) {
      const label = dom.mapLoading.querySelector("span:last-child");
      if (label) label.textContent = text;
    }
  }

  async function initMap() {
    if (!window.echarts) {
      setMapLoading(true, "地图组件未能加载，请刷新页面");
      return;
    }
    if (!state.chart) {
      state.chart = window.echarts.init(dom.mapCanvas, null, { renderer: "canvas" });
      if (window.ResizeObserver && dom.mapFrame) {
        let resizeTimer = null;
        const observer = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => state.chart && state.chart.resize(), 90);
        });
        observer.observe(dom.mapFrame);
      }
    }
    if (state.mapReady) {
      state.chart.resize();
      return;
    }
    setMapLoading(true, "正在展开全国轮廓...");
    try {
      const geo = await fetchJSON("assets/geo/100000_full.json");
      state.nationalGeo = geo;
      window.echarts.registerMap("flavor-china", geo);
      state.geo = geo;
      state.features = (geo.features || []).filter((feature) => feature.properties && feature.properties.name);
      state.level = "country";
      state.mapReady = true;
      updateMapChrome();
      renderMap();
      setMapLoading(false);
    } catch (error) {
      console.error(error);
      setMapLoading(true, "地图加载失败，请检查本地资源后重试");
      showToast("地图资源加载失败，请刷新重试", "error");
    }
  }

  async function fetchJSON(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  }

  function mapSeriesData(features) {
    return features.map((feature) => ({
      name: feature.properties.name,
      value: 0
    }));
  }

  function renderMap() {
    if (!state.chart || !state.geo || !state.features.length) return;
    const isCountry = state.level === "country";
    const mapName = isCountry ? "flavor-china" : `flavor-province-${state.province.code}`;
    state.chart.setOption({
      animation: true,
      animationDuration: 680,
      animationDurationUpdate: 560,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "item",
        confine: true,
        padding: [10, 13],
        borderWidth: 0,
        backgroundColor: "rgba(31, 54, 43, 0.94)",
        textStyle: {
          color: "#fff8eb",
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
          fontSize: 11,
          lineHeight: 18
        },
        formatter: (params) => {
          if (!params.name) return "";
          return isCountry
            ? `${params.name}\n{tip|点击查看下辖地区}`
            : `${params.name}\n{tip|点击翻开风味档案}`;
        },
        rich: { tip: { color: "rgba(255,248,235,.62)", fontSize: 9, padding: [4, 0, 0] } }
      },
      series: [{
        id: "flavor-map",
        name: isCountry ? "全国风味地图" : `${state.province.name}风味地图`,
        type: "map",
        map: mapName,
        roam: true,
        scaleLimit: { min: 0.7, max: 7 },
        left: isCountry ? "4%" : "7%",
        right: isCountry ? "4%" : "7%",
        top: "4%",
        bottom: "4%",
        selectedMode: false,
        label: {
          show: !isCountry,
          color: "#435549",
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
          fontSize: 10,
          textBorderColor: "rgba(251,246,236,.9)",
          textBorderWidth: 3,
          formatter: (params) => shortMapLabel(params.name)
        },
        itemStyle: {
          areaColor: isCountry ? "rgba(242,231,213,.84)" : "rgba(247,236,218,.9)",
          borderColor: "#46594b",
          borderWidth: isCountry ? 1 : 0.9,
          shadowColor: "rgba(70,89,75,.08)",
          shadowBlur: 10
        },
        emphasis: {
          disabled: false,
          label: { show: true, color: "#8f432b", fontSize: 11, fontWeight: 600 },
          itemStyle: {
            areaColor: "#e7bd97",
            borderColor: "#a84f31",
            borderWidth: 1.2,
            shadowColor: "rgba(168,79,49,.18)",
            shadowBlur: 18
          }
        },
        data: mapSeriesData(state.features)
      }]
    }, true);
    state.chart.off("click");
    state.chart.on("click", handleMapClick);
    state.chart.off("mouseover");
    state.chart.on("mouseover", () => state.chart.getZr().setCursorStyle("pointer"));
    state.chart.off("globalout");
    state.chart.on("globalout", () => state.chart.getZr().setCursorStyle("grab"));
  }

  function handleMapClick(params) {
    if (!params.name) return;
    if (state.level === "country") {
      const feature = state.features.find((item) => item.properties.name === params.name);
      if (feature) selectProvince(feature);
      return;
    }
    if (state.level === "province") {
      openRegion(params.name);
    }
  }

  async function selectProvinceByCode(code) {
    if (!state.nationalGeo) await initMap();
    if (!state.nationalGeo) return false;
    const feature = state.nationalGeo.features.find((item) => String(item.properties?.adcode) === String(code));
    if (!feature) return false;
    await selectProvince(feature);
    return true;
  }

  async function selectProvince(feature) {
    if (!feature || !feature.properties) return;
    const code = String(feature.properties.adcode);
    const name = feature.properties.name;
    const token = ++state.mapRequestToken;
    closeDrawer(true);
    setMapLoading(true, `正在展开${shortProvinceName(name)}地图...`);
    try {
      let geo = state.geoCache.get(code);
      if (!geo) {
        geo = await fetchJSON(`assets/geo/${code}_full.json`);
        state.geoCache.set(code, geo);
      }
      if (token !== state.mapRequestToken) return;
      const features = (geo.features || []).filter((item) => item.properties && item.properties.name);
      if (!features.length) throw new Error("No region features");
      state.level = "province";
      state.province = { code, name };
      state.geo = geo;
      state.features = features;
      window.echarts.registerMap(`flavor-province-${code}`, geo);
      updateMapChrome();
      renderMap();
      setMapLoading(false);
    } catch (error) {
      console.error(error);
      if (token !== state.mapRequestToken) return;
      setMapLoading(false);
      showToast(`${shortProvinceName(name)}地图加载失败，请稍后重试`, "error");
    }
  }

  function goNational() {
    if (state.level === "country" || !state.nationalGeo) return;
    state.mapRequestToken += 1;
    state.level = "country";
    state.province = null;
    state.geo = state.nationalGeo;
    state.features = (state.nationalGeo.features || []).filter((feature) => feature.properties && feature.properties.name);
    closeDrawer(true);
    updateMapChrome();
    renderMap();
    setMapLoading(false);
  }

  function updateMapChrome() {
    const isCountry = state.level === "country";
    dom.mapTitle.classList.add("is-switching");
    window.setTimeout(() => dom.mapTitle.classList.remove("is-switching"), 220);
    if (isCountry) {
      dom.mapKicker.textContent = "CHINA / 全国";
      dom.mapTitle.innerHTML = "山河<br><em>入味</em>";
      dom.mapSubtitle.textContent = "每一格轮廓里，都藏着一方人的日常。选择一座省份，继续向里走。";
      dom.mapCueText.textContent = "移动鼠标，选择一方水土";
      dom.mapIndex.textContent = "FLAVOR MAP / 001";
      dom.mapLevelText.textContent = "全国视图 / 34 个省级行政区";
      dom.breadcrumbCurrent.textContent = "省份";
      dom.breadcrumbRoot.setAttribute("aria-current", "location");
      dom.backButton.classList.add("is-hidden");
      dom.regionIndex.hidden = true;
      return;
    }
    const shortName = shortProvinceName(state.province.name);
    dom.mapKicker.textContent = `PROVINCE / ${state.province.code}`;
    dom.mapTitle.innerHTML = `${escapeHTML(shortName)}<br><em>寻味</em>`;
    dom.mapSubtitle.textContent = `${state.province.name}的风味，散落在 ${state.features.length} 个地区。点开一座城，看看大家留下了什么。`;
    dom.mapCueText.textContent = state.mode === "query" ? "点开地区，翻阅风味档案" : "选一座城，记下你的这一味";
    dom.mapIndex.textContent = `FLAVOR MAP / ${state.province.code}`;
    dom.mapLevelText.textContent = `${state.province.name} / ${state.features.length} 个地区`;
    dom.breadcrumbCurrent.textContent = state.province.name;
    dom.breadcrumbRoot.removeAttribute("aria-current");
    dom.backButton.classList.remove("is-hidden");
    dom.regionIndex.hidden = false;
    renderRegionIndex();
  }

  function renderRegionIndex() {
    if (state.level !== "province") return;
    dom.regionIndexCount.textContent = `${state.features.length} 个地区`;
    dom.regionIndexList.replaceChildren();
    state.features.forEach((feature) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "region-chip";
      button.textContent = feature.properties.name;
      button.dataset.regionName = feature.properties.name;
      dom.regionIndexList.appendChild(button);
    });
  }

  function adjustMapZoom(factor) {
    if (!state.chart) return;
    const option = state.chart.getOption();
    const series = option.series && option.series[0];
    if (!series) return;
    const currentZoom = Number(series.zoom) || 1;
    const nextZoom = Math.min(6, Math.max(0.75, currentZoom * factor));
    state.chart.setOption({ series: [{ zoom: nextZoom }] });
  }

  function resetMapView() {
    if (!state.chart) return;
    state.chart.setOption({ series: [{ zoom: 1, center: null }] });
  }

  function updateDrawerModeCopy() {
    if (!state.drawerOpen) return;
    if (state.mode === "record") {
      dom.drawerNotice.innerHTML = `${icon("notebook-pen")}<span>记录模式 · 点右下角笔形按钮，留下你的这一味。</span>`;
    } else if (state.selectedRegion) {
      const count = dom.drawerCount.textContent.replace(/[^0-9]/g, "") || "0";
      dom.drawerNotice.innerHTML = `${icon("book-open")}<span>查询模式 · 这里收录了 ${count} 份来自大家的风味档案。</span>`;
    }
    createIcons();
  }

  function bindEvents() {
    dom.chooseQuery.addEventListener("click", () => enterMap("query"));
    dom.chooseRecord.addEventListener("click", () => enterMap("record"));
    dom.brandHome.addEventListener("click", goHome);
    dom.modePill.addEventListener("click", () => setMode(state.mode === "query" ? "record" : "query"));
    dom.breadcrumbRoot.addEventListener("click", () => {
      if (state.level === "province") goNational();
    });
    dom.backButton.addEventListener("click", goNational);
    dom.regionIndexList.addEventListener("click", (event) => {
      const target = event.target.closest("[data-region-name]");
      if (target) openRegion(target.dataset.regionName);
    });
    dom.zoomIn.addEventListener("click", () => adjustMapZoom(1.24));
    dom.zoomOut.addEventListener("click", () => adjustMapZoom(0.8));
    dom.resetMap.addEventListener("click", resetMapView);
    dom.drawerScrim.addEventListener("click", () => closeDrawer());
    dom.closeDrawer.addEventListener("click", () => closeDrawer());
    dom.recordFab.addEventListener("click", openRecordDialog);
    dom.closeRecordDialog.addEventListener("click", () => closeRecordDialog());
    dom.cancelRecord.addEventListener("click", () => closeRecordDialog());
    dom.recordDialog.addEventListener("click", (event) => {
      if (event.target === dom.recordDialog) closeRecordDialog();
    });
    dom.recordDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeRecordDialog();
    });
    dom.recordForm.addEventListener("submit", submitRecord);
    dom.descriptionInput.addEventListener("input", () => {
      dom.descriptionCount.textContent = String(dom.descriptionInput.value.length);
    });
    dom.photoInput.addEventListener("change", () => {
      const file = dom.photoInput.files && dom.photoInput.files[0];
      if (file) handlePhoto(file);
    });
    ["dragenter", "dragover"].forEach((type) => {
      dom.uploadDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dom.uploadDropzone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      dom.uploadDropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dom.uploadDropzone.classList.remove("is-dragging");
      });
    });
    dom.uploadDropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) handlePhoto(file);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.drawerOpen && !dom.recordDialog.open) closeDrawer();
    });
    window.addEventListener("resize", () => {
      if (state.chart) window.clearTimeout(window.__flavorResizeTimer), window.__flavorResizeTimer = window.setTimeout(() => state.chart.resize(), 120);
    });
  }

  function init() {
    createIcons();
    bindEvents();
    const savedAuthor = localStorage.getItem(AUTHOR_KEY);
    if (savedAuthor) dom.authorInput.value = savedAuthor;
    refreshStats();
    window.__foodAtlas = {
      enterMap,
      setMode,
      selectProvinceByCode,
      openRegion: (name) => openRegion(name),
      goNational,
      openRecordDialog,
      getState: () => ({
        mode: state.mode,
        view: state.view,
        level: state.level,
        province: state.province,
        selectedRegion: state.selectedRegion,
        drawerOpen: state.drawerOpen,
        stats: state.stats
      })
    };
  }

  function updateRecordFab() {
    const visible = state.mode === "record" && state.drawerOpen && Boolean(state.selectedRegion);
    dom.recordFab.classList.toggle("is-visible", visible);
    dom.recordFab.setAttribute("aria-hidden", String(!visible));
    dom.recordFab.tabIndex = visible ? 0 : -1;
  }

  function setDrawerOpen(open) {
    state.drawerOpen = open;
    dom.drawer.classList.toggle("is-open", open);
    dom.drawer.setAttribute("aria-hidden", String(!open));
    dom.drawer.inert = !open;
    document.body.classList.toggle("drawer-open", open);
    if (!open) {
      dom.drawerScrim.setAttribute("aria-hidden", "true");
      return;
    }
    dom.drawerScrim.setAttribute("aria-hidden", "false");
    window.setTimeout(() => {
      if (state.drawerOpen && !dom.recordDialog.open) {
        dom.closeDrawer.focus({ preventScroll: true });
      }
    }, 520);
  }

  function openRegion(name) {
    if (state.level !== "province" || !state.province) return;
    const feature = state.features.find((item) => item.properties.name === name);
    if (!feature) return;
    const regionId = String(feature.properties.adcode || `${state.province.code}-${name}`);
    state.selectedRegion = {
      id: regionId,
      name,
      provinceId: state.province.code,
      provinceName: state.province.name
    };
    const requestToken = ++state.recordRequestToken;
    dom.regionTitle.textContent = name;
    dom.drawerCount.textContent = "读档中";
    dom.drawerMeta.textContent = `${state.province.name} · 这一方水土的风味档案`;
    dom.drawerNotice.hidden = false;
    dom.drawerNotice.innerHTML = `${icon("book-open")}<span>正在读档，看看大家记住了什么。</span>`;
    dom.recordList.innerHTML = skeletonMarkup();
    setDrawerOpen(true);
    updateRecordFab();
    createIcons();
    if (state.chart) {
      state.chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
      state.chart.dispatchAction({ type: "highlight", seriesIndex: 0, name });
    }
    loadRegionRecords(requestToken);
  }

  function skeletonMarkup() {
    return Array.from({ length: 2 }, () => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-image"></div>
        <div class="skeleton-content">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      </div>`).join("");
  }

  async function loadRegionRecords(token) {
    const region = state.selectedRegion;
    if (!region) return;
    let records = [];
    try {
      if (state.backendAvailable) {
        try {
          const response = await fetch(`${API_BASE}/records?regionId=${encodeURIComponent(region.id)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(`records unavailable: ${response.status}`);
          const data = await response.json();
          records = Array.isArray(data.records) ? data.records : [];
        } catch (error) {
          console.warn("Falling back to local records", error);
          state.backendAvailable = false;
          records = fallbackRecordsForRegion(region.id);
        }
      } else {
        records = fallbackRecordsForRegion(region.id);
      }
    } catch (error) {
      console.error(error);
      records = [];
    }
    if (token !== state.recordRequestToken) return;
    renderRecordList(records);
  }

  function fallbackRecordsForRegion(regionId) {
    return [...state.localRecords, ...SEED_RECORDS]
      .filter((record) => String(record.regionId) === String(regionId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  function renderRecordList(records) {
    if (!state.selectedRegion) return;
    dom.drawerCount.textContent = `${records.length} 味`;
    dom.drawerMeta.textContent = `${state.selectedRegion.provinceName} · ${records.length ? "来自大家的风味档案" : "等待第一份风味档案"}`;
    if (state.mode === "record") {
      dom.drawerNotice.innerHTML = `${icon("notebook-pen")}<span>记录模式 · 点右下角笔形按钮，留下你的这一味。</span>`;
    } else {
      dom.drawerNotice.innerHTML = `${icon("book-open")}<span>查询模式 · 这里收录了 ${records.length} 份来自大家的风味档案。</span>`;
    }

    if (!records.length) {
      dom.recordList.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__mark">${icon("utensils")}</span>
          <h3>${state.mode === "record" ? "这一味，还空着" : "还没有人留下记录"}</h3>
          <p>${state.mode === "record" ? "点右下角的笔形按钮，把刚出锅的这一味留在这里。" : "现在还没有风味档案。切换到记录模式，成为第一个记录它的人。"}</p>
        </div>`;
      createIcons();
      updateRecordFab();
      return;
    }

    dom.recordList.innerHTML = records.map((record, index) => {
      const dishName = record.dishName || record.regionName || "无名好味";
      const author = record.author || "匿名食客";
      return `
        <article class="record-card" style="animation-delay:${Math.min(index * 70, 350)}ms">
          <div class="record-image-wrap">
            <img src="${escapeHTML(record.imageUrl)}" alt="${escapeHTML(dishName)}，${escapeHTML(record.regionName || state.selectedRegion.name)}风味记录" loading="lazy">
            <span class="dish-tag">${escapeHTML(dishName)}</span>
          </div>
          <div class="record-body">
            <p class="record-description">${escapeHTML(record.description || "这一味，值得亲自来尝。")}</p>
            <div class="record-meta">
              <span class="record-author">
                <span class="author-avatar">${escapeHTML(avatarInitial(author))}</span>
                ${escapeHTML(author)}
              </span>
              <time class="record-time" datetime="${escapeHTML(record.createdAt || "")}">
                ${icon("clock-3")}${escapeHTML(formatRecordDate(record.createdAt))}
              </time>
            </div>
          </div>
        </article>`;
    }).join("");
    createIcons();
    updateRecordFab();
  }

  function closeDrawer(immediate = false) {
    if (!state.drawerOpen && !dom.drawer.classList.contains("is-open")) return;
    state.drawerOpen = false;
    state.recordRequestToken += 1;
    dom.drawer.classList.remove("is-open");
    dom.drawer.setAttribute("aria-hidden", "true");
    dom.drawer.inert = true;
    document.body.classList.remove("drawer-open");
    dom.drawerScrim.setAttribute("aria-hidden", "true");
    updateRecordFab();
    if (state.chart) state.chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
    if (immediate) {
      state.selectedRegion = null;
      return;
    }
    window.setTimeout(() => {
      if (!state.drawerOpen) state.selectedRegion = null;
    }, 520);
  }

  function openRecordDialog() {
    if (state.mode !== "record") {
      showToast("查询模式只能浏览，切换到记录模式才能新增", "error");
      return;
    }
    if (!state.selectedRegion) {
      showToast("请先选择一个地区", "error");
      return;
    }
    resetRecordForm();
    dom.recordRegionName.textContent = state.selectedRegion.name;
    state.dialogClosing = false;
    dom.recordDialog.classList.remove("is-closing");
    if (!dom.recordDialog.open) dom.recordDialog.showModal();
    window.setTimeout(() => {
      if (dom.recordDialog.open) dom.authorInput.focus({ preventScroll: true });
    }, 120);
  }

  function closeRecordDialog(immediate = false) {
    if (!dom.recordDialog.open || state.dialogClosing) return;
    if (state.savingRecord && !immediate) {
      showToast("正在存入味册，请稍候");
      return;
    }
    state.imageRequestToken = (state.imageRequestToken || 0) + 1;
    state.imageProcessing = false;
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dom.recordDialog.close();
      resetRecordForm();
      return;
    }
    state.dialogClosing = true;
    dom.recordDialog.classList.add("is-closing");
    window.setTimeout(() => {
      dom.recordDialog.classList.remove("is-closing");
      dom.recordDialog.close();
      state.dialogClosing = false;
      resetRecordForm();
    }, 210);
  }

  function clearPendingImage() {
    if (state.pendingImage?.url) URL.revokeObjectURL(state.pendingImage.url);
    state.pendingImage = null;
    dom.uploadPreviewImage.removeAttribute("src");
    dom.uploadPreviewMeta.textContent = "";
  }

  function resetRecordForm() {
    dom.recordForm.reset();
    dom.descriptionCount.textContent = "0";
    dom.uploadError.textContent = "";
    dom.formError.textContent = "";
    dom.uploadDropzone.classList.remove("has-error", "is-dragging");
    dom.authorInput.classList.remove("is-invalid");
    dom.descriptionInput.classList.remove("is-invalid");
    state.imageProcessing = false;
    state.savingRecord = false;
    clearPendingImage();
    setPhotoUi("empty");
    setSubmitBusy(false);
  }

  function setPhotoUi(mode) {
    dom.uploadEmpty.hidden = mode !== "empty";
    dom.uploadPreview.hidden = mode !== "preview";
    dom.uploadProcessing.hidden = mode !== "processing";
  }

  function setSubmitBusy(busy, label = "存入味册") {
    dom.submitRecord.disabled = busy;
    const text = dom.submitRecord.querySelector("span");
    if (text) text.textContent = label;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  async function handlePhoto(file) {
    clearUploadError();
    const requestToken = (state.imageRequestToken || 0) + 1;
    state.imageRequestToken = requestToken;
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      dom.photoInput.value = "";
      state.imageProcessing = false;
      clearPendingImage();
      const message = `照片大小为 ${formatBytes(file.size)}，超过 2MB 限制，本次上传已拒绝。`;
      dom.uploadDropzone.classList.add("has-error");
      dom.uploadError.textContent = message;
      setPhotoUi("empty");
      setSubmitBusy(false);
      showToast("照片超过 2MB，已拒绝上传", "error");
      return;
    }

    clearPendingImage();
    state.imageProcessing = true;
    dom.uploadDropzone.classList.remove("has-error");
    setPhotoUi("processing");
    setSubmitBusy(true, "正在处理照片");
    try {
      const detectedType = await validateImageInChunks(file, requestToken);
      const compressed = await compressImage(file);
      if (requestToken !== state.imageRequestToken) return;
      if (compressed.blob.size > MAX_IMAGE_BYTES) {
        throw new Error("压缩后的照片仍超过 2MB，请换一张更小的照片。");
      }
      if (state.pendingImage?.url) URL.revokeObjectURL(state.pendingImage.url);
      const url = URL.createObjectURL(compressed.blob);
      state.pendingImage = {
        blob: compressed.blob,
        url,
        originalSize: file.size,
        size: compressed.blob.size,
        width: compressed.width,
        height: compressed.height,
        detectedType
      };
      dom.uploadPreviewImage.src = url;
      dom.uploadPreviewMeta.textContent = `原图 ${formatBytes(file.size)} → ${formatBytes(compressed.blob.size)} · ${compressed.width}×${compressed.height}`;
      setPhotoUi("preview");
      dom.uploadError.textContent = "";
    } catch (error) {
      if (requestToken !== state.imageRequestToken) return;
      console.error(error);
      dom.uploadDropzone.classList.add("has-error");
      dom.uploadError.textContent = error.message || "照片处理失败，请换一张重试。";
      setPhotoUi("empty");
      showToast(error.message || "照片处理失败", "error");
    } finally {
      if (requestToken === state.imageRequestToken) {
        state.imageProcessing = false;
        dom.photoInput.value = "";
        setSubmitBusy(false);
      }
    }
  }

  function clearUploadError() {
    dom.uploadError.textContent = "";
    dom.uploadDropzone.classList.remove("has-error");
  }

  async function validateImageInChunks(file, requestToken) {
    if (!file || !file.size) throw new Error("照片是空文件，请重新选择。");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("照片超过 2MB，已拒绝上传。");
    if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("仅支持 JPG、PNG 或 WEBP 格式的照片。");
    }

    const chunkSize = 128 * 1024;
    let offset = 0;
    let header = new Uint8Array(16);
    let headerLength = 0;
    while (offset < file.size) {
      if (requestToken !== state.imageRequestToken) throw new Error("照片处理已取消。");
      const end = Math.min(offset + chunkSize, file.size);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      if (headerLength < 16 && bytes.length) {
        const take = Math.min(16 - headerLength, bytes.length);
        header.set(bytes.slice(0, take), headerLength);
        headerLength += take;
      }
      offset = end;
      if (!bytes.byteLength) throw new Error("照片读取中断，请重试。");
    }
    if (offset !== file.size) throw new Error("照片分片校验失败，请重新选择。");

    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    const isWebp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
    if (!isJpeg && !isPng && !isWebp) throw new Error("无法识别这张照片，请选择有效的 JPG、PNG 或 WEBP 图片。");
    return isJpeg ? "image/jpeg" : isPng ? "image/png" : "image/webp";
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
      } catch {
        /* Fall back to an image element below. */
      }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url)
      });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("照片解码失败，请换一张图片。"));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("照片压缩失败，请重试。"));
      }, type, quality);
    });
  }

  async function compressImage(file) {
    const decoded = await decodeImage(file);
    try {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("设备不支持图片压缩，请更换浏览器。");
      context.fillStyle = "#f4ead9";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);

      let blob = null;
      for (const quality of [0.86, 0.78, 0.7, 0.62, 0.55]) {
        blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob.size <= MAX_IMAGE_BYTES) break;
      }
      if (!blob || blob.size > MAX_IMAGE_BYTES) {
        throw new Error("压缩后的照片仍超过 2MB，请换一张更小的照片。");
      }
      return { blob, width, height };
    } finally {
      decoded.release();
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("照片读取失败，请重新选择。"));
      reader.readAsDataURL(blob);
    });
  }

  async function saveRecordToApi(payload) {
    let response;
    try {
      response = await fetch(`${API_BASE}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      error.isNetworkError = true;
      throw error;
    }
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      const error = new Error(data.error || "服务器暂时没有接下这份记录，请稍后重试。");
      error.isApiRejection = true;
      throw error;
    }
    return data.record;
  }

  function saveRecordLocally(payload) {
    const record = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      regionId: payload.regionId,
      regionName: payload.regionName,
      provinceId: payload.provinceId,
      provinceName: payload.provinceName,
      imageUrl: payload.imageDataUrl,
      dishName: payload.dishName,
      description: payload.description,
      author: payload.author,
      createdAt: new Date().toISOString()
    };
    const previous = state.localRecords;
    state.localRecords = [record, ...state.localRecords];
    if (!persistLocalRecords()) {
      state.localRecords = previous;
      throw new Error("本机存储空间不足，照片未能保存。请清理浏览器空间后重试。");
    }
    return record;
  }

  async function submitRecord(event) {
    event.preventDefault();
    if (state.savingRecord) return;
    clearFormErrors();
    if (!state.selectedRegion) {
      dom.formError.textContent = "地区信息已失效，请关闭面板后重新选择。";
      return;
    }
    if (!state.pendingImage) {
      dom.uploadDropzone.classList.add("has-error");
      dom.uploadError.textContent = "请先选择一张照片。";
      setPhotoUi("empty");
    }
    const author = dom.authorInput.value.trim();
    const description = dom.descriptionInput.value.trim();
    const dishName = dom.dishNameInput.value.trim();
    if (!author) {
      dom.authorInput.classList.add("is-invalid");
      dom.formError.textContent = "请留下你的名字。";
    }
    if (!description) {
      dom.descriptionInput.classList.add("is-invalid");
      dom.formError.textContent = "请把这一味写下来。";
    } else if (description.length > 500) {
      dom.descriptionInput.classList.add("is-invalid");
      dom.formError.textContent = "文字描述不能超过 500 字。";
    }
    if (!state.pendingImage || !author || !description || description.length > 500) {
      const focusTarget = !state.pendingImage ? dom.uploadDropzone : (!author ? dom.authorInput : dom.descriptionInput);
      if (focusTarget === dom.uploadDropzone) dom.photoInput.click();
      else focusTarget.focus();
      return;
    }

    state.savingRecord = true;
    setSubmitBusy(true, "正在存入...");
    dom.formError.textContent = "";
    const region = { ...state.selectedRegion };
    const payload = {
      regionId: region.id,
      regionName: region.name,
      provinceId: region.provinceId,
      provinceName: region.provinceName,
      dishName,
      description,
      author
    };
    try {
      const imageDataUrl = await blobToDataUrl(state.pendingImage.blob);
      payload.imageDataUrl = imageDataUrl;
      let savedRecord = null;
      if (state.backendAvailable) {
        try {
          savedRecord = await saveRecordToApi(payload);
        } catch (error) {
          if (error.isApiRejection || !error.isNetworkError) throw error;
          state.backendAvailable = false;
          savedRecord = saveRecordLocally(payload);
        }
      } else {
        savedRecord = saveRecordLocally(payload);
      }
      if (!savedRecord) throw new Error("记录保存失败，请稍后重试。");
      localStorage.setItem(AUTHOR_KEY, author);
      state.savingRecord = false;
      closeRecordDialog();
      showToast("这一味已经存进味册");
      await refreshStats();
      const requestToken = ++state.recordRequestToken;
      await loadRegionRecords(requestToken);
    } catch (error) {
      console.error(error);
      dom.formError.textContent = error.message || "记录保存失败，请稍后重试。";
      showToast(error.message || "记录保存失败", "error");
    } finally {
      state.savingRecord = false;
      setSubmitBusy(false);
    }
  }

  function clearFormErrors() {
    dom.formError.textContent = "";
    dom.uploadError.textContent = "";
    dom.uploadDropzone.classList.remove("has-error");
    dom.authorInput.classList.remove("is-invalid");
    dom.descriptionInput.classList.remove("is-invalid");
  }

  dom.authorInput.addEventListener("input", () => {
    dom.authorInput.classList.remove("is-invalid");
    if (dom.formError.textContent) dom.formError.textContent = "";
  });
  dom.descriptionInput.addEventListener("input", () => {
    dom.descriptionInput.classList.remove("is-invalid");
    if (dom.formError.textContent) dom.formError.textContent = "";
  });

  init();
})();





