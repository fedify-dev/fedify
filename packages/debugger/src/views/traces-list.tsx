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
   * The list of trace summaries to display.
   */
  traces: TraceSummary[];

  /**
   * The path prefix for the debug dashboard.
   */
  pathPrefix: string;
}

/**
 * The traces list page of the debug dashboard.
 */
export const TracesListPage: FC<TracesListPageProps> = (
  { traces, pathPrefix },
) => {
  return (
    <Layout pathPrefix={pathPrefix}>
      <p>
        Showing <strong>{traces.length}</strong>{" "}
        trace{traces.length !== 1 ? "s" : ""}.
      </p>
      {traces.length === 0
        ? <p class="empty">No traces captured yet.</p>
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
  var interval = setInterval(function() {
    fetch("${pathPrefix}/api/traces")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var countEl = document.querySelector("strong");
        if (countEl) {
          var current = parseInt(countEl.textContent, 10);
          if (data.length !== current) {
            location.reload();
          }
        }
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
