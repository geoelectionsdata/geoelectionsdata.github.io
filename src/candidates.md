---
theme: dashboard
title: Candidates
toc: false
---

```js

import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/translations.json").json();
const lang = getLang();

// MOCK DATA (Replicating your R data.frame)
// We add 'Type' and 'Level' fields to demonstrate filtering
const candidatesData = [
  {Name: "Candidate A", Party: "Party X", Type: "Parliamentary", Election: "Dummy election 1", District: "District 1", Level: "District 1", Tags: "SMD"},
  {Name: "Candidate B", Party: "Party Y", Type: "Parliamentary", Election: "Dummy election 1", District: "District 2", Level: "District 2", Tags: "SMD, By-election"},
  {Name: "Candidate C", Party: "Party X", Type: "Local",         Election: "Dummy election 2", District: "Nationwide", Level: "Country",    Tags: "Party list"},
  {Name: "Candidate D", Party: "Party Z", Type: "Presidential",  Election: "Dummy election 1", District: "Nationwide", Level: "Country",    Tags: "Main"},
  {Name: "Candidate E", Party: "Party Y", Type: "Parliamentary", Election: "Dummy election 1", District: "District 1", Level: "District 1", Tags: "List"},
];

```

```js
// 1. Election Type
const typeInput = Inputs.select(
  ["Parliamentary", "Presidential", "Local", "Adjara", "Plebiscite"], 
  {
    label: tr(dict, lang, "candidates.election_type"),
    format: k => tr(dict, lang, `type.${k.toLowerCase()}`)
  }
);

// 2. Election ID
const idInput = Inputs.select(["Dummy election 1", "Dummy election 2"], {
  label: tr(dict, lang, "candidates.election")
});

// 3. Level
const levelInput = Inputs.select(
  ["Country", "District 1", "District 2"], 
  {
    label: tr(dict, lang, "candidates.level"),
    // Map internal keys to translation keys
    format: k => {
       const map = {
         "Country": "candidates.level.country",
         "District 1": "candidates.level.distr1",
         "District 2": "candidates.level.distr2"
       };
       return tr(dict, lang, map[k] || k);
    }
  }
);

// 4. Search
const searchInput = Inputs.text({
  label: tr(dict, lang, "candidates.search"),
  placeholder: "..."
});

// Group inputs to track values
const uiForm = Inputs.form({
  type: typeInput, 
  id: idInput, 
  level: levelInput, 
  search: searchInput
});

// Extract values
const filters = Generators.input(uiForm);

```

```js
// 1. FILTER LOGIC
const filteredData = candidatesData.filter(d => {
  // Logic: Match Type AND Match ID AND Match Level AND Match Search
  // (You can adjust logic to be looser if needed, e.g., ignore if input is empty)
  const matchType = d.Type === filters.type;
  const matchId   = d.Election === filters.id;
  // For demo purposes, we loosely match level (or show all if "Country")
  const matchLevel = filters.level === "Country" ? true : d.Level === filters.level; 
  const matchSearch = filters.search === "" || d.Name.toLowerCase().includes(filters.search.toLowerCase());

  return matchType && matchId && matchLevel && matchSearch;
});

// 2. CREATE TABLE
// We use Inputs.table which supports selection natively
const tableInput = Inputs.table(filteredData, {
  columns: ["Name", "Party", "Election", "District", "Tags"],
  required: false, // Allow deselecting
  rows: 15,
  maxWidth: "100%"
});

// 3. CAPTURE SELECTION
// This variable 'selectedRows' will contain an Array of the selected items
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

  <div class="card">
    <h4>${tr(dict, lang, "candidates.filter_title")}</h4>
    
    <div style="margin-bottom: 1rem;">${typeInput}</div>
    <div style="margin-bottom: 1rem;">${idInput}</div>
    <div style="margin-bottom: 1rem;">${levelInput}</div>
    <div style="margin-bottom: 1rem;">${searchInput}</div>
  </div>

  <div class="card" style="min-height: 600px;">
    <h3>${tr(dict, lang, "candidates.title")}</h3>
    
    <div style="margin-bottom: 2rem;">
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
  // Inputs.table selection returns an array. Check if empty.
  if (!selection || selection.length === 0) {
    return html`<p style="color: #777; font-style: italic;">Select a candidate from the table to view details.</p>`;
  }

  const candidate = selection[0]; // Get the first selected item

  return html`
    <div>
      <h5>${tr(dict, lang, "candidates.profile_name")}: ${candidate.Name}</h5>
      
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
           <div class="candidate-photo-placeholder">
             ${tr(dict, lang, "candidates.photo_placeholder") || "Photo"}
           </div>
        </div>
        
        <div class="sm:col-span-2">
           <p><strong>${tr(dict, lang, "candidates.party_name") || "Party"}:</strong> ${candidate.Party}</p>
           <p><strong>District:</strong> ${candidate.District}</p>
           <p>${tr(dict, lang, "candidates.bio_text") || "Biography text would go here..."}</p>
        </div>
      </div>
    </div>
  `;
}
```

<style> .input-group { margin-bottom: 1rem; } .input-group label { font-weight: bold; font-size: 0.9rem; display: block; margin-bottom: 0.25rem; } </style>