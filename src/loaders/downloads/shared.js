import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";

export const ROOT = process.cwd();
export const SRC = path.join(ROOT, "src");
export const ELECTIONS_DIR = path.join(SRC, "data", "config", "elections");
export const PARTIES_YML = path.join(SRC, "data", "config", "parties.yml");
export const OUT_DIR = path.join(SRC, "data", "downloads");
export const PARL2024_DOWNLOAD_FILENAME = "parl_2024_main_20241026_data.xlsx";

export function ensureDownloadsDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

export function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, "utf8"));
}

export function readAllElections() {
  const elections = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (/\.ya?ml$/i.test(entry.name)) {
        const election = readYaml(p);
        if (election?.id) elections.push(election);
      }
    }
  }
  scan(ELECTIONS_DIR);
  return elections;
}

export function readElection(id) {
  const election = readAllElections().find(e => e.id === id);
  if (!election) throw new Error(`Election config not found: ${id}`);
  return election;
}

export function readParties() {
  return readYaml(PARTIES_YML) ?? {};
}

export function partyList(partiesYaml) {
  return Array.isArray(partiesYaml?.parties) ? partiesYaml.parties : [];
}

export function buildPartyLookup(partiesYaml, electionParties = []) {
  const lookup = {};
  for (const p of partyList(partiesYaml)) {
    if (!p?.id) continue;
    lookup[p.id] = {
      id: p.id,
      name_en: p.name?.en ?? p.id,
      name_ka: p.name?.ka ?? p.name?.en ?? p.id,
      color: p.color ?? null,
    };
  }
  for (const ep of electionParties ?? []) {
    if (!ep?.id) continue;
    const base = lookup[ep.id] ?? { id: ep.id, name_en: ep.id, name_ka: ep.id };
    lookup[ep.id] = {
      ...base,
      name_en: ep.alias?.en ?? ep.name?.en ?? base.name_en,
      name_ka: ep.alias?.ka ?? ep.name?.ka ?? base.name_ka,
      color: ep.color ?? base.color,
      threshold_status: ep.threshold_status ?? null,
      seats_pr: ep.seats_pr ?? null,
      seats_smd: ep.seats_smd ?? null,
    };
  }
  return lookup;
}

export function sanitize(s) {
  return (s ?? "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60)
    .replace(/_$/, "");
}

export function subTypeLabel(sub) {
  if (!sub || sub.id === "__main__") return "main";
  if (sub.type === "runoff") return "runoff";
  if (sub.type === "by_election") return "by_election";
  return sub.type ?? "sub";
}

export function dateToken(election) {
  return (election.date ?? "").split(/\s/)[0].replace(/-/g, "");
}

export function legacyFilenamePrefix(election, sub) {
  const name = sanitize(election.name?.en ?? election.id);
  return `${name}_${subTypeLabel(sub)}_${dateToken(election)}_data_`;
}

export function mainSubElection() {
  return { id: "__main__", type: "main", name: { en: "Main" } };
}

export function subElections(election) {
  return [mainSubElection(), ...(election.sub_elections ?? []).filter(s => s?.id)];
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function downloadEntry(election, sub, filename) {
  const filePath = path.join(OUT_DIR, filename);
  const stat = fs.statSync(filePath);
  const isMain = !sub || sub.id === "__main__";
  return {
    election_id: election.id,
    election_type: election.type,
    sub_id: isMain ? "__main__" : sub.id,
    sub_type: subTypeLabel(sub),
    label_en: election.name?.en ?? election.id,
    label_ka: election.name?.ka ?? "",
    sub_name_en: isMain ? "Main" : (sub.name?.en ?? sub.id),
    sub_name_ka: isMain ? "" : (sub.name?.ka ?? ""),
    date: election.date ?? "",
    filename,
    sha: sha256File(filePath),
    size_bytes: stat.size,
  };
}

export function latestLegacyDownload(election, sub) {
  if (!fs.existsSync(OUT_DIR)) return null;
  const prefix = legacyFilenamePrefix(election, sub);
  const files = fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith(".xlsx") && f.startsWith(prefix))
    .map(filename => {
      const filePath = path.join(OUT_DIR, filename);
      return { filename, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename));
  return files[0]?.filename ?? null;
}

export function collectLegacyDownloadEntries({ excludeIds = new Set() } = {}) {
  const entries = [];
  for (const election of readAllElections()) {
    if (excludeIds.has(election.id)) continue;
    for (const sub of subElections(election)) {
      const filename = latestLegacyDownload(election, sub);
      if (filename) entries.push(downloadEntry(election, sub, filename));
    }
  }
  return entries;
}

export function resolveSrcPath(p) {
  return p ? path.join(SRC, p) : null;
}

export function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
