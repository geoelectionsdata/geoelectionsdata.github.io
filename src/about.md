---
theme: [air, alt, wide]
title: About
toc: false
---

```js
import {getLang, tr} from "./components/state.js";

const dict = await FileAttachment("data/config/translations.json").json();
const lang = getLang();
const elections = await FileAttachment("data/elections.json").json();
```

```js
// ── Localised strings ────────────────────────────────────────────────────────
const about = {
  en: {
    hero_title:    "Comprehensive Election Data Archive of Georgia",
    hero_abbr:     "CEDAG",
    hero_sub:      "An open, structured dataset of Georgian election results from 1919 to the present.",
    about_title:   "About the Archive",
    about_body:    `CEDAG brings together official election results, candidate lists, and
      constituency-level data for all national and sub-national elections held in Georgia.
      Data are sourced from the Central Election Commission of Georgia (CEC), contemporary
      press coverage, and the National Archives of Georgia. The archive is maintained by
      David Sichinava and is freely available for research, journalism, and civic use.`,
    sources_title: "Primary Sources",
    sources: [
      "Central Election Commission of Georgia (cesko.ge)",
      "National Archives of Georgia",
      "Contemporary press and official gazette records",
    ],
    cite_title:    "Cite CEDAG",
    cite_sub:      "Select an election and a citation style to generate a formatted reference.",
    pick_election: "Election",
    pick_style:    "Citation style",
    copy:          "Copy",
    copied:        "Copied!",
    bibtex_title:  "BibTeX",
    styles: {
      apa:     "APA 7th",
      harvard: "Harvard",
      chicago: "Chicago 17th",
    },
    contact_title: "Contact",
    contact_body:  "For questions, corrections, or collaboration inquiries, please contact David Sichinava.",
  },
  ka: {
    hero_title:    "საქართველოს არჩევნების ყოვლისმომცველი მონაცემთა არქივი",
    hero_abbr:     "CEDAG",
    hero_sub:      "ღია, სტრუქტურირებული მონაცემთა ბაზა საქართველოს არჩევნების შედეგების შესახებ 1919 წლიდან დღემდე.",
    about_title:   "არქივის შესახებ",
    about_body:    `CEDAG აერთიანებს ოფიციალურ საარჩევნო შედეგებს, კანდიდატთა სიებს და
      საოლქო დონის მონაცემებს საქართველოში გამართული ყველა ეროვნული და
      ადგილობრივი არჩევნებისათვის. მონაცემები მომზადებულია საქართველოს
      ცენტრალური საარჩევნო კომისიის (ცსკ), პრესისა და საქართველოს ეროვნული
      არქივის მასალების საფუძველზე. არქივს ინახავს დავით სიჭინავა; ის ღიად
      არის ხელმისაწვდომი კვლევითი, ჟურნალისტური და სამოქალაქო გამოყენებისათვის.`,
    sources_title: "პირველადი წყაროები",
    sources: [
      "საქართველოს ცენტრალური საარჩევნო კომისია (cesko.ge)",
      "საქართველოს ეროვნული არქივი",
      "თანამედროვე პრესსა და ოფიციალური გაზეთის ჩანაწერები",
    ],
    cite_title:    "CEDAG-ის ციტირება",
    cite_sub:      "აირჩიეთ არჩევნები და ციტირების სტილი ფორმატირებული მითითების მისაღებად.",
    pick_election: "არჩევნები",
    pick_style:    "ციტირების სტილი",
    copy:          "კოპირება",
    copied:        "კოპირებულია!",
    bibtex_title:  "BibTeX",
    styles: {
      apa:     "APA 7th",
      harvard: "Harvard",
      chicago: "Chicago 17th",
    },
    contact_title: "კონტაქტი",
    contact_body:  "კითხვების, შესწორებების ან თანამშრომლობის მოთხოვნების შემთხვევაში, გთხოვთ, დაუკავშირდეთ დავით სიჭინავას.",
  },
};

const L = about[lang] ?? about.en;
const BASE_URL = "https://electionsdata.ge";
```

```js
// ── Election list for citation picker ────────────────────────────────────────
const elecOptions = elections
  .filter(e => e.id && e.name)
  .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
  .map(e => ({
    id:    e.id,
    label: (lang === "ka" && e.name?.ka) ? e.name.ka : (e.name?.en ?? e.id),
    url:   `${BASE_URL}/${e.id}`,
    year:  e.date ? new Date(e.date).getFullYear() : 2026,
    nameEn: e.name?.en ?? e.id,
  }));

const styleOptions = [
  {value: "apa",     label: L.styles.apa},
  {value: "harvard", label: L.styles.harvard},
  {value: "chicago", label: L.styles.chicago},
];
```

