// VR1 - the monitor's picture of the whole viewport.
//
// The box walk in domRaster.js paints backgrounds, borders, direct text and
// replaced images. The door's icons are not those: the support marks are
// ::before box-shadows (ui/supportAsks.js), profile marks are inline SVG,
// and several panes are overflow:auto. This file asks Chromium to paint the
// live page through an SVG foreignObject, with the stylesheets copied in so
// those rules still apply, and with each scrollport shifted by its current
// scrollTop/scrollLeft (a clone does not keep scroll, and serialization
// drops it). A blank, tainted or timed-out picture returns null. The caller
// paints the box walk instead.
//
// Quest's browser is Chromium. Measured here: drawing an SVG image that
// contains a foreignObject taints the canvas even when the markup has no
// outside url. The upload canvas is never that image. A one-pixel probe
// decides once; when it taints, later frames use the box walk only.

import { PANEL_VIEW_H, PANEL_VIEW_W } from './panelHit.js';
import { rasterizeRoot } from './domRaster.js';

export const VIRTUAL_W = PANEL_VIEW_W;
export const VIRTUAL_H = PANEL_VIEW_H;
const SNAP_MS = 700;
const URL_CAP = 1500000;

export function viewportBox(width, height) {
  const w = Number(width);
  const h = Number(height);
  const aspect = w / h;
  if (w >= 480 && h >= 360 && aspect >= 0.9 && aspect <= 2.6) {
    const widthPx = Math.round(w);
    const heightPx = Math.round(h);
    return { left: 0, top: 0, width: widthPx, height: heightPx, right: widthPx, bottom: heightPx, pinned: false };
  }
  return { left: 0, top: 0, width: VIRTUAL_W, height: VIRTUAL_H, right: VIRTUAL_W, bottom: VIRTUAL_H, pinned: true };
}

export function pageCovers(doc, win) {
  const w = win?.innerWidth;
  const h = win?.innerHeight;
  if (w == null && h == null) return false;
  if (!(Number(w) > 0) || !(Number(h) > 0)) return true;
  let stack = null;
  try {
    if (typeof doc?.elementsFromPoint === 'function') stack = doc.elementsFromPoint(Number(w) / 2, Number(h) / 2);
  } catch { stack = null; }
  if (!stack) return false;
  for (const el of stack) {
    if (!el) continue;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-vr-chrome')) continue;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'CANVAS' || tag === 'BODY' || tag === 'HTML') continue;
    let rect = null;
    try { rect = el.getBoundingClientRect?.(); } catch { rect = null; }
    if (rect && rect.width >= Number(w) * 0.7 && rect.height >= Number(h) * 0.7) return true;
  }
  return false;
}

/** A shift that puts the scrolled window back in the visible box. */
export function scrollShift(left, top) {
  const x = Number(left) || 0;
  const y = Number(top) || 0;
  if (!x && !y) return '';
  return `translate(${-x}px, ${-y}px)`;
}

export function bakeScrollTree(node) {
  if (!node || node.nodeType === 3) return;
  const kids = node.childNodes ? [...node.childNodes] : [];
  for (const kid of kids) bakeScrollTree(kid);
  const shift = scrollShift(node.scrollLeft, node.scrollTop);
  if (!shift || !kids.length) return;
  const doc = node.ownerDocument;
  if (!doc || typeof doc.createElement !== 'function' || typeof node.appendChild !== 'function' || typeof node.removeChild !== 'function') return;
  const inner = doc.createElement('div');
  try { inner.setAttribute('data-vr-scroll', '1'); } catch { /* the shift is the point */ }
  inner.style.transform = shift;
  while (node.firstChild) inner.appendChild(node.removeChild(node.firstChild));
  node.appendChild(inner);
  node.style.overflow = 'hidden';
}

const urlCache = new Map();

let cssCache = { doc: null, n: -1, raw: '' };
let embeddedCache = { raw: '', css: '' };

