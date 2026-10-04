/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { TraceSummary } from "@fedify/fedify/otel";
import { Layout } from "./layout.tsx";

/**
 * Props for the {@link TracesListPage} component.
 */
export interface TracesListPageProps {
  /**
   * The list of trace summaries to display, already filtered by
   * {@link selectedTypes} when it is non-empty.
   */
  traces: TraceSummary[];

  /**
   * The distinct activity types available to filter by, derived from the
   * unfiltered trace set.
   */
  availableTypes: readonly string[];

  /**
   * The activity types currently selected in the filter form.
   */
  selectedTypes: readonly string[];

  /**
   * The same snapshot string the live-poll script computes from a fresh
   * `/api/traces` fetch, computed here from the data this page was
   * actually rendered with.  The script starts comparing from this value
   * instead of from whatever its first poll happens to see, so a change
   * that landed between the render and the first poll is still caught.
   */
  initialSnapshot: string;

  /**
   * The path prefix for the debug dashboard.
   */
  pathPrefix: string;
}

/**
 * The traces list page of the debug dashboard.
 */
export const TracesListPage: FC<TracesListPageProps> = (
  { traces, availableTypes, selectedTypes, initialSnapshot, pathPrefix },
) => {
  const filtered = selectedTypes.length > 0;
  return (
    <Layout pathPrefix={pathPrefix}>
      {availableTypes.length > 0 && (
        <form class="filter-form" method="get" action={`${pathPrefix}/`}>
          <fieldset>
            <legend>Filter by activity type</legend>
            {availableTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  name="type"
                  value={type}
                  checked={selectedTypes.includes(type)}
                />
                {type}
              </label>
            ))}
          </fieldset>
          <div class="filter-actions">
            <button type="submit">Filter</button>
            {filtered && <a href={`${pathPrefix}/`}>Clear filters</a>}
          </div>
        </form>
      )}
      <p>
        Showing <strong>{traces.length}</strong>{" "}
        trace{traces.length !== 1 ? "s" : ""}.
      </p>
      {traces.length === 0
        ? (
          <p class="empty">
            {filtered
              ? "No traces match the selected filters."
              : "No traces captured yet."}
          </p>
        )
        : (
          <table>
            <thead>
              <tr>
                <th>Trace ID</th>
                <th>Activity Types</th>
                <th>Activities</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.traceId}>
                  <td>
                    <a href={`${pathPrefix}/traces/${trace.traceId}`}>
                      <code>{trace.traceId.slice(0, 8)}</code>
                    </a>
                  </td>
                  <td>
                    {trace.activityTypes.map((t) => (
                      <span key={t} class="badge">
                        {t}
                      </span>
                    ))}
                    {trace.activityTypes.length === 0 && (
                      <span class="empty">none</span>
                    )}
                  </td>
                  <td>{trace.activityCount}</td>
                  <td>
                    <time datetime={trace.timestamp}>
                      {trace.timestamp}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  var selectedTypes = new URLSearchParams(location.search).getAll("type");
  function snapshotOf(data) {
    var types = [];
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      var activityTypes = (data[i].activityTypes || []).slice().sort();
      var matchesFilter = selectedTypes.length === 0;
      for (var j = 0; j < activityTypes.length; j++) {
        if (types.indexOf(activityTypes[j]) === -1) types.push(activityTypes[j]);
        if (!matchesFilter && selectedTypes.indexOf(activityTypes[j]) !== -1) {
          matchesFilter = true;
        }
      }
      if (matchesFilter) {
        rows.push(
          data[i].traceId + ":" + activityTypes.join("+") + ":" +
            data[i].activityCount,
        );
      }
    }
    types.sort();
    rows.sort();
    return types.join(",") + "|" + rows.join(";");
  }
  var prevSnapshot = ${
            JSON.stringify(initialSnapshot).replace(/</g, "\\u003c")
          };
  var interval = setInterval(function() {
    fetch(${
            JSON.stringify(pathPrefix).replace(/</g, "\\u003c")
          } + "/api/traces")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var snapshot = snapshotOf(data);
        if (snapshot !== prevSnapshot) {
          location.reload();
        }
        prevSnapshot = snapshot;
      })
      .catch(function() {});
  }, 3000);
  window.addEventListener("beforeunload", function() {
    clearInterval(interval);
  });
})();
`,
        }}
      />
    </Layout>
  );
};
