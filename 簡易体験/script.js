require([
  "esri/WebMap",
  "esri/views/MapView",
  "esri/core/reactiveUtils"
  // SimpleMarkerSymbol などの読み込みは削除したよ
], function(
  WebMap, MapView, reactiveUtils
) {

  const WS_URL = "https://forms.gle/ra5uroNn98oUJKfV7"; 

  // ズーム＆ドラッグ用の変数
  let isZoomed = false;
  let isDragging = false;
  let startX = 0, startY = 0;
  let currentTranslateX = 0, currentTranslateY = 0;
  let previousTranslateX = 0, previousTranslateY = 0;

  // --- 1. 基本設定 ---
  const webMap = new WebMap({ portalItem: { id: "70429b65f4b14047a6564766ed6b7334" } });

  const view = new MapView({
    container: "viewDiv",
    map: webMap,
    zoom: 15,
    // ★ハイライトの色だけオレンジ(#F57F32)に設定！
    highlightOptions: { 
        color: "#F57F32", 
        haloOpacity: 0.9, 
        fillOpacity: 1 
    },
    popup: { autoOpenEnabled: false },
    constraints: { rotationEnabled: false, minZoom: 13 }
  });

  let activeHighlightHandle = null;
  let highlightedObjectId = null;
  let isProgrammaticScroll = false;
  let isSatellite = false;

  async function initializeApp() {
    setupUI();
    await webMap.load();
    await view.when();
    setupLayerInteraction();
  }

  // --- 3. UI周りの設定 ---
  function setupUI() {
    const detailModal = document.getElementById("detail-modal");
    const detailCloseBtn = document.getElementById("detail-close-btn");
    
    // 詳細画像ズーム＆ドラッグ機能
    const detailImg = document.getElementById("detail-img");
    const imgContainer = document.querySelector(".detail-fixed-image-area");

    if (detailImg && imgContainer) {
        const onStart = (clientX, clientY) => {
            if (!isZoomed) return;
            isDragging = true;
            startX = clientX;
            startY = clientY;
            detailImg.style.transition = "none";
        };
        imgContainer.addEventListener("mousedown", (e) => onStart(e.clientX, e.clientY));
        imgContainer.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) onStart(e.touches[0].clientX, e.touches[0].clientY);
        });

        const onMove = (clientX, clientY) => {
            if (!isDragging || !isZoomed) return;
            const diffX = clientX - startX;
            const diffY = clientY - startY;
            currentTranslateX = previousTranslateX + diffX;
            currentTranslateY = previousTranslateY + diffY;
            detailImg.style.transform = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(2.5)`;
        };
        window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
        window.addEventListener("touchmove", (e) => {
            if (isDragging && e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: false });

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            previousTranslateX = currentTranslateX;
            previousTranslateY = currentTranslateY;
            detailImg.style.transition = "transform 0.3s ease";
        };
        window.addEventListener("mouseup", onEnd);
        window.addEventListener("touchend", onEnd);

        let clickStartTime;
        imgContainer.addEventListener("mousedown", () => { clickStartTime = new Date().getTime(); });
        imgContainer.addEventListener("touchstart", () => { clickStartTime = new Date().getTime(); });

        const onImageClick = (e) => {
            const clickDuration = new Date().getTime() - clickStartTime;
            if (clickDuration > 200 && isZoomed) return; 

            let clientX = e.clientX;
            let clientY = e.clientY;
            if(!clientX && e.changedTouches && e.changedTouches.length > 0) {
                 clientX = e.changedTouches[0].clientX;
                 clientY = e.changedTouches[0].clientY;
            }

            if (isZoomed) {
                isZoomed = false;
                imgContainer.classList.remove("active");
                detailImg.style.transform = "none";
                detailImg.style.transformOrigin = "center center";
                previousTranslateX = 0; previousTranslateY = 0;
                currentTranslateX = 0; currentTranslateY = 0;
            } else {
                isZoomed = true;
                imgContainer.classList.add("active");
                const rect = detailImg.getBoundingClientRect();
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                const xPercent = (x / rect.width) * 100;
                const yPercent = (y / rect.height) * 100;
                detailImg.style.transformOrigin = `${xPercent}% ${yPercent}%`;
                detailImg.style.transform = "scale(2.5)";
            }
        };
        imgContainer.addEventListener("click", onImageClick);
    }

    if (detailCloseBtn && detailModal) {
        detailCloseBtn.onclick = () => { detailModal.style.display = "none"; };
    }

    const basemapBtn = document.getElementById("basemap-toggle-btn");
    if (basemapBtn) {
        basemapBtn.onclick = () => {
          isSatellite = !isSatellite;
          const layer = webMap.allLayers.find(l => l.title === "衛星画像（World Imagery）");
          if(layer) {
            layer.visible = isSatellite;
            basemapBtn.classList.toggle("satellite", isSatellite);
          }
        };
    }
  }

  // --- 4. マップとデータの連携 ---
  async function setupLayerInteraction() {
    const artLayer = webMap.allLayers.find(l => l.title === "survey2");
    if(!artLayer) return;

    // ★ここに書いてあった「ピンの色を強制変更するコード」を削除したよ！
    // これで元のピンの色（ArcGISでの設定）がそのまま出るはず！

    const layerView = await view.whenLayerView(artLayer);
    
    reactiveUtils.whenOnce(() => !layerView.updating).then(() => {
        updateCarousel(layerView, view);
    });

    const carousel = document.getElementById("card-carousel");
    carousel.addEventListener("scroll", () => {
        if(isProgrammaticScroll) return;
        detectCenterCard(layerView);
    });

    view.on("click", (event) => {
        view.hitTest(event).then((response) => {
            const result = response.results.find(r => r.graphic.layer === artLayer);
            if(result) {
                const oid = result.graphic.attributes.objectid;
                scrollToCard(oid);
                highlightFeature(oid, layerView);
            } else {
                highlightFeature(null, layerView);
            }
        });
    });
  }

  function generateTagHTML(text) {
    if (!text) return "";
    let shortText = text.replace(/（外水氾濫）/g, "").replace(/（内水氾濫）/g, "");
    return shortText.split(",").map(t => t.trim()).filter(t => t !== "")
               .map(t => `<span class="hazard-tag">${t}</span>`).join("");
  }

  async function updateCarousel(layerView, view) {
    const container = document.getElementById("card-carousel");
    const targetIds = [5, 15, 33]; 
    const query = layerView.layer.createQuery();
    query.objectIds = targetIds;
    query.outFields = ["objectid", "field_25", "Message", "field_24", "Mabling", "collage"];
    const results = await layerView.layer.queryFeatures(query);
    container.innerHTML = ""; 

    if(results.features.length === 0) {
        container.innerHTML = '<div class="empty-message">データが見つかりません</div>';
        return;
    }
    
    results.features.forEach(feature => {
        const attr = feature.attributes;
        const oid = attr.objectid;
        const hazardTags = generateTagHTML(attr.field_24);

        const card = document.createElement("div");
        card.className = "art-card";
        card.id = `card-${oid}`;
        
        card.innerHTML = `
            <div class="art-card-img-container">
                <img src="" id="img-${oid}" class="art-card-img">
            </div>
            <div class="art-info">
                <div class="art-title">${attr.field_25 || "作者不明"}</div>
                <div class="tags-wrapper">${hazardTags}</div>
                <div class="art-message">${attr.Message || "メッセージなし"}</div>
                <div class="detail-btn">詳細を見る</div>
            </div>
        `;
        card.onclick = () => {
             const imgUrl = document.getElementById(`img-${oid}`).src;
             openDetailModal(attr, imgUrl);
             highlightFeature(oid, null);
        };
        container.appendChild(card);
        
        layerView.layer.queryAttachments({ objectIds: [oid] }).then(attachments => {
            if(attachments[oid] && attachments[oid].length > 0) {
                document.getElementById(`img-${oid}`).src = attachments[oid][0].url;
            } else {
                document.getElementById(`img-${oid}`).src = "https://via.placeholder.com/300x200?text=No+Image";
            }
        });
    });

    const inviteCard = document.createElement("div");
    inviteCard.className = "art-card invite-card"; 
    inviteCard.id = "card-invite";
    inviteCard.innerHTML = `
        <div class="invite-icon">🎨</div>
        <div class="invite-title">あなたも作品を制作しませんか？</div>
        <div class="invite-text">ワークショップに参加して<br>あなたの作品をマップに追加しましょう！</div>
        <a href="${WS_URL}" target="_blank" class="invite-btn">ワークショップに申し込む</a>
    `;
    inviteCard.onclick = (e) => {
        if (e.target.tagName !== 'A') { window.open(WS_URL, '_blank'); }
    };
    container.appendChild(inviteCard);
  }

  function detectCenterCard(layerView) {
    const container = document.getElementById("card-carousel");
    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let closestCard = null;
    let minDiff = Infinity;
    const cards = container.querySelectorAll(".art-card");
    cards.forEach(card => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const diff = Math.abs(containerCenter - cardCenter);
        if(diff < minDiff) { minDiff = diff; closestCard = card; }
    });
    if(closestCard && minDiff < container.clientWidth / 3) {
        if (closestCard.id === "card-invite") {
            highlightFeature(null, layerView);
            document.querySelectorAll(".art-card").forEach(c => c.classList.remove("active-card"));
            closestCard.classList.add("active-card");
        } else {
            const oid = parseInt(closestCard.id.replace("card-", ""));
            if(oid && oid !== highlightedObjectId) {
                highlightFeature(oid, layerView);
                document.querySelectorAll(".art-card").forEach(c => c.classList.remove("active-card"));
                closestCard.classList.add("active-card");
            }
        }
    }
  }

  function scrollToCard(oid) {
    const card = document.getElementById(`card-${oid}`);
    if(card) {
        isProgrammaticScroll = true;
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        document.querySelectorAll(".art-card").forEach(c => c.classList.remove("active-card"));
        card.classList.add("active-card");
        setTimeout(() => { isProgrammaticScroll = false; }, 800);
    }
  }

  function highlightFeature(oid, layerView) {
    if(activeHighlightHandle) { activeHighlightHandle.remove(); activeHighlightHandle = null; }
    highlightedObjectId = oid;
    if(oid && layerView) {
        const query = layerView.layer.createQuery();
        query.objectIds = [oid];
        layerView.queryFeatures(query).then(res => {
            if(res.features.length > 0) { activeHighlightHandle = layerView.highlight(res.features[0]); }
        });
    }
  }

  function openDetailModal(attributes, imgUrl) {
    const modal = document.getElementById("detail-modal");
    const detailImg = document.getElementById("detail-img");
    const imgContainer = document.querySelector(".detail-fixed-image-area");
    if(detailImg) {
        isZoomed = false; isDragging = false;
        previousTranslateX = 0; previousTranslateY = 0;
        currentTranslateX = 0; currentTranslateY = 0;
        detailImg.style.transform = "none";
        detailImg.style.transformOrigin = "center center";
        imgContainer.classList.remove("active");
    }

    document.getElementById("detail-img").src = imgUrl;
    const authorEl = document.getElementById("detail-author");
    authorEl.textContent = attributes.field_25 || "作者不明"; 

    let tagContainer = document.getElementById("detail-tag-container");
    if (!tagContainer) {
        tagContainer = document.createElement("div");
        tagContainer.id = "detail-tag-container";
        authorEl.parentNode.insertBefore(tagContainer, authorEl.nextSibling);
    }
    tagContainer.innerHTML = generateTagHTML(attributes.field_24);

    document.getElementById("detail-risk").textContent = attributes.Mabling || "情報なし";
    document.getElementById("detail-action").textContent = attributes.collage || "情報なし";
    document.getElementById("detail-message").textContent = attributes.Message || "メッセージなし";

    const detailContent = document.querySelector(".detail-text-area");
    let inviteArea = document.getElementById("detail-invite-area");
    if (inviteArea) inviteArea.remove();
    inviteArea = document.createElement("div");
    inviteArea.id = "detail-invite-area";
    inviteArea.className = "invite-container";
    inviteArea.innerHTML = `
        <div class="invite-title">あなたも作品を制作しませんか？</div>
        <div class="invite-text">ワークショップに参加して、<br>あなたの作品をマップに追加しましょう！</div>
        <a href="${WS_URL}" target="_blank" class="invite-btn">ワークショップに申し込む</a>
    `;
    detailContent.appendChild(inviteArea);
    modal.style.display = "flex";
  }

  initializeApp();
});