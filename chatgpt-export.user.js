// ==UserScript==
// @name         ChatGPT 對話匯出（Stay / 油猴通用）
// @namespace    https://github.com/Minijinai75
// @version      1.3.2
// @description  在 ChatGPT 對話頁右下角放一顆按鈕，一鍵把整串對話存成 Markdown。走官方 API 拿完整內容，不受「捲到哪才載到哪」影響；沒有捷徑那種時間上限，長對話也能慢慢跑完。
// @author       承曦（for Mini）
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 為什麼會有這支（26-08-16）
 * ─────────────────────────────────────────────────────────
 * 原本這件事是用 iOS 捷徑的「在網頁上執行 JavaScript」做的，三次真機測試三次逾時：
 * 捷徑對那個動作有自己的時間上限，等不到 completion 就把整格判失敗——連診斷都拿不到。
 * 那個上限是捷徑的規矩，不是 Safari 的。**寫成使用者腳本就完全沒有這個問題**：
 * 腳本活在頁面裡，愛跑多久跑多久。
 *
 * 三個設計決定，都是踩過才知道的：
 * 1. **優先走官方 API**。ChatGPT 改用虛擬滾動之後，畫面上只留可視區附近幾則
 *    （實測：1.1MB 的頁面存檔裡只有 2 個訊息節點）。從畫面抓 = 只抓得到那幾則，
 *    而且會「成功」匯出一個看起來很正常的檔案——失敗長得跟成功一樣，那是最貴的一種壞。
 * 2. **partToText 每個元素只算一次**。舊版對同一個元素算兩次，而它是遞迴的，
 *    巢狀每深一層就翻倍：深度 10 實測 139 萬次呼叫、623ms。Safari 就是這樣被拖死的。
 * 3. **不用任何 GM_* API**。Stay 對那套支援有限，純瀏覽器 API 到哪都能跑。
 */

