/** Build localized tooltip content independently of map events. */
export function createMapTooltips({lang, t, getParty, partyColor, electionId, activePartyId, getTurnoutMetric}) {
  const _tooltipFallbacks = {
    winner: "Leader",
    subject: "Subject",
    votes: "Votes",
    share: "Share",
    turnout: "Turnout",
    count: "Count",
    registered: "Registered",
    noData: "No data"
  };
  function tooltipLabel(key, fallbackKey = key) {
    return t(`elections.map.tooltip.${key}`) || _tooltipFallbacks[fallbackKey] || key;
  }
  // _tooltipLabels is mutated by setLang() so tooltips opened AFTER a language switch
  // reflect the new translations. Bound (string) tooltip content stays in whichever
  // language was active when the layer was added — accepted trade-off for now.
  function _computeTooltipLabels() {
    return {
      winner:     tooltipLabel("winner"),
      subject:    tooltipLabel("subject"),
      votes:      tooltipLabel("votes"),
      share:      tooltipLabel("share"),
      turnout:    tooltipLabel("turnout"),
      count:      tooltipLabel("count"),
      registered: tooltipLabel("registered"),
      noData:     tooltipLabel("no_data", "noData")
    };
  }
  let _tooltipLabels = _computeTooltipLabels();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const formatted = new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(Math.round(n));
    return lang === "ka" ? formatted.replaceAll(",", " ") : formatted;
  }

  function formatPct(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
  }

  function rowName(row) {
    if (!row) return null;
    const party = getParty?.(row.party_id);
    return (lang === "ka" && (row.name_ka || row.candidate_name_ka))
      || row.name_en
      || row.name_ka
      || row.candidate_name_ka
      || row.candidate_name
      || row.party_label
      || party?.name?.[lang]
      || party?.name?.en
      || row.party_id;
  }

  function turnoutMetricDetails(td, metric) {
    if (!td) return null;
    if (metric === "noon") {
      const pct = td.noon_pct ?? (td.registered > 0 ? td.voted_noon / td.registered : null);
      return {label: t("elections.turnout.metric.noon") || "12:00", count: td.voted_noon, pct};
    }
    if (metric === "5pm") {
      const pct = td.five_pct ?? (td.registered > 0 ? td.voted_5pm / td.registered : null);
      return {label: t("elections.turnout.metric.5pm") || "17:00", count: td.voted_5pm, pct};
    }
    if (metric === "invalid") {
      const pct = td.invalid_pct ?? (td.voted > 0 ? td.invalid_ballots / td.voted : null);
      return {label: t("elections.turnout.metric.invalid") || "Invalid ballots", count: td.invalid_ballots, pct};
    }
    const pct = td.turnout_pct ?? (td.registered > 0 ? td.voted / td.registered : null);
    return {label: t("elections.turnout.metric.final") || _tooltipLabels.turnout, count: td.voted, pct};
  }

  function tooltipFrame(title, rowsHtml) {
    return `<div class="geda-tooltip-frame">
      <div class="geda-tooltip-title">${escapeHtml(title)}</div>
      ${rowsHtml}
    </div>`;
  }

  function tooltipLine(label, value, options = {}) {
    const valueClass = options.wrapValue ? "geda-tooltip-value geda-tooltip-value-wrap" : "geda-tooltip-value";
    return `<div class="geda-tooltip-line">
      <span class="geda-tooltip-label">${escapeHtml(label)}</span>
      <span class="${valueClass}">${escapeHtml(value)}</span>
    </div>`;
  }

  function tooltipSubject(value, color) {
    return `<div class="geda-tooltip-subject" style="color:${escapeHtml(color || "#111111")};">${escapeHtml(value)}</div>`;
  }

  function buildTurnoutTooltip(title, td) {
    const metric = turnoutMetricDetails(td, getTurnoutMetric());
    if (!metric) return tooltipFrame(title, `<div style="font-size:0.74rem;color:#666;">${_tooltipLabels.noData}</div>`);
    return tooltipFrame(title, [
      tooltipLine(metric.label, formatPct(metric.pct)),
      tooltipLine(_tooltipLabels.count, formatCount(metric.count)),
      tooltipLine(_tooltipLabels.registered, formatCount(td.registered))
    ].join(""));
  }

  function selectTooltipResultRow(rows) {
    const activeId = activePartyId();
    if (activeId != null) return rows.find(r => String(r.party_id) === String(activeId)) ?? null;
    return rows.reduce((best, row) => !best || (Number(row.vote_share) || 0) > (Number(best.vote_share) || 0) ? row : best, null);
  }

  function buildResultTooltipFromRows(title, rows) {
    const activeId = activePartyId();
    const row = selectTooltipResultRow(rows);
    if (!row && activeId == null) return tooltipFrame(title, `<div style="font-size:0.74rem;color:#666;">${_tooltipLabels.noData}</div>`);

    const fallbackParty = activeId != null ? getParty?.(activeId) : null;
    const subject = rowName(row) || fallbackParty?.name?.[lang] || fallbackParty?.name?.en || activeId || _tooltipLabels.noData;
    const subjectColor = partyColor(row?.party_id ?? activeId, electionId);
    return tooltipFrame(title, [
      tooltipSubject(subject, subjectColor),
      tooltipLine(_tooltipLabels.votes, formatCount(row?.votes ?? 0)),
      tooltipLine(_tooltipLabels.share, formatPct(row?.vote_share ?? 0))
    ].join(""));
  }

  function buildAreaResultTooltip(title, rows, id) {
    return buildResultTooltipFromRows(
      title,
      rows.filter(r => String(r.district_id) === String(id))
    );
  }

  return {
    buildTurnoutTooltip, buildResultTooltipFromRows, buildAreaResultTooltip,
    setLang(nextLang, translate) {
      lang = nextLang;
      t = translate;
      _tooltipLabels = _computeTooltipLabels();
    }
  };
}

/** Keep at most one highlighted tooltip target, even if mouseout is missed. */
export function createMapHover() {
  let active = null;
  function clear() {
    const previous = active;
    active = null;
    previous?.element?.classList.remove("geda-hovered");
    previous?.layer.closeTooltip();
  }
  return {
    clear,
    enter(layer) {
      if (active?.layer === layer) return;
      clear();
      const element = layer.getElement?.();
      element?.classList.add("geda-hovered");
      active = {layer, element};
    },
    leave(layer) {
      if (active?.layer === layer) clear();
    }
  };
}

export function bindMapTooltip(layer, contentFn, hover) {
  layer.on("mouseover tooltipopen", () => hover.enter(layer));
  layer.on("mouseout tooltipclose remove", () => hover.leave(layer));
  layer.bindTooltip(() => contentFn(), {
    className: "geda-map-tooltip",
    direction: "top",
    offset: [0, -6],
    opacity: 0.96,
    sticky: false
  });
  layer.on("mousedown", hover.clear);
}
