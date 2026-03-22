---
theme: [air, alt, wide]
title: Candidates
toc: false
---

```js
import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/config/translations.json").json();
const lang = getLang();

const candidatesData = [
  {Name: "Candidate A", Party: "Party X", Type: "Parliamentary", Election: "Dummy election 1", District: "District 1", Level: "District 1", Tags: "SMD"},
  {Name: "Candidate B", Party: "Party Y", Type: "Parliamentary", Election: "Dummy election 1", District: "District 2", Level: "District 2", Tags: "SMD, By-election"},
  {Name: "Candidate C", Party: "Party X", Type: "Local",         Election: "Dummy election 2", District: "Nationwide", Level: "Country",    Tags: "Party list"},
  {Name: "Candidate D", Party: "Party Z", Type: "Presidential",  Election: "Dummy election 1", District: "Nationwide", Level: "Country",    Tags: "Main"},
  {Name: "Candidate E", Party: "Party Y", Type: "Parliamentary", Election: "Dummy election 1", District: "District 1", Level: "District 1", Tags: "List"},
];
```

```js
const typeInput = Inputs.select(
  ["Parliamentary", "Presidential", "Local", "Adjara", "Plebiscite"],
  {
    label: tr(dict, lang, "candidates.election_type"),
    format: k => tr(dict, lang, `type.${k.toLowerCase()}`)
  }
);

const idInput = Inputs.select(["Dummy election 1", "Dummy election 2"], {
  label: tr(dict, lang, "candidates.election")
});

const levelInput = Inputs.select(
  ["Country", "District 1", "District 2"],
  {
    label: tr(dict, lang, "candidates.level"),
    format: k => {
      const map = {
        "Country":    "candidates.level.country",
        "District 1": "candidates.level.distr1",
        "District 2": "candidates.level.distr2"
      };
      return tr(dict, lang, map[k] || k);
    }
  }
);

const searchInput = Inputs.text({
  label: tr(dict, lang, "candidates.search"),
  placeholder: "..."
});

const uiForm = Inputs.form({ type: typeInput, id: idInput, level: levelInput, search: searchInput });
const filters = Generators.input(uiForm);
```

```js
const filteredData = candidatesData.filter(d => {
  const matchType   = d.Type === filters.type;
  const matchId     = d.Election === filters.id;
  const matchLevel  = filters.level === "Country" ? true : d.Level === filters.level;
  const matchSearch = filters.search === "" || d.Name.toLowerCase().includes(filters.search.toLowerCase());
  return matchType && matchId && matchLevel && matchSearch;
});

const tableInput = Inputs.table(filteredData, {
  columns: ["Name", "Party", "Election", "District", "Tags"],
  required: false,
  rows: 15,
  maxWidth: "100%"
});

const selectedRows = Generators.input(tableInput);
```

```js
const container = html`
<style>
  .candidates-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 768px) {
    .candidates-grid { grid-template-columns: 1fr 3fr; }
  }
</style>

<div class="candidates-grid">

  <div class="card" style="align-self: start;">
    <h4 style="margin-top: 0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);">
      ${tr(dict, lang, "candidates.filter_title")}
    </h4>
    <div class="input-group">${typeInput}</div>
    <div class="input-group">${idInput}</div>
    <div class="input-group">${levelInput}</div>
    <div class="input-group">${searchInput}</div>
  </div>

  <div class="card">
    <h3 style="margin-top: 0;">${tr(dict, lang, "candidates.title")}</h3>

    <div style="margin-bottom: 1.5rem;">
      ${tableInput}
    </div>

    <hr>

    <h4 style="margin-top: 1rem;">${tr(dict, lang, "candidates.details_title")}</h4>
    <div id="candidate-profile">
      ${generateProfile(selectedRows)}
    </div>
  </div>

</div>
`;

display(container);
```

```js
function generateProfile(selection) {
  if (!selection || selection.length === 0) {
    return html`<p style="color: var(--muted); font-style: italic; font-size: 0.9rem;">
      ${tr(dict, lang, "candidates.select_prompt") || "Select a candidate from the table to view their profile."}
    </p>`;
  }

  const c = selection[0];

  return html`
    <div style="display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: start;">
      <div class="candidate-photo-placeholder">
        ${tr(dict, lang, "candidates.photo_placeholder") || "Photo"}
      </div>
      <div>
        <h4 style="margin-top: 0;">${c.Name}</h4>
        <table style="border-collapse: collapse; font-size: 0.9rem; width: 100%;">
          <tr>
            <td style="color: var(--muted); padding: 0.3rem 1rem 0.3rem 0; white-space: nowrap; font-weight: 700;">${tr(dict, lang, "candidates.party_name") || "Party"}</td>
            <td style="color: var(--dark);">${c.Party}</td>
          </tr>
          <tr>
            <td style="color: var(--muted); padding: 0.3rem 1rem 0.3rem 0; white-space: nowrap; font-weight: 700;">District</td>
            <td style="color: var(--dark);">${c.District}</td>
          </tr>
          <tr>
            <td style="color: var(--muted); padding: 0.3rem 1rem 0.3rem 0; white-space: nowrap; font-weight: 700;">Tags</td>
            <td><span style="background: var(--red-light); color: var(--red); font-size: 0.78rem; font-weight: 700; padding: 2px 8px; border-radius: 20px;">${c.Tags}</span></td>
          </tr>
        </table>
        <p style="margin-top: 1rem; color: var(--muted); font-size: 0.9rem;">
          ${tr(dict, lang, "candidates.bio_text") || "Biography text would go here..."}
        </p>
      </div>
    </div>
  `;
}
```
