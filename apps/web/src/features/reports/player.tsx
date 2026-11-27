import { FastForward, Maximize, Minimize, Pause, Play, Rewind, RotateCw, Volume2, VolumeX } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

export function clock(seconds: number) {
  const whole = Number.isFinite(seconds) ? Math.floor(Math.max(0, seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function seekVideo(video: HTMLVideoElement | null, seconds: number) {
  if (!video || !Number.isFinite(seconds)) return;
  const end = Number.isFinite(video.duration) ? video.duration : Infinity;
  video.currentTime = Math.min(end, Math.max(0, seconds));
}

const pill = "flex items-center gap-0.5 rounded-full bg-black/55 p-1 text-white shadow-lg backdrop-blur-md";
const pillButton = "rounded-full text-white hover:bg-white/20 hover:text-white";

type Marker = { id: string; offsetMs: number; label: string; text: string };

type PlayerProps = {
  video: RefObject<HTMLVideoElement | null>;
  src: string;
  durationHint: number;
  markers: Marker[];
  onReload: () => Promise<string | undefined>;
};

export function ReportPlayer({ video, src, durationHint, markers, onReload }: PlayerProps) {
  const frame = useRef<HTMLDivElement>(null);
  const resumeAt = useRef(0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekableEnd, setSeekableEnd] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const limit = duration || Math.max(seekableEnd, durationHint);
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // YouTube-style: controls show on pointer move and hide after 2.5s while playing.
  function wake() {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  useEffect(() => {
    const update = () => setExpanded(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  function syncTime(element: HTMLVideoElement) {
    setCurrent(element.currentTime);
    setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const range = element.seekable;
    const end = range.length ? range.end(range.length - 1) : 0;
    setSeekableEnd(Number.isFinite(end) ? end : 0);
  }

  async function togglePlayback() {
    const element = video.current;
    if (!element) return;
    if (element.paused) await element.play().catch(() => setFailed(true));
    else element.pause();
  }

  function seek(seconds: number) {
    seekVideo(video.current, seconds);
    if (video.current) setCurrent(video.current.currentTime);
  }

  function skip(offset: number) {
    if (video.current) seek(video.current.currentTime + offset);
  }

  function toggleMute() {
    const element = video.current;
    if (!element) return;
    if (!element.volume) element.volume = 1;
    else element.muted = !element.muted;
  }

  async function fullscreen() {
    if (document.fullscreenElement === frame.current) await document.exitFullscreen().catch(() => {});
    else await frame.current?.requestFullscreen().catch(() => {});
  }

  async function refresh() {
    resumeAt.current = video.current?.currentTime ?? 0;
    setLoading(true);
    try {
      const next = await onReload();
      setFailed(!next);
      if (next === src) video.current?.load();
    } finally {
      setLoading(false);
    }
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " " || event.key.toLowerCase() === "k") void togglePlayback();
    else if (event.key === "ArrowLeft") skip(-5);
    else if (event.key === "ArrowRight") skip(5);
    else if (event.key.toLowerCase() === "m") toggleMute();
    else if (event.key.toLowerCase() === "f") void fullscreen();
    else return;
    event.preventDefault();
  }

  return (
    <div
      ref={frame}
      className="relative isolate grid aspect-video min-h-52 min-w-0 overflow-hidden bg-neutral-950 focus-visible:ring-2 focus-visible:ring-ring fullscreen:h-full fullscreen:w-full"
      role="group"
      aria-label="Recording player"
      tabIndex={0}
      onKeyDown={keyboard}
      onPointerMove={wake}
      onPointerLeave={() => setIdle(true)}
    >
      <div className="absolute inset-0 grid place-items-center">
        <video
          ref={video}
          src={src}
          preload="metadata"
          playsInline
          className="h-full w-full object-contain"
          onClick={() => void togglePlayback()}
          onLoadedMetadata={({ currentTarget }) => {
            currentTarget.playbackRate = Number(speed);
            currentTarget.volume = volume;
            currentTarget.muted = muted;
            seekVideo(currentTarget, resumeAt.current);
            resumeAt.current = 0;
            syncTime(currentTarget);
          }}
          onTimeUpdate={({ currentTarget }) => setCurrent(currentTarget.currentTime)}
          onDurationChange={({ currentTarget }) => syncTime(currentTarget)}
          onProgress={({ currentTarget }) => syncTime(currentTarget)}
          onSeeking={({ currentTarget }) => setCurrent(currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onVolumeChange={({ currentTarget }) => {
            setVolume(currentTarget.volume);
            setMuted(currentTarget.muted);
          }}
          onError={() => { setFailed(true); setPlaying(false); }}
        />
      </div>
      {!playing && !failed && (
        <div className="dark pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto">
            <Button size="icon-lg" aria-label="Play video" onClick={() => void togglePlayback()}><Play /></Button>
          </div>
        </div>
      )}
      <div className={`dark absolute inset-x-0 bottom-0 grid gap-2 bg-linear-to-t from-black/80 via-black/40 to-transparent px-3 pb-3 pt-10 text-foreground transition-opacity sm:px-4${playing && idle && !failed ? " pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100" : ""}`}>
        {failed && (
          <Alert variant="destructive">
            <AlertDescription>
              The recording could not be loaded.
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}><RotateCw />Reload</Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="px-2">
          {limit > 0 && markers.length > 0 && (
            <div className="relative mx-2 mb-1 h-6" aria-label="Network error markers">
              {markers.filter(({ offsetMs }) => offsetMs / 1000 <= limit).map((marker) => (
                <div key={marker.id} className="absolute top-0 -translate-x-1/2" style={{ left: `${marker.offsetMs / (limit * 10)}%` }}>
                  <button type="button" className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow ring-2 ring-black/40 hover:bg-red-400 focus-visible:outline-2 focus-visible:outline-white" aria-label={`${marker.label} at ${clock(marker.offsetMs / 1000)}`} title={marker.label} onClick={() => seek(marker.offsetMs / 1000)}>
                    {marker.text}
                  </button>
                </div>
              ))}
            </div>
          )}
          <Slider
            className="**:data-[slot=slider-range]:bg-[#7ed957] **:data-[slot=slider-thumb]:border-2 **:data-[slot=slider-thumb]:border-[#7ed957] **:data-[slot=slider-track]:bg-white/35"
            value={[Math.min(current, limit)]} min={0} max={Math.max(0.1, limit)} step={0.1} aria-label="Playback position" disabled={!limit} onValueChange={([value]) => seek(value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className={pill}>
              <Button className={pillButton} variant="ghost" size="icon-sm" aria-label={playing ? "Pause recording" : "Play recording"} onClick={() => void togglePlayback()}>{playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}</Button>
              <Button className={pillButton} variant="ghost" size="icon-sm" aria-label="Back 5 seconds" title="Back 5 seconds" onClick={() => skip(-5)}><Rewind className="fill-current" /></Button>
              <Button className={pillButton} variant="ghost" size="icon-sm" aria-label="Forward 5 seconds" title="Forward 5 seconds" onClick={() => skip(5)}><FastForward className="fill-current" /></Button>
              <div className="group/volume flex items-center">
              <Button className={pillButton} variant="ghost" size="icon-sm" aria-label={muted || !volume ? "Unmute" : "Mute"} onClick={toggleMute}>{muted || !volume ? <VolumeX /> : <Volume2 />}</Button>
              <div className="w-0 overflow-hidden px-0 transition-all group-focus-within/volume:mr-2 group-focus-within/volume:w-14 group-hover/volume:mr-2 group-hover/volume:w-14">
                <Slider className="**:data-[slot=slider-range]:bg-white **:data-[slot=slider-track]:bg-white/35" value={[muted ? 0 : volume]} min={0} max={1} step={0.05} aria-label="Volume" onValueChange={([value]) => {
                  if (!video.current) return;
                  video.current.muted = false;
                  video.current.volume = value;
                }} />
              </div>
              </div>
            </div>
            <span className={`${pill} h-9 px-3 whitespace-nowrap text-sm font-medium tabular-nums`}>{clock(current)} / {duration ? clock(duration) : "—"}</span>
          </div>
          <div className={pill}>
            <Select value={speed} onValueChange={(value) => {
              setSpeed(value);
              if (video.current) video.current.playbackRate = Number(value);
            }}>
              <SelectTrigger size="sm" className="h-7 border-0 bg-transparent text-white shadow-none hover:bg-white/20 dark:bg-transparent" aria-label="Playback speed"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["0.5", "0.75", "1", "1.25", "1.5", "2"].map((rate) => <SelectItem key={rate} value={rate}>{rate}×</SelectItem>)}
              </SelectContent>
            </Select>
            <Button className={pillButton} variant="ghost" size="icon-sm" aria-label={expanded ? "Exit fullscreen" : "Fullscreen"} onClick={() => void fullscreen()}>
              {expanded ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
