---
theme: dashboard
title: Main Page
toc: false
---

```js
import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/translations.json").json();
const lang = getLang();
```

```js
// 1. Generate a single Data Card
// Mimics: make_data_cards R function
function makeDataCards(typeKey, count = 3) {
  // Loop 'count' times
  return Array.from({length: count}).map((_, i) => {
    const title = `${tr(dict, lang, `type.${typeKey}`)} ${tr(dict, lang, "main.card.election") || "Election"} ${i + 1}`;
    
    return html`
      <div class="data-card">
        <h5 style="margin:0; font-weight:bold;">${title}</h5>
        <p style="margin:0; color:#666; font-size:0.9rem;">
          ${tr(dict, lang, "data.card.description") || "Description..."}
        </p>
        
        <div class="btn-group">
          <button class="btn-primary-outline">
            ${tr(dict, lang, "data.card.election_data") || "Election Data"}
          </button>
          <button class="btn-secondary-outline">
             ${tr(dict, lang, "data.card.candidate_data") || "Candidate Data"}
          </button>
        </div>
      </div>
    `;
  });
}

// 2. Generate an Accordion Panel
// Wraps the cards in a <details> element
function generateAccordionPanel(typeKey) {
  const cards = makeDataCards(typeKey, 3); // Generate 3 dummy cards

  return html`
    <div class="card" style="margin-bottom: 10px; padding: 0;">
      <details name="data-accordion">
        <summary style="padding: 1rem; cursor: pointer; font-weight: bold; list-style: none;">
          <span class="acc-icon">▼</span> ${tr(dict, lang, `type.${typeKey}`)}
        </summary>
        
        <div style="padding: 1rem; border-top: 1px solid #eee; background: #f8f9fa; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
          ${cards}
        </div>
      </details>
    </div>
  `;
}
```

```js
const container = html`
<div class="card" style="margin-bottom: 2rem;">
  <h3>${tr(dict, lang, "data.title")}</h3>
  <p style="max-width: 800px; color: #555;">
    ${tr(dict, lang, "data.intro")}
  </p>
</div>

<div id="data-accordion-container">
  ${generateAccordionPanel("parliamentary")}
  ${generateAccordionPanel("presidential")}
  ${generateAccordionPanel("local")}
  ${generateAccordionPanel("adjara")}
  ${generateAccordionPanel("plebiscite")}
</div>
`;

display(container);

```

<style> /* Simple scoped styles for the accordion interaction */ details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }

details[open] summary .acc-icon { transform: rotate(180deg); display: inline-block; } .acc-icon { display: inline-block; margin-right: 8px; transition: transform 0.2s; } </style>