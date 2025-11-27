// 1. Import the Node.js file system module
import { readFileSync } from "node:fs";

// 2. Read the file content (Path is relative to the project root)
const headerContent = readFileSync("./src/components/header.html", "utf8");

// See https://observablehq.com/framework/config for documentation.
export default {
  root: "src",
  base: "/electionsdata-wireframe/",
  header: headerContent,
  head: `
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <link rel="stylesheet" href="custom-style.css">
    <link rel="icon" href="logo_ka-1.svg" type="image/svg" sizes="32x32">
  `,
  pages: [
    {name: "Main", path: "/index"},
    {name: "Elections", path: "/elections"},
    {name: "Candidates", path: "/candidates"},
    {name: "Data", path: "/data"},
    {name: "Analysis", path: "/analysis"}
  ],
  theme: "air", // "air", "cotton", "ink", or "near-midnight"
  pager: false, // Turn off next/prev buttons for a dashboard feel
  // The app’s title; used in the sidebar and webpage titles.
  title: "არჩევნები საქართველოში",
  // The pages and sections in the sidebar. If you don’t specify this option,
  // all pages will be listed in alphabetical order. Listing pages explicitly
  // lets you organize them into sections and have unlisted pages.
  // Some additional configuration options and their defaults:
  theme: "light",
  // theme: "default", // try "light", "dark", "slate", etc.
  footer: "დავით სიჭინავა.", // what to show in the footer (HTML)
  sidebar: false, // whether to show the sidebar
  // toc: true, // whether to show the table of contents
  pager: false, // whether to show previous & next links in the footer
  // output: "dist", // path to the output root for build
  // search: true, // activate search
  // linkify: true, // convert URLs in Markdown to links
  // typographer: false, // smart quotes and other typographic improvements
  // preserveExtension: false, // drop .html from URLs
  // preserveIndex: false, // drop /index from URLs
};
