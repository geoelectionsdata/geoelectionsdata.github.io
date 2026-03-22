---
theme: [air, alt, wide]
title: Data
toc: false
---

```js
import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/config/translations.json").json();
const lang = getLang();
```

```js
function makeDataCards(typeKey, count = 3) {
  return Array.from({length: count}).map((_, i) => {
    const title = `${tr(dict, lang, `type.${typeKey}`)} — ${tr(dict, lang, "main.card.election") || "Election"} ${i + 1}`;
    return html`
      <div class="data-card">
        <div>
          <div class="stat-label" style="margin-bottom: 0.3rem;">${tr(dict, lang, `type.${typeKey}`)}</div>
          <h5>${title}</h5>
          <p>${tr(dict, lang, "data.card.description") || "Description..."}</p>
        </div>
        <div class="btn-group" style="margin-top: 0.75rem;">
          <button class="btn-primary-outline">
            ↓ ${tr(dict, lang, "data.card.election_data") || "Election Data"}
          </button>
          <button class="btn-secondary-outline">
            ↓ ${tr(dict, lang, "data.card.candidate_data") || "Candidate Data"}
          </button>
        </div>
      </div>
    `;
  });
}

function generateAccordionPanel(typeKey) {
  const cards = makeDataCards(typeKey, 3);
  return html`
    <div class="card" style="margin-bottom: 8px; padding: 0;">
      <details name="data-accordion">
        <summary>
          <span class="acc-icon">▼</span> ${tr(dict, lang, `type.${typeKey}`)}
        </summary>
        <div class="accordion-inner">
          ${cards}
        </div>
      </details>
    </div>
  `;
}
```

```js
const container = html`
<div class="card card-featured" style="margin-bottom: 1.5rem;">
  <h3 style="margin-top: 0;">${tr(dict, lang, "data.title")}</h3>
  <p style="color: var(--muted); max-width: 720px; margin-bottom: 0;">
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
