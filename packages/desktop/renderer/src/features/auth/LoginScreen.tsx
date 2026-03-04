import { useState, useEffect } from "react";
import { tokens } from "../../theme/tokens";

const styles = {
  root: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #1a2332 0%, #252f3f 100%)",
  } as React.CSSProperties,
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.lg,
    padding: tokens.space[6],
    width: 400,
  } as React.CSSProperties,
  title: {
    fontFamily: tokens.font.family,
    fontSize: tokens.font.size["2xl"],
    fontWeight: tokens.font.weight.semiBold,
    color: tokens.color.navy,
    marginBottom: tokens.space[2],
  } as React.CSSProperties,
  subtitle: {
    color: tokens.color.textMuted,
    fontSize: tokens.font.size.sm,
    marginBottom: tokens.space[6],
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "12px 16px",
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    fontSize: tokens.font.size.base,
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  button: {
    width: "100%",
    padding: 14,
    background: tokens.color.primary,
    color: tokens.color.white,
    border: "none",
    borderRadius: tokens.radius.md,
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,
  error: {
    color: tokens.color.error,
    fontSize: tokens.font.size.sm,
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
};

interface Props {
  onLogin: (email: string, password: string) => Promise<boolean>;
  /** Invoke planlux:syncUsers (optional). Called on mount with short delay to refresh user list from backend. */
  api?: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function LoginScreen({ onLogin, api }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!api) return;
    const timeoutMs = 500;
    const t = setTimeout(() => {
      Promise.race([
        api("planlux:syncUsers"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]).catch(() => {});
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [api]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zalogować");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>Planlux Hale</h1>
        <p style={styles.subtitle}>Zaloguj się, aby kontynuować</p>
        {error && <p style={styles.error}>{error}</p>}
        <input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          required
        />
        <input
          type="password"
          placeholder="Hasło"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
        />
        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? "Logowanie..." : "Zaloguj się"}
        </button>
      </form>
    </div>
  );
}
