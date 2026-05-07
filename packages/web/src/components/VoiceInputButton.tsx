import { useEffect, useRef, useState } from 'react';
import { typeInActiveTerminal } from '../store/active';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
    length: number;
  }>;
}

function getRecognitionCtor(): { new (): SpeechRecognitionLike } | null {
  const w = window as unknown as {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface Props {
  className?: string;
  /** Defaults to zh-CN; click+hold could swap, but keep simple. */
  lang?: string;
}

export function VoiceInputButton({ className = '', lang = 'zh-CN' }: Props) {
  const [supported] = useState(() => getRecognitionCtor() != null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const lastFinalEnd = useRef(0);

  useEffect(() => {
    return () => {
      try { recRef.current?.abort(); } catch {}
      recRef.current = null;
    };
  }, []);

  if (!supported) {
    return (
      <button
        className={`${className} disabled`}
        title="此浏览器不支持语音输入（试试 iOS 16+ Safari 或 Chrome）"
        onClick={() => alert('该浏览器不支持 Web Speech API')}
      >🎤 不支持</button>
    );
  }

  const start = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognitionCtor()!;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    let lastInterim = '';
    rec.onresult = (ev) => {
      let finalText = '';
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        const txt = r[0]!.transcript;
        if (r.isFinal) finalText += txt;
        else interim += txt;
      }
      // Prefer typing only the delta when interim grows; otherwise fall back to final.
      if (finalText) {
        // Drop already-typed interim chars by clearing nothing — terminal already has them; replace with final via backspaces.
        if (lastInterim) {
          typeInActiveTerminal('\b'.repeat(charLen(lastInterim)));
        }
        typeInActiveTerminal(finalText);
        lastInterim = '';
        lastFinalEnd.current = Date.now();
      } else if (interim && interim !== lastInterim) {
        if (lastInterim) typeInActiveTerminal('\b'.repeat(charLen(lastInterim)));
        typeInActiveTerminal(interim);
        lastInterim = interim;
      }
    };
    rec.onerror = () => { /* ignore; onend will follow */ };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  return (
    <button
      className={`${className} ${listening ? 'on listening' : ''}`}
      onPointerDown={(e) => { e.preventDefault(); start(); }}
      title={listening ? '正在识别 — 再点结束' : '语音输入（点开始 / 再点结束）'}
    >{listening ? '🎙️ 听…' : '🎤 语音'}</button>
  );
}

/** Approximate visual character length — emoji + CJK count as 1 each. */
function charLen(s: string): number {
  return [...s].length;
}
