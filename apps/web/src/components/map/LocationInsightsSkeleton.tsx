import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** Placeholder saat chunk peta (MapLibre) masih dimuat. */
export function LocationInsightsSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-2">
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-2 w-72 max-w-full" />
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Skeleton className="h-[380px] w-full rounded-none lg:h-[440px]" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
