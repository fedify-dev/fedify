/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { Layout } from "./layout.tsx";

/**
 * Props for the {@link LoginPage} component.
 */
export interface LoginPageProps {
  /**
   * The path prefix for the debug dashboard.
   */
  pathPrefix: string;

  /**
   * Whether to show a username field in addition to the password field.
   */
  showUsername: boolean;

  /**
   * An optional error message to display (e.g., "Invalid credentials").
   */
  error?: string;
}

/**
 * Login page for the debug dashboard.
 */
export const LoginPage: FC<LoginPageProps> = (
  { pathPrefix, showUsername, error },
) => {
  return (
    <Layout title="Login" pathPrefix={pathPrefix}>
      <h2>Login Required</h2>
      <p class="login-description">
        The debug dashboard requires authentication to access.
      </p>
      {error && <p class="login-error">{error}</p>}
      <form method="post" action={pathPrefix + "/login"} class="login-form">
        {showUsername && (
          <div class="login-field">
            <label for="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              required
              autocomplete="username"
            />
          </div>
        )}
        <div class="login-field">
          <label for="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            required
            autocomplete="current-password"
          />
        </div>
        <button type="submit">Log in</button>
      </form>
      <style>
        {`
        .login-form {
          max-width: 320px;
        }
        .login-field {
          margin-bottom: 0.75rem;
        }
        .login-field label {
          display: block;
          margin-bottom: 0.25rem;
          font-weight: 600;
          font-size: 0.875rem;
        }
        .login-field input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 0.875rem;
          box-sizing: border-box;
        }
        .login-form button {
          padding: 0.5rem 1.5rem;
          background: #0969da;
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 0.875rem;
          cursor: pointer;
        }
        .login-form button:hover {
          background: #0860c5;
        }
        .login-error {
          color: #d1242f;
          background: #ffebe9;
          padding: 0.5rem 0.75rem;
          border-radius: 4px;
          font-size: 0.875rem;
        }
        .login-description {
          color: #666;
          font-size: 0.875rem;
        }
        `}
      </style>
    </Layout>
  );
};
