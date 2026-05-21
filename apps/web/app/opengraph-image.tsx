import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Aibenchef · Inteligencia financiera SBS Peru";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "80px",
        background:
          "linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #3b82f6 100%)",
        color: "white",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 40,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 12,
            background: "rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 700,
          }}
        >
          A
        </div>
        <p style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Aibenchef</p>
      </div>

      <h1
        style={{
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.05,
          margin: 0,
          marginBottom: 24,
          maxWidth: 1000,
        }}
      >
        Inteligencia financiera para la banca peruana
      </h1>

      <p
        style={{
          fontSize: 32,
          margin: 0,
          opacity: 0.85,
          maxWidth: 900,
          lineHeight: 1.3,
        }}
      >
        Toda la data publica de la SBS, limpia y lista para decidir.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 60,
          flexWrap: "wrap",
        }}
      >
        {["Banca Multiple", "Financieras", "CMAC", "CRAC", "EDPYMEs"].map((t) => (
          <span
            key={t}
            style={{
              padding: "10px 20px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.15)",
              fontSize: 22,
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>,
    { ...size },
  );
}