```js
// ── Citation generator — fully self-contained, uses DOM events (no Generators.input) ──
{
  const elecSelect  = Inputs.select(elecOptions,  {label: L.pick_election, format: d => d.label});
  const styleSelect = Inputs.select(styleOptions, {label: L.pick_style,    format: d => d.label});

  function formatCitation(elec, styleVal) {
    if (!elec) return "";
    const { nameEn, year, url } = elec;
    const title   = `Results of the ${nameEn}`;
    const archive = "Comprehensive Election Data Archive of Georgia (CEDAG)";
    const today   = new Date().toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric"});
    if (styleVal === "apa")
      return `Sichinava, D. (${year}). <em>${title}</em>. ${archive}. ${url}`;
    if (styleVal === "harvard")
      return `Sichinava, D. (${year}) <em>${title}</em>, ${archive}. Available at: ${url} (Accessed: ${today}).`;
    if (styleVal === "chicago")
      return `Sichinava, David. ${year}. "<em>${title}</em>." ${archive}. ${url}.`;
    return "";
  }

  function formatBibtex(elec) {
    if (!elec) return "";
    const key   = `sichinava${elec.year}${elec.id.replace(/[^a-z0-9]/gi, "")}`;
    const title = `Results of the ${elec.nameEn}`;
    return `@misc{${key},\n  author    = {Sichinava, David},\n  title     = {{${title}}},\n  year      = {${elec.year}},\n  publisher = {Comprehensive Election Data Archive of Georgia (CEDAG)},\n  url       = {${elec.url}}\n}`;
  }

  function stripTags(s) { return s.replace(/<[^>]+>/g, ""); }

  // DOM nodes that will be updated on input change
  const citDiv = document.createElement("div");
  citDiv.style.cssText = "background:var(--theme-background-alt,#f7f7f7);border:1px solid var(--theme-foreground-faintest,#e0e0e0);border-radius:6px;padding:0.75rem 1rem;margin-bottom:0.5rem;font-size:0.9rem;line-height:1.7;";

  const bibtexPre = document.createElement("pre");
  bibtexPre.style.cssText = "background:var(--theme-background-alt,#f7f7f7);border:1px solid var(--theme-foreground-faintest,#e0e0e0);border-radius:6px;padding:0.75rem 1rem;font-size:0.8rem;overflow-x:auto;margin:0 0 0.5rem;white-space:pre-wrap;";

  function makeCopyBtn(label, getContent) {
    const btn = html`<button class="btn-primary-outline" style="font-size:0.78rem;padding:0.25rem 0.75rem;">${label}</button>`;
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(getContent());
      const orig = btn.textContent;
      btn.textContent = L.copied;
      setTimeout(() => btn.textContent = orig, 1800);
    });
    return btn;
  }

  const copyCiteBtn   = makeCopyBtn(L.copy, () => stripTags(citDiv.innerHTML));
  const copyBibtexBtn = makeCopyBtn(L.copy, () => bibtexPre.textContent);

  function update() {
    const elec     = elecSelect.value;         // the selected option object
    const styleVal = (styleSelect.value?.value) ?? "apa"; // {value:"apa",...}.value
    citDiv.innerHTML      = formatCitation(elec, styleVal);
    bibtexPre.textContent = formatBibtex(elec);
  }

  elecSelect.addEventListener("input",  update);
  styleSelect.addEventListener("input", update);
  update(); // initial render

  const page = html`
<div class="about-page">

  <!-- Hero -->
  <div class="card card-featured" style="margin-bottom:1.5rem;">
    <div style="display:flex;align-items:baseline;gap:0.75rem;flex-wrap:wrap;">
      <h2 style="margin:0;">${L.hero_title}</h2>
      <span style="font-size:1rem;font-weight:600;color:var(--muted);letter-spacing:0.05em;">(${L.hero_abbr})</span>
    </div>
    <p style="margin:0.6rem 0 0;color:var(--muted);max-width:760px;">${L.hero_sub}</p>
  </div>

  <!-- Two-column layout -->
  <div class="about-cols">

    <!-- Left: about + sources -->
    <div>
      <div class="card" style="margin-bottom:1rem;">
        <h4 style="margin-top:0;">${L.about_title}</h4>
        <p style="margin:0;line-height:1.7;">${L.about_body}</p>
      </div>

      <div class="card" style="margin-bottom:1rem;">
        <h4 style="margin-top:0;">${L.sources_title}</h4>
        <ul style="margin:0;padding-left:1.25rem;line-height:1.8;">
          ${L.sources.map(s => html`<li>${s}</li>`)}
        </ul>
      </div>

      <div class="card">
        <h4 style="margin-top:0;">${L.contact_title}</h4>
        <p style="margin:0;">${L.contact_body}</p>
      </div>
    </div>

    <!-- Right: citation generator -->
    <div class="card" style="align-self:start;">
      <h4 style="margin-top:0;">${L.cite_title}</h4>
      <p style="color:var(--muted);margin-top:0;font-size:0.88rem;">${L.cite_sub}</p>

      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem;">
        ${elecSelect}
        ${styleSelect}
      </div>

      ${citDiv}
      <div style="display:flex;justify-content:flex-end;margin-bottom:1.5rem;">${copyCiteBtn}</div>

      <h5 style="margin:0 0 0.4rem;">${L.bibtex_title}</h5>
      ${bibtexPre}
      <div style="display:flex;justify-content:flex-end;">${copyBibtexBtn}</div>
    </div>

  </div>
</div>
`;

  display(page);
}
```

<style>
.about-page {
  max-width: 1100px;
  width: 100%;
}
.about-cols {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 1rem;
  align-items: start;
}
@media (max-width: 720px) {
  .about-cols { grid-template-columns: 1fr; }
}
</style>
