// ==UserScript==
// @name         MuseScore → MusicXML 素材下载器
// @namespace    https://github.com/local/musescore-to-musicxml
// @version      1.0.0
// @description  在 musescore.com 曲谱页一键下载所有页面图片(SVG/PNG)+ MIDI + 元信息,打包成 zip,供 Claude Code skill 解析为 MusicXML。
// @author       you
// @match        https://musescore.com/*
// @match        https://*.musescore.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      musescore.com
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * musescore.com 有 Cloudflare 反爬,curl/无头浏览器会被 403。这个脚本跑在你真实的、
 * 已通过 Cloudflare 校验的浏览器会话里,所以能拿到数据。
 *
 * 页面图片走内部接口 /api/jmuse?id=&type=img&index=,鉴权头
 *   Authorization = md5(id + "img" + index + suffix).slice(0,4)
 * suffix 从 MuseScore 混淆 JS bundle 里正则抠出(抠不到回退硬编码 9654,4e,
 * 再回退公开静态路径)。算法与 dl-librescore 一致。MIDI 走同一接口 type=midi。
 */

(function () {
  "use strict";

  const HARDCODED_SUFFIX = "9654,4e";
  const log = (...a) => console.log("[MS-DL]", ...a);

  /* ============================ MD5 (Paul Johnston, public domain) ======= */
  function md5(string) {
    function safeAdd(x, y) {
      const lsw = (x & 0xffff) + (y & 0xffff);
      return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff);
    }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return safeAdd(rol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    function binl(x, len) {
      x[len >> 5] |= 0x80 << len % 32;
      x[(((len + 64) >>> 9) << 4) + 14] = len;
      let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
      for (let i = 0; i < x.length; i += 16) {
        const oa = a, ob = b, oc = c, od = d;
        a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586);
        c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
        a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
        c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
        a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
        c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
        a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101);
        c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
        a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
        c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
        a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083);
        c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
        a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
        c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
        a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784);
        c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
        a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
        c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
        a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
        c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
        a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222);
        c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
        a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835);
        c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
        a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
        c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
        a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
        c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
        a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744);
        c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
        a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
        c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
        a = safeAdd(a, oa); b = safeAdd(b, ob); c = safeAdd(c, oc); d = safeAdd(d, od);
      }
      return [a, b, c, d];
    }
    function rstr2binl(input) {
      const out = [];
      for (let i = 0; i < input.length * 8; i += 8) out[i >> 5] |= (input.charCodeAt(i / 8) & 0xff) << i % 32;
      return out;
    }
    function binl2rstr(input) {
      let out = "";
      for (let i = 0; i < input.length * 32; i += 8) out += String.fromCharCode((input[i >> 5] >>> i % 32) & 0xff);
      return out;
    }
    function rstrMd5(s) { return binl2rstr(binl(rstr2binl(s), s.length * 8)); }
    const utf8 = unescape(encodeURIComponent(string));
    const raw = rstrMd5(utf8);
    let hex = "";
    for (let i = 0; i < raw.length; i++) {
      const b = raw.charCodeAt(i);
      hex += "0123456789abcdef".charAt((b >>> 4) & 0x0f) + "0123456789abcdef".charAt(b & 0x0f);
    }
    return hex;
  }

  /* ============================ minimal ZIP (store, no compression) ====== */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipStore(files) {
    // files: [{ name, data: Uint8Array }]
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
    const u32 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), nameBytes, data,
      ]);
      chunks.push(local);
      central.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ]));
      offset += local.length;
    }
    const centralBytes = concat(central);
    const end = concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralBytes.length), u32(offset), u16(0),
    ]);
    return new Blob([concat(chunks), centralBytes, end], { type: "application/zip" });
  }
  function concat(arrays) {
    let len = 0;
    for (const a of arrays) len += a.length;
    const out = new Uint8Array(len);
    let p = 0;
    for (const a of arrays) { out.set(a, p); p += a.length; }
    return out;
  }

  /* ============================ helpers =================================== */
  function gmFetchBytes(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) resolve(new Uint8Array(r.response));
          else reject(new Error("HTTP " + r.status + " " + url));
        },
        onerror: () => reject(new Error("网络错误 " + url)),
        ontimeout: () => reject(new Error("超时 " + url)),
      });
    });
  }

  const metaContent = (p) => {
    const el = document.querySelector(`meta[property='${p}']`);
    return el ? el.getAttribute("content") : null;
  };
  function getScoreId() {
    const ios = metaContent("al:ios:url");
    let m = ios && ios.match(/(\d+)/);
    if (m) return +m[1];
    m = location.pathname.match(/scores\/(\d+)/);
    return m ? +m[1] : null;
  }
  const getTitle = () =>
    (metaContent("og:title") || document.title.replace(/\s*\|.*$/, "") || "musescore-score").trim();
  // Only a hint for logging/validation — the real driver is probing jmuse.
  function pageCountHint() {
    try {
      const w = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      const n = w && w.UGAPP && w.UGAPP.store && w.UGAPP.store.page &&
        w.UGAPP.store.page.data && w.UGAPP.store.page.data.score &&
        w.UGAPP.store.page.data.score.pages_count;
      if (n) return +n;
    } catch (e) { /* sandbox may block */ }
    const head = [...document.querySelectorAll("h3,h2")].find((h) => /^\s*pages\s*$/i.test(h.textContent));
    if (head) {
      const n = (head.nextElementSibling || head.parentElement)?.textContent?.match(/\d+/);
      if (n) return +n[0];
    }
    const m = document.documentElement.innerHTML.match(/pages_count["']?\s*:\s*(\d+)/);
    if (m) return +m[1];
    return null;
  }
  function getInfo() {
    const info = {};
    for (const h of document.querySelectorAll("h3,h2")) {
      const label = h.textContent.trim();
      if (!label || label.length > 24) continue;
      const val = h.nextElementSibling ? h.nextElementSibling.textContent.trim().replace(/\s+/g, " ") : "";
      if (val) info[label] = val;
    }
    return info;
  }
  function staticImageBase() {
    const og = metaContent("og:image") || "";
    const m = og.match(/^(.+\/)score_0\.(\w+)/);
    if (!m) return null;
    const q = og.split("?")[1];
    return { base: m[1], ext: m[2], query: q ? "?" + q : "" };
  }
  async function getSuffix() {
    const urls = [...document.querySelectorAll("script[src],link[href]")]
      .map((e) => e.src || e.href)
      .filter((u) => /\/static\/public\/build\/musescore.*\/20.*\.js/.test(u));
    log(`扫描 ${urls.length} 个 bundle 找密钥…`);
    for (const u of urls) {
      try {
        const t = await (await fetch(u)).text();
        const m = t.match(/"([^"]+)"\)\.substr\(0,4\)/);
        if (m) { log("✓ 从 bundle 抠到 suffix:", JSON.stringify(m[1])); return m[1]; }
      } catch (e) { log("bundle 读取失败", u, String(e)); }
    }
    log("✗ 没在 bundle 里找到 suffix,将回退硬编码", JSON.stringify(HARDCODED_SUFFIX));
    return null;
  }
  async function getJmuseUrl(id, type, index, suffix) {
    const api = `https://musescore.com/api/jmuse?id=${id}&type=${type}&index=${index}`;
    for (const s of [suffix, HARDCODED_SUFFIX].filter(Boolean)) {
      const auth = md5(`${id}${type}${index}${s}`).slice(0, 4);
      try {
        const r = await fetch(api, { headers: { Authorization: auth }, credentials: "include" });
        if (r.ok) {
          const j = await r.json();
          if (j && j.info && j.info.url) {
            log(`✓ jmuse ${type}#${index} 用 suffix=${JSON.stringify(s)} 成功`);
            return j.info.url;
          }
          log(`? jmuse ${type}#${index} HTTP ${r.status} 但响应里没有 info.url:`, JSON.stringify(j).slice(0, 200));
        } else {
          const body = await r.text().catch(() => "");
          log(`✗ jmuse ${type}#${index} suffix=${JSON.stringify(s)} auth=${auth} → HTTP ${r.status} ${body.slice(0, 120)}`);
        }
      } catch (e) {
        log(`✗ jmuse ${type}#${index} 请求异常:`, String(e));
      }
    }
    return null;
  }
  const sanitize = (s) =>
    (String(s).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "musescore-score");

  /* ============================ main flow ================================ */
  async function run(setStatus) {
    const id = getScoreId();
    if (!id) throw new Error("找不到曲谱 ID(不是曲谱页?)");
    const title = getTitle();
    const hint = pageCountHint();
    log("id", id, "title", title, "页数提示", hint ?? "(未知,将逐页探测)");

    setStatus("读取密钥…");
    const suffix = await getSuffix();
    const stat = staticImageBase();

    const files = [];

    // Probe pages: request img#0, #1, ... until one is unavailable.
    const MAX = 200;
    let i = 0;
    for (; i < MAX; i++) {
      setStatus(hint ? `第 ${i + 1}/${hint} 页…` : `第 ${i + 1} 页…`);
      let url = await getJmuseUrl(id, "img", i, suffix);
      let ext = null;
      if (!url && stat && i === 0) {
        url = `${stat.base}score_0.${stat.ext}${stat.query}`;
        ext = stat.ext;
        log("↩ 第 0 页 jmuse 失败,回退公开静态路径:", url);
      }
      if (!url) { log(`第 ${i} 页没有地址 → 视为结束,共 ${i} 页`); break; }
      if (!ext) { const m = url.split("?")[0].match(/\.(svg|png)$/i); ext = m ? m[1].toLowerCase() : "svg"; }
      let bytes;
      try {
        bytes = await gmFetchBytes(url);
      } catch (e) {
        log(`第 ${i} 页下载失败:${e} → 结束,共 ${i} 页`);
        break;
      }
      files.push({ name: `page_${String(i).padStart(2, "0")}.${ext}`, data: bytes });
      log(`✓ 第 ${i} 页已抓 (${bytes.length} bytes)`);
    }
    const pages = i;
    if (hint && pages < hint) log(`⚠ 只抓到 ${pages} 页,但提示是 ${hint} 页,可能有页失败`);

    files.push({
      name: "score-info.json",
      data: new TextEncoder().encode(JSON.stringify(
        { id, title, pages, pagesHint: hint, source: location.href, ...getInfo() }, null, 2)),
    });

    setStatus("MIDI…");
    const midiUrl = await getJmuseUrl(id, "midi", 0, suffix);
    if (midiUrl) {
      try { files.push({ name: "score.mid", data: await gmFetchBytes(midiUrl) }); }
      catch (e) { log("midi failed", e); }
    }

    const pageCount = files.filter((f) => /^page_/.test(f.name)).length;
    if (!pageCount) throw new Error("没抓到任何页面,刷新后重试");

    setStatus("打包 zip…");
    const blob = zipStore(files);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "musescore-dl_" + sanitize(title) + ".zip";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);

    return { pages: pageCount, hasMidi: files.some((f) => f.name === "score.mid") };
  }

  /* ============================ button UI ================================ */
  function makeButton() {
    if (document.getElementById("ms-mxl-dl-btn")) return;
    const btn = document.createElement("button");
    btn.id = "ms-mxl-dl-btn";
    btn.textContent = "⬇ 下载谱面素材";
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
      padding: "10px 14px", background: "#1a73e8", color: "#fff", border: "none",
      borderRadius: "8px", fontSize: "13px", fontFamily: "system-ui,sans-serif",
      cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.3)",
    });
    let busy = false;
    const setStatus = (s) => (btn.textContent = s);
    btn.addEventListener("click", async () => {
      if (busy) return;
      busy = true; btn.style.background = "#999";
      try {
        const res = await run(setStatus);
        btn.style.background = "#188038";
        setStatus(`✓ ${res.pages} 页${res.hasMidi ? " + MIDI" : "(无 MIDI)"}`);
      } catch (e) {
        btn.style.background = "#d93025";
        setStatus("✗ " + (e.message || e));
        console.error("[MS-DL]", e);
      } finally {
        setTimeout(() => { btn.style.background = "#1a73e8"; btn.textContent = "⬇ 下载谱面素材"; busy = false; }, 6000);
      }
    });
    document.body.appendChild(btn);
  }

  if (/\/scores\/\d+/.test(location.pathname) || document.querySelector("meta[property='al:ios:url']")) {
    makeButton();
  } else {
    const obs = new MutationObserver(() => {
      if (document.querySelector("meta[property='al:ios:url']")) makeButton();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
