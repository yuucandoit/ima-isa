import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AppSidebar } from './AppSidebar'
import { Header } from './Header'

export function DashboardShell() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen">
      <AppSidebar />

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 animate-slide-in">
            <AppSidebar
              mobile
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="md:pl-[248px]">
        <Header onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 pb-8 pt-4 text-[10px] text-muted-foreground/60 sm:px-6 lg:px-8">
          <span>IMA-ISA · Indonesia Media &amp; Social Intelligence Engine</span>
          <span className="font-mono">10 portal · IndoBERT · pgvector · SSE</span>
        </footer>
      </div>
    </div>
  )
}
