---
theme: [air, alt, wide]
title: Main Page
toc: false
---

```js
import L from "npm:leaflet";
import {getLang, tr} from "./components/state.js";
const dict = await FileAttachment("data/config/translations.json").json();
```

```js
const lang = getLang();
```

```js
function tr(key) {
  return dict[lang]?.[key] || dict["ka"]?.[key] || key;
}

const container = html`
<style>
  .custom-dashboard-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 668px) {
    .custom-dashboard-grid {
      grid-template-columns: 2fr 1fr;
    }
  }
</style>

<div class="custom-dashboard-grid">

  <div class="card" style="min-height: 520px; padding: 0; overflow: hidden; display: flex; flex-direction: column;">
    <h3 style="margin: 1rem 1.25rem 0.5rem;">${tr("main.latest_title")}</h3>
    <div id="internal-map-div" style="flex-grow: 1; width: 100%; z-index: 0;"></div>
  </div>

  <div class="card card-featured">
    <h4 style="margin-top:0;">${tr("main.overview_title")}</h4>
    <div id="main-info-body">
      <p>${tr("main.overview.text")}</p>
      <ul style="padding-left: 1.5rem; margin-top: 0.75rem; color: var(--muted);">
        <li style="margin-bottom:0.4rem;"><strong style="color:var(--dark);">${tr("main.overview.item_turnout")}</strong></li>
        <li style="margin-bottom:0.4rem;">${tr("main.overview.item_winner")}</li>
        <li>${tr("main.overview.item_notes")}</li>
      </ul>
    </div>
  </div>

</div>

<hr>

<h3 style="margin-bottom: 0.75rem;">${tr("main.browse_title")}</h3>

<div id="main_accordion">
  ${generateAccordionPanel("parliamentary", "type.parliamentary")}
  ${generateAccordionPanel("presidential", "type.presidential")}
  ${generateAccordionPanel("local", "type.local")}
  ${generateAccordionPanel("adjara", "type.adjara")}
  ${generateAccordionPanel("plebiscite", "type.plebiscite")}
</div>
`;

// Initialize map
const mapDiv = container.querySelector("#internal-map-div");
if (mapDiv && L) {
  const map = L.map(mapDiv).setView([41.7, 44.8], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 200);
}

function generateAccordionPanel(typeKey, titleKey) {
  const cards = Array.from({length: 3}).map((_, i) => html`
    <div class="election-card">
      <div>
        <h5>${tr(titleKey)} ${tr("main.card.election") || "Election"} ${i + 1}</h5>
        <p>${tr("main.card.description") || "Description placeholder..."}</p>
      </div>
      <button class="btn-ghost" style="margin-top: 0.75rem;">
        ${tr("main.card.open") || "Open"}
      </button>
    </div>
  `);

  return html`
    <div class="card" style="margin-bottom: 8px; padding: 0;">
      <details name="election-accordion">
        <summary>
          <span class="acc-icon">▼</span> ${tr(titleKey)}
        </summary>
        <div class="accordion-inner">
          ${cards}
        </div>
      </details>
    </div>
  `;
}

display(container);
```