function collectCss(doc) {
  const sheets = doc?.styleSheets;
  const n = sheets?.length ?? 0;
  if (cssCache.doc === doc && cssCache.n === n) return cssCache.raw;
  const parts = [];
  if (!sheets) return '';
  for (const sheet of sheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { rules = null; }
    if (!rules) continue;
    for (const rule of rules) {
      try { parts.push(rule.cssText); } catch { /* one rule is not the sheet */ }
    }
  }
  cssCache = { doc, n, raw: parts.join('\n') };
  return cssCache.raw;
}

async function fetchData(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  let data = '';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('skip');
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 0 && buf.byteLength <= URL_CAP) {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const type = res.headers?.get?.('content-type') || 'application/octet-stream';
      const encode = globalThis.btoa;
      if (typeof encode !== 'function') throw new Error('skip');
      data = `data:${type};base64,${encode(bin)}`;
    }
  } catch { data = ''; }
  urlCache.set(url, data);
  return data;
}

export function rewriteCssUrls(css, map) {
  return String(css || '').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, _q, raw) => {
    const key = String(raw).trim();
    if (!key || key.startsWith('data:') || key.startsWith('#')) return full;
    const data = map.get(key);
    return data ? `url("${data}")` : 'none';
  });
}

async function embedCss(css, base) {
  if (embeddedCache.raw === css) return embeddedCache.css;
  const found = new Set();
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m = re.exec(css);
  while (m) {
    const key = String(m[2]).trim();
    if (key && !key.startsWith('data:') && !key.startsWith('#')) found.add(key);
    m = re.exec(css);
  }
  const map = new Map();
  for (const key of found) {
    let abs = key;
    try { abs = new URL(key, base).href; } catch { abs = key; }
    const data = await fetchData(abs);
    if (data) map.set(key, data);
  }
  embeddedCache = { raw: css, css: rewriteCssUrls(css, map) };
  return embeddedCache.css;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT']);

function skipNode(node) {
  const tag = String(node?.tagName || '').toUpperCase();
  if (SKIP.has(tag)) return true;
  if (typeof node.hasAttribute === 'function' && node.hasAttribute('data-vr-chrome')) return true;
  return false;
}

async function imageData(node) {
  const src = node.getAttribute?.('src') || '';
  if (!src || src.startsWith('data:')) return src;
  try {
    if (node.complete !== false && node.naturalWidth > 0) {
      const c = node.ownerDocument.createElement('canvas');
      c.width = node.naturalWidth;
      c.height = node.naturalHeight;
      c.getContext('2d').drawImage(node, 0, 0);
      return c.toDataURL('image/png');
    }
  } catch { /* a cross-origin picture is fetched, or dropped */ }
  return fetchData(src);
}

function copyVars(from, to) {
  let cs = null;
  try { cs = from?.ownerDocument?.defaultView?.getComputedStyle?.(from) ?? null; } catch { cs = null; }
  if (!cs || !to?.style?.setProperty) return;
  const count = Number(cs.length) || 0;
  for (let i = 0; i < count; i++) {
    const name = cs[i];
    if (typeof name === 'string' && name.startsWith('--')) {
      try { to.style.setProperty(name, cs.getPropertyValue(name)); } catch { /* one variable is not the picture */ }
    }
  }
}

async function cloneTree(node, doc) {
  if (!node) return null;
  if (node.nodeType === 3) return doc.createTextNode(node.nodeValue || '');
  if (node.nodeType !== 1 || skipNode(node)) return null;
  const tag = String(node.tagName || '').toUpperCase();
  if (tag === 'CANVAS') {
    if (typeof node.getContext === 'function' && node.getContext('2d') == null) return null;
    try {
      const img = doc.createElement('img');
      img.setAttribute('src', node.toDataURL('image/png'));
      return img;
    } catch { return null; }
  }
  const clone = doc.createElement(String(node.tagName || 'div').toLowerCase());
  const attrs = node.attributes || [];
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (!attr || attr.name === 'srcset') continue;
    try { clone.setAttribute(attr.name, attr.value); } catch { /* one attribute is not the node */ }
  }
  if (tag === 'IMG') {
    const data = await imageData(node);
    if (data) clone.setAttribute('src', data);
    else clone.removeAttribute('src');
  }
  const kids = node.childNodes ? [...node.childNodes] : [];
  for (const kid of kids) {
    const next = await cloneTree(kid, doc);
    if (next) clone.appendChild(next);
  }
  clone.scrollTop = node.scrollTop || 0;
  clone.scrollLeft = node.scrollLeft || 0;
  return clone;
}

