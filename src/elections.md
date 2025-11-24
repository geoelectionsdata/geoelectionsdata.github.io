---
theme: dashboard
title: Elections
toc: false
---

```js
import L from "npm:leaflet";
import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/config/translations.json").json();
const lang = getLang();
```
```js
// Define Inputs individually so we can place them in the layout later
const typeInput = Inputs.select(
  ["Parliamentary", "Presidential", "Local", "Adjara", "Plebiscite"], 
  {
    label: tr(dict, lang, "elections.type"),
    format: k => tr(dict, lang, `type.${k.toLowerCase()}`)
  }
);

const idInput = Inputs.select(["Dummy election 1", "Dummy election 2"], {
  label: tr(dict, lang, "elections.choice")
});

const mapModeInput = Inputs.radio(["Geographic", "Cartogram"], {
  label: tr(dict, lang, "elections.map_mode"),
  value: "Geographic",
  format: k => k === "Geographic" ? tr(dict, lang, "elections.mode.geo") : tr(dict, lang, "elections.mode.cart")
});

const voteTypeInput = Inputs.radio(["Party list", "Single-member districts"], {
  label: tr(dict, lang, "elections.vote_type"),
  value: "Party list",
  format: k => k === "Party list" ? tr(dict, lang, "elections.vote_type.party_list") : tr(dict, lang, "elections.vote_type.smd")
});

// Group them for logic, but don't display 'uiForm'
const uiForm = Inputs.form({
  type: typeInput, 
  id: idInput, 
  mapMode: mapModeInput, 
  voteType: voteTypeInput
});
```
```js
const inputValues = Generators.input(uiForm);
```

```js
// 4. MAIN UI LAYOUT
const container = html`
<style>
  .elections-grid {
    display: grid;
    grid-template-columns: 1fr; /* Default: Stacked (Mobile) */
    gap: 1rem;
    margin-bottom: 1rem;
  }

  /* Desktop: Split 25% (Inputs) vs 75% (Map) */
  @media (min-width: 768px) {
    .elections-grid {
      grid-template-columns: 1fr 3fr; 
    }
  }
</style>

<div class="elections-grid">

  <div class="card" style="height: auto; align-self: start;">
    <h4 style="margin-top: 0;">${tr(dict, lang, "elections.selection_title")}</h4>
    
    <div class="input-group">${typeInput}</div>
    <div class="input-group">${idInput}</div>
    <div class="input-group">${mapModeInput}</div>

    ${["Parliamentary", "Local", "Adjara"].includes(inputValues.type) 
      ? html`
          <hr style="margin: 1rem 0;">
          <h5>${tr(dict, lang, "elections.vote_type")}</h5>
          <div class="input-group">${voteTypeInput}</div>
        ` 
      : ""
    }
  </div>

  <div class="card" style="padding: 0; height: 600px; overflow: hidden; display: flex; flex-direction: column;">
    <div id="election-map" style="flex-grow: 1; width: 100%; background: #f0f0f0; z-index: 0;"></div>
  </div>

</div>

<div class="card">
  <h3 style="margin-top: 0;">
    ${tr(dict, lang, `type.${inputValues.type.toLowerCase()}`)} - ${inputValues.id}
  </h3>
  
  <hr>

  <div id="election-info-body">
    ${generateInfoBody(inputValues.type, inputValues.voteType)}
  </div>
</div>
`;

display(container);
```

```js
// 5. MAP LOGIC
{
  // Dependencies
  inputValues; 
  lang;

  // Find the map div inside our new container structure
  const mapDiv = container.querySelector("#election-map");
  
  if (mapDiv && L) {
    mapDiv.innerHTML = ""; // Reset
    const map = L.map(mapDiv).setView([41.7, 44.8], 7);
    
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Resize fix is crucial here since we changed the layout container
    setTimeout(() => map.invalidateSize(), 200);
  }
}
```

```js
// 5. HELPER: Generate Info Body
// This mimics the massive if/else block in your R 'mod_elections_server'
function generateInfoBody(type, voteType) {
  const t = (k) => tr(dict, lang, k);
  
  // A. PRESIDENTIAL
  if (type === "Presidential") {
    return html`
      <h4>${t("elections.pres.candidates_title")}</h4>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <ul class="list-disc pl-5">
            <li><a href="#">${t("elections.pres.candidate_1") || "Candidate 1"}</a></li>
            <li><a href="#">${t("elections.pres.candidate_2") || "Candidate 2"}</a></li>
            <li><a href="#">${t("elections.pres.candidate_3") || "Candidate 3"}</a></li>
          </ul>
        </div>
        <div class="sm:col-span-2">
          <h5>${t("elections.pres.details_title")}</h5>
          <p>${t("elections.pres.details_text")}</p>
        </div>
      </div>
      <hr>
      <h4>${t("elections.pres.district_results_title")}</h4>
      <p>${t("elections.pres.district_results_text")}</p>
    `;
  } 
  
  // B. PARLIAMENTARY / LOCAL / ADJARA
  else if (["Parliamentary", "Local", "Adjara"].includes(type)) {
    // Generate the SVG Placeholder for "Half Circle"
    const halfCircle = svg`<svg width="300" height="150" viewBox="0 0 200 100" style="display:block; margin: 0 auto;">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#ccc" stroke-width="20" />
      <text x="100" y="90" text-anchor="middle" font-size="12" fill="#666">
        ${t("elections.half_circle_placeholder") || "Parliament Chart"}
      </text>
    </svg>`;

    return html`
      <h4>${t("elections.legislature_title")}</h4>
      ${halfCircle}
      <p>${t("elections.legislature_text")}</p>
      <hr>
      
      ${voteType === "Party list" 
        ? html`
          <h4>${t("elections.party_list_title")}</h4>
          <p>${t("elections.party_list_text")}</p>
          <ul>
             <li>${t("elections.party_list_bullet_parties")}</li>
             <li>${t("elections.party_list_bullet_lists")}</li>
          </ul>` 
        : html`
          <h4>${t("elections.smd_title")}</h4>
          <p>${t("elections.smd_text")}</p>`
      }
    `;
  } 
  
  // C. PLEBISCITE
  else if (type === "Plebiscite") {
    return html`
      <h4>${t("elections.plebiscite_measures_title")}</h4>
      <ul>
        <li>${t("elections.plebiscite_measure_1")}</li>
        <li>${t("elections.plebiscite_measure_2")}</li>
      </ul>
      <hr>
      <h4>${t("elections.plebiscite_results_title")}</h4>
      <p>${t("elections.plebiscite_results_text")}</p>
    `;
  }
  
  // D. DEFAULT
  return html`
    <h4>${t("elections.info_title")}</h4>
    <p>${t("elections.info_text")}</p>
  `;
}
```

<style> .input-group { margin-bottom: 1rem; } .input-group label { font-weight: bold; font-size: 0.9rem; display: block; margin-bottom: 0.25rem; } </style>