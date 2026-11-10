import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 menebak URL worker dari `import.meta.url` saat runtime — pola yang tidak
// bisa dideteksi bundler. Impor eksplisit di sini supaya worker ikut ter-emit oleh Vite
// (dev & build produksi) dan tidak gagal dengan "Worker failed to load".
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Crosshair, MapPin, Newspaper, RotateCcw } from 'lucide-react'
import type { FeatureCollection, Point } from 'geojson'
import type { LocationAnalyticsResult, LocationPoint } from '@media-intel/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/States'
import { formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ── Skala risiko (rasio artikel negatif) ──────────────────── */

const RISK_STOPS = [
  { min: 50, label: '≥ 50%', color: 'hsl(352 78% 62%)' },
  { min: 30, label: '30–50%', color: 'hsl(20 85% 62%)' },
  { min: 15, label: '15–30%', color: 'hsl(38 92% 58%)' },
  { min: 0, label: '< 15%', color: 'hsl(158 64% 52%)' },
] as const

function riskColor(ratio: number): string {
  return (RISK_STOPS.find((stop) => ratio >= stop.min) ?? RISK_STOPS[RISK_STOPS.length - 1]!).color
}

/**
 * Basemap vektor gratis & terbuka: gaya `dark` OpenFreeMap
 * (data © OpenStreetMap, skema OpenMapTiles, dirender MapLibre GL — semua open source).
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'
const MAP_ATTRIBUTION =
  '© <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

setWorkerUrl(maplibreWorkerUrl)

const INDONESIA_CENTER: [number, number] = [118.0149, -2.5489]
const CIRCLED = ['top', 'bottom', 'left', 'right'] as const

type Bounds = [[number, number], [number, number]]

/**
 * Kamera peta selalu berpusat di Indonesia (Sabang–Merauke). Sebutan luar negeri
 * (China, Amerika Serikat, …) tidak boleh menarik peta sampai skala dunia — entitas
 * asing tetap tampil di daftar peringkat tetapi kamera tidak mengejarnya.
 */
const INDONESIA_BOUNDS: Bounds = [
  [94.5, -11.5],
  [141.5, 7.5],
]

/** Ruang geser di tepi frame agar Selat Malaka & Pasifik tetap bisa dijangkau. */
const PAN_LIMIT: Bounds = [
  [88, -16],
  [150, 13],
]

function isDomestic(point: LocationPoint): boolean {
  const [[minLng, minLat], [maxLng, maxLat]] = INDONESIA_BOUNDS
  return (
    point.latitude >= minLat &&
    point.latitude <= maxLat &&
    point.longitude >= minLng &&
    point.longitude <= maxLng
  )
}

function domesticPoints(points: LocationPoint[]): LocationPoint[] {
  return points.filter(isDomestic)
}

function fitToPoints(map: MapLibreMap, points: LocationPoint[], duration = 800) {
  if (points.length === 0) {
    map.fitBounds(INDONESIA_BOUNDS, { padding: 28, duration })
    return
  }

  if (points.length === 1) {
    const only = points[0]!
    map.flyTo({ center: [only.longitude, only.latitude], zoom: 6, duration })
    return
  }

  const lngs = points.map((point) => point.longitude)
  const lats = points.map((point) => point.latitude)
  const bounds: Bounds = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
  map.fitBounds(bounds, { padding: 44, maxZoom: 6, duration })
}

type RegionProps = {
  name: string
  total: number
  ratio: number
  radius: number
  color: string
  rank: number
}

type RegionCollection = FeatureCollection<Point, RegionProps>

const EMPTY_COLLECTION: RegionCollection = { type: 'FeatureCollection', features: [] }

function buildCollection(points: LocationPoint[], ids: Map<string, number>): RegionCollection {
  const maxTotal = Math.max(1, ...points.map((point) => point.total))
  const rankByName = new Map(points.map((point, index) => [point.name, index + 1]))

  return {
    type: 'FeatureCollection',
    features: [...points]
      .sort((a, b) => a.total - b.total)
      .map((point, index) => ({
        type: 'Feature',
        id: ids.get(point.name) ?? index + 1,
        properties: {
          name: point.name,
          total: point.total,
          ratio: point.negativeRatio,
          radius: 5 + 17 * Math.sqrt(point.total / maxTotal),
          color: riskColor(point.negativeRatio),
          rank: rankByName.get(point.name) ?? points.length,
        },
        geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
      })),
  }
}

function buildTooltipContent(point: LocationPoint): HTMLElement {
  const root = document.createElement('div')
  root.className = 'ima-tip'

  const title = document.createElement('p')
  title.className = 'ima-tip-title'
  title.textContent = point.name

  const meta = document.createElement('p')
  meta.className = 'ima-tip-meta'
  const total = document.createElement('span')
  total.textContent = `${formatNumber(point.total)} sebutan`
  const ratio = document.createElement('span')
  ratio.className = 'ima-tip-ratio'
  ratio.textContent = `${formatPercent(point.negativeRatio, 0)} negatif`
  ratio.style.color = riskColor(point.negativeRatio)
  meta.append(total, document.createTextNode(' · '), ratio)

  root.append(title, meta)
  return root
}

/* ── Panel detail wilayah terpilih ─────────────────────────── */

function RegionDetail({ point, onClear }: { point: LocationPoint; onClear: () => void }) {
  return (
    <div className="animate-fade-in space-y-2.5">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: riskColor(point.negativeRatio) }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{point.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {formatNumber(point.total)} sebutan · {point.sourceCount} sumber
            {isDomestic(point) ? '' : ' · luar negeri'}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onClear}>
          Tutup
        </Button>
      </div>

      <div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Rasio negatif</span>
          <span
            className="font-mono font-medium tabular-nums"
            style={{ color: riskColor(point.negativeRatio) }}
          >
            {formatPercent(point.negativeRatio, 1)}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, point.negativeRatio)}%`,
              background: riskColor(point.negativeRatio),
            }}
          />
        </div>
      </div>

      {point.sources.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {point.sources.slice(0, 4).map((source) => (
            <span
              key={source}
              className="max-w-[130px] truncate rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {source}
            </span>
          ))}
        </div>
      ) : null}

      {point.sampleHeadlines.length > 0 ? (
        <ul className="space-y-1 border-t border-border/50 pt-2">
          {point.sampleHeadlines.slice(0, 2).map((headline) => (
            <li
              key={headline}
              className="line-clamp-2 text-[10px] leading-relaxed text-foreground/70"
            >
              {headline}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ── Komponen utama ────────────────────────────────────────── */

export function LocationInsights({
  data,
  isLoading,
}: {
  data?: LocationAnalyticsResult
  isLoading?: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const tooltipRef = useRef<Popup | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const pointByNameRef = useRef(new Map<string, LocationPoint>())
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const points = useMemo(() => data?.points ?? [], [data])

  // id fitur harus stabil agar feature-state tidak berpindah saat data di-refresh
  const idByName = useMemo(() => {
    const ids = new Map<string, number>()
    ;[...points]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((point, index) => ids.set(point.name, index + 1))
    return ids
  }, [points])

  const collection = useMemo(() => buildCollection(points, idByName), [points, idByName])
  const signature = useMemo(
    () => points.map((point) => `${point.name}:${point.total}`).join('|'),
    [points],
  )
  const signatureRef = useRef(signature)

  const selected = points.find((point) => point.name === selectedName) ?? null
  const hasPoints = points.length > 0
  const mappedRatio =
    data && data.totalMentions > 0
      ? Number(((data.mappedMentions / data.totalMentions) * 100).toFixed(0))
      : 0

  useEffect(() => {
    pointByNameRef.current = new Map(points.map((point) => [point.name, point]))
    signatureRef.current = signature
  }, [points, signature])

  /* ── Inisialisasi peta ─────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      center: INDONESIA_CENTER,
      zoom: 4,
      minZoom: 3,
      maxZoom: 12,
      renderWorldCopies: false,
      scrollZoom: false,
      dragRotate: false,
      maxBounds: PAN_LIMIT,
      attributionControl: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()

    map.addControl(
      new AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }),
      'bottom-right',
    )
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')

    // Tooltip kursor
    const tooltip = new Popup({
      className: 'ima-map-tip',
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      offset: 14,
      maxWidth: '260px',
    })
    tooltipRef.current = tooltip

    const publishSelection = (name: string) => {
      setSelectedName(name)
      const point = pointByNameRef.current.get(name)
      if (!point || !isDomestic(point)) return
      map.flyTo({
        center: [point.longitude, point.latitude],
        zoom: Math.max(map.getZoom(), 5),
        duration: 700,
      })
    }

    map.on('style.load', () => {
      // Selaraskan warna basemap dengan palet gelap dashboard.
      const recolor = (layer: string, property: string, value: string) => {
        if (!map.getLayer(layer)) return
        try {
          // Nama properti paint berbeda per tipe layer; divalidasi saat runtime.
          ;(map.setPaintProperty as (id: string, name: string, v: unknown) => void)(
            layer,
            property,
            value,
          )
        } catch {
          /* properti tidak tersedia pada versi gaya ini */
        }
      }
      recolor('background', 'background-color', 'hsl(220 34% 7%)')
      recolor('water', 'fill-color', 'hsl(220 32% 12%)')
      recolor('waterway', 'line-color', 'hsl(220 32% 12%)')
      recolor('landcover_wood', 'fill-color', 'hsl(200 20% 11%)')
      recolor('landuse_park', 'fill-color', 'hsl(200 20% 11%)')
      recolor('building', 'fill-color', 'hsl(220 22% 10%)')
      recolor('boundary_country_z0-4', 'line-color', 'hsl(215 22% 30%)')
      recolor('boundary_country_z5-', 'line-color', 'hsl(215 22% 30%)')
      recolor('boundary_state', 'line-color', 'hsl(215 18% 22%)')

      // Panah satu arah hanya muncul di zoom jalan raya (jarang dipakai di peta nasional)
      // dan titik kota memakai sprite yang tak tersedia di gaya ini — dibuang agar bersih.
      for (const layer of ['road_oneway', 'road_oneway_opposite']) {
        if (map.getLayer(layer)) map.removeLayer(layer)
      }
      for (const layer of ['place_town', 'place_city', 'place_city_large']) {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'icon-image', '')
      }

      map.addSource('regions', { type: 'geojson', data: EMPTY_COLLECTION })

      map.addLayer({
        id: 'region-halo',
        type: 'circle',
        source: 'regions',
        filter: ['==', ['get', 'name'], ''],
        paint: {
          'circle-radius': ['+', ['get', 'radius'], 7],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': 0.5,
        },
      })

      map.addLayer({
        id: 'region-circle',
        type: 'circle',
        source: 'regions',
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.72, 0.42],
          'circle-stroke-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            'hsl(210 40% 98%)',
            ['get', 'color'],
          ],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 1],
          'circle-stroke-opacity': 0.85,
        },
      })

      map.addLayer({
        id: 'region-labels',
        type: 'symbol',
        source: 'regions',
        filter: ['<=', ['get', 'rank'], 10],
        minzoom: 4,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 7, 11],
          'text-variable-anchor': [...CIRCLED],
          'text-radial-offset': 1.5,
          'text-justify': 'auto',
          'text-padding': 3,
        },
        paint: {
          'text-color': 'hsl(210 22% 76%)',
          'text-halo-color': 'hsl(220 40% 5% / 0.92)',
          'text-halo-width': 1.2,
        },
      })

      const handleMove = (event: MapLayerMouseEvent) => {
        const name = event.features?.[0]?.properties?.name as string | undefined
        const point = name ? pointByNameRef.current.get(name) : undefined
        if (!point) return
        map.getCanvas().style.cursor = 'pointer'
        if (hoveredRef.current !== point.name) {
          hoveredRef.current = point.name
          tooltip.setDOMContent(buildTooltipContent(point))
        }
        tooltip.setLngLat([point.longitude, point.latitude]).addTo(map)
      }

      const handleLeave = () => {
        hoveredRef.current = null
        map.getCanvas().style.cursor = ''
        tooltip.remove()
      }

      const handleClick = (event: MapLayerMouseEvent) => {
        const name = event.features?.[0]?.properties?.name as string | undefined
        if (name) publishSelection(name)
      }

      map.on('mousemove', 'region-circle', handleMove)
      map.on('mouseleave', 'region-circle', handleLeave)
      map.on('click', 'region-circle', handleClick)

      setReady(true)
    })

    return () => {
      tooltip.remove()
      map.remove()
      mapRef.current = null
      tooltipRef.current = null
      setReady(false)
    }
  }, [])

  /* ── Data → geojson + auto fit ─────────────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const source = map.getSource('regions') as GeoJSONSource | undefined
    if (!source) return

    source.setData(collection)
    if (points.length === 0) return

    // Hanya wilayah domestik yang menentukan kamera; sebutan luar negeri cukup
    // tampil di daftar peringkat agar peta tidak melompat ke skala dunia.
    fitToPoints(map, domesticPoints(points))
    // `signature` sudah merepresentasikan isi `collection`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature])

  /* ── Wilayah aktif (pilihan / teratas) ─────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    for (const [name, id] of idByName) {
      const isSelected = name === selectedName
      if (isSelected) map.setFeatureState({ source: 'regions', id }, { selected: true })
      else map.removeFeatureState({ source: 'regions', id }, 'selected')
    }

    const active = selectedName ?? points[0]?.name ?? ''
    map.setFilter('region-halo', ['==', ['get', 'name'], active])
  }, [ready, selectedName, idByName, points])

  /* ── Denyut halo wilayah aktif ─────────────────────────── */
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let last = 0
    const started = performance.now()

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (now - last < 50) return
      last = now
      const phase = (Math.sin(((now - started) / 2400) * Math.PI * 2) + 1) / 2
      try {
        map.setPaintProperty('region-halo', 'circle-stroke-opacity', 0.12 + phase * 0.6)
      } catch {
        /* layer belum siap */
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready])

  const resetView = () => {
    setSelectedName(null)
    const map = mapRef.current
    if (!map) return
    if (points.length === 0) {
      map.flyTo({ center: INDONESIA_CENTER, zoom: 4, duration: 700 })
      return
    }
    fitToPoints(map, domesticPoints(points), 700)
  }

  const focusRegion = (point: LocationPoint) => {
    setSelectedName(point.name)
    const map = mapRef.current
    if (!map) return
    // Wilayah luar negeri tetap ditampilkan di panel detail, tetapi kamera
    // dipertahankan di Indonesia sesuai fokus peta.
    if (!isDomestic(point)) return
    map.flyTo({
      center: [point.longitude, point.latitude],
      zoom: Math.max(map.getZoom(), 5),
      duration: 700,
    })
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Sebaran isu per wilayah</CardTitle>
            <span className="rounded border border-border/70 bg-secondary/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              geo-intel
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Entitas lokasi hasil NER diproyeksikan ke peta. Ukuran gelembung = volume sebutan,
            warna = rasio sentimen negatif.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {RISK_STOPS.map((stop) => (
            <span key={stop.label} className="inline-flex items-center gap-1 text-[10px]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: stop.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{stop.label}</span>
            </span>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Wadah peta selalu ter-mount agar MapLibre tidak perlu diinisialisasi ulang */}
        <div className="relative">
          <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            {/* Peta */}
            <div className="relative border-b border-border/60 lg:border-b-0 lg:border-r">
              <div
                ref={containerRef}
                className="ima-map h-[380px] w-full lg:h-[440px]"
                role="application"
                aria-label="Peta sebaran pemberitaan per wilayah"
              />

              {hasPoints ? (
                <>
              {/* Overlay status */}
              <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col items-start gap-1.5">
                <span className="rounded border border-border/70 bg-background/85 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/80 backdrop-blur">
                  {points.length} wilayah · {mappedRatio}% sebutan terpetakan
                </span>
                <span className="rounded border border-border/50 bg-background/70 px-2 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur">
                  fokus Indonesia · klik gelembung untuk detail
                </span>
              </div>

              <div className="absolute right-3 top-3 z-[500]">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetView}
                  className="h-7 gap-1.5 border-border/70 bg-background/85 px-2 text-[10px] backdrop-blur hover:bg-secondary/70"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
              </div>

              {/* Legenda ukuran gelembung */}
              <div className="pointer-events-none absolute bottom-10 left-3 z-[500] hidden items-end gap-2 rounded border border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur sm:flex">
                {[0.25, 0.55, 1].map((scale) => {
                  const total = Math.max(1, ...points.map((point) => point.total))
                  return (
                    <span key={scale} className="flex flex-col items-center gap-0.5">
                      <span
                        className="rounded-full border border-primary/50 bg-primary/25"
                        style={{ height: 4 + 14 * scale, width: 4 + 14 * scale }}
                      />
                      <span className="font-mono text-[8px] text-muted-foreground">
                        {formatNumber(Math.round(total * scale))}
                      </span>
                    </span>
                  )
                })}
              </div>
                </>
              ) : null}
            </div>

            {/* Daftar wilayah */}
            {hasPoints ? (
            <div className="flex max-h-[440px] min-w-0 flex-col">
              <div className="border-b border-border/60 p-4">
                {selected ? (
                  <RegionDetail point={selected} onClear={() => setSelectedName(null)} />
                ) : (
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
                      <Crosshair className="h-3 w-3" />
                    </span>
                    <div>
                      <p className="text-[11px] font-medium text-foreground/90">Detail wilayah</p>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        Pilih gelembung pada peta atau wilayah di daftar bawah untuk melihat sumber
                        dan headline yang menyebutnya.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <p className="label-caps mb-2.5 flex items-center gap-1.5">
                  <Newspaper className="h-3 w-3" />
                  Wilayah teratas
                </p>
                <ul className="space-y-2">
                  {points.slice(0, 10).map((point) => {
                    const color = riskColor(point.negativeRatio)
                    const isSelected = point.name === selectedName
                    return (
                      <li key={point.name}>
                        <button
                          type="button"
                          onClick={() => focusRegion(point)}
                          className={cn(
                            'group w-full rounded-md px-2 py-1.5 text-left transition-colors',
                            isSelected ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                          )}
                        >
                          <div className="flex items-center gap-2 text-[11px]">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: color }}
                            />
                            <span className="min-w-0 flex-1 truncate text-foreground/90">
                              {point.name}
                            </span>
                            {isDomestic(point) ? null : (
                              <span className="shrink-0 rounded border border-border/70 bg-secondary/40 px-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
                                LN
                              </span>
                            )}
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {formatNumber(point.total)}
                            </span>
                            <span
                              className="w-9 text-right font-mono tabular-nums"
                              style={{ color }}
                            >
                              {formatPercent(point.negativeRatio, 0)}
                            </span>
                          </div>
                          <div className="ml-3.5 mt-1 h-0.5 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full opacity-70 transition-opacity group-hover:opacity-100"
                              style={{
                                width: `${Math.max(4, (point.total / Math.max(1, points[0]?.total ?? 1)) * 100)}%`,
                                background: color,
                              }}
                            />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>

                {data && data.unmapped.length > 0 ? (
                  <p className="mt-3 border-t border-border/60 pt-2 text-[9px] leading-relaxed text-muted-foreground/70">
                    {data.unmapped.length} entitas tanpa koordinat:{' '}
                    {data.unmapped
                      .slice(0, 3)
                      .map((item) => item.name)
                      .join(', ')}
                    {data.unmapped.length > 3 ? '…' : ''}
                  </p>
                ) : null}
              </div>
            </div>
            ) : null}
          </div>

          {!hasPoints ? (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-card/85 p-4 backdrop-blur-sm">
              {isLoading && !data ? (
                <Skeleton className="absolute inset-0 rounded-none" />
              ) : (
                <EmptyState
                  className="border-0 bg-transparent"
                  icon={MapPin}
                  title="Belum ada wilayah terpetakan"
                  description="Entitas lokasi akan muncul setelah worker AI menyelesaikan ekstraksi NER pada artikel rentang ini."
                />
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
