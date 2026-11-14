import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Ban,
  Clapperboard,
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  Lock,
  MapPin,
  Radar,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

/** Metrik yang dipamerkan di panel kiri — cermin cakupan platform. */
const SIGNALS = [
  { label: 'Portal terpantau', value: '10', icon: Radar },
  { label: 'Entitas tokoh', value: 'NER', icon: Fingerprint },
  { label: 'Deteksi lonjakan', value: '2.5×', icon: ShieldCheck },
  { label: 'Klaster isu', value: 'pgvector', icon: Sparkles },
]

const SOURCES = [
  'Kompas.com',
  'Tempo.co',
  'CNN Indonesia',
  'Detik.com',
  'Tribunnews',
  'Kumparan',
  'Tirto.id',
  'BBC Indonesia',
  'Bisnis.com',
  'CNBC Indonesia',
]

/** Baris log sintetis yang bergulir, memberi kesan pipeline hidup. */
const FEED = [
  { tone: 'text-positive', tag: 'SENTIMEN', text: 'IndoBERT · 3 kelas · positif 41%' },
  { tone: 'text-accent', tag: 'KLASTER', text: 'Cosine 0.18 → 7 artikel / 3 portal' },
  { tone: 'text-warning', tag: 'LONJAKAN', text: 'Volume 2.8× baseline 6 jam' },
  { tone: 'text-muted-foreground', tag: 'INGEST', text: 'RSS poller · dedupe SHA256' },
  { tone: 'text-negative', tag: 'ALERT', text: 'Negatif 68% → severity HIGH' },
  { tone: 'text-accent', tag: 'TOKOH', text: 'Entitas "Prabowo" naik 3 peringkat' },
]

function FeedLine({ index }: { index: number }) {
  const entry = FEED[index % FEED.length]!
  return (
    <div className="flex items-start gap-2 font-mono text-[10px] leading-relaxed">
      <span className="shrink-0 text-muted-foreground/40">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className={cn('shrink-0 font-semibold tracking-wider', entry.tone)}>
        {entry.tag}
      </span>
      <span className="min-w-0 text-muted-foreground/80">{entry.text}</span>
    </div>
  )
}

function BrandPanel() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 2600)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="relative hidden overflow-hidden border-r border-border/60 lg:flex lg:flex-col">
      {/* Latar: grid + glow bertema radar intelijen */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 30% 40%, black, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 70% at 30% 40%, black, transparent 75%)',
        }}
      />
      <div
        aria-hidden
        className="absolute -left-32 top-1/4 h-[460px] w-[460px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--primary) / 0.16), transparent 68%)',
        }}
      />
      <div
        aria-hidden
        className="absolute -bottom-24 right-0 h-[380px] w-[380px] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(var(--accent) / 0.12), transparent 70%)',
        }}
      />

      <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-12">
        <div className="space-y-7">
          <div className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
              <Radar className="h-5 w-5 text-primary" />
              <span className="absolute inset-0 animate-ping rounded-lg border border-primary/30" />
            </span>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary/80">
                IMA · ISA
              </p>
              <p className="text-sm font-semibold tracking-tight text-foreground">
                Media &amp; Social Intelligence
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="max-w-[19ch] text-[32px] font-semibold leading-[1.15] tracking-tight text-foreground xl:text-[38px]">
              Pantau isu nasional sebelum menjadi krisis.
            </h1>
            <p className="max-w-[42ch] text-[13px] leading-relaxed text-muted-foreground">
              Ingestion 10 portal, sentimen IndoBERT, ekstraksi tokoh, klaster
              semantik <span className="font-mono text-[12px] text-accent">pgvector</span>,
              dan peringatan dini lonjakan — dalam satu konsol analis.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {SIGNALS.map((signal) => (
              <div
                key={signal.label}
                className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5 backdrop-blur-sm"
              >
                <div className="flex items-center gap-1.5">
                  <signal.icon className="h-3 w-3 text-primary/70" />
                  <p className="font-mono text-[15px] font-semibold leading-none text-foreground">
                    {signal.value}
                  </p>
                </div>
                <p className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  {signal.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {/* Log bergulir */}
          <div className="rounded-md border border-border/60 bg-card/50 p-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" />
                pipeline langsung
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/50">
                SSE · stream
              </span>
            </div>
            <div className="space-y-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <FeedLine key={`${tick}-${index}`} index={tick + index} />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
              <MapPin className="h-2.5 w-2.5" />
              sumber terpantau
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((source) => (
                <span
                  key={source}
                  className="rounded border border-border/50 bg-secondary/30 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70"
                >
                  {source}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { login, status } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true })
  }, [status, navigate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)
    try {
      await login(username, password)
      navigate('/', { replace: true })
    } catch (caught) {
      setError((caught as Error)?.message ?? 'Gagal masuk.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      {/* Panel form */}
      <div className="relative flex items-center justify-center px-5 py-10 sm:px-8">
        <div
          aria-hidden
          className="absolute inset-0 lg:hidden"
          style={{
            backgroundImage:
              'radial-gradient(700px 420px at 50% -10%, hsl(var(--primary) / 0.12), transparent 62%)',
          }}
        />

        <div className="relative w-full max-w-[380px]">
          {/* Logo versi mobile */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
              <Radar className="h-4 w-4 text-primary" />
            </span>
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-primary/80">
                IMA · ISA
              </p>
              <p className="text-[13px] font-semibold text-foreground">
                Media &amp; Social Intelligence
              </p>
            </div>
          </div>

          <div className="mb-7 space-y-1.5">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
              <Lock className="h-2.5 w-2.5" />
              akses analis
            </p>
            <h2 className="text-[26px] font-semibold tracking-tight text-foreground">
              Masuk ke konsol
            </h2>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Gunakan kredensial admin untuk membuka dashboard pemantauan.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-[11px]">
                Username
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  className="h-10 pl-8 text-[13px]"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[11px]">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••"
                  className="h-10 pl-8 pr-9 text-[13px]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-negative/40 bg-negative/10 px-2.5 py-2 text-[11px] leading-snug text-negative"
              >
                <Ban className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button type="submit" className="h-10 w-full text-[13px]" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Memverifikasi…
                </>
              ) : (
                <>
                  Masuk ke dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 space-y-3 border-t border-border/50 pt-5">
            <div className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground/70">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-positive/70" />
              <p>
                Sesi disimpan sebagai cookie <span className="font-mono">httpOnly</span> dan
                kedaluwarsa otomatis dalam 7 hari. Tidak ada token yang disimpan di
                browser.
              </p>
            </div>
            <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/40">
              <Clapperboard className="h-2.5 w-2.5" />
              indonesia media &amp; social intelligence engine
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
