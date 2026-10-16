"use client";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, Send, Volume2, VolumeX, RefreshCw, ExternalLink, Check, X, Database, KeyRound } from "lucide-react";
import { Header } from "@/components/layout/Header";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Turno = { role: "user" | "assistant"; content: string };
type Resultado = { texto: string; url?: string; ok: boolean };
type Mensaje = {
  id: number;
  quien: "yo" | "asistente";
  texto: string;
  resultados?: Resultado[];
  pendientes?: any[];
  error?: boolean;
};
type BaseMapa = { id: string; titulo: string; url?: string; rol: string | null; campos: { nombre: string; tipo: string; rol: string | null }[] };
type EstadoNotion =
  | { conectado: false; motivo: string; sinLlave?: boolean }
  | { conectado: true; workspace: string; bases: BaseMapa[]; personas: string[]; faltan: string[] };

const EJEMPLOS = [
  "Apunta una idea: bundle de Navidad de Pleena con el sérum y la mascarilla",
  "Tarea para Hamlet: subir los videos de Balancea el lunes",
  "¿Qué tengo pendiente para hoy?",
];

const sinSuscripcion = () => () => {};
const soportaVoz = () => !!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
const leerVozGuardada = () => {
  try {
    return localStorage.getItem("asistente_voz") !== "0";
  } catch {
    return true;
  }
};