function escapeStyle(css) {
  return String(css || '').replace(/<\/style/gi, '<\\/style');
}

export function foreignMarkup(width, height, css, inner) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;margin:0">`
    + `<style>${escapeStyle(css)}</style>${inner}</div>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
}

function closeVoids(xml) {
  return String(xml || '').replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)>/gi, (full, tag, rest) => {
    if (/\/\s*>$/.test(full)) return full;
    return `<${tag}${rest}/>`;
  });
}

export function dataUrlOf(backgroundImage) {
  const text = String(backgroundImage || '');
  const at = text.toLowerCase().indexOf('data:image/');
  if (at < 0) return '';
  const stop = text.indexOf(')', at);
  let url = text.slice(at, stop < 0 ? text.length : stop).trim();
  if (url.endsWith('"') || url.endsWith("'")) url = url.slice(0, -1);
  return url;
}

function originClean(ctx) {
  try {
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

export function paintedEnough(ctx, w, h) {
  if (!ctx || typeof ctx.getImageData !== 'function' || !(w > 0) || !(h > 0)) return false;
  const spots = [[0.5, 0.5], [0.18, 0.18], [0.82, 0.18], [0.5, 0.82]];
  try {
    for (const [u, v] of spots) {
      const x = Math.min(w - 1, Math.max(0, Math.floor((w - 1) * u)));
      const y = Math.min(h - 1, Math.max(0, Math.floor((h - 1) * v)));
      const p = ctx.getImageData(x, y, 1, 1).data;
      if (p && p[3] > 8) return true;
    }
    return false;
  } catch { return false; }
}

function drawSvg(doc, canvas, svg, width, height) {
  return new Promise((resolve) => {
    let img = null;
    try { img = doc.createElement('img'); } catch { resolve(null); return; }
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(null); }, SNAP_MS);
    img.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      try {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        if (!originClean(ctx)) { resolve(null); return; }
        resolve(paintedEnough(ctx, width, height) ? canvas : null);
      } catch { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

let foreignOk = null;

async function allowForeign(doc) {
  if (foreignOk != null) return foreignOk;
  if (!doc || typeof doc.createElement !== 'function') {
    foreignOk = false;
    return false;
  }
  let canvas = null;
  try { canvas = doc.createElement('canvas'); } catch { foreignOk = false; return false; }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">'
    + '<foreignObject width="4" height="4"><div xmlns="http://www.w3.org/1999/xhtml" '
    + 'style="width:4px;height:4px;background:#ffffff"></div></foreignObject></svg>';
  const drawn = await drawSvg(doc, canvas, svg, 4, 4);
  foreignOk = !!drawn;
  return foreignOk;
}

const cleanImages = new Map();

function loadableSrc(src) {
  if (!String(src).startsWith('data:image/svg+xml')) return src;
  const comma = src.indexOf(',');
  if (comma < 0) return src;
  let body = src.slice(comma + 1);
  try { body = decodeURIComponent(body.replace(/\+/g, '%20')); } catch { /* the payload is already plain */ }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
}

function loadCleanImage(doc, src) {
  if (cleanImages.has(src)) return cleanImages.get(src);
  const pending = new Promise((resolve) => {
    let img = null;
    try { img = doc.createElement('img'); } catch { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), SNAP_MS);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const probe = doc.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const ctx = probe.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (!originClean(ctx)) { resolve(null); return; }
        resolve(img);
      } catch { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = loadableSrc(src);
  });
  cleanImages.set(src, pending);
  return pending;
}

const svgImages = new WeakMap();

function svgElementImage(el, doc) {
  if (svgImages.has(el)) return svgImages.get(el);
  const pending = (async () => {
    const Serializer = doc.defaultView?.XMLSerializer ?? globalThis.XMLSerializer;
    if (typeof Serializer !== 'function') return null;
    let xml = '';
    try {
      const copy = typeof el.cloneNode === 'function' ? el.cloneNode(true) : el;
      try { copy.removeAttribute?.('style'); copy.removeAttribute?.('class'); } catch { /* the picture keeps the attributes */ }
      xml = new Serializer().serializeToString(copy);
    } catch { return null; }
    if (!xml) return null;
    if (!xml.includes('xmlns=')) xml = xml.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return loadCleanImage(doc, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
  })();
  svgImages.set(el, pending);
  return pending;
}

async function collectRasterImages(root, doc) {
  const map = new Map();
  const view = doc?.defaultView;
  if (!root || typeof root.querySelectorAll !== 'function') return map;
  let els = [];
  try { els = [...root.querySelectorAll('*')]; } catch { return map; }
  const jobs = [];
  let budget = 64;
  for (const el of els) {
    if (budget <= 0) break;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-vr-chrome')) continue;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'SCRIPT' || tag === 'STYLE') continue;
    if (tag === 'SVG') {
      budget -= 1;
      jobs.push(svgElementImage(el, doc).then((img) => { if (img) map.set(el, img); }));
      continue;
    }
    let bg = '';
    try { bg = view?.getComputedStyle?.(el)?.backgroundImage || ''; } catch { bg = ''; }
    const url = dataUrlOf(bg);
    if (!url) continue;
    budget -= 1;
    jobs.push(loadCleanImage(doc, url).then((img) => { if (img) map.set(el, img); }));
  }
  await Promise.all(jobs);
  return map;
}

async function foreignSnapshot(doc, win, frame) {
  const Serializer = globalThis.XMLSerializer;
  let canvas = null;
  try { canvas = doc?.createElement?.('canvas'); } catch { canvas = null; }
  if (!doc?.body || typeof Serializer !== 'function' || !canvas) return null;
  const width = Math.max(1, Math.round(frame?.width || VIRTUAL_W));
  const height = Math.max(1, Math.round(frame?.height || VIRTUAL_H));
  const clone = doc.createElement('div');
  const kids = [...doc.body.childNodes];
  let nodes = 0;
  for (const kid of kids) {
    const next = await cloneTree(kid, doc);
    if (next) {
      clone.appendChild(next);
      nodes += 1;
    }
  }
  bakeScrollTree(clone);
  copyVars(doc.documentElement, clone);
  const y = Number(win?.scrollY) || 0;
  const x = Number(win?.scrollX) || 0;
  if (x || y) clone.style.transform = scrollShift(x, y);
  const css = await embedCss(collectCss(doc), doc.baseURI || win?.location?.href || 'https://local/');
  const ViewSerializer = doc.defaultView?.XMLSerializer ?? Serializer;
  const inner = closeVoids(new ViewSerializer().serializeToString(clone));
  const drawn = await drawSvg(doc, canvas, foreignMarkup(width, height, css, inner), width, height);
  if (!drawn) return null;
  return { canvas: drawn, nodes, texts: 0, images: 0, width, height, mode: 'svg' };
}

export async function snapshotViewport(doc, win, canvas, frame) {
  try {
    if (await allowForeign(doc)) {
      const shot = await foreignSnapshot(doc, win, frame);
      if (shot) return shot;
    }
  } catch { foreignOk = false; }
  const root = doc?.body || doc?.documentElement;
  let images = null;
  try { images = await collectRasterImages(root, doc); } catch { images = null; }
  const box = rasterizeRoot(root, canvas, doc, frame, images);
  if (!box) return null;
  return { ...box, mode: 'box' };
}
