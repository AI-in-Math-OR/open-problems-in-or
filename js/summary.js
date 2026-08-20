/**
 * Summary of Results — aggregates the published export at page load so the
 * figures never drift from the problem listings.
 */
(function () {
  "use strict";

  const EXPORT_INDEX = "data/llm_math_export/index.json";
  const PROGRESS_INDEX = "data/llm_math_export/solution_progress/index.json";
  // Written by `llm-math website export-progress-scores`. Only some batches have
  // been rolled up, so the section keyed to it hides itself when it is absent.
  const SCORE_INDEX = "data/llm_math_export/solution_progress/progress_scores.json";

  // Tones mirror the pill colours used on the problem pages, so a reader who has
  // seen a "solution" pill recognises the same green here.
  const OUTCOMES = [
    { key: "solved", label: "Solution", tone: "positive" },
    { key: "partial", label: "Partial progress", tone: "caution" },
    { key: "none", label: "No write-up yet", tone: "neutral" },
  ];

  const SOLUTION_TYPES = [
    { key: "direct_proof", label: "Direct proof", tone: "teal" },
    { key: "counterexample", label: "Counterexample", tone: "clay" },
  ];

  // Ordered best first, so the chart reads top-down from strongest result.
  const SCORE_LEVELS = [
    { key: "score3", score: 3, label: "3/3 · full solution of the open problem (e.g., bound improved as stated)", tone: "positive" },
    { key: "score2", score: 2, label: "2/3 · major progress, partially improved main result (e.g., bound slightly improved)", tone: "teal" },
    { key: "score1", score: 1, label: "1/3 · progress, main result not improved (e.g., bound unmoved)", tone: "caution" },
    { key: "score0", score: 0, label: "0/3 · little beyond a restatement of the problem", tone: "neutral" },
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function pct(value, total) {
    return total > 0 ? (value / total) * 100 : 0;
  }

  function formatPct(value, total) {
    if (total <= 0) return "—";
    const share = (value / total) * 100;
    return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
  }

  function effectiveArea(problem) {
    const primary = String(problem?.area ?? "").trim();
    if (primary) return primary;
    const evalLabel = String(problem?.evaluation_area_label ?? "").trim();
    if (evalLabel && evalLabel.toLowerCase() !== "none") return evalLabel;
    return String(problem?.subject_classification ?? "").trim();
  }

  function categoryFor(problem) {
    if (typeof window.resolveCategory !== "function") {
      throw new Error("Missing taxonomy: js/taxonomy.js did not load window.resolveCategory.");
    }
    return window.resolveCategory(problem?.category, effectiveArea(problem));
  }

  /** Joins each problem to its solution/partial write-ups and derives one outcome. */
  function buildDataset(exportPayload, progressPayload, scorePayload) {
    const progress = progressPayload?.problems ?? {};
    const scores = scorePayload?.problems ?? {};
    return (exportPayload.problems ?? []).map((problem) => {
      const entry = progress[problem.problem_id] ?? {};
      const solutions = Array.isArray(entry.solutions) ? entry.solutions : [];
      const partials = Array.isArray(entry.partial_progress) ? entry.partial_progress : [];
      const classifications = solutions
        .map((s) => String(s?.classification ?? "").trim())
        .filter(Boolean);
      const attempts = Array.isArray(scores[problem.problem_id]?.attempts)
        ? scores[problem.problem_id].attempts
        : [];
      const scored = attempts.map((a) => Number(a?.score)).filter(Number.isFinite);
      return {
        problem,
        area: effectiveArea(problem) || "unspecified",
        category: categoryFor(problem),
        journal: String(problem.source_paper_journal ?? "").trim() || "Unknown",
        year: problem.source_paper_publication_year ?? null,
        solutions,
        partials,
        classifications,
        attempts,
        bestScore: scored.length ? Math.max(...scored) : null,
        outcome: solutions.length ? "solved" : partials.length ? "partial" : "none",
      };
    });
  }

  function tally(rows, keyFn) {
    const buckets = new Map();
    rows.forEach((row) => {
      const key = keyFn(row);
      if (key === null || key === undefined || key === "") return;
      const bucket = buckets.get(key) ?? { key, total: 0, solved: 0, partial: 0, none: 0 };
      bucket.total += 1;
      bucket[row.outcome] += 1;
      buckets.set(key, bucket);
    });
    return [...buckets.values()];
  }

  function legend(items) {
    const wrap = el("div", "chart-legend");
    items.forEach((item) => {
      const entry = el("span", "chart-legend-item");
      entry.appendChild(el("span", `chart-swatch tone-${item.tone}`));
      entry.appendChild(el("span", null, item.label));
      wrap.appendChild(entry);
    });
    return wrap;
  }

  /** A single full-width bar split into proportional segments. */
  function stackedBar(segments, total) {
    const track = el("div", "bar-track");
    segments.forEach((segment) => {
      if (!segment.value) return;
      const seg = el("div", `bar-seg tone-${segment.tone}`);
      seg.style.width = `${pct(segment.value, total)}%`;
      seg.title = `${segment.label}: ${segment.value} of ${total} (${formatPct(segment.value, total)})`;
      track.appendChild(seg);
    });
    if (!total) track.appendChild(el("div", "bar-seg bar-seg-empty"));
    return track;
  }

  /** Rows of label + stacked bar + count, scaled against the largest row. */
  function barRows(container, rows, segmentDefs, maxTotal) {
    container.replaceChildren();
    const scale = maxTotal || Math.max(...rows.map((r) => r.total), 1);
    rows.forEach((row) => {
      const line = el("div", "bar-row");
      line.appendChild(el("div", "bar-label", row.label));

      const shell = el("div", "bar-shell");
      const inner = el("div", "bar-inner");
      inner.style.width = `${pct(row.total, scale)}%`;
      inner.appendChild(stackedBar(
        segmentDefs.map((def) => ({ ...def, value: row[def.key] ?? 0 })),
        row.total
      ));
      shell.appendChild(inner);
      line.appendChild(shell);

      line.appendChild(el("div", "bar-total", row.total));
      container.appendChild(line);
    });
  }

  function renderKpis(rows) {
    const grid = document.getElementById("kpi-grid");
    const total = rows.length;
    // Counted from the rows rather than read from the export's own counts block,
    // which is a snapshot written at export time and can outlive its numbers.
    const withReview = rows.filter((r) => r.problem?.has_literature_review === true).length;
    const solved = rows.filter((r) => r.outcome === "solved").length;
    const partial = rows.filter((r) => r.outcome === "partial").length;
    const none = rows.filter((r) => r.outcome === "none").length;
    const solutionDocs = rows.reduce((sum, r) => sum + r.solutions.length, 0);
    const partialDocs = rows.reduce((sum, r) => sum + r.partials.length, 0);

    const items = [
      { value: total, label: "Open problems catalogued", note: `${withReview} with a literature review` },
      { value: solved, label: "Problems with a solution", note: `${formatPct(solved, total)} of all problems`, tone: "positive" },
      { value: partial, label: "Problems with partial progress", note: `${formatPct(partial, total)} of all problems`, tone: "caution" },
      { value: none, label: "Problems not yet attempted", note: `${formatPct(none, total)} of all problems` },
      { value: solutionDocs, label: "Solution write-ups" },
      { value: partialDocs, label: "Partial-progress write-ups" },
    ];

    grid.replaceChildren();
    items.forEach((item) => {
      const cell = el("div", `kpi${item.tone ? ` kpi-${item.tone}` : ""}`);
      cell.appendChild(el("dt", "kpi-value", item.value));
      const dd = el("dd", "kpi-meta");
      dd.appendChild(el("span", "kpi-label", item.label));
      if (item.note) dd.appendChild(el("span", "kpi-note", item.note));
      cell.appendChild(dd);
      grid.appendChild(cell);
    });
  }

  function renderOutcomeBar(rows) {
    const host = document.getElementById("outcome-bar");
    const total = rows.length;
    const counts = {
      solved: rows.filter((r) => r.outcome === "solved").length,
      partial: rows.filter((r) => r.outcome === "partial").length,
      none: rows.filter((r) => r.outcome === "none").length,
    };
    host.replaceChildren();
    host.appendChild(legend(OUTCOMES));

    const wide = el("div", "bar-wide");
    wide.appendChild(stackedBar(
      OUTCOMES.map((o) => ({ ...o, value: counts[o.key] })),
      total
    ));
    host.appendChild(wide);

    const caption = el("div", "chart-caption");
    OUTCOMES.forEach((o) => {
      caption.appendChild(el("span", "chart-caption-item",
        `${o.label}: ${counts[o.key]} (${formatPct(counts[o.key], total)})`));
    });
    host.appendChild(caption);
  }

  function renderSolutionTypes(rows) {
    const host = document.getElementById("solution-type-bar");
    const counts = { direct_proof: 0, counterexample: 0, unclassified: 0 };
    rows.forEach((row) => row.classifications.forEach((c) => {
      if (c in counts) counts[c] += 1;
    }));
    // Proof style is authored separately and baked into the progress manifest, so a
    // solution can reach the site before it is classified. Carrying the shortfall as
    // its own segment keeps this chart's total equal to the write-up count above it
    // instead of quietly shrinking.
    const solutionDocs = rows.reduce((sum, r) => sum + r.solutions.length, 0);
    counts.unclassified = Math.max(solutionDocs - counts.direct_proof - counts.counterexample, 0);
    const segments = counts.unclassified
      ? [...SOLUTION_TYPES, { key: "unclassified", label: "Not yet classified", tone: "neutral" }]
      : SOLUTION_TYPES;
    const total = segments.reduce((sum, s) => sum + counts[s.key], 0);

    host.replaceChildren();
    host.appendChild(legend(segments));

    const wide = el("div", "bar-wide");
    wide.appendChild(stackedBar(
      segments.map((t) => ({ ...t, value: counts[t.key] })),
      total
    ));
    host.appendChild(wide);

    const caption = el("div", "chart-caption");
    segments.forEach((t) => {
      caption.appendChild(el("span", "chart-caption-item",
        `${t.label}: ${counts[t.key]} (${formatPct(counts[t.key], total)})`));
    });
    host.appendChild(caption);
  }

  /**
   * Score distribution, hidden entirely until at least one batch has been rolled
   * up and exported. The coverage line names every journal so it stays honest
   * about which parts of the catalogue have been scored and which have not.
   */
  function renderScores(rows) {
    const section = document.getElementById("score-section");
    const scored = rows.filter((r) => r.bestScore !== null);
    if (!scored.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const chartRows = SCORE_LEVELS.map((level) => {
      const total = scored.filter((r) => r.bestScore === level.score).length;
      return { label: level.label, total, [level.key]: total };
    });
    const chart = el("div", "bar-rows bar-rows-wide-labels");
    barRows(chart, chartRows, SCORE_LEVELS);
    document.getElementById("score-chart").replaceChildren(chart);

    const byJournal = new Map();
    rows.forEach((row) => {
      const bucket = byJournal.get(row.journal) ?? { total: 0, scored: 0 };
      bucket.total += 1;
      if (row.bestScore !== null) bucket.scored += 1;
      byJournal.set(row.journal, bucket);
    });
    const coverage = [...byJournal.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
      .map(([journal, b]) => `${journal}: ${b.scored} of ${b.total} scored`)
      .join(" · ");
    document.getElementById("score-coverage").textContent =
      `${scored.length} of ${rows.length} problems have a scored attempt. ${coverage}`;
  }

  function renderGrouped(hostId, rows, keyFn) {
    const host = document.getElementById(hostId);
    const buckets = tally(rows, keyFn)
      .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));

    host.replaceChildren();
    host.appendChild(legend(OUTCOMES));
    const chart = el("div", "bar-rows");
    barRows(chart, buckets.map((b) => ({ ...b, label: b.key })), OUTCOMES);
    host.appendChild(chart);
  }

  function renderYears(rows) {
    const host = document.getElementById("year-chart");
    const counts = new Map();
    rows.forEach((row) => {
      if (row.year === null || row.year === undefined) return;
      counts.set(row.year, (counts.get(row.year) ?? 0) + 1);
    });
    const years = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    const max = Math.max(...years.map(([, n]) => n), 1);

    host.replaceChildren();
    const chart = el("div", "col-chart");
    years.forEach(([year, count]) => {
      const item = el("div", "col-item");
      const wrap = el("div", "col-bar-wrap");
      const bar = el("div", "col-bar tone-accent");
      bar.style.height = `${pct(count, max)}%`;
      bar.title = `${year}: ${count} source papers`;
      wrap.appendChild(el("div", "col-value", count));
      wrap.appendChild(bar);
      item.appendChild(wrap);
      item.appendChild(el("div", "col-label", year));
      chart.appendChild(item);
    });
    host.appendChild(chart);
  }

  function renderTable(rows) {
    const table = document.getElementById("category-table");
    const buckets = tally(rows, (r) => r.category)
      .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));

    const head = el("thead");
    const headRow = el("tr");
    ["Category", "Problems", "Solution", "Partial", "None", "Solved share"].forEach((label, i) => {
      const th = el("th", i === 0 ? null : "num", label);
      th.scope = "col";
      headRow.appendChild(th);
    });
    head.appendChild(headRow);

    const body = el("tbody");
    buckets.forEach((bucket) => {
      const tr = el("tr");
      tr.appendChild(el("td", null, bucket.key));
      tr.appendChild(el("td", "num", bucket.total));
      tr.appendChild(el("td", "num", bucket.solved));
      tr.appendChild(el("td", "num", bucket.partial));
      tr.appendChild(el("td", "num", bucket.none));
      tr.appendChild(el("td", "num", formatPct(bucket.solved, bucket.total)));
      body.appendChild(tr);
    });

    const foot = el("tfoot");
    const footRow = el("tr");
    footRow.appendChild(el("th", null, "All categories"));
    const totals = rows.length;
    const solved = rows.filter((r) => r.outcome === "solved").length;
    [totals, solved, rows.filter((r) => r.outcome === "partial").length,
      rows.filter((r) => r.outcome === "none").length].forEach((value) => {
      footRow.appendChild(el("td", "num", value));
    });
    footRow.appendChild(el("td", "num", formatPct(solved, totals)));
    foot.appendChild(footRow);

    table.replaceChildren(head, body, foot);
  }

  function toCsv(rows) {
    const header = [
      "problem_id", "number", "title", "area", "category", "journal",
      "publication_year", "outcome", "solution_count", "partial_count",
      "solution_classifications", "best_progress_score", "scored_attempts",
      "quantitative_bounds",
      "counterexample_suitability", "alphaevolve_suitability", "has_literature_review",
    ];
    const escape = (value) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = rows.map((row) => [
      row.problem.problem_id,
      row.problem.number,
      row.problem.title,
      row.area,
      row.category,
      row.journal,
      row.year,
      row.outcome,
      row.solutions.length,
      row.partials.length,
      row.classifications.join("|"),
      row.bestScore === null ? "" : `${row.bestScore}/3`,
      row.attempts.length,
      row.problem.quantitative_bounds,
      row.problem.counterexample_suitability,
      row.problem.alphaevolve_suitability,
      row.problem.has_literature_review,
    ].map(escape).join(","));
    return [header.join(","), ...lines].join("\n");
  }

  function wireCsv(rows) {
    const button = document.getElementById("download-csv");
    button.addEventListener("click", () => {
      const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "open-problems-in-or-results.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
    return response.json();
  }

  /** For data the page can do without: a missing file costs one section, not the page. */
  async function fetchOptionalJson(path) {
    try {
      const response = await fetch(path);
      return response.ok ? await response.json() : null;
    } catch (error) {
      return null;
    }
  }

  async function boot() {
    try {
      const [exportPayload, progressPayload, scorePayload] = await Promise.all([
        fetchJson(EXPORT_INDEX),
        fetchJson(PROGRESS_INDEX),
        fetchOptionalJson(SCORE_INDEX),
      ]);
      const rows = buildDataset(exportPayload, progressPayload, scorePayload);

      renderKpis(rows);
      renderOutcomeBar(rows);
      renderSolutionTypes(rows);
      renderScores(rows);
      renderGrouped("category-chart", rows, (r) => r.category);
      renderGrouped("journal-chart", rows, (r) => r.journal);
      renderYears(rows);
      renderTable(rows);
      wireCsv(rows);
    } catch (error) {
      const banner = document.getElementById("summary-error");
      banner.textContent = `Could not build the summary: ${error.message}`;
      banner.hidden = false;
    }
  }

  boot();
})();
