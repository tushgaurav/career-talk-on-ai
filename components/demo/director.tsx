'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react'
import { createFalClient } from '@fal-ai/client'
import {
  wma,
  type ManagedRealtimeSession,
  type RealtimeState,
  type WmaRealtimeSession,
} from '@fal-ai/client/realtime'
import { Volume2, VolumeX } from 'lucide-react'

import { cn } from '@/lib/utils'

const ENDPOINT = 'minimax/h3-max/director'

type Phase =
  | 'idle'
  | 'connecting'
  | 'configuring'
  | 'streaming'
  | 'stopped'
  | 'error'

type AspectRatio = '16:9' | '9:16' | '1:1'
type Resolution = '480p' | '768p' | '1080p'

type Tone = 'info' | 'ok' | 'warn' | 'error' | 'user'
type FeedItem = { id: number; at: number; tone: Tone; text: string }

type DirectionStatus = 'sent' | 'queued' | 'applied' | 'rejected'
type LastDirection = {
  version: number
  text: string
  status: DirectionStatus
  reason?: string
}

type DirectorSession = ManagedRealtimeSession<WmaRealtimeSession>

const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: 'Wide 16:9' },
  { value: '9:16', label: 'Tall 9:16' },
  { value: '1:1', label: 'Square 1:1' },
]

const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: '480p', label: '480p' },
  { value: '768p', label: '768p' },
  { value: '1080p', label: '1080p' },
]

const SCENE_PRESETS: { label: string; prompt: string }[] = [
  {
    label: 'Robot in Delhi market',
    prompt:
      'A continuous live-action stream following a friendly, curious robot wandering through a busy Delhi street market at golden hour, stopping to look at spices, fabrics and street food.',
  },
  {
    label: 'Astronaut on alien jungle',
    prompt:
      'A documentary-style continuous stream following a young astronaut exploring a glowing alien jungle at dusk, bioluminescent plants lighting the path.',
  },
  {
    label: 'Cat chef bakery',
    prompt:
      'A cosy animated continuous stream inside a small bakery where a cat chef bakes bread and pastries while rain falls softly outside the window.',
  },
  {
    label: 'Himalayan drone flight',
    prompt:
      'A slow continuous aerial drone stream gliding over the Himalayas at sunrise, clouds drifting between snow-covered peaks.',
  },
  {
    label: 'Science fair comes alive',
    prompt:
      'A continuous live-action stream of a school science fair where the students\u2019 inventions slowly start coming to life, one table at a time.',
  },
]

const DIRECTION_CHIPS = [
  'It suddenly starts raining',
  'A dog runs into the scene',
  'Cut to a wide aerial shot',
  'Night falls and the lights come on',
  'Everyone starts dancing',
  'Zoom in on a small detail',
]

const FATAL_ERROR_CODES = new Set([
  'balance_unavailable',
  'configuration_timeout',
  'generation_failed',
  'generation_timeout',
  'initialization_timeout',
  'invalid_initial_image',
  'invalid_initial_audio',
  'not_configured',
])

const ERROR_TEXT: Record<string, string> = {
  balance_unavailable: 'Session budget is unavailable right now.',
  content_policy: 'That request was blocked by the content policy.',
  configuration_timeout: 'The scene took too long to set up.',
  generation_failed: 'Video generation failed.',
  generation_timeout: 'Video generation timed out.',
  immutable_settings: 'Those settings cannot change during a stream.',
  initialization_timeout: 'The stream took too long to start.',
  invalid_initial_image: 'The starting image could not be used.',
  invalid_initial_audio: 'The starting audio could not be used.',
  invalid_message: 'The stream received a message it did not understand.',
  stale_prompt_version: 'A newer direction already replaced that one.',
}

