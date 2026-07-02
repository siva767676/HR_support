import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Spinner } from "./ui";
import type { InterviewTurn, PlannedQuestion } from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD = 0.008;
const SILENCE_AFTER_SPEECH_MS = 2800;
const POST_TTS_DELAY_MS = 600;
const INTERVIEW_SECS = 30 * 60;

type RoomStatus = "idle" | "speaking" | "listening" | "processing";

function fmtTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function deriveStage(asked: number, total: number, round: string): string {
  const pct = total > 0 ? asked / total : 0;
  if (pct < 0.18) return "Introduction";
  if (round === "technical" || pct < 0.6) return "Technical";
  if (pct < 0.88) return "HR Round";
  return "Final";
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface InterviewRoomProps {
  question: PlannedQuestion;
  asked: number;
  total: number;
  candidate: string;
  role: string;
  transcript: InterviewTurn[];
  submitting: boolean;
  difficultyAdapted: boolean;
  error: string;
  onAnswerReady: (text: string) => void;
  onReset: () => void;
}

// ── Circular AI Avatar ────────────────────────────────────────────────────────
function AvatarCircle({ status }: { status: RoomStatus }) {
  const speaking = status === "speaking";
  const listening = status === "listening";
  const processing = status === "processing";

  const [dot, setDot] = useState(0);
  useEffect(() => {
    if (!speaking) { setDot(0); return; }
    const id = setInterval(() => setDot((d) => (d + 1) % 3), 420);
    return () => clearInterval(id);
  }, [speaking]);

  // Pulse rings color based on status
  const ringColor = speaking
    ? "rgba(139,92,246,0.35)"
    : listening
    ? "rgba(99,120,240,0.28)"
    : "rgba(160,140,220,0.18)";

  return (
    <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>
      {/* Outer pulse ring */}
      {(speaking || listening) && (
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: 240,
            height: 240,
            background: `radial-gradient(circle, ${ringColor} 0%, transparent 70%)`,
            animationDuration: speaking ? "1.1s" : "1.6s",
          }}
        />
      )}
      {/* Second pulse */}
      {speaking && (
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: 210,
            height: 210,
            background: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)",
            animationDuration: "1.6s",
            animationDelay: "0.4s",
          }}
        />
      )}

      {/* Gradient border ring — SVG circle trick */}
      <svg
        className="absolute"
        width={220}
        height={220}
        style={{ transform: speaking ? "rotate(0deg)" : undefined }}
      >
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={speaking ? "#a855f7" : "#818cf8"} />
            <stop offset="50%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor={speaking ? "#6366f1" : "#a78bfa"} />
          </linearGradient>
        </defs>
        <circle
          cx={110}
          cy={110}
          r={104}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={speaking ? 5 : 3.5}
          opacity={speaking ? 1 : 0.75}
        />
      </svg>

      {/* Inner white circle */}
      <div
        className="relative flex flex-col items-center justify-center rounded-full bg-white shadow-xl"
        style={{ width: 196, height: 196 }}
      >
        {/* "m." lettermark */}
        <span
          className="select-none font-black text-slate-800 tracking-tight"
          style={{ fontSize: 52, lineHeight: 1, letterSpacing: "-0.04em" }}
        >
          m.
        </span>

        {/* Speaking dots */}
        {speaking && (
          <div className="mt-2 flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block rounded-full bg-violet-400 transition-all duration-200"
                style={{
                  width: 6,
                  height: i === dot ? 16 : 6,
                  opacity: i === dot ? 1 : 0.4,
                }}
              />
            ))}
          </div>
        )}

        {/* Processing spinner */}
        {processing && (
          <div className="mt-2">
            <Spinner className="size-5 text-violet-400" />
          </div>
        )}

        {/* Listening indicator */}
        {listening && !speaking && !processing && (
          <div className="mt-2 flex items-center gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="block animate-pulse rounded-full bg-blue-400"
                style={{
                  width: 4,
                  height: 4 + i * 4,
                  animationDelay: `${i * 0.15}s`,
                  animationDuration: "0.9s",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Candidate camera ──────────────────────────────────────────────────────────
function CandidateCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; }
        setLoading(false);
      } catch {
        if (mounted) { setBlocked(true); setLoading(false); }
      }
    })();
    return () => {
      mounted = false;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  if (blocked) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 rounded-2xl">
        <svg className="size-7 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
        </svg>
        <span className="text-[10px] font-medium text-slate-400">Camera blocked</span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-slate-200">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-200">
          <Spinner className="size-4 text-slate-400" />
        </div>
      )}
      <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function InterviewRoom({
  question, asked, total, candidate, role, transcript,
  submitting, difficultyAdapted, error, onAnswerReady, onReset,
}: InterviewRoomProps) {
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [liveText, setLiveText] = useState("");
  const [timer, setTimer] = useState(INTERVIEW_SECS);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const statusRef = useRef<RoomStatus>("idle");
  const liveTextRef = useRef("");
  const submittedRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevSubmittingRef = useRef(false);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { liveTextRef.current = liveText; }, [liveText]);

  useEffect(() => {
    const id = setInterval(() => setTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch { /**/ }
      clearTimeout(silenceTimerRef.current ?? undefined);
      clearTimeout(vadTimerRef.current ?? undefined);
      audioCtxRef.current?.close();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (prevSubmittingRef.current && !submitting && statusRef.current === "processing") {
      setStatus("idle");
      submittedRef.current = false;
    }
    prevSubmittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (!question) return;
    submittedRef.current = false;
    setLiveText("");
    stopListening();

    const afterSpeak = () => {
      if (statusRef.current !== "processing") {
        setStatus("idle");
        setTimeout(() => startListening(), POST_TTS_DELAY_MS);
      }
    };

    if (ttsEnabled && "speechSynthesis" in window) {
      setStatus("speaking");
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(question.question);
      utt.rate = 0.9;
      utt.pitch = 1.0;
      utt.lang = "en-US";
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => /google|natural|premium|enhanced/i.test(v.name) && v.lang.startsWith("en"),
      ) || voices.find((v) => v.lang.startsWith("en"));
      if (preferred) utt.voice = preferred;
      utt.onend = afterSpeak;
      utt.onerror = afterSpeak;
      window.speechSynthesis.speak(utt);
    } else {
      setStatus("idle");
      setTimeout(() => startListening(), 800);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.question]);

  function stopListening() {
    clearTimeout(silenceTimerRef.current ?? undefined);
    clearTimeout(vadTimerRef.current ?? undefined);
    try { if (recognitionRef.current) { recognitionRef.current.onresult = null; recognitionRef.current.abort(); } recognitionRef.current = null; } catch { /**/ }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  const startListening = useCallback(() => {
    if (statusRef.current === "processing") return;
    setStatus("listening");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;

      rec.onresult = (e: any) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        setLiveText(text);
        clearTimeout(silenceTimerRef.current ?? undefined);
        silenceTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening") {
            try { rec.stop(); } catch { /**/ }
          }
        }, SILENCE_AFTER_SPEECH_MS);
      };

      rec.onerror = (e: any) => {
        if (e.error === "no-speech") {
          clearTimeout(silenceTimerRef.current ?? undefined);
          silenceTimerRef.current = setTimeout(() => {
            if (statusRef.current === "listening") doSubmit();
          }, 4000);
        }
      };

      rec.onend = () => {
        if (statusRef.current === "listening") doSubmit();
      };

      recognitionRef.current = rec;
      try { rec.start(); } catch { /**/ }
    } else {
      silenceTimerRef.current = setTimeout(() => {
        if (statusRef.current === "listening") doSubmit();
      }, 15_000);
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (statusRef.current !== "listening") { stream.getTracks().forEach((t) => t.stop()); return; }
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;

        let speechSeen = false;
        let silenceStart: number | null = null;
        const buf = new Float32Array(analyser.fftSize);

        const check = () => {
          if (statusRef.current !== "listening") {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          analyser.getFloatTimeDomainData(buf);
          const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
          if (rms > SILENCE_THRESHOLD) {
            speechSeen = true;
            silenceStart = null;
          } else if (speechSeen) {
            if (!silenceStart) silenceStart = Date.now();
            else if (Date.now() - silenceStart > SILENCE_AFTER_SPEECH_MS) {
              try { recognitionRef.current?.stop(); } catch { /**/ }
              stream.getTracks().forEach((t) => t.stop());
              ctx.close();
              audioCtxRef.current = null;
              analyserRef.current = null;
              return;
            }
          }
          vadTimerRef.current = setTimeout(check, 100);
        };
        check();
      } catch { stream.getTracks().forEach((t) => t.stop()); }
    }).catch(() => { /* mic blocked */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doSubmit() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const text = liveTextRef.current.trim();
    stopListening();
    if (!text) {
      setStatus("idle");
      submittedRef.current = false;
      return;
    }
    setStatus("processing");
    setLiveText(text);
    onAnswerReady(text);
  }

  function handleSpeakButton() {
    if (status === "listening") {
      doSubmit();
    } else if (status !== "speaking" && status !== "processing" && !submitting) {
      startListening();
    }
  }

  function replayQuestion() {
    if (!question || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(question.question);
    utt.rate = 0.9;
    utt.lang = "en-US";
    window.speechSynthesis.speak(utt);
  }

  const timerWarning = timer < 5 * 60;
  const roomStatus: RoomStatus = submitting ? "processing" : status;

  const recordingActive = roomStatus === "listening";
  const canSpeak = roomStatus !== "speaking" && roomStatus !== "processing" && !submitting;

  if (!mounted) return null;

  const room = (
    <div
      className="fixed inset-0 z-[100] overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #eaeaf8 0%, #ebebf9 40%, #e4e4f5 100%)",
      }}
    >
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-7 pt-5">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-xl font-black tracking-tight text-slate-800" style={{ letterSpacing: "-0.04em" }}>
            medha.
          </span>
        </div>

        {/* Timer */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-sm font-semibold tabular-nums",
            timerWarning
              ? "bg-red-50 text-red-600 ring-1 ring-red-200"
              : "bg-white/70 text-slate-700 ring-1 ring-white/80",
          )}
          style={{ backdropFilter: "blur(8px)" }}
        >
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          {fmtTime(timer)}
        </div>
      </div>

      {/* ── Center avatar ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: 80 }}>
        <AvatarCircle status={roomStatus} />
      </div>

      {/* ── Right panel: question + controls ──────────────────────────── */}
      <div
        className="absolute right-8 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3"
        style={{ width: "min(340px, 32vw)", paddingBottom: 60 }}
      >
        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Question text */}
        <div className="space-y-1.5">
          {question.is_followup && (
            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700">Follow-up</span>
          )}
          {difficultyAdapted && (
            <span className="inline-block ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold text-sky-700">Adaptive</span>
          )}
          <p className="text-[15px] font-medium leading-relaxed text-slate-800">
            {question.question}
          </p>
          <button
            type="button"
            onClick={replayQuestion}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            Replay
          </button>
        </div>

        {/* Live transcript */}
        {liveText && (
          <p className="text-[12px] leading-relaxed text-slate-500 italic line-clamp-3">
            "{liveText}"
          </p>
        )}

        {/* Recording button */}
        <button
          type="button"
          onClick={handleSpeakButton}
          disabled={!canSpeak}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
            recordingActive
              ? "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
              : roomStatus === "speaking"
              ? "bg-white/60 text-slate-400 cursor-not-allowed"
              : roomStatus === "processing"
              ? "bg-white/60 text-slate-400 cursor-not-allowed"
              : "bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 hover:ring-slate-300",
          )}
        >
          {roomStatus === "processing" ? (
            <><Spinner className="size-4" /> Thinking…</>
          ) : recordingActive ? (
            <>
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
              Recording…
            </>
          ) : roomStatus === "speaking" ? (
            <>
              <span className="size-2.5 rounded-full bg-violet-400" />
              Speaking…
            </>
          ) : (
            <>
              <span className="size-2.5 rounded-full bg-slate-300" />
              Start recording
            </>
          )}
        </button>

        {/* Done answering button */}
        <button
          type="button"
          onClick={() => { if (recordingActive || liveText.trim()) doSubmit(); }}
          disabled={!recordingActive && !liveText.trim()}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
            (recordingActive || liveText.trim())
              ? "bg-white/70 text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:ring-slate-300"
              : "bg-white/40 text-slate-300 cursor-not-allowed ring-1 ring-slate-100",
          )}
          style={{ backdropFilter: "blur(8px)" }}
        >
          Done answering? Continue
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Q counter */}
        <p className="text-center text-[11px] text-slate-400">
          Question {asked} of {total}
        </p>
      </div>

      {/* ── Candidate webcam, bottom-left ──────────────────────────────── */}
      <div className="absolute bottom-14 left-7 z-10">
        <div
          className="overflow-hidden rounded-2xl shadow-lg"
          style={{ width: 180, height: 126 }}
        >
          <CandidateCamera />
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-medium text-slate-500">You</span>
        </div>
      </div>

      {/* ── Voice + End controls, bottom-right ─────────────────────────── */}
      <div className="absolute bottom-14 right-7 z-10 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setTtsEnabled((v) => { if (v) window.speechSynthesis?.cancel(); return !v; })}
          title={ttsEnabled ? "Mute AI voice" : "Unmute AI voice"}
          className="grid size-9 place-items-center rounded-full bg-white/80 text-slate-500 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-white"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {ttsEnabled ? (
              <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>
            ) : (
              <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
            )}
          </svg>
        </button>

        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600"
        >
          End Interview
        </button>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/60 bg-white/30 px-7 py-2 text-[11px] text-slate-400" style={{ backdropFilter: "blur(8px)" }}>
        <span>Please don't refresh — your interview is in progress.</span>
        <span>Powered by <span className="font-semibold text-slate-500">MEDHA</span></span>
      </div>
    </div>
  );

  return createPortal(room, document.body);
}
