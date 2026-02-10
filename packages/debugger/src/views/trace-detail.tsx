/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { TraceActivityRecord } from "@fedify/fedify/otel";
import type { SerializedLogRecord } from "../mod.tsx";
import { Layout } from "./layout.tsx";

/**
 * Props for the {@link TraceDetailPage} component.
 */
export interface TraceDetailPageProps {
  /**
   * The trace ID being displayed.
   */
  traceId: string;

  /**
   * The list of activity records for this trace.
   */
  activities: TraceActivityRecord[];

  /**
   * The list of log records for this trace.
   */
  logs: SerializedLogRecord[];

  /**
   * The path prefix for the debug dashboard.
   */
  pathPrefix: string;
}

/**
 * The trace detail page of the debug dashboard.
 */
export const TraceDetailPage: FC<TraceDetailPageProps> = (
  { traceId, activities, logs, pathPrefix },
) => {
  return (
    <Layout pathPrefix={pathPrefix} title={`Trace ${traceId.slice(0, 8)}`}>
      <nav>
        <a href={`${pathPrefix}/`}>&larr; Back to traces</a>
      </nav>

      <h2>
        Trace <code>{traceId.slice(0, 8)}</code>
      </h2>
      <p>
        Full ID: <code>{traceId}</code> &mdash;{" "}
        <strong>{activities.length}</strong>{" "}
        activit{activities.length !== 1 ? "ies" : "y"},{" "}
        <strong>{logs.length}</strong> log record{logs.length !== 1 ? "s" : ""}
      </p>

      {activities.length === 0
        ? <p class="empty">No activities found for this trace.</p>
        : (
          activities.map((activity) => (
            <div key={activity.spanId} class="detail-section">
              <h2>
                <span
                  class={`badge ${
                    activity.direction === "inbound"
                      ? "badge-inbound"
                      : "badge-outbound"
                  }`}
                >
                  {activity.direction}
                </span>{" "}
                {activity.activityType}
              </h2>

              <table>
                <tbody>
                  <tr>
                    <th>Span ID</th>
                    <td>
                      <code>{activity.spanId}</code>
                    </td>
                  </tr>
                  {activity.parentSpanId != null && (
                    <tr>
                      <th>Parent Span</th>
                      <td>
                        <code>{activity.parentSpanId}</code>
                      </td>
                    </tr>
                  )}
                  {activity.activityId != null && (
                    <tr>
                      <th>Activity ID</th>
                      <td>
                        <code>{activity.activityId}</code>
                      </td>
                    </tr>
                  )}
                  {activity.actorId != null && (
                    <tr>
                      <th>Actor</th>
                      <td>
                        <code>{activity.actorId}</code>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <th>Timestamp</th>
                    <td>
                      <time datetime={activity.timestamp}>
                        {activity.timestamp}
                      </time>
                    </td>
                  </tr>
                  {activity.direction === "outbound" &&
                    activity.inboxUrl != null && (
                    <tr>
                      <th>Inbox URL</th>
                      <td>
                        <code>{activity.inboxUrl}</code>
                      </td>
                    </tr>
                  )}
                  {activity.direction === "inbound" && (
                    <tr>
                      <th>Verified</th>
                      <td>{activity.verified ? "Yes" : "No"}</td>
                    </tr>
                  )}
                  {activity.signatureDetails != null && (
                    <tr>
                      <th>Signature Details</th>
                      <td>
                        HTTP Signatures:{" "}
                        {activity.signatureDetails.httpSignaturesVerified
                          ? "verified"
                          : "not verified"}
                        {activity.signatureDetails.httpSignaturesKeyId !=
                            null &&
                          (
                            <span>
                              &nbsp;(key:&nbsp;
                              <code>
                                {activity.signatureDetails.httpSignaturesKeyId}
                              </code>)
                            </span>
                          )}
                        <br />
                        LD Signatures:{" "}
                        {activity.signatureDetails.ldSignaturesVerified
                          ? "verified"
                          : "not verified"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <details>
                <summary>Activity JSON</summary>
                <pre>{formatJson(activity.activityJson)}</pre>
              </details>
            </div>
          ))
        )}

      <h2>Logs</h2>
      {logs.length === 0
        ? <p class="empty">No logs captured for this trace.</p>
        : (
          <table class="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Category</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={i} class={`log-${log.level}`}>
                  <td>
                    <time datetime={new Date(log.timestamp).toISOString()}>
                      {new Date(log.timestamp).toISOString().slice(11, 23)}
                    </time>
                  </td>
                  <td>
                    <span class={`badge badge-${log.level}`}>{log.level}</span>
                  </td>
                  <td>
                    <code>{log.category.join(".")}</code>
                  </td>
                  <td>
                    {log.message}
                    {Object.keys(log.properties).length > 0 && (
                      <details>
                        <summary>Properties</summary>
                        <pre>
                          {JSON.stringify(log.properties, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Layout>
  );
};

function formatJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
