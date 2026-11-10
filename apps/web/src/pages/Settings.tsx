import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react'
import type { KeywordDTO } from '@media-intel/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/PageHeader'
import { useKeywords, useSources, useSystemStatus } from '@/hooks/useAnalytics'
import {
  API_BASE,
  createKeyword,
  fetchSystemStatus,
  removeKeyword,
  seedDemoData,
  toggleSource,
  updateKeyword,
  validateBooleanQuery,
} from '@/lib/api'
import { PLATFORM_LABEL, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-primary/40 bg-primary/30' : 'border-border bg-secondary',
      )}
    >
      <span
        className={cn(
          'h-2.5 w-2.5 rounded-full transition-transform',
          checked ? 'translate-x-[13px] bg-primary' : 'translate-x-[3px] bg-muted-foreground',
        )}
      />
    </button>
  )
}

function StatusTile({
  label,
  value,
  ok,
  hint,
}: {
  label: string
  value: string
  ok: boolean | null
  hint?: string
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <span className="label-caps">{label}</span>
        {ok === null ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-positive" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-negative" />
        )}
      </div>
      <p className="mt-1.5 font-mono text-sm font-semibold uppercase tracking-wide text-foreground">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

const QUERY_EXAMPLES = [
  'rupiah OR inflasi',
  '"bank indonesia" AND rupiah',
  '(pemilu OR presiden) AND NOT hoaks',
  'banjir -hoaks',
]

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const keywords = useKeywords(true)
  const sources = useSources()
  const status = useSystemStatus()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<KeywordDTO | null>(null)
  const [label, setLabel] = useState('')
  const [booleanQuery, setBooleanQuery] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ ok: boolean; terms: string[]; error: string | null } | null>(
    null,
  )
  const [notice, setNotice] = useState<string | null>(null)

  const notify = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(null), 6_000)
  }

  const saveKeyword = useMutation({
    mutationFn: async () => {
      const check = await validateBooleanQuery(booleanQuery)
      if (!check.ok) throw new Error(check.error ?? 'Query Boolean tidak valid.')
      if (editing) {
        return updateKeyword(editing.id, { label, booleanQuery, isActive })
      }
      return createKeyword({ label, booleanQuery, isActive })
    },
    onSuccess: async () => {
      setDialogOpen(false)
      setFormError(null)
      setValidation(null)
      notify(editing ? 'Kata kunci diperbarui.' : 'Kata kunci baru ditambahkan.')
      await queryClient.invalidateQueries({ queryKey: ['keywords'] })
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'Gagal menyimpan.'),
  })

  const testQuery = useMutation({
    mutationFn: () => validateBooleanQuery(booleanQuery),
    onSuccess: (result) => {
      setValidation({ ok: result.ok, terms: result.terms, error: result.error })
      if (!result.ok) setFormError(result.error ?? 'Query tidak valid.')
      else setFormError(null)
    },
  })

  const toggleKeyword = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      updateKeyword(id, { isActive: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['keywords'] })
    },
  })

  const deleteKeywordMutation = useMutation({
    mutationFn: (id: string) => removeKeyword(id),
    onSuccess: async () => {
      notify('Kata kunci dihapus.')
      await queryClient.invalidateQueries({ queryKey: ['keywords'] })
    },
  })

  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => toggleSource(id, next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const seed = useMutation({
    mutationFn: seedDemoData,
    onSuccess: async (result) => {
      notify(result.message)
      await queryClient.invalidateQueries()
    },
  })

  const openCreate = () => {
    setEditing(null)
    setLabel('')
    setBooleanQuery('')
    setIsActive(true)
    setFormError(null)
    setValidation(null)
    setDialogOpen(true)
  }

  const openEdit = (keyword: KeywordDTO) => {
    setEditing(keyword)
    setLabel(keyword.label)
    setBooleanQuery(keyword.booleanQuery)
    setIsActive(keyword.isActive)
    setFormError(null)
    setValidation(null)
    setDialogOpen(true)
  }

  const appendToken = (token: string) => {
    setBooleanQuery((previous) => (previous ? `${previous.trimEnd()} ${token} ` : `${token} `))
    setValidation(null)
  }

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({ queryKey: ['system-status'] })
    void fetchSystemStatus()
  }

  return (
    <div>
      <PageHeader
        eyebrow="Konfigurasi platform"
        title="Pengaturan"
        description="Kelola kata kunci pantauan, sumber media, koneksi pipeline, dan dataset demo."
        actions={
          <Button variant="outline" size="sm" onClick={refreshStatus} disabled={status.isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', status.isFetching && 'animate-spin')} />
            Cek sistem
          </Button>
        }
      />

      {notice ? (
        <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Kata kunci pantauan</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Boolean query diterapkan pada judul dan isi artikel
              </p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Tambah
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {keywords.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : keywords.data && keywords.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Label</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead className="w-[84px] text-right">7 hari</TableHead>
                    <TableHead className="w-[70px]">Aktif</TableHead>
                    <TableHead className="w-[76px] pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywords.data.map((keyword) => (
                    <TableRow key={keyword.id}>
                      <TableCell className="py-2 pl-4">
                        <p className="text-xs font-medium text-foreground">{keyword.label}</p>
                        <p className="font-mono text-[9px] text-muted-foreground">
                          {formatDateTime(keyword.createdAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <code className="line-clamp-2 max-w-[220px] font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {keyword.booleanQuery}
                        </code>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-foreground/80">
                        {formatNumber(keyword.matches ?? 0)}
                      </TableCell>
                      <TableCell>
                        <Toggle
                          checked={keyword.isActive}
                          label={`Aktifkan ${keyword.label}`}
                          onChange={(next) =>
                            toggleKeyword.mutate({ id: keyword.id, next })
                          }
                        />
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(keyword)}
                            aria-label="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-negative/70 hover:text-negative"
                            onClick={() => {
                              if (window.confirm(`Hapus kata kunci "${keyword.label}"?`)) {
                                deleteKeywordMutation.mutate(keyword.id)
                              }
                            }}
                            aria-label="Hapus"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="p-6 text-center text-xs text-muted-foreground">
                Belum ada kata kunci. Tambahkan satu untuk mulai memantau isu.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Status infrastruktur</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Koneksi pipeline dan model
              </p>
            </div>
            <Radio className="h-3.5 w-3.5 text-muted-foreground/60" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <StatusTile
                label="PostgreSQL"
                value={status.data?.database ?? '…'}
                ok={status.data ? status.data.database === 'ok' : null}
                hint="pgvector 16"
              />
              <StatusTile
                label="Redis"
                value={status.data?.redis ?? '…'}
                ok={status.data ? status.data.redis === 'ok' : null}
                hint="Streams & pub/sub"
              />
              <StatusTile
                label="LLM Gateway"
                value={status.data?.llm ?? '…'}
                ok={status.data ? status.data.llm === 'ok' : null}
                hint={
                  status.data
                    ? status.data.llmProvider === 'disabled'
                      ? 'set LLM_URL di .env'
                      : `${status.data.llmProvider} · ${status.data.versions.model}`
                    : 'OpenAI-compatible'
                }
              />
              <StatusTile
                label="Worker"
                value={
                  status.data?.worker.lastProcessedAt
                    ? formatRelative(status.data.worker.lastProcessedAt)
                    : 'belum ada'
                }
                ok={status.data ? status.data.worker.lastProcessedAt !== null : null}
                hint={`backlog ${formatNumber(status.data?.worker.backlog ?? 0)}`}
              />
            </div>

            <div className="space-y-1.5 rounded-md border border-border/60 bg-background/40 p-3 text-[11px]">
              {([
                ['Sumber media', status.data?.counts.sources],
                ['Artikel terindeks', status.data?.counts.mediaItems],
                ['Klaster isu', status.data?.counts.clusters],
                ['Peringatan', status.data?.counts.alerts],
                ['Kata kunci', status.data?.counts.keywords],
              ] as Array<[string, number | undefined]>).map(([labelText, value]) => (
                <div key={String(labelText)} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{labelText}</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {value === undefined ? '—' : formatNumber(value)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5">
                <span className="text-muted-foreground">Consumer group</span>
                <code className="font-mono text-[10px] text-foreground/80">
                  {status.data?.worker.consumerGroup ?? 'ai-workers'}
                </code>
              </div>
            </div>

            <Button variant="outline" size="sm" className="w-full" asChild>
              <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
                <BookOpen className="h-3.5 w-3.5" />
                Dokumentasi API (Swagger)
                <ExternalLink className="ml-auto h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Sumber media terpantau</CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Matriks 10 portal berita Indonesia
            </p>
          </div>
          <Badge variant="outline" className="font-mono">
            {sources.data?.length ?? 0} sumber
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {sources.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Portal</TableHead>
                  <TableHead className="hidden md:table-cell">Platform</TableHead>
                  <TableHead className="hidden lg:table-cell">RSS</TableHead>
                  <TableHead className="text-right">Artikel</TableHead>
                  <TableHead className="w-[70px] pr-4">Aktif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.data?.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="py-2 pl-4">
                      <p className="text-xs font-medium text-foreground">{source.name}</p>
                      <p className="font-mono text-[9px] text-muted-foreground">{source.domain}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="secondary">{PLATFORM_LABEL[source.platform]}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[280px] lg:table-cell">
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {source.rssUrl ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-foreground/80">
                      {formatNumber(source.totalItems ?? 0)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Toggle
                        checked={source.isActive}
                        label={`Aktifkan ${source.name}`}
                        onChange={(next) => toggleSourceMutation.mutate({ id: source.id, next })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dataset demo</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Isi dashboard dengan 60 artikel lintas 5 topik, embedding, dan lonjakan BBM
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Endpoint <code className="text-foreground/80">POST /api/dev/seed</code> hanya aktif
              di luar production. Data demo bersifat idempoten — aman dijalankan berulang.
            </p>
            <Button onClick={() => seed.mutate()} disabled={seed.isPending} size="sm">
              <Sparkles className={cn('h-3.5 w-3.5', seed.isPending && 'animate-pulse')} />
              {seed.isPending ? 'Menyiapkan data…' : 'Muat data demo'}
            </Button>
            {seed.isError ? (
              <p className="text-[11px] text-negative">{(seed.error as Error)?.message}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Panduan pipeline</CardTitle>
            <p className="-mt-1 text-[11px] text-muted-foreground">
              Urutan menjalankan komponen
            </p>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-[11px] text-muted-foreground">
              {[
                'docker compose up -d postgres redis',
                'bun run db:generate && bun run db:migrate && bun run db:seed',
                'bun run dev (API :3001 + dashboard :5173)',
                'bun run worker:poll (RSS → Redis Streams)',
                'bun run worker (AI enrichment daemon)',
                'bun run worker:cluster (cron klasterisasi)',
              ].map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-secondary/50 font-mono text-[9px] text-foreground/70">
                    {index + 1}
                  </span>
                  <code className="text-[10px] leading-relaxed text-foreground/75">{step}</code>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit kata kunci' : 'Kata kunci baru'}</DialogTitle>
            <DialogDescription>
              Gunakan operator AND, OR, NOT, tanda kutip untuk frasa, dan tanda kurung untuk
              pengelompokan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto p-5">
            <div className="space-y-1.5">
              <Label htmlFor="keyword-label">Label pantauan</Label>
              <Input
                id="keyword-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Contoh: Ekonomi & Rupiah"
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="keyword-query">Boolean query</Label>
                <span className="flex items-center gap-1">
                  {['AND', 'OR', 'NOT', '(', ')', '"..."'].map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => appendToken(token === '"..."' ? '""' : token)}
                      className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {token}
                    </button>
                  ))}
                </span>
              </div>
              <Textarea
                id="keyword-query"
                value={booleanQuery}
                onChange={(event) => {
                  setBooleanQuery(event.target.value)
                  setValidation(null)
                }}
                placeholder='(pemilu OR presiden) AND NOT hoaks'
                className="min-h-[84px] font-mono text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testQuery.mutate()}
                  disabled={!booleanQuery.trim() || testQuery.isPending}
                >
                  <Wand2 className={cn('h-3.5 w-3.5', testQuery.isPending && 'animate-pulse')} />
                  Uji query
                </Button>
                {validation ? (
                  validation.ok ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-positive">
                      <CheckCircle2 className="h-3 w-3" />
                      Valid · istilah: {validation.terms.join(', ')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-negative">
                      <XCircle className="h-3 w-3" />
                      {validation.error}
                    </span>
                  )
                ) : (
                  <span className="text-[10px] text-muted-foreground/60">
                    Implicit AND didukung: `rupiah inflasi`
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUERY_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setBooleanQuery(example)
                    setValidation(null)
                  }}
                  className="rounded border border-border/70 bg-background/40 px-2 py-1 font-mono text-[9px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
              <div>
                <p className="text-xs text-foreground">Aktifkan pemantauan</p>
                <p className="text-[10px] text-muted-foreground">
                  Digunakan oleh filter dashboard dan spike detector.
                </p>
              </div>
              <Toggle checked={isActive} onChange={setIsActive} label="Status kata kunci" />
            </div>

            {formError ? (
              <p className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
                {formError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={() => saveKeyword.mutate()}
              disabled={!label.trim() || !booleanQuery.trim() || saveKeyword.isPending}
            >
              {saveKeyword.isPending ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Tambahkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 text-[10px] text-muted-foreground/60">
        <span className="inline-flex items-center gap-1.5">
          <Server className="h-3 w-3" />
          API versi {status.data?.versions.api ?? '0.1.0'} · LLM{' '}
          {status.data?.versions.provider ?? 'ollama'}/{status.data?.versions.model ?? 'qwen2.5:7b'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          PostgreSQL 16 + pgvector · Redis 7 Streams
        </span>
      </div>
    </div>
  )
}
