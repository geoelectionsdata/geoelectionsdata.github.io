import {FileAttachment} from "npm:@observablehq/stdlib";

export async function loadFonts() {
  const fontCapsUrl = await FileAttachment("../fonts/bpg-arial-caps-webfont.ttf").url();
  const fontMainUrl = await FileAttachment("../fonts/bpg-arial-webfont.ttf").url();

  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: 'BPG Arial Caps';
      src: url('${fontCapsUrl}') format('truetype');
      font-weight: normal;
      font-style: normal;
      font-display: block; /* <--- ADD THIS LINE */
    }
    @font-face {
      font-family: 'BPG Arial';
      src: url('${fontMainUrl}') format('truetype');
      font-weight: normal;
      font-style: normal;
      font-display: block; /* <--- ADD THIS LINE */
    }
  `;

  document.head.appendChild(style);
}