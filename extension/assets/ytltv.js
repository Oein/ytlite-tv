// YouTube Plus (TV) — youtube.com/tv(Cobalt) 웹 앱에 주입되는 스크립트.
// YTLite(iOS)의 noAds / noPromotionCards / hideShorts / endScreenCards / SponsorBlock 을 웹 앱 수준에서 재구현한다.
// Injector.java 가 이 파일을 window.__ytltv 가드 안에서 실행한다.
(function () {
  'use strict';
  window.__ytltv = true;
  var log = function () {
    try { console.log.apply(console, ['[YTLiteTV]'].concat([].slice.call(arguments))); } catch (e) {}
  };

  // ---------------------------------------------------------------------------
  // 0. 설정 (localStorage 저장, YouTube 설정 화면의 "YouTube Plus" 섹션에서 변경)
  // ---------------------------------------------------------------------------
  var STORE = 'ytplus.settings';
  var DEFAULTS = {
    noAds: true, noPromotionCards: true, sponsorBlock: true, sponsorBlockToast: true,
    hideShorts: false, endScreenCards: false, defaultSpeed: '1'
  };
  var cfg = {};
  (function load() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) {}
    for (var k in DEFAULTS) cfg[k] = k in saved ? saved[k] : DEFAULTS[k];
  })();
  function saveSetting(key, value) {
    if (!(key in DEFAULTS)) return;
    cfg[key] = value;
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { log('save', e); }
    log('setting', key, value);
  }

  // ---------------------------------------------------------------------------
  // 1. InnerTube 응답 필터 (JSON.parse / Response.json 가로채기)
  // ---------------------------------------------------------------------------
  var AD_RENDERERS = {
    adSlotRenderer: 1, tvMastheadRenderer: 1, promotedVideoRenderer: 1, compactPromotedVideoRenderer: 1,
    displayAdRenderer: 1, inFeedAdLayoutRenderer: 1, adBreakServiceRenderer: 1, promotedSparklesWebRenderer: 1,
    searchPyvRenderer: 1, bannerPromoRenderer: 1
  };
  var PROMO_RENDERERS = {
    mealbarPromoRenderer: 1, upsellDialogRenderer: 1, statementBannerRenderer: 1, brandVideoSingletonRenderer: 1,
    premiumUpsellRenderer: 1, primetimePromoRenderer: 1, tvSurveyRenderer: 1, inlineSurveyRenderer: 1
  };

  function isShortsShelf(o) {
    var s = o.shelfRenderer || o.reelShelfRenderer || o.richShelfRenderer;
    if (!s) return false;
    if (o.reelShelfRenderer) return true;
    if (s.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') return true;
    var t = JSON.stringify(s.headerRenderer || s.title || '');
    return /"Shorts"/.test(t) && /reelWatchEndpoint/.test(JSON.stringify(s.content || '').slice(0, 4000));
  }

  function isShortsTile(o) {
    var t = o.tileRenderer;
    return !!(t && t.onSelectCommand && t.onSelectCommand.reelWatchEndpoint) ||
      !!(t && t.contentType === 'TILE_CONTENT_TYPE_SHORTS');
  }

  function dropItem(o) {
    if (!o || typeof o !== 'object') return false;
    for (var k in o) {
      if (cfg.noAds && AD_RENDERERS[k]) { log('removed', k); return true; }
      if (cfg.noPromotionCards && PROMO_RENDERERS[k]) return true;
      break; // InnerTube 배열 요소는 { xxxRenderer: {...} } 형태로 키가 하나다
    }
    if (cfg.hideShorts && (isShortsShelf(o) || isShortsTile(o))) return true;
    return false;
  }

  function scrub(node, depth) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      for (var i = node.length - 1; i >= 0; i--) {
        if (dropItem(node[i])) node.splice(i, 1);
        else scrub(node[i], depth + 1);
      }
      return;
    }
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      if (cfg.noAds && (AD_RENDERERS[k] || k === 'adSlots' || k === 'adPlacements')) { log('removed', k); delete node[k]; continue; }
      if (cfg.noPromotionCards && PROMO_RENDERERS[k]) { delete node[k]; continue; }
      scrub(node[k], depth + 1);
    }
  }

  function filterResponse(r) {
    if (!r || typeof r !== 'object' || !r.responseContext) return r; // InnerTube 응답만 처리
    try {
      // 플레이어 응답
      if (cfg.noAds) {
        var n = (r.adPlacements || []).length + (r.adSlots || []).length + (r.playerAds || []).length;
        if (n) log('player ads removed:', n);
        if (r.adPlacements) r.adPlacements = [];
        if (r.adSlots) r.adSlots = [];
        if ('playerAds' in r) r.playerAds = [];
        if (r.adBreakHeartbeatParams) delete r.adBreakHeartbeatParams;
      }
      if (cfg.noPromotionCards && r.paidContentOverlay) delete r.paidContentOverlay;
      if (cfg.endScreenCards) {
        if (r.endscreen) delete r.endscreen;
        if (r.cards) delete r.cards;
      }
      injectSettings(r);
      // 홈 · 피드 · 검색 · 다음 동영상
      scrub(r.contents, 0);
      scrub(r.continuationContents, 0);
      scrub(r.onResponseReceivedActions, 0);
      scrub(r.onResponseReceivedEndpoints, 0);
      if (cfg.noPromotionCards) {
        if (r.overlay && (r.overlay.upsellDialogRenderer || r.overlay.mealbarPromoRenderer)) delete r.overlay;
        scrub(r.messages, 0);
      }
      if (r.playerResponse) filterResponse(r.playerResponse);
    } catch (e) {
      log('filter error', e);
    }
    return r;
  }


  // ---------------------------------------------------------------------------
  // 1-1. YouTube 설정 화면에 "YouTube Plus" 섹션 추가
  //   - 토글: settingBooleanRenderer + setSettingEndpoint(settingItemId = "ytplus.<key>")
  //   - 선택: settingSingleOptionMenuRenderer (기존 "위치" 항목 구조를 복제)
  //   - 앱이 보내는 /account/set_setting 요청을 XHR 단계에서 가로채 로컬에서 처리한다(아래 2절).
  // ---------------------------------------------------------------------------
  // [키, 제목, 설명, 선택지([라벨, 값], ...)]
  var ON_OFF = [['사용', true], ['사용 안함', false]];
  var PLUS_ITEMS = [
    ['noAds', '광고 제거', '동영상 광고, 홈 마스트헤드 광고, 피드 광고를 제거합니다', ON_OFF],
    ['noPromotionCards', '프로모션 제거', 'Premium 가입 유도와 유료 프로모션 안내를 제거합니다', ON_OFF],
    ['sponsorBlock', 'SponsorBlock', '스폰서, 인트로, 구독 유도 구간을 자동으로 건너뜁니다', ON_OFF],
    ['sponsorBlockToast', 'SponsorBlock 알림', '구간을 건너뛸 때 화면에 알림을 표시합니다', ON_OFF],
    ['hideShorts', 'Shorts 숨기기', '홈, 구독, 검색의 Shorts 선반과 타일을 숨깁니다', ON_OFF],
    ['endScreenCards', '최종 화면 카드 숨기기', '영상 끝의 추천 카드와 정보 카드를 숨깁니다', ON_OFF],
    ['defaultSpeed', '기본 재생 속도', '동영상을 시작할 때 적용할 재생 속도', [
      ['1x', '1'], ['1.25x', '1.25'], ['1.5x', '1.5'], ['1.75x', '1.75'], ['2x', '2']]]
  ];
  var THUMB = 'https://www.gstatic.com/ytlr/img/autoplay.png';
  var menus = {}; // key -> 생성한 settingSingleOptionMenuRenderer (값이 바뀌면 직접 갱신)

  function text(t) { return { runs: [{ text: t }] }; }
  function labelOf(item, value) {
    for (var i = 0; i < item[3].length; i++) if (item[3][i][1] === value) return item[3][i][0];
    return String(value);
  }

  // 켜기/끄기 항목: YouTube 의 "사용 / 사용 안함" 토글(settingBooleanRenderer)을 그대로 쓴다.
  //  - 상태 표시: 토글은 ClientSettingService.isEnabled(settingItemIdForClient) 로 상태를 읽으므로 그 함수를 hook 한다(2절)
  //  - 클릭: 버튼이 _yttv.I().resolveCommand(endpoint) 를 호출하므로 resolveCommand hook 에서 저장한다(2절)
  function boolItem(item, tracking) {
    var key = item[0];
    var ep = function (v) { return { setSettingEndpoint: { settingItemIdForClient: 'YTPLUS_' + key, boolValue: v } }; };
    return { settingBooleanRenderer: {
      title: text(item[1]), summary: text(item[2]), enabled: !!cfg[key],
      enableServiceEndpoint: ep(true), disableServiceEndpoint: ep(false),
      trackingParams: tracking, itemId: 'YTPLUS_' + key, thumbnail: { thumbnails: [{ url: THUMB }] }
    } };
  }

  // 여러 값 중 하나를 고르는 항목: 기존 "위치" 항목과 같은 단일 선택 메뉴(settingSingleOptionMenuRenderer)를 복제한다.
  // 선택지를 누르면 ytplusCommand 가 실행되고, resolveCommand hook(2절)이 설정을 저장한다.
  function optionItem(item, template, tracking) {
    var key = item[0], title = item[1];
    var menu = JSON.parse(JSON.stringify(template));
    menu.title = text(title);
    menu.summary = text(item[2]);
    menu.itemId = 'YTPLUS_' + key;
    menu.trackingParams = tracking;
    menu.thumbnail = { thumbnails: [{ url: THUMB }] };
    var btn = menu.button.buttonRenderer;
    var panel = btn.command.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer;
    panel.header.overlayPanelHeaderRenderer.title = { simpleText: title };
    var list = panel.content.overlayPanelItemListRenderer;
    var proto = list.items[0];
    list.items = item[3].map(function (opt) {
      var it = JSON.parse(JSON.stringify(proto));
      var c = it.compactLinkRenderer;
      c.title = { simpleText: opt[0] };
      delete c.navigationEndpoint;
      // commandExecutorCommand 의 하위 명령은 resolveCommand 를 거치지 않으므로 단일 명령으로 둔다(팝업 닫기는 hook 에서 처리)
      c.serviceEndpoint = { ytplusCommand: { key: key, value: opt[1], closePopup: true } };
      return it;
    });
    menus[key] = { item: item, menu: menu, list: list };
    renderMenu(key);
    return { settingSingleOptionMenuRenderer: menu };
  }

  // 현재 값에 맞춰 버튼 문구와 라디오 표시를 갱신한다
  function renderMenu(key) {
    var m = menus[key];
    if (!m) return;
    var value = cfg[key];
    m.menu.button.buttonRenderer.text = { simpleText: m.item[1] + ': ' + labelOf(m.item, value) };
    m.list.items.forEach(function (it, i) {
      it.compactLinkRenderer.secondaryIcon = { iconType: m.item[3][i][1] === value ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED' };
    });
    if ('selectedIndex' in m.list) {
      m.list.selectedIndex = Math.max(0, m.item[3].map(function (o) { return o[1]; }).indexOf(value));
    }
  }

  function isPremiumUpsell(item) {
    var c = item && item.settingActionRenderer;
    return !!c && /premium_purchase_flow|ypc_purchase/.test(JSON.stringify(c.serviceEndpoint || ''));
  }

  // YouTube Plus 항목(renderer 객체 목록)을 만든다. 기존 단일 선택 메뉴 항목을 틀로 사용한다.
  function plusItems(allItems, tracking) {
    var tpl = allItems.filter(function (i) { return i && i.settingSingleOptionMenuRenderer; })[0];
    var out = [];
    PLUS_ITEMS.forEach(function (item) {
      try {
        if (item[3] === ON_OFF) out.push(boolItem(item, tracking));
        else if (tpl) out.push(optionItem(item, tpl.settingSingleOptionMenuRenderer, tracking));
        else log('settings: option menu template not found', item[0]);
      } catch (e) { log('settings item', item[0], e); }
    });
    return out;
  }

  function injectSettings(r) {
    // 형식 1: 서버 원본 — items: [{ settingCategoryCollectionRenderer: { title, items, categoryId } }, ...]
    if (Array.isArray(r.items) && r.items.some(function (c) { return c && c.settingCategoryCollectionRenderer; })) {
      if (r.items.some(function (c) { return c.settingCategoryCollectionRenderer && c.settingCategoryCollectionRenderer.categoryId === 'YTPLUS'; })) return;
      var all = [];
      r.items.forEach(function (c) {
        var cc = c.settingCategoryCollectionRenderer;
        if (!cc || !cc.items) return;
        if (cfg.noPromotionCards) cc.items = cc.items.filter(function (i) { return !isPremiumUpsell(i); });
        all = all.concat(cc.items);
      });
      var tracking = r.trackingParams;
      r.items.splice(1, 0, { settingCategoryCollectionRenderer: {
        title: text('YouTube Plus'), items: plusItems(all, tracking), categoryId: 'YTPLUS', focused: false, trackingParams: tracking
      } });
      log('settings section injected (category)');
      return;
    }
    // 형식 2: TV 내비게이션 — contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[0].tabs
    var nav = r.contents && r.contents.tvBrowseRenderer && r.contents.tvBrowseRenderer.content &&
      r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer;
    var sec = nav && nav.sections && nav.sections[0] && nav.sections[0].tvSecondaryNavSectionRenderer;
    if (!sec || !sec.tabs) return;
    var contentOf = function (t) { return t.tabRenderer && t.tabRenderer.content; };
    var isSettings = sec.tabs.some(function (t) { var c = contentOf(t); return c && (c.settingBooleanRenderer || c.settingActionRenderer); });
    if (!isSettings || sec.tabs.some(function (t) { return t.tabRenderer && t.tabRenderer.title === 'YouTube Plus' && t.tabRenderer.unselectable; })) return;
    var tr = (sec.tabs[0].tabRenderer || {}).trackingParams || r.trackingParams;
    var rest = sec.tabs;
    if (cfg.noPromotionCards) rest = rest.filter(function (t) { return !isPremiumUpsell(contentOf(t)); });
    var items = plusItems(rest.map(contentOf).filter(Boolean), tr);
    var tabs = [{ tabRenderer: { title: 'YouTube Plus', unselectable: true, trackingParams: tr } }];
    items.forEach(function (it) {
      var k = Object.keys(it)[0];
      tabs.push({ tabRenderer: { title: it[k].title.runs[0].text, selected: false, content: it } });
    });
    tabs.push({ tabRenderer: { title: 'YouTube', unselectable: true, trackingParams: tr } });
    sec.tabs = tabs.concat(rest);
    log('settings section injected (tabs)');
  }

  // ---------------------------------------------------------------------------
  // 2. 명령 처리: 앱의 모든 명령이 거치는 _yttv.I().resolveCommand 에 ytplusCommand 처리를 추가한다
  // ---------------------------------------------------------------------------
  function app() {
    try { return window._yttv && window._yttv.I && window._yttv.I(); } catch (e) { return null; }
  }

  function showToast(msg) {
    var a = app();
    if (a) {
      try {
        a.resolveCommand({ openPopupAction: { popupType: 'TOAST', popup: {
          overlayToastRenderer: { title: text(msg) } } } });
        return;
      } catch (e) {}
    }
    toast(msg);
  }

  // 토글 화면을 다시 그리게 한다(앱이 설정 변경 후 보내는 것과 같은 "rerender" 이벤트)
  function rerender() {
    try { window._yttv.N.getInstance().j(new window._yttv.P('rerender')); } catch (e) { log('rerender', e); }
  }

  function onPlusCommand(key, value, closePopup) {
    saveSetting(key, value);
    renderMenu(key);
    if (key === 'defaultSpeed') applySpeedToCurrent();
    if (closePopup) {
      var a = app();
      try { a && a.resolveCommand({ signalAction: { signal: 'POPUP_BACK' } }); } catch (e) {}
    }
    rerender();
    var m = menus[key];
    if (m) showToast(m.item[1] + ': ' + labelOf(m.item, value));
  }

  function plusKeyOf(cmd) {
    var s = cmd && cmd.setSettingEndpoint;
    var id = s && s.settingItemIdForClient;
    return typeof id === 'string' && id.indexOf('YTPLUS_') === 0 ? id.slice(7) : null;
  }

  // ClientSettingService.isEnabled: YTPLUS_ 키는 YouTube Plus 설정값을 돌려준다(토글의 현재 상태 표시용)
  function patchIsEnabled() {
    try {
      var svc = window._yttv.C.get(window._yttv.br);
      if (!svc || typeof svc.isEnabled !== 'function') return false;
      if (svc.isEnabled.__ytplus) return true;
      var orig = svc.isEnabled;
      var hooked = function (k) {
        if (typeof k === 'string' && k.indexOf('YTPLUS_') === 0) return !!cfg[k.slice(7)];
        return orig.apply(this, arguments);
      };
      hooked.__ytplus = true;
      svc.isEnabled = hooked;
      log('isEnabled hooked');
      return true;
    } catch (e) { return false; }
  }

  function patchResolveCommand() {
    var a = app();
    if (!a || typeof a.resolveCommand !== 'function') return false;
    var proto = Object.getPrototypeOf(a);
    var target = proto && proto.resolveCommand === a.resolveCommand ? proto : a;
    if (target.resolveCommand.__ytplus) return true;
    var orig = target.resolveCommand;
    var hooked = function (cmd, ctx) {
      try {
        if (cmd && cmd.ytplusCommand) {
          onPlusCommand(cmd.ytplusCommand.key, cmd.ytplusCommand.value, cmd.ytplusCommand.closePopup);
          return true;
        }
        var key = plusKeyOf(cmd);
        if (key) {
          onPlusCommand(key, !!cmd.setSettingEndpoint.boolValue, false);
          return true;
        }
      } catch (e) { log('ytplus command', e); return true; }
      return orig.apply(this, arguments);
    };
    hooked.__ytplus = true;
    target.resolveCommand = hooked;
    log('resolveCommand hooked');
    return true;
  }
  (function waitForApp(n) {
    var ok = patchResolveCommand() & patchIsEnabled();
    if (!ok && n < 120) setTimeout(function () { waitForApp(n + 1); }, 500);
  })(0);

  function patchJSON(win) {
    try {
      if (!win || !win.JSON || win.JSON.parse.__ytltv) return;
      var orig = win.JSON.parse;
      var parse = function () { return filterResponse(orig.apply(this, arguments)); };
      parse.__ytltv = true;
      win.JSON.parse = parse;
      if (win.Response && win.Response.prototype.json && !win.Response.prototype.json.__ytltv) {
        var origJson = win.Response.prototype.json;
        var json = function () { return origJson.apply(this, arguments).then(filterResponse); };
        json.__ytltv = true;
        win.Response.prototype.json = json;
      }
    } catch (e) { log('patchJSON', e); }
  }
  patchJSON(window);

  // ---------------------------------------------------------------------------
  // 2. 화면 알림(토스트)
  // ---------------------------------------------------------------------------
  var toastEl, toastTimer;
  function toast(msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;right:5%;bottom:8%;z-index:2147483647;padding:16px 28px;' +
          'background:rgba(20,20,20,.88);color:#fff;font-size:28px;border-radius:12px;font-family:sans-serif;' +
          'transition:opacity .3s;opacity:0;pointer-events:none';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2500);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // 3. 동영상 제어: SponsorBlock, 기본 재생 속도, 남은 광고 건너뛰기
  // ---------------------------------------------------------------------------
  var SB_LABEL = {
    sponsor: '스폰서', selfpromo: '자체 홍보', interaction: '구독 유도', intro: '인트로',
    outro: '아웃트로', preview: '미리보기', music_offtopic: '음악 외 구간', filler: '잡담'
  };
  var sb = { videoId: null, segments: [], skipped: {} };

  function currentVideoId() {
    var m = /[?&]v=([\w-]{11})/.exec(location.hash) || /[?&]v=([\w-]{11})/.exec(location.search);
    return m ? m[1] : null;
  }

  // Java(SponsorBlock.java) 가 조회한 구간을 전달한다. 웹 앱 CSP 때문에 JS 에서 직접 fetch 할 수 없다.
  window.__ytltvSetSegments = function (id, arr) {
    if (sb.videoId !== id) sb.skipped = {};
    sb.videoId = id;
    sb.segments = (arr || []).filter(function (s) { return (s.actionType || 'skip') === 'skip'; })
      .map(function (s) { return { start: s.segment[0], end: s.segment[1], cat: s.category, uuid: s.UUID }; });
    log('SponsorBlock', id, sb.segments.length);
  };

  function onTime(v) {
    if (!cfg.sponsorBlock) return;
    var t = v.currentTime;
    if (currentVideoId() !== sb.videoId) return;
    for (var i = 0; i < sb.segments.length; i++) {
      var s = sb.segments[i];
      // 구간 시작 직후에만 건너뛴다. 사용자가 구간 안으로 되감은 경우는 그대로 둔다.
      if (t >= s.start && t < s.end - 0.5 && t - s.start < 1.5 && !sb.skipped[s.uuid]) {
        sb.skipped[s.uuid] = true;
        v.currentTime = s.end;
        if (cfg.sponsorBlockToast) toast('SponsorBlock: ' + (SB_LABEL[s.cat] || s.cat) + ' 건너뜀');
        return;
      }
    }
  }

  function hookVideo(v) {
    if (v.__ytltv) return;
    v.__ytltv = true;
    v.addEventListener('timeupdate', function () { onTime(v); });
    v.addEventListener('loadedmetadata', function () {
      var speed = Number(cfg.defaultSpeed) || 1;
      if (speed !== 1) v.playbackRate = speed;
    });
    log('video hooked');
  }

  function applySpeedToCurrent() {
    var v = document.querySelector('video');
    if (v) v.playbackRate = Number(cfg.defaultSpeed) || 1;
  }

  function findVideos() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) hookVideo(vs[i]);
  }

  // 응답 필터를 빠져나온 광고가 재생될 경우를 대비한 보조 수단: 광고 표시 중이면 끝으로 이동하고 건너뛰기 버튼을 누른다.
  function skipLeftoverAds() {
    if (!cfg.noAds) return;
    var adUi = document.querySelector('ytlr-ad-ui-renderer, .ytlr-ad-ui-renderer, ytlr-player-ad-overlay-renderer');
    if (!adUi) return;
    var skip = document.querySelector('ytlr-skip-button-renderer, .ytlr-skip-ad-button, [idomkey="skip-button"]');
    if (skip) {
      try { skip.click(); } catch (e) {}
      try { skip.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true })); } catch (e) {}
    }
    var v = document.querySelector('video');
    if (v && isFinite(v.duration) && v.duration > 0 && v.duration < 180) v.currentTime = v.duration;
  }

  function start() {
    findVideos();
    new MutationObserver(function () { findVideos(); skipLeftoverAds(); })
      .observe(document.documentElement, { childList: true, subtree: true });
    setInterval(skipLeftoverAds, 1000);
    log('YouTube Lite TV loaded', JSON.stringify(cfg));
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
