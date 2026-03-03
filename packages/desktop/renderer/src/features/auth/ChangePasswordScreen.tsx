import { useState } from "react";
import { tokens } from "../../theme/tokens";

const MIN_PASSWORD_LENGTH = 8;

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
    boxSizing: "border-box" as const,
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
  user: { id: string; email: string; role: string; displayName?: string };
  onChangePassword: (newPassword: string) => Promise<void>;
}

export function ChangePasswordScreen({ user, onChangePassword }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków`);
      return;
    }
    if (newPassword !== repeatPassword) {
      setError("Hasła nie są identyczne");
      return;
    }
    setLoading(true);
    try {
      await onChangePassword(newPassword);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zmienić hasła");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>Zmień hasło</h1>
        <p style={styles.subtitle}>
          Twoje konto wymaga ustawienia nowego hasła przed wejściem do aplikacji.
        </p>
        {error && <p style={styles.error}>{error}</p>}
        <input
          type="password"
          placeholder="Nowe hasło (min. 8 znaków)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={styles.input}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <input
          type="password"
          placeholder="Powtórz hasło"
          value={repeatPassword}
          onChange={(e) => setRepeatPassword(e.target.value)}
          style={styles.input}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
        />
        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? "Zapisywanie..." : "Zapisz hasło i kontynuuj"}
        </button>
      </form>
    </div>
  );
}