function Asistente() {
  const [llave, setLlave] = useState("");
  const [conectando, setConectando] = useState(false);
  const [errorLlave, setErrorLlave] = useState("");
  const [cambiandoLlave, setCambiandoLlave] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [historial, setHistorial] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [pensando, setPensando] = useState(false);
  const [vozElegida, setVozElegida] = useState<boolean | null>(null);
  const vozGuardada = useSyncExternalStore(sinSuscripcion, leerVozGuardada, () => true);
  const voz = vozElegida ?? vozGuardada;
  const sinMicrofono = !useSyncExternalStore(sinSuscripcion, soportaVoz, () => true);
  const [notion, setNotion] = useState<EstadoNotion | null>(null);
  const [verMapa, setVerMapa] = useState(false);
  const reconocedor = useRef<any>(null);
  const finalRef = useRef("");
  const idRef = useRef(0);
  const finRef = useRef<HTMLDivElement>(null);

  const agregar = (m: Omit<Mensaje, "id">) => setMensajes((prev) => [...prev, { ...m, id: ++idRef.current }]);

  const hablar = useCallback(
    (frase: string) => {
      if (!voz || typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(frase);
      const voces = window.speechSynthesis.getVoices();
      u.voice = voces.find((v) => v.lang === "es-MX") ?? voces.find((v) => v.lang.startsWith("es")) ?? null;
      u.lang = u.voice?.lang ?? "es-MX";
      window.speechSynthesis.speak(u);
    },
    [voz],
  );

  const cargarNotion = useCallback(async (refrescar = false) => {
    const r = await fetch(`/api/asistente/mapa${refrescar ? "?refrescar=1" : ""}`);
    setNotion(await r.json());
  }, []);

  const conectar = async () => {
    if (!llave.trim() || conectando) return;
    setConectando(true);
    setErrorLlave("");
    try {
      const r = await fetch("/api/asistente/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: llave }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErrorLlave(d.error ?? "No se pudo conectar.");
        return;
      }
      setNotion(d);
      setLlave("");
      setCambiandoLlave(false);
      hablar(`Listo, conectado a ${d.workspace}.`);
    } catch {
      setErrorLlave("No hay conexión con el servidor.");
    } finally {
      setConectando(false);
    }
  };

  useEffect(() => {
    fetch("/api/asistente/mapa")
      .then((r) => r.json())
      .then(setNotion)
      .catch(() => setNotion({ conectado: false, motivo: "no respondió el servidor" }));
    window.speechSynthesis?.getVoices(); // precarga la lista de voces
  }, []);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, pensando]);

  const llamar = async (cuerpo: object): Promise<any> => {
    setPensando(true);
    try {
      const r = await fetch("/api/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const d = await r.json();
      if (!r.ok) {
        agregar({ quien: "asistente", texto: d.error ?? "Algo falló.", error: true });
        return null;
      }
      setHistorial((h) => [...h, ...(d.historial ?? [])].slice(-10));
      agregar({ quien: "asistente", texto: d.respuesta, resultados: d.resultados, pendientes: d.pendientes });
      hablar(d.pendientes ? `${d.respuesta} ¿Confirmas?` : d.respuesta);
      return d;
    } catch {
      agregar({ quien: "asistente", texto: "No hay conexión con el servidor.", error: true });
      return null;
    } finally {
      setPensando(false);
    }
  };

  const enviar = async (frase: string) => {
    const t = frase.trim();
    if (!t || pensando) return;
    setTexto("");
    agregar({ quien: "yo", texto: t });
    await llamar({ texto: t, historial });
  };

  const confirmar = async (m: Mensaje, si: boolean) => {
    setMensajes((prev) => prev.map((x) => (x.id === m.id ? { ...x, pendientes: undefined } : x)));
    if (si) {
      agregar({ quien: "yo", texto: "Sí, confírmalo" });
      await llamar({ ejecutar: m.pendientes, historial });
      return;
    }
    agregar({ quien: "yo", texto: "No, cancélalo" });
    setHistorial((h) =>
      [
        ...h,
        { role: "user" as const, content: "[sistema] La jefa NO confirmó; no se ejecutó nada." },
        { role: "assistant" as const, content: JSON.stringify({ respuesta: "ok", pregunta: null, necesita_confirmacion: false, acciones: [] }) },
      ].slice(-10),
    );
    agregar({ quien: "asistente", texto: "De acuerdo, no hago nada." });
    hablar("De acuerdo, no hago nada.");
  };

  const escuchar = () => {
    if (escuchando) {
      reconocedor.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    window.speechSynthesis?.cancel();
    const rec = new SR();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = false;
    finalRef.current = "";
    rec.onresult = (e: any) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else parcial += r[0].transcript;
      }
      setTexto((finalRef.current + " " + parcial).trim());
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        agregar({ quien: "asistente", texto: "El navegador no dio permiso al micrófono. Actívalo en el candado de la barra de direcciones o escribe abajo.", error: true });
      }
    };
    rec.onend = () => {
      setEscuchando(false);
      const dicho = finalRef.current.trim();
      if (dicho) enviar(dicho);
    };
    reconocedor.current = rec;
    setEscuchando(true);
    try {
      rec.start();
    } catch {
      setEscuchando(false);
    }
  };

  const alternarVoz = () => {
    const v = !voz;
    setVozElegida(v);
    if (!v) window.speechSynthesis?.cancel();
    try {
      localStorage.setItem("asistente_voz", v ? "1" : "0");
    } catch {}
  };

  const desconectado = notion && !notion.conectado;

  return (
    <div className="flex flex-col" style={{ minHeight: "100vh" }}>
      <Header title="Asistente de voz" subtitle="Habla o escribe y queda en tu Notion" />

      <div className="flex-1 w-full flex flex-col gap-3" style={{ maxWidth: 672, margin: "0 auto", padding: "16px 16px 0" }}>
        {/* Conectar Notion: pegar la llave y queda funcionando al instante */}
        {notion && (!notion.conectado || cambiandoLlave) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              conectar();
            }}
            className="rounded-xl text-sm flex flex-col gap-2.5"
            style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 14 }}
          >
            <div className="flex items-center gap-2" style={{ color: "var(--text)" }}>
              <KeyRound size={15} style={{ color: "#0E766E" }} />
              <b>{notion.conectado ? "Cambiar la llave de Notion" : "Conecta tu Notion"}</b>
            </div>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Pega la llave de la integración «Asistente de voz» (empieza por <code>ntn_</code>). Se conecta en el momento.
            </p>
            {!notion.conectado && !(notion as any).sinLlave && (
              <p className="text-xs" style={{ color: "var(--red-text)" }}>
                La llave guardada no funciona: {(notion as any).motivo}
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="password"
                autoComplete="off"
                value={llave}
                onChange={(e) => setLlave(e.target.value)}
                placeholder="ntn_…"
                className="flex-1 min-w-0 rounded-lg outline-none text-base"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px 10px" }}
              />
              <button
                type="submit"
                disabled={!llave.trim() || conectando}
                className="rounded-lg text-sm font-semibold text-white disabled:opacity-50 shrink-0"
                style={{ background: "#0E766E", padding: "8px 14px" }}
              >
                {conectando ? "Conectando…" : "Conectar"}
              </button>
            </div>
            {errorLlave && (
              <p className="text-xs" style={{ color: "var(--red-text)" }}>
                {errorLlave}
              </p>
            )}
            {notion.conectado && (
              <button type="button" onClick={() => setCambiandoLlave(false)} className="text-xs self-start" style={{ color: "var(--text-3)" }}>
                Cancelar
              </button>
            )}
          </form>
        )}

        {/* Estado de Notion */}
        {(!notion || notion.conectado) && (
        <div className="rounded-xl text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "10px 12px" }}>
          <div className="flex items-center gap-2">
            <Database size={14} style={{ color: "var(--text-3)" }} />
            {!notion && <span style={{ color: "var(--text-3)" }}>Revisando Notion…</span>}
            {notion?.conectado && (
              <span style={{ color: "var(--text-2)" }}>
                Notion: <b>{notion.workspace}</b> · {notion.bases.filter((b) => b.rol).length} bases en uso
                {notion.faltan.length > 0 && <span style={{ color: "var(--yellow-text)" }}> · sin base para {notion.faltan.join(", ")}</span>}
              </span>
            )}
            <div className="flex items-center gap-1" style={{ marginLeft: "auto" }}>
              {notion?.conectado && (
                <>
                  <button onClick={() => setVerMapa((v) => !v)} className="rounded-md" style={{ color: "var(--text-3)", padding: "4px 8px" }}>
                    {verMapa ? "Ocultar" : "Ver bases"}
                  </button>
                  <button onClick={() => setCambiandoLlave(true)} className="rounded-md" style={{ color: "var(--text-3)", padding: "4px 8px" }}>
                    Cambiar llave
                  </button>
                </>
              )}
              <button onClick={() => cargarNotion(true)} title="Volver a leer Notion" className="rounded-md" style={{ color: "var(--text-3)", padding: 4 }}>
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
          {verMapa && notion?.conectado && (
            <ul className="flex flex-col gap-1.5" style={{ marginTop: 8, listStyle: "none" }}>
              {notion.bases.map((b) => (
                <li key={b.id} style={{ color: "var(--text-2)" }}>
                  <span className="font-semibold">{b.titulo}</span>
                  {b.rol ? <span style={{ color: "var(--green-text)" }}> → {b.rol}</span> : <span style={{ color: "var(--text-4)" }}> (sin rol)</span>}
                  <span style={{ color: "var(--text-4)" }}> · {b.campos.map((c) => c.nombre).join(", ")}</span>
                </li>
              ))}
              <li style={{ color: "var(--text-3)" }}>Personas: {notion.personas.join(", ") || "ninguna visible"}</li>
            </ul>
          )}
        </div>
        )}

        {/* Conversación */}
        <div className="flex-1 flex flex-col gap-2.5">
          {mensajes.length === 0 && (
            <div className="flex flex-col items-center gap-3 text-center" style={{ padding: "32px 0" }}>
              <p className="text-sm" style={{ color: "var(--text-2)" }}>
                Pulsa el micrófono y dile qué anotar. Ejemplos:
              </p>
              {EJEMPLOS.map((e) => (
                <button
                  key={e}
                  onClick={() => enviar(e)}
                  disabled={pensando || !!desconectado}
                  className="text-xs rounded-full disabled:opacity-50"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text-2)", padding: "6px 12px" }}
                >
                  «{e}»
                </button>
              ))}
            </div>
          )}

          {mensajes.map((m) => (
            <div key={m.id} className={`flex ${m.quien === "yo" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[85%] rounded-2xl text-sm"
                style={
                  m.quien === "yo"
                    ? { background: "#0E766E", color: "#fff", padding: "10px 14px" }
                    : {
                        padding: "10px 14px",
                        background: m.error ? "var(--red-bg)" : "var(--card)",
                        color: m.error ? "var(--red-text)" : "var(--text)",
                        border: "1px solid var(--border)",
                      }
                }
              >
                <p>{m.texto}</p>
                {m.resultados?.some((r) => r.url) && (
                  <div className="flex flex-col gap-1" style={{ marginTop: 6 }}>
                    {m.resultados.filter((r) => r.url).map((r, i) => (
                      <a key={i} href={r.url} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 underline" style={{ color: "var(--text-3)" }}>
                        <ExternalLink size={11} /> Abrir en Notion
                      </a>
                    ))}
                  </div>
                )}
                {m.pendientes && (
                  <div className="flex gap-2" style={{ marginTop: 8 }}>
                    <button onClick={() => confirmar(m, true)} className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-white" style={{ background: "#0E766E", padding: "6px 12px" }}>
                      <Check size={13} /> Confirmar
                    </button>
                    <button onClick={() => confirmar(m, false)} className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold" style={{ background: "var(--bg)", color: "var(--text-2)", border: "1px solid var(--border)", padding: "6px 12px" }}>
                      <X size={13} /> Cancelar
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {pensando && (
            <div className="text-xs" style={{ color: "var(--text-3)", padding: "0 4px" }}>
              Pensando…
            </div>
          )}
          <div ref={finRef} />
        </div>

        {/* Entrada */}
        <div
          className="sticky bottom-0"
          style={{ background: "var(--bg)", padding: "8px 0 12px" }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviar(texto);
            }}
            className="flex items-center gap-2 rounded-2xl"
            style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 2px 12px var(--shadow)", padding: 6 }}
          >
            <button
              type="button"
              onClick={escuchar}
              disabled={sinMicrofono || pensando || !!desconectado}
              title={sinMicrofono ? "Este navegador no reconoce voz: usa Chrome o Edge" : escuchando ? "Terminar" : "Hablar"}
              className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-white disabled:opacity-40 ${escuchando ? "animate-pulse" : ""}`}
              style={{ background: escuchando ? "var(--red)" : "#0E766E" }}
            >
              {escuchando ? <Square size={16} /> : <Mic size={18} />}
            </button>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={escuchando ? "Te escucho…" : "O escríbelo aquí"}
              disabled={!!desconectado}
              className="flex-1 min-w-0 bg-transparent outline-none text-base"
              style={{ color: "var(--text)", padding: "0 4px" }}
            />
            <button type="button" onClick={alternarVoz} title={voz ? "Silenciar respuestas" : "Leer respuestas en voz alta"} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style={{ color: "var(--text-3)" }}>
              {voz ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button type="submit" disabled={!texto.trim() || pensando || !!desconectado} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg disabled:opacity-40" style={{ color: "#0E766E" }}>
              <Send size={16} />
            </button>
          </form>
          {sinMicrofono && (
            <p className="text-xs" style={{ color: "var(--text-3)", margin: "6px 4px 0" }}>
              Este navegador no reconoce voz. Abre la app en Chrome o Edge para hablar; mientras, puedes escribir.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AsistentePage() {
  return (
    <Suspense>
      <Asistente />
    </Suspense>
  );
}