const REJECT_TEXT: Record<string, string> = {
  content_policy: 'blocked by the content policy',
  preparation_failed: 'could not be prepared',
  stale_prompt_version: 'superseded by a newer direction',
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function aspectStyle(ratio: AspectRatio): CSSProperties {
  switch (ratio) {
    case '9:16':
      return { aspectRatio: '9 / 16' }
    case '1:1':
      return { aspectRatio: '1 / 1' }
    default:
      return { aspectRatio: '16 / 9' }
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  connecting: 'Connecting',
  configuring: 'Setting the scene',
  streaming: 'Live',
  stopped: 'Ended',
  error: 'Problem',
}

export function Director() {
  const fal = useMemo(
    () => createFalClient({ proxyUrl: '/api/fal/proxy' }),
    [],
  )

  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<DirectorSession | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const feedIdRef = useRef(0)
  const promptVersionRef = useRef(1)
  const hasFramesRef = useRef(false)

  const [phase, setPhaseState] = useState<Phase>('idle')
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  // Setup (immutable once the stream starts)
  const [scene, setScene] = useState(SCENE_PRESETS[0].prompt)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9')
  const [resolution, setResolution] = useState<Resolution>('768p')
  const [imageUrl, setImageUrl] = useState('')
  const [seed, setSeed] = useState('')

  // Live
  const [direction, setDirection] = useState('')
  const [lastDirection, setLastDirection] = useState<LastDirection | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [chunks, setChunks] = useState(0)
  const [bufferDepth, setBufferDepth] = useState<number | null>(null)
  const [hasFrames, setHasFrames] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const feedEndRef = useRef<HTMLDivElement>(null)
  const directionInputRef = useRef<HTMLInputElement>(null)

  const log = useCallback((tone: Tone, text: string) => {
    feedIdRef.current += 1
    const item: FeedItem = {
      id: feedIdRef.current,
      at: Date.now(),
      tone,
      text,
    }
    setFeed((prev) => [...prev.slice(-79), item])
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [feed])

  useEffect(() => {
    if (!startedAt || phase !== 'streaming') return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [startedAt, phase])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted])

  const detachMedia = useCallback(() => {
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    mediaRef.current = null
  }, [])

  const closeSession = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    if (session) {
      try {
        await session.close()
      } catch {
        // Closing an already-torn-down session is harmless.
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      void closeSession()
      detachMedia()
    }
  }, [closeSession, detachMedia])

  const handleMedia = useCallback((stream: MediaStream) => {
    const video = videoRef.current
    if (!video) return
    const combined = mediaRef.current ?? new MediaStream()
    mediaRef.current = combined
    for (const track of stream.getTracks()) {
      if (!combined.getTracks().includes(track)) combined.addTrack(track)
    }
    if (video.srcObject !== combined) video.srcObject = combined
    video.play().catch(() => {
      // Autoplay with sound was refused; fall back to muted playback.
      setMuted(true)
      video.muted = true
      video.play().catch(() => undefined)
    })
  }, [])

  const handleMessage = useCallback(
    (raw: string) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return
      }
      const type = String(message.type ?? '')

      // Only the most recent direction is shown next to the input; older
      // versions were already superseded by the time their ack arrives.
      const markDirection = (status: DirectionStatus, reason?: string) => {
        const version = Number(message.prompt_version)
        setLastDirection((prev) =>
          prev && prev.version === version ? { ...prev, status, reason } : prev,
        )
      }

      switch (type) {
        case 'configured': {
          setPhase('streaming')
          log('ok', 'Scene set. Generating the opening shot…')
          return
        }
        case 'chunk': {
          setChunks((c) => c + 1)
          setBuffering(false)
          if (typeof message.buffer_depth_seconds === 'number') {
            setBufferDepth(message.buffer_depth_seconds)
          }
          if (!hasFramesRef.current) {
            hasFramesRef.current = true
            setHasFrames(true)
            setStartedAt(Date.now())
            log('ok', 'First frames are on screen. You can direct the scene now.')
          }
          return
        }
        case 'deadline_missed': {
          setBuffering(true)
          return
        }
        case 'prompt_pending': {
          markDirection('queued')
          log('info', `Direction ${message.prompt_version} queued for the next shot.`)
          return
        }
        case 'prompt_applied': {
          markDirection('applied')
          log('ok', `Direction ${message.prompt_version} applied. Watch the next shot.`)
          return
        }
        case 'prompt_rejected': {
          const reason = String(message.reason ?? '')
          markDirection('rejected', reason)
          log(
            'error',
            `Direction ${message.prompt_version} was ${REJECT_TEXT[reason] ?? 'rejected'}.`,
          )
          return
        }
        case 'audio_applied': {
          log('info', 'Soundtrack update accepted.')
          return
        }
        case 'audio_rejected': {
          log('error', 'Soundtrack update was rejected.')
          return
        }
        case 'stream_exhausted': {
          const reason = String(message.reason ?? '')
          const count = Number(message.chunks ?? 0)
          log(
            'info',
            reason === 'session_limit'
              ? `Stream reached its time limit after ${count} shots.`
              : `Stream ended after ${count} shots.`,
          )
          if (phaseRef.current !== 'error') setPhase('stopped')
          void closeSession()
          return
        }
        case 'error': {
          const code = String(message.code ?? '')
          const text = ERROR_TEXT[code] ?? String(message.error ?? 'Something went wrong.')
          log('error', text)
          if (FATAL_ERROR_CODES.has(code)) {
            setPhase('error')
            void closeSession()
          }
          return
        }
        default:
          // session_info, chunk_metrics, session_metrics, pong, audio_pending, audio_exhausted
          return
      }
    },
    [closeSession, log, setPhase],
  )

  const handleState = useCallback(
    (state: RealtimeState) => {
      switch (state) {
        case 'opening':
          return
        case 'live':
          if (phaseRef.current === 'connecting') {
            setPhase('configuring')
            log('info', 'Connected. Sending the scene description…')
          }
          return
        case 'failed':
          if (phaseRef.current !== 'error') {
            setPhase('error')
            log('error', 'The connection failed.')
          }
          return
        case 'closed':
          if (
            phaseRef.current === 'connecting' ||
            phaseRef.current === 'configuring' ||
            phaseRef.current === 'streaming'
          ) {
            setPhase('stopped')
            log('info', 'Stream closed.')
          }
          return
      }
    },
    [log, setPhase],
  )

  const handleError = useCallback(
    (error: unknown) => {
      const text =
        error instanceof Error && error.message
          ? error.message
          : 'The connection could not be established.'
      log('error', text)
      if (phaseRef.current !== 'error') setPhase('error')
      void closeSession()
    },
    [closeSession, log, setPhase],
  )

  const start = useCallback(async () => {
    const prompt = scene.trim()
    if (!prompt) return

    await closeSession()
    detachMedia()

    setFeed([])
    setChunks(0)
    setBufferDepth(null)
    hasFramesRef.current = false
    setHasFrames(false)
    setBuffering(false)
    setStartedAt(null)
    setDirection('')
    setLastDirection(null)
    promptVersionRef.current = 1
    setPhase('connecting')
    log('user', `Scene: ${prompt}`)

    const seedValue = seed.trim() === '' ? null : Number.parseInt(seed, 10)
    const configure: Record<string, unknown> = {
      type: 'configure',
      protocol_version: 1,
      prompt,
      prompt_version: 1,
      aspect_ratio: aspectRatio,
      resolution,
    }
    if (imageUrl.trim()) configure.image_url = imageUrl.trim()
    if (seedValue !== null && Number.isFinite(seedValue)) configure.seed = seedValue

    try {
      const session = fal.realtime.open(wma(ENDPOINT), {
        receive: ['video', 'audio'],
        onMedia: handleMedia,
        onData: handleMessage,
        onState: handleState,
        onError: handleError,
      })
      sessionRef.current = session
      // Queued until the control channel opens, then flushed in order.
      session.send(configure)
    } catch (error) {
      handleError(error)
    }
  }, [
    aspectRatio,
    closeSession,
    detachMedia,
    fal,
    handleError,
    handleMedia,
    handleMessage,
    handleState,
    imageUrl,
    log,
    resolution,
    scene,
    seed,
    setPhase,
  ])

  const stop = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    log('user', 'Stop.')
    try {
      session.send({ type: 'stop' })
    } catch {
      // The channel may already be gone.
    }
    setPhase('stopped')
    await closeSession()
  }, [closeSession, log, setPhase])

  const reset = useCallback(async () => {
    await closeSession()
    detachMedia()
    hasFramesRef.current = false
    setHasFrames(false)
    setBuffering(false)
    setStartedAt(null)
    setLastDirection(null)
    setPhase('idle')
  }, [closeSession, detachMedia, setPhase])

  const sendDirection = useCallback(
    (text: string) => {
      const session = sessionRef.current
      const prompt = text.trim()
      if (!session || !prompt || phaseRef.current !== 'streaming') return
      promptVersionRef.current += 1
      const version = promptVersionRef.current
      session.send({
        type: 'prompt',
        prompt,
        prompt_version: version,
        replan: true,
      })
      log('user', `Direction ${version}: ${prompt}`)
      setLastDirection({ version, text: prompt, status: 'sent' })
      setDirection('')
      // Keep the cursor in the box so the next direction can be typed straight away.
      directionInputRef.current?.focus()
    },
    [log],
  )

  const onDirectionSubmit = (event: FormEvent) => {
    event.preventDefault()
    sendDirection(direction)
  }

  const running =
    phase === 'connecting' || phase === 'configuring' || phase === 'streaming'
  const setupLocked = running
  const canDirect = phase === 'streaming' && hasFrames
  const elapsed = startedAt ? now - startedAt : 0

  // Once the stream is running the direction box moves above the video so it is
  // easy to see on a projector while typing.
  const directionOnTop = running

  useEffect(() => {
    if (canDirect) directionInputRef.current?.focus()
  }, [canDirect])

  const input =
    'w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <main className="demo-root min-h-svh">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Live Director</h1>
            <p className="text-sm text-neutral-400">
              Realtime AI video you can steer with words
            </p>
          </div>
          <Status phase={phase} elapsed={elapsed} />
        </header>

        {directionOnTop ? (
          <DirectionPanel
            prominent
            inputRef={directionInputRef}
            inputClass={input}
            direction={direction}
            setDirection={setDirection}
            onSubmit={onDirectionSubmit}
            sendDirection={sendDirection}
            canDirect={canDirect}
            lastDirection={lastDirection}
            onStop={() => void stop()}
          />
        ) : null}

        {/* Video */}
        <div
          className={cn(
            'relative mx-auto w-full overflow-hidden rounded-lg border border-neutral-800 bg-black',
            aspectRatio === '9:16' && 'max-w-[min(100%,calc(65svh*9/16))]',
            aspectRatio === '1:1' && 'max-w-[min(100%,65svh)]',
          )}
          style={aspectStyle(aspectRatio)}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
          />
          {!hasFrames ? <Placeholder phase={phase} /> : null}
          {hasFrames ? (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="absolute top-3 right-3 grid size-9 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          ) : null}
          {hasFrames && buffering ? (
            <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
              Buffering…
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-6">
            {/* Scene */}
            <section>
              <label htmlFor="scene" className="mb-2 block text-sm font-medium">
                Scene
              </label>
              <textarea
                id="scene"
                value={scene}
                onChange={(e) => setScene(e.target.value)}
                disabled={setupLocked}
                rows={3}
                placeholder="Describe the continuous stream you want to watch…"
                className={cn(input, 'resize-y py-2 leading-relaxed')}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {SCENE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={setupLocked}
                    onClick={() => setScene(preset.prompt)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      scene === preset.prompt
                        ? 'border-neutral-400 text-neutral-100'
                        : 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Options */}
            <section className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Aspect ratio"
                options={ASPECT_RATIOS}
                value={aspectRatio}
                onChange={setAspectRatio}
                disabled={setupLocked}
              />
              <Select
                label="Resolution"
                options={RESOLUTIONS}
                value={resolution}
                onChange={setResolution}
                disabled={setupLocked}
              />
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Starting image URL{' '}
                  <span className="font-normal text-neutral-500">(optional)</span>
                </span>
                <input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={setupLocked}
                  inputMode="url"
                  placeholder="https://…"
                  className={cn(input, 'h-10')}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">
                  Seed <span className="font-normal text-neutral-500">(optional)</span>
                </span>
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={setupLocked}
                  inputMode="numeric"
                  placeholder="Random"
                  className={cn(input, 'h-10')}
                />
              </label>
            </section>

            {/* Start / clear — Stop lives in the direction panel while live */}
            <div className="flex flex-wrap items-center gap-3">
              {!running ? (
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={!scene.trim()}
                  className="h-10 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === 'idle' ? 'Start stream' : 'Start again'}
                </button>
              ) : (
                <p className="text-sm text-neutral-500">
                  Settings are locked while the stream is live.
                </p>
              )}
              {!running && hasFrames ? (
                <button
                  type="button"
                  onClick={() => void reset()}
                  className="h-10 rounded-md border border-neutral-800 px-4 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {!directionOnTop ? (
              <DirectionPanel
                inputRef={directionInputRef}
                inputClass={input}
                direction={direction}
                setDirection={setDirection}
                onSubmit={onDirectionSubmit}
                sendDirection={sendDirection}
                canDirect={canDirect}
              />
            ) : null}
          </div>

          {/* Activity */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">Activity</h2>
              <span className="text-xs text-neutral-500">
                {chunks} shot{chunks === 1 ? '' : 's'}
                {bufferDepth !== null ? ` · ${bufferDepth.toFixed(1)}s buffered` : ''}
              </span>
            </div>
            <div className="max-h-[50svh] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 p-3 text-sm">
              {feed.length === 0 ? (
                <p className="text-neutral-500">Start a stream to see activity here.</p>
              ) : (
                <ol className="space-y-2">
                  {feed.map((item) => (
                    <li key={item.id} className="flex gap-3 leading-snug">
                      <span className="shrink-0 font-mono text-xs text-neutral-500 tabular-nums">
                        {formatClock(item.at)}
                      </span>
                      <span
                        className={cn(
                          item.tone === 'user' && 'text-neutral-100',
                          item.tone === 'ok' && 'text-neutral-200',
                          item.tone === 'info' && 'text-neutral-400',
                          item.tone === 'warn' && 'text-amber-300',
                          item.tone === 'error' && 'text-red-400',
                        )}
                      >
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div ref={feedEndRef} />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function DirectionPanel({
  prominent = false,
  inputRef,
  inputClass,
  direction,
  setDirection,
  onSubmit,
  sendDirection,
  canDirect,
  lastDirection = null,
  onStop,
}: {
  prominent?: boolean
  inputRef: RefObject<HTMLInputElement | null>
  inputClass: string
  direction: string
  setDirection: (value: string) => void
  onSubmit: (event: FormEvent) => void
  sendDirection: (text: string) => void
  canDirect: boolean
  lastDirection?: LastDirection | null
  onStop?: () => void
}) {
  return (
    <section
      className={cn(
        prominent &&
          'mb-5 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <label
          htmlFor="direction"
          className={cn('font-medium', prominent ? 'text-base' : 'text-sm')}
        >
          Direct the scene
        </label>
        {onStop ? (
          <button
            type="button"
            onClick={onStop}
            className="h-8 rounded-md border border-neutral-800 px-3 text-xs text-neutral-400 transition-colors hover:border-red-500/60 hover:text-red-400"
          >
            Stop stream
          </button>
        ) : null}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          id="direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          disabled={!canDirect}
          autoComplete="off"
          placeholder="What should happen next?"
          className={cn(
            inputClass,
            'flex-1',
            prominent ? 'h-14 px-4 text-xl sm:text-2xl' : 'h-10',
          )}
        />
        <button
          type="submit"
          disabled={!canDirect || !direction.trim()}
          className={cn(
            'shrink-0 rounded-md bg-white font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50',
            prominent ? 'h-14 px-6 text-base' : 'h-10 px-4 text-sm',
          )}
        >
          Send
        </button>
      </form>
      <DirectionStatusLine
        canDirect={canDirect}
        lastDirection={lastDirection}
        prominent={prominent}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {DIRECTION_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={!canDirect}
            onClick={() => sendDirection(chip)}
            className={cn(
              'rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50',
              prominent ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
            )}
          >
            {chip}
          </button>
        ))}
      </div>
    </section>
  )
}

const STATUS_TEXT: Record<DirectionStatus, string> = {
  sent: 'Sending…',
  queued: 'Queued for the next shot',
  applied: 'Applied — watch the next shot',
  rejected: 'Rejected',
}

/** One fixed-height line under the input: a hint before anything is sent, then the latest direction and its status. */
function DirectionStatusLine({
  canDirect,
  lastDirection,
  prominent,
}: {
  canDirect: boolean
  lastDirection: LastDirection | null
  prominent: boolean
}) {
  const size = prominent ? 'text-sm' : 'text-xs'

  if (!lastDirection) {
    return (
      <p className={cn('mt-2 truncate text-neutral-500', size)}>
        {canDirect
          ? 'Type what should happen next — it shows up in the next shot.'
          : 'Available once the stream is live.'}
      </p>
    )
  }

  const { status, text, reason } = lastDirection
  const pending = status === 'sent' || status === 'queued'
  const statusText =
    status === 'rejected' && reason && REJECT_TEXT[reason]
      ? `Rejected — ${REJECT_TEXT[reason]}`
      : STATUS_TEXT[status]

  return (
    <p
      className={cn('mt-2 flex min-w-0 items-center gap-2', size)}
      aria-live="polite"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          pending && 'animate-pulse bg-neutral-400',
          status === 'applied' && 'bg-neutral-100',
          status === 'rejected' && 'bg-red-500',
        )}
      />
      <span
        className={cn(
          'shrink-0',
          status === 'rejected' ? 'text-red-400' : 'text-neutral-300',
        )}
      >
        {statusText}
      </span>
      <span className="truncate text-neutral-500">“{text}”</span>
    </p>
  )
}

function formatClock(at: number): string {
  const d = new Date(at)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function Status({ phase, elapsed }: { phase: Phase; elapsed: number }) {
  const live = phase === 'streaming'
  const busy = phase === 'connecting' || phase === 'configuring'
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          'size-2 rounded-full',
          live && 'animate-pulse bg-red-500',
          busy && 'animate-pulse bg-amber-400',
          phase === 'error' && 'bg-red-500',
          !live && !busy && phase !== 'error' && 'bg-neutral-600',
        )}
      />
      <span className={live ? 'text-neutral-100' : 'text-neutral-400'}>
        {PHASE_LABEL[phase]}
      </span>
      {live ? (
        <span className="font-mono text-neutral-400 tabular-nums">{formatElapsed(elapsed)}</span>
      ) : null}
    </div>
  )
}

function Placeholder({ phase }: { phase: Phase }) {
  const text: Record<Phase, string> = {
    idle: 'Your stream will appear here',
    connecting: 'Connecting…',
    configuring: 'Setting the scene…',
    streaming: 'Generating the opening shot…',
    stopped: 'Stream ended',
    error: 'Something went wrong — check the activity panel',
  }
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-neutral-500">
      {text[phase]}
    </div>
  )
}

function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className="h-10 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 outline-none focus:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
