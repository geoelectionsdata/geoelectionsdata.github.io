import {FileAttachment} from "npm:@observablehq/stdlib";

// Loaded once at app start (state.js imports this module and calls loadFonts()).
// FileAttachment is the only reliable way to point at static assets that survives
// Observable Framework's file hashing + base-path rewriting. We declare both
// woff2 (preferred — smaller) and ttf (fallback) for each family.
//
// IMPORTANT: Each FileAttachment(...) MUST be called with a literal string —
// Observable Framework statically analyses the source to know what assets to
// bundle. Passing a variable triggers
//   "FileAttachment requires a single literal string argument"
// Wrap each call in its own try/catch so a single missing file doesn't tank
// the whole declaration.
async function safeUrl(label, fa) {
  try {
    return await fa.url();
  } catch (err) {
    console.warn(`[fontloader] ${label} failed:`, err);
    return null;
  }
}

function srcLine(url, format) {
  return url ? `url('${url}') format('${format}')` : null;
}

export async function loadFonts() {
  const [capsWoff2, capsTtf, bodyWoff2, bodyTtf] = await Promise.all([
    safeUrl("BPG Arial Caps woff2", FileAttachment("../fonts/bpg-arial-caps-webfont.woff2")),
    safeUrl("BPG Arial Caps ttf",   FileAttachment("../fonts/bpg-arial-caps-webfont.ttf")),
    safeUrl("BPG Arial woff2",      FileAttachment("../fonts/bpg-arial-webfont.woff2")),
    safeUrl("BPG Arial ttf",        FileAttachment("../fonts/bpg-arial-webfont.ttf"))
  ]);

  const capsSources = [srcLine(capsWoff2, "woff2"), srcLine(capsTtf, "truetype")].filter(Boolean).join(",\n           ");
  const bodySources = [srcLine(bodyWoff2, "woff2"), srcLine(bodyTtf, "truetype")].filter(Boolean).join(",\n           ");

  if (!capsSources && !bodySources) {
    console.error("[fontloader] No font sources resolved — BPG fonts will not load.");
    return;
  }

  const style = document.createElement("style");
  style.setAttribute("data-fontloader", "bpg");
  style.textContent = `
    ${capsSources ? `@font-face {
      font-family: 'BPG Arial Caps';
      src: ${capsSources};
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }` : ""}
    ${bodySources ? `@font-face {
      font-family: 'BPG Arial';
      src: ${bodySources};
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }` : ""}
  `;
  document.head.appendChild(style);
  console.info("[fontloader] BPG fonts registered:", {
    capsWoff2, capsTtf, bodyWoff2, bodyTtf
  });
}