(function () {
  "use strict";

  var VERSION = "1.3.2";
  var BTN_ID = "mini-gpt-export-btn";
  var FMT_ID = "mini-gpt-export-fmt";
  var FMT_KEY = "mini-gpt-export-format";

  // 副檔名跟 MIME 要一起換——**iOS Safari 有時候不理 download 屬性的檔名，改用 MIME 決定副檔名**，
  // 兩個對不上就會發生「我明明寫 .txt，存下來卻是 .md」。
  var FORMATS = {
    txt: { ext: "txt", mime: "text/plain;charset=utf-8", label: "TXT" },
    md: { ext: "md", mime: "text/markdown;charset=utf-8", label: "MD" },
  };

  function currentFormat() {
    var v;
    try { v = localStorage.getItem(FMT_KEY); } catch (e) { v = null; }
    return FORMATS[v] ? v : "txt";
  }

  function toggleFormat() {
    var next = currentFormat() === "txt" ? "md" : "txt";
    try { localStorage.setItem(FMT_KEY, next); } catch (e) {}
    return next;
  }
  var API_TIMEOUT_MS = 25000; // userscript 沒有外部時限，這個數字只用來防「伺服器不回話」
  var MAX_PART_DEPTH = 8;

  // ── 介面雜訊：這些是 ChatGPT 的按鈕文字，不是對話內容（整套沿用 v5.3 驗過的規則）
  function escapeForRegExp(text) {
    return String(text).replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  }

  var UI_LINES = ["Copy", "Copy code", "Copied", "Copied!", "Edit", "Share",
                  "Regenerate", "Regenerate response", "Continue generating",
                  "Stop generating", "Read aloud",
                  "複製", "複製程式碼", "已複製", "編輯", "分享", "重新生成", "朗讀"];
  // 正則編譯一次就好；**連同該行的換行一起吃掉**，否則每刪一行就留一個空行
  var UI_RE = (function () {
    var parts = [], i;
    for (i = 0; i < UI_LINES.length; i++) parts.push(escapeForRegExp(UI_LINES[i]));
    return new RegExp("^(?:" + parts.join("|") + ")[ \\t]*\\n?", "gmi");
  })();

  var STRIP_SELECTORS = [
    "button", "[role='button']", "svg", "style", "script",
    "nav", "aside", "footer", "form", "textarea",
    "[data-testid*='copy']", "[data-testid*='regenerate']"
    // 不用 "[class*='copy']"：只要頁面有 class 叫 copyable / copy-wrapper，
    // **整塊內容會被當按鈕刪掉，而且無聲無息**
  ];

  function arrayFrom(nodeList) {
    var arr = [], i;
    for (i = 0; i < nodeList.length; i++) arr.push(nodeList[i]);
    return arr;
  }

  function removeNodes(root, selector) {
    var list = root.querySelectorAll(selector), i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    }
  }

  // ─────────────────────────────────────────────── 小工具

  function log() {
    var args = ["[GPT匯出]"].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  }

  function cleanText(text) {
    if (!text) return "";
    return String(text)
      .replace(UI_RE, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  function conversationId() {
    var m = location.pathname.match(/\/(?:c|share)\/([0-9a-zA-Z-]{16,})/);
    return m ? m[1] : null;
  }

  function pageTitle() {
    var raw = (document.title || "").replace(/\s*[-–—]\s*ChatGPT\s*$/i, "").trim();
    return raw || "ChatGPT 對話";
  }

  // GPTs 對話裡，回話的是那個 GPT，不是泛稱的 ChatGPT——名字要找出來。
  // 這格我沒有真實回應可以對照，所以**多路探測、取到什麼就標什麼來源**，
  // 全部落空就退回 "ChatGPT"，不假裝知道。
  function gizmoIdFromUrl() {
    var m = location.pathname.match(/\/g\/(g-[^/]+)/);
    return m ? m[1] : null;
  }

  function nameFromGizmoPayload(res) {
    if (!res || typeof res !== "object") return null;
    var candidates = [
      res.name,
      res.display && res.display.name,
      res.gizmo && res.gizmo.name,
      res.gizmo && res.gizmo.display && res.gizmo.display.name,
      res.gizmo && res.gizmo.gizmo && res.gizmo.gizmo.display && res.gizmo.gizmo.display.name,
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "string" && candidates[i].trim()) return candidates[i].trim();
    }
    return null;
  }

  // 26-08-17 真機證據：GPTs 的名字就掛在頁面最上面那顆帶下拉箭頭的按鈕上（截圖：「任宇成 ˅」），
  // 但 v1.2.1 只找 h1 / data-testid，兩條都落空。**名字在畫面上，是我找錯地方。**
  // 改成照它實際的樣子找：掃頂部區域的按鈕與標題，濾掉介面字，取**最靠近頁面頂端**的那個。
  var NAME_NOISE = new RegExp(
    "^(ChatGPT|打開|開啟|分享|Share|新交談|新聊天|New chat|登入|註冊|Log ?in|Sign ?up|" +
    "升級|Upgrade|更多|More|取消|Cancel|完成|Done|" +
    // 26-08-17 真機撈到「開啟側邊欄」才補的一組：介面控制項的無障礙標籤
    "開啟側邊欄|關閉側邊欄|側邊欄|Open sidebar|Close sidebar|Toggle sidebar|" +
    "暫時聊天|Temporary chat|模型選擇器|Model selector|選單|Menu|" +
    "\\d+|)$", "i"
  );

  function nameCandidates() {
    // 26-08-17：v1.3.1 回報「畫面上也沒有候選」，但名字明明在畫面上——
    // ChatGPT 那條頂欄不是 <header> 標籤，是 main 裡一塊 sticky 的 div。選擇器照現場補。
    var nodes = document.querySelectorAll(
      'header button, header h1, header [role="button"], ' +
      'main h1, main > div button, [class*="header"] button, [data-testid*="gizmo"], ' +
      '[id*="conversation-header"] button, [class*="sticky"] button, [class*="sticky"] [role="button"], ' +
      '#page-header button, [data-testid*="conversation"] button'
    );
    var seen = {}, out = [], i, el, t, rect;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      // **只認 innerText，不 fallback textContent**：純圖示按鈕裡常藏一個給讀螢幕軟體用的
      // 隱藏標籤（實例：左上角側邊欄鍵藏著「開啟側邊欄」），textContent 撈得到、但那不是畫面上的字。
      // v1.3.0 就是這樣把介面按鈕當成 GPT 名字寫進檔案的。
      t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 40 || NAME_NOISE.test(t) || seen[t]) continue;
      rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 9999, left: 9999, width: 0 };
      if (rect.top > 400) continue;     // 只認頁面上緣那一帶
      if (rect.left < 24) continue;     // 貼齊最左的多半是側邊欄／返回這類控制項，不是名字
      seen[t] = true;
      out.push({ text: t, top: rect.top, left: rect.left });
    }
    out.sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    return out;
  }

  function nameFromDom() {
    var list = nameCandidates();
    return list.length ? list[0].text : null;
  }

  // 26-08-17 真機回報：這支 API 回 **HTTP 401**——它要 Bearer token，而拿對話內容那發明明帶了、
  // 查名字這發卻漏帶。**同一個網域、同一組憑證，兩發卻不一致，錯在我沒把 token 傳下來。**
  function resolveAssistantName(data, token) {
    var fromData = data && (data.gizmo_name || (data.gizmo && data.gizmo.display && data.gizmo.display.name));
    if (typeof fromData === "string" && fromData.trim()) {
      return Promise.resolve({ name: fromData.trim(), from: "對話資料" });
    }
    var id = gizmoIdFromUrl() || (data && data.conversation_template_id) || (data && data.gizmo_id);
    if (!id) return Promise.resolve({ name: "ChatGPT", from: "一般對話" });
    var headers = token ? { Authorization: "Bearer " + token } : {};

    // 失敗要留線索：**沒取到的時候，把畫面上看到的候選一起寫進檔頭**——
    // 26-08-16 那次「沒取到」只留了一個 gizmo id，等於什麼都沒說，白費一次真機。
    function fallback(why) {
      var list = nameCandidates();
      if (list.length) return { name: list[0].text, from: "畫面頂部" };
      return { name: "ChatGPT", from: "沒取到（" + why + "；畫面上也沒有候選）" };
    }

    return fetchJson("/backend-api/gizmos/" + id, { credentials: "include", headers: headers }, 8000)
      .then(function (res) {
        var n = nameFromGizmoPayload(res);
        if (n) return { name: n, from: "GPTs 資料" };
        var keys = res && typeof res === "object" ? Object.keys(res).slice(0, 6).join(",") : "非物件";
        return fallback("API 有回應但沒有名稱欄位｜keys=" + keys);
      })
      .catch(function (err) {
        return fallback("API " + (err && err.message ? err.message : "失敗"));
      });
  }

  function safeFileName(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "chatgpt";
  }

  function stamp() {
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  function fetchJson(url, options, timeoutMs) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = null;
    var opts = options || {};
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, timeoutMs || API_TIMEOUT_MS);
    }
    return fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(url.split("?")[0] + " 回 HTTP " + res.status);
      return res.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  // ─────────────────────────────────────────────── 內容抽取（API 路徑）

  // 每個元素只算一次；深度設上限。這兩件事是 Safari 當掉那格的解藥。
  function partToText(part, depth) {
    if (part == null) return "";
    if (typeof part === "string") return part;
    if ((depth || 0) >= MAX_PART_DEPTH) return "";
    var d = (depth || 0) + 1;
    var i, out;

    if (Array.isArray(part)) {
      out = [];
      for (i = 0; i < part.length; i++) {
        var piece = partToText(part[i], d);
        if (piece) out.push(piece);
      }
      return out.join("\n");
    }
    if (typeof part === "object") {
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (part.parts) return partToText(part.parts, d);
      if (part.content) return partToText(part.content, d);
    }
    return "";
  }

  function messageToText(msg) {
    if (!msg || !msg.content) return "";
    var c = msg.content;
    if (c.content_type === "text" && Array.isArray(c.parts)) return cleanText(partToText(c.parts, 0));
    if (c.content_type === "multimodal_text" && Array.isArray(c.parts)) return cleanText(partToText(c.parts, 0));
    if (typeof c.text === "string") return cleanText(c.text);
    if (Array.isArray(c.parts)) return cleanText(partToText(c.parts, 0));
    return "";
  }

  // 沿 current_node 往回走才是「這條對話線」——分支與被重生成掉的旁枝不算。
  function orderedNodes(data) {
    var mapping = data && data.mapping ? data.mapping : {};
    var chain = [], seen = {}, id = data && data.current_node ? data.current_node : null;
    while (id && mapping[id] && !seen[id]) {
      seen[id] = true;
      chain.push(mapping[id]);
      id = mapping[id].parent;
    }
    chain.reverse();
    if (chain.length) return chain;

    // 沒有 current_node 就退回「全部節點按時間排序」
    var all = [], key;
    for (key in mapping) {
      if (Object.prototype.hasOwnProperty.call(mapping, key)) all.push(mapping[key]);
    }
    all.sort(function (a, b) {
      var ta = a && a.message && a.message.create_time ? a.message.create_time : 0;
      var tb = b && b.message && b.message.create_time ? b.message.create_time : 0;
      return ta - tb;
    });
    return all;
  }

  function turnsFromApi(data) {
    var nodes = orderedNodes(data), turns = [], i, msg, role, text, last;
    for (i = 0; i < nodes.length; i++) {
      msg = nodes[i] && nodes[i].message ? nodes[i].message : null;
      if (!msg || !msg.author) continue;
      role = msg.author.role;
      if (role !== "user" && role !== "assistant") continue;
      if (msg.metadata && msg.metadata.is_visually_hidden_from_conversation) continue;
      text = messageToText(msg);
      if (!text) continue;
      last = turns.length ? turns[turns.length - 1] : null;
      if (last && last.role === role && last.text === text) continue; // 同一則被記兩次
      turns.push({ role: role, text: text });
    }
    return turns;
  }

  // ─────────────────────────────────────────────── 內容抽取（畫面退路）

  // 整套沿用 v5.3：只在真的要移除時才複製子樹、程式碼區塊轉 code fence、
  // br 轉換行、**清單照巢狀深度縮排**（不縮排的話三層清單匯出後全糊在一起）
  function serializeNode(node) {
    var clone, i, preList, liList, brList, text, depth, p, indent, needsClone = false;
    if (!node) return "";

    for (i = 0; i < STRIP_SELECTORS.length; i++) {
      if (node.querySelector(STRIP_SELECTORS[i])) { needsClone = true; break; }
    }
    if (!needsClone && !node.querySelector("pre, li, br")) {
      return cleanText((node.innerText || node.textContent || "").replace(UI_RE, ""));
    }

    clone = node.cloneNode(true);
    for (i = 0; i < STRIP_SELECTORS.length; i++) removeNodes(clone, STRIP_SELECTORS[i]);

    preList = arrayFrom(clone.querySelectorAll("pre"));
    for (i = 0; i < preList.length; i++) {
      preList[i].parentNode.replaceChild(
        document.createTextNode("\n```\n" + cleanText(preList[i].innerText || preList[i].textContent || "") + "\n```\n"),
        preList[i]);
    }

    brList = arrayFrom(clone.querySelectorAll("br"));
    for (i = 0; i < brList.length; i++) {
      brList[i].parentNode.replaceChild(document.createTextNode("\n"), brList[i]);
    }

    liList = arrayFrom(clone.querySelectorAll("li"));
    for (i = 0; i < liList.length; i++) {
      depth = 0; p = liList[i].parentNode;
      while (p && p !== clone) {
        if (p.tagName === "UL" || p.tagName === "OL") depth++;
        p = p.parentNode;
      }
      indent = new Array(Math.max(0, depth - 1) + 1).join("  ");
      liList[i].insertBefore(document.createTextNode(indent + "- "), liList[i].firstChild);
      liList[i].appendChild(document.createTextNode("\n"));
    }

    text = (clone.innerText || clone.textContent || "").replace(UI_RE, "");
    return cleanText(text);
  }

  function turnsFromDom() {
    var root = document.querySelector("main") || document.body;
    var nodes = root.querySelectorAll("[data-message-author-role]");
    var out = [], i, role, text;
    for (i = 0; i < nodes.length; i++) {
      role = nodes[i].getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") continue;
      text = serializeNode(nodes[i]);
      if (!text || text.length < 2) continue;
      out.push({ role: role, text: text });
    }
    return out;
  }

  // ─────────────────────────────────────────────── 組檔與下載

  // 檔頭欄位沿用 v5.3 的形狀（標題／警告／匯出時間／訊息數量／網址／來源），
  // 多兩欄：助手叫什麼名字、那個名字是從哪查到的。
  function toMarkdown(title, turns, source, warning, assistant) {
    var head = [], body = [], i;
    var label = (assistant && assistant.name) || "ChatGPT";
    head.push("# " + title);
    head.push("");
    if (warning) { head.push("> ⚠ " + warning); head.push(""); }
    head.push("匯出時間: " + new Date().toLocaleString("zh-TW"));
    head.push("訊息數量: " + turns.length);
    head.push("網址: " + location.href);
    head.push("來源: " + source);
    head.push("對話對象: " + label + "（名稱取自：" + ((assistant && assistant.from) || "預設") + "）");
    head.push("腳本: userscript v" + VERSION);
    head.push("");
    head.push("---");
    head.push("");
    for (i = 0; i < turns.length; i++) {
      body.push(turns[i].role === "user" ? "## 你" : "## " + label);
      body.push("");
      body.push(turns[i].text);
      body.push("");
      body.push("---");
      body.push("");
    }
    return head.join("\n") + body.join("\n");
  }

  // 照 GeminiSaver 的做法：blob + 隱形連結 + click，純瀏覽器 API，iOS Safari 上驗過可行。
  // 存成 .txt 不是 .md——**要給人的檔案就用人人都打得開的格式**（iOS 上 .md 常常沒有 App 認）；
  // 內容本身仍是 Markdown 寫法，貼到任何筆記軟體照樣看得懂。
  function downloadText(text, fileName, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  // ─────────────────────────────────────────────── 按鈕

  function makeButton() {
    if (document.getElementById(BTN_ID)) return document.getElementById(BTN_ID);
    var btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "存對話";
    btn.setAttribute("aria-label", "把這串對話存成 Markdown");
    // 配色沿用 Minijin 的 --home-* 色票（淡紫 #cfc2ef／天藍 #93c5e8，深一階給白字撐對比）
    btn.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:calc(88px + env(safe-area-inset-bottom))",
      "z-index:2147483000",
      "padding:11px 18px",
      "border:none",
      "border-radius:999px",
      "background:linear-gradient(135deg,#8171af,#5d89b5)",
      "color:#fffdfc",
      "font:800 15px/1.2 'Noto Sans TC','Yu Gothic UI',-apple-system,sans-serif",
      "letter-spacing:.02em",
      "box-shadow:0 10px 22px rgba(81,101,142,.32)",
      "cursor:pointer",
      "-webkit-tap-highlight-color:transparent",
    ].join(";");
    document.body.appendChild(btn);
    return btn;
  }

  // 格式切換做成主按鈕上面一顆小標籤：**不增加存檔的步驟**（點一下還是直接存），
  // 想換格式才多點那一下。選擇記在瀏覽器裡，下次照舊。
  function makeFormatChip() {
    var chip = document.getElementById(FMT_ID);
    if (chip) return chip;
    chip = document.createElement("button");
    chip.id = FMT_ID;
    chip.type = "button";
    chip.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:calc(136px + env(safe-area-inset-bottom))",
      "z-index:2147483000",
      "padding:5px 12px",
      "border:1px solid rgba(207,194,239,.9)",
      "border-radius:999px",
      "background:#f1ebff",
      "color:#8171af",
      "font:700 12px/1.2 'Noto Sans TC','Yu Gothic UI',-apple-system,sans-serif",
      "letter-spacing:.04em",
      "box-shadow:0 6px 14px rgba(81,101,142,.18)",
      "cursor:pointer",
      "-webkit-tap-highlight-color:transparent",
    ].join(";");
    document.body.appendChild(chip);
    return chip;
  }

  function paintChip(chip) {
    var fmt = FORMATS[currentFormat()];
    chip.textContent = "存成 " + fmt.label;
    chip.setAttribute("aria-label", "目前存成 " + fmt.label + " 檔，點一下換成另一種");
  }

  function setState(btn, text, busy) {
    btn.textContent = text;
    btn.disabled = !!busy;
    btn.style.opacity = busy ? "0.72" : "1";
  }

  function flash(btn, text, ms) {
    setState(btn, text, false);
    setTimeout(function () { setState(btn, "存對話", false); }, ms || 3200);
  }

  // ─────────────────────────────────────────────── 主流程

  function run(btn) {
    var title = pageTitle();
    var id = conversationId();
    var started = Date.now();

    if (!id) {
      flash(btn, "這頁沒有對話", 3000);
      return;
    }

    setState(btn, "抓取中…", true);

    // 已經交出檔案之後就不准再走退路——**不然下載失敗會被當成 API 失敗，落一份殘缺的畫面版**
    var delivered = false;

    var accessToken = null;

    fetchJson("/api/auth/session", { credentials: "include" })
      .then(function (session) {
        if (!session || !session.accessToken) throw new Error("拿不到登入憑證（請確認已登入）");
        accessToken = session.accessToken; // 查 GPTs 名字那發也要用它，別讓兩發憑證不一致
        setState(btn, "讀取對話…", true);
        return fetchJson("/backend-api/conversation/" + id, {
          credentials: "include",
          headers: { Authorization: "Bearer " + accessToken },
        });
      })
      .then(function (data) {
        var turns = turnsFromApi(data);
        if (!turns.length) throw new Error("API 回來了但沒有可讀的訊息");
        var name = (data && data.title) || title;
        setState(btn, "查名稱…", true);
        return resolveAssistantName(data, accessToken).then(function (assistant) {
          delivered = true;
          finish(btn, name, turns, "API（完整）", "", started, assistant);
        });
      })
      .catch(function (err) {
        if (delivered) { log("檔案已交出，後面這個錯不影響：", err && err.message); return; }
        log("API 路徑失敗，改抓畫面：", err && err.message);
        setState(btn, "改抓畫面…", true);
        var turns = turnsFromDom();
        if (!turns.length) {
          flash(btn, "失敗：" + (err && err.message ? err.message : "不明原因"), 5000);
          return;
        }
        resolveAssistantName(null, accessToken).then(function (assistant) {
          finish(
            btn, title, turns, "畫面（可能不完整）",
            "這份是從畫面抓的，**可能不完整**：ChatGPT 只把可視區附近的訊息留在頁面上（本次抓到 "
              + turns.length + " 則）。API 那條路失敗的原因：" + (err && err.message ? err.message : "不明"),
            started, assistant
          );
        });
      });
  }

  function finish(btn, title, turns, source, warning, started, assistant) {
    var fmt = FORMATS[currentFormat()];
    var text = toMarkdown(title, turns, source, warning, assistant);
    var fileName = safeFileName(title) + "_" + stamp() + "." + fmt.ext;
    downloadText(text, fileName, fmt.mime);
    log("完成", turns.length, "則，耗時", Date.now() - started, "ms，檔名", fileName);
    flash(btn, "已存 " + turns.length + " 則 ✓", 3600);
  }

  // ─────────────────────────────────────────────── 掛載
  // ChatGPT 是單頁應用，換對話不會重新載入頁面——所以要盯著網址變化重掛按鈕。

  function removeById(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function mount() {
    if (!/\/(c|share)\//.test(location.pathname)) {
      removeById(BTN_ID);
      removeById(FMT_ID);
      return;
    }

    var chip = makeFormatChip();
    paintChip(chip);
    if (chip.dataset.bound !== "1") {
      chip.dataset.bound = "1";
      chip.addEventListener("click", function () {
        toggleFormat();
        paintChip(chip);
      });
    }

    var btn = makeButton();
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () { run(btn); });
  }

  // 26-08-16 真機回報（喬雅，GPTs 對話）：「一開始有出現，後面不見了」——
  // ChatGPT 換頁時會把整塊畫面重繪，我掛在 body 上的按鈕跟著被洗掉，而網址沒變，
  // 所以「只在網址變化時重掛」這個設計看不到它消失。
  // **不去猜它什麼時候會洗，讓按鈕自己長回來**：每一輪都確認它還在，不在就重建。
  // （同一個判斷用在兩件事上：換對話要重掛、被洗掉也要重掛，一條路涵蓋兩種。）
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(mount, 400);
      return;
    }
    mount(); // 冪等：按鈕還在就什麼都不做
  }, 800);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  log("已載入 v" + VERSION);
})();
