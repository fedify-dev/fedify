/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from "hono/jsx";

/**
 * Props for the {@link Layout} component.
 */
export interface LayoutProps {
  /**
   * The page title.  Appended to "Fedify Debug Dashboard".
   */
  title?: string;

  /**
   * The path prefix for the debug dashboard (used for linking).
   */
  pathPrefix: string;
}

/**
 * Root HTML layout for the debug dashboard.
 */
export const Layout: FC<PropsWithChildren<LayoutProps>> = (
  { title, pathPrefix, children },
) => {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>
          {title != null ? `${title} — ` : ""}Fedify Debug Dashboard
        </title>
        <style>
          {`
          body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 960px;
            margin: 0 auto;
            padding: 1rem;
            color: #333;
          }
          header { border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; margin-bottom: 1rem; }
          header h1 { margin: 0; font-size: 1.25rem; }
          header h1 a { color: inherit; text-decoration: none; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
          th { font-weight: 600; font-size: 0.875rem; color: #666; }
          a { color: #0969da; }
          code { background: #f0f0f0; padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.875em; }
          .badge { display: inline-block; background: #e0e0e0; color: #333; padding: 0.15em 0.5em; border-radius: 3px; font-size: 0.75rem; }
          .badge-inbound { background: #ddf4ff; color: #0969da; }
          .badge-outbound { background: #fff8c5; color: #9a6700; }
          .detail-section { margin-bottom: 1.5rem; }
          .detail-section h2 { font-size: 1rem; margin-bottom: 0.5rem; border-bottom: 1px solid #eee; padding-bottom: 0.25rem; }
          pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; font-size: 0.8125rem; }
          .empty { color: #888; font-style: italic; }
          nav a { margin-right: 0.5rem; }
          .log-table td { font-size: 0.8125rem; vertical-align: top; }
          .log-table time { font-family: monospace; white-space: nowrap; }
          .badge-debug { background: #e8e8e8; color: #666; }
          .badge-info { background: #ddf4ff; color: #0969da; }
          .badge-warning { background: #fff8c5; color: #9a6700; }
          .badge-error { background: #ffebe9; color: #cf222e; }
          .badge-fatal { background: #cf222e; color: #fff; }
          .log-error td { background: #fff5f5; }
          .log-fatal td { background: #ffebe9; }

          @media (prefers-color-scheme: dark) {
            body { background: #0d1117; color: #e6edf3; }
            header { border-bottom-color: #30363d; }
            th { color: #9198a1; }
            th, td { border-bottom-color: #21262d; }
            a { color: #58a6ff; }
            code { background: #161b22; }
            .badge { background: #30363d; color: #e6edf3; }
            .badge-inbound { background: #122d42; color: #58a6ff; }
            .badge-outbound { background: #2e2a1f; color: #d29922; }
            .detail-section h2 { border-bottom-color: #21262d; }
            pre { background: #161b22; }
            .empty { color: #9198a1; }
            .badge-debug { background: #21262d; color: #9198a1; }
            .badge-info { background: #122d42; color: #58a6ff; }
            .badge-warning { background: #2e2a1f; color: #d29922; }
            .badge-error { background: #3d1f20; color: #f85149; }
            .badge-fatal { background: #da3633; color: #fff; }
            .log-error td { background: #2d1215; }
            .log-fatal td { background: #3d1f20; }
          }
        `}
        </style>
      </head>
      <body>
        <header>
          <h1>
            <a href={pathPrefix + "/"}>Fedify Debug Dashboard</a>
          </h1>
        </header>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
};
