---
theme: dashboard
title: Main Page
toc: false
---

```js

// 1. IMPORTS
import L from "npm:leaflet";
// Import our new shared component

import {getLang, tr} from "./components/state.js";
// Load Data
const dict = await FileAttachment("data/config/translations.json").json();
```

```js
const lang = getLang();
```

```js 
// BLOCK 3: MAIN LOGIC (UI + MAP + TRANSLATION)
// This block depends on 'lang'. When 'lang' changes, it re-runs.



// 2. Define the Local Translation Helper (Takes 1 argument)
function tr(key) {
  return dict[lang]?.[key] || dict["ka"]?.[key] || key;
}

// 3. Generate HTML with CSS Grid
const container = html`
<style>
  .custom-dashboard-grid {
    display: grid;
    grid-template-columns: 1fr; /* Mobile: Stacked */
    gap: 1rem;
  }
  @media (min-width: 668px) {
    .custom-dashboard-grid {
      grid-template-columns: 2fr 1fr; /* Desktop: 66% vs 33% */
    }
  }
</style>

<div class="custom-dashboard-grid">

  <div class="card" style="min-height: 550px; padding: 0; overflow: hidden; display: flex; flex-direction: column;">
    <h3 style="margin: 1rem;">${tr("main.latest_title")}</h3>
    <div id="internal-map-div" style="flex-grow: 1; width: 100%; z-index: 0; background: #f8f9fa;"></div>
  </div>

  <div class="card">
    <h4>${tr("main.overview_title")}</h4>
    <div id="main-info-body">
      <p>${tr("main.overview.text")}</p>
      <ul style="padding-left: 1.5rem; margin-top: 10px;">
        <li><strong>${tr("main.overview.item_turnout")}</strong></li>
        <li>${tr("main.overview.item_winner")}</li>
        <li>${tr("main.overview.item_notes")}</li>
      </ul>
    </div>
  </div>

</div>

<hr>

<h3>${tr("main.browse_title")}</h3>

<div id="main_accordion">
  ${generateAccordionPanel("parliamentary", "type.parliamentary")}
  ${generateAccordionPanel("presidential", "type.presidential")}
  ${generateAccordionPanel("local", "type.local")}
  ${generateAccordionPanel("adjara", "type.adjara")}
  ${generateAccordionPanel("plebiscite", "type.plebiscite")}
</div>
`;

// 4. Initialize the Map
const mapDiv = container.querySelector("#internal-map-div");

if (mapDiv && L) {
  const map = L.map(mapDiv).setView([41.7, 44.8], 7);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  setTimeout(() => {
    map.invalidateSize();
  }, 200);
}

// 5. Accordion Helper
function generateAccordionPanel(typeKey, titleKey) {
  const cards = Array.from({length: 3}).map((_, i) => {
    return html`
      <div class="election-card" style="border:1px solid #eee; padding:15px; border-radius:5px; background:white; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <h5>${tr(titleKey)} ${tr("main.card.election") || "Election"} ${i + 1}</h5>
          <p>${tr("main.card.description") || "Description placeholder..."}</p>
        </div>
        <button class="observablehq-input" style="font-size: 0.8rem; align-self: flex-start; margin-top: 10px;">
          ${tr("main.card.open") || "Open"}
        </button>
      </div>
    `;
  });

  return html`
    <div class="card" style="margin-bottom: 10px; padding: 0;">
      <details name="election-accordion">
        <summary style="padding: 1rem; cursor: pointer; font-weight: bold; list-style: none;">
          <span class="acc-icon">▼</span> ${tr(titleKey)}
        </summary>
        
        <div style="padding: 1rem; border-top: 1px solid #eee; background: #f8f9fa; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
          ${cards}
        </div>
      </details>
    </div>
  `;
}
// 6. Display
display(container);
```

<style> /* Simple scoped styles for the accordion interaction */ details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }

details[open] summary .acc-icon { transform: rotate(180deg); display: inline-block; } .acc-icon { display: inline-block; margin-right: 8px; transition: transform 0.2s; } </style>