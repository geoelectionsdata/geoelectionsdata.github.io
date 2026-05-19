import * as Inputs from "npm:@observablehq/inputs";
import {Generators} from "npm:@observablehq/stdlib";
import {loadFonts} from "./fontloader.js"; 

// EXECUTE IMMEDIATELY
// Since this module is imported by every page, the fonts will load automatically.
loadFonts();
// --- 1. UPDATE DICTIONARY HERE ---
function updateGlobalNavbar(lang) {
  const navDict = {
    "en": {
      "nav.brand": "Elections in Georgia", // <--- Added
      "nav.main": "Main",
      "nav.elections": "Elections",
      "nav.candidates": "Candidates",
      "nav.parties": "Parties",
      "nav.data": "Data",
      "nav.analysis": "Analysis"
    },
    "ka": {
      "nav.brand": "არჩევნები საქართველოში", // <--- Added
      "nav.main": "მთავარი",
      "nav.elections": "არჩევნები",
      "nav.candidates": "კანდიდატები",
      "nav.parties": "პარტიები",
      "nav.data": "მონაცემები",
      "nav.analysis": "ანალიზი"
    }
  };

  // Since we added data-nav="nav.brand" to the logo, 
  // this existing loop will automatically find it and update it!
  const links = document.querySelectorAll("[data-nav]");
  links.forEach(link => {
    const key = link.getAttribute("data-nav");
    if (navDict[lang] && navDict[lang][key]) {
      link.innerText = navDict[lang][key];
    }
  });
}

export function LanguageSwitcher() {
  const savedLang = (typeof window !== "undefined" && localStorage.getItem("app_lang")) || "ka";

  const input = Inputs.radio(["en", "ka"], {
    label: "Language", 
    value: savedLang, 
    format: x => x === "en" ? "🏴󠁧󠁢󠁥󠁮󠁧󠁿 English" : "🇬🇪 Georgian"
  });

  const element = input;
  element.addEventListener("input", () => {
    localStorage.setItem("app_lang", element.value);
    // Trigger the update
    updateGlobalNavbar(element.value);
  });

  return input;
}

export function tr(dict, lang, key) {
  if (!dict) return key;
  return dict[lang]?.[key] || dict["ka"]?.[key] || key;
}


// We no longer export 'LanguageSwitcher' (the input widget).
// We export a reactive variable generator.

export function getLang() {
  return Generators.observe((notify) => {
    // 1. Initialize with saved value
    const initial = (typeof window !== "undefined" && localStorage.getItem("app_lang")) || "ka";
    notify(initial);

    // 2. Define Listener for the header button
    const listener = (event) => {
      // 'event.detail' contains the new language from the header script
      notify(event.detail);
    };

    // 3. Attach Listener
    if (typeof window !== "undefined") {
      window.addEventListener("lang-change", listener);
    }

    // 4. Cleanup when page changes
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("lang-change", listener);
      }
    };
  });
}