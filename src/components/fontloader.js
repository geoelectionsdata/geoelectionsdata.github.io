import {FileAttachment} from "npm:@observablehq/stdlib";

export async function loadFonts() {
  // 1. Get the hashed URLs for the fonts
  // Note: We use "../fonts/" because this file is in "src/components/"
  const fontCapsUrl = await FileAttachment("../fonts/bpg-arial-caps-webfont.ttf").url();
  const fontMainUrl = await FileAttachment("../fonts/bpg-arial-webfont.ttf").url();

  // 2. Create the CSS block
  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: 'BPG Arial Caps';
      src: url('${fontCapsUrl}') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'BPG Arial';
      src: url('${fontMainUrl}') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
  `;

  // 3. Inject into the document head
  document.head.appendChild(style);
}