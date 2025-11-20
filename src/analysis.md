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
function generatePosts(count = 3) {
  return Array.from({length: count}).map((_, i) => {
    // Generate dynamic title and teaser
    const postTitle = `${tr(dict, lang, "analysis.post_title")} ${i + 1}`;
    const postTeaser = tr(dict, lang, "analysis.post_teaser");
    const btnLabel = tr(dict, lang, "analysis.post_read_more");

    return html`
      <div class="analysis-card">
        <div>
          <h5 style="margin-top: 0; font-weight: bold; color: #2c3e50;">
            ${postTitle}
          </h5>
          <p style="color: #555; font-size: 0.95rem; line-height: 1.5;">
            ${postTeaser}
          </p>
        </div>
        
        <button class="btn-primary-solid" style="margin-top: 15px;">
          ${btnLabel}
        </button>
      </div>
    `;
  });
}
```

```js
const container = html`
<div class="card" style="margin-bottom: 2rem; border-left: 4px solid #2c3e50;">
  <h3 style="margin-top: 0;">${tr(dict, lang, "analysis.title")}</h3>
  <p style="color: #666; font-size: 1.05rem;">
    ${tr(dict, lang, "analysis.intro")}
  </p>
</div>

<style>
  .analysis-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  @media (min-width: 768px) {
    .analysis-grid {
      grid-template-columns: repeat(3, 1fr); /* 3 Equal columns */
    }
  }
</style>

<div class="analysis-grid">
  ${generatePosts(3)} 
  </div>
`;

display(container);
```

<style> /* Simple scoped styles for the accordion interaction */ details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }

details[open] summary .acc-icon { transform: rotate(180deg); display: inline-block; } .acc-icon { display: inline-block; margin-right: 8px; transition: transform 0.2s; } </style>