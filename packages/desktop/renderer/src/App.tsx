import { useState } from "react";

type Tab = "kalkulator" | "historia" | "admin";

export default function App() {
  const [tab, setTab] = useState<Tab>("kalkulator");

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Planlux Hale</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Aplikacja offline-first dla przedstawicieli handlowych PLANLUX.
      </p>

      <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["kalkulator", "historia", "admin"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.5rem 1rem",
              fontWeight: tab === t ? "bold" : "normal",
              background: tab === t ? "#222" : "#eee",
              color: tab === t ? "#fff" : "#222",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {t === "kalkulator" ? "Kalkulator" : t === "historia" ? "Historia" : "Panel admina"}
          </button>
        ))}
      </nav>

      {tab === "kalkulator" && (
        <section>
          <h2>Kalkulator wyceny</h2>
          <p>Konfiguracja hali, dodatki, podsumowanie – miejsce na formularz wyceny.</p>
        </section>
      )}
      {tab === "historia" && (
        <section>
          <h2>Historia</h2>
          <p>Lista PDF i e-maili – filtry: klient, data, status.</p>
        </section>
      )}
      {tab === "admin" && (
        <section>
          <h2>Panel admina</h2>
          <p>Użytkownicy, aktywność, historia globalna.</p>
        </section>
      )}
    </div>
  );
}
