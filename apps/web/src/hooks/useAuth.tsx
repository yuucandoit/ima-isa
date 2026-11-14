import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchSession, loginRequest, logoutRequest, type SessionInfo } from '@/lib/api'

/**
 * Status autentikasi dashboard.
 *
 * Sesi sebenarnya ada di cookie `httpOnly` yang tidak bisa dibaca JS; hook ini
 * hanya menanyakan `GET /api/auth/me`. Karena itu logout harus lewat API (tidak
 * cukup menghapus cookie di klien).
 */
type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous'
  session: SessionInfo | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    session: null,
    error: null,
  })

  const load = useCallback(async () => {
    try {
      const session = await fetchSession()
      setState({
        status: session.authenticated ? 'authenticated' : 'anonymous',
        session,
        error: null,
      })
    } catch {
      // API tidak terjangkau: tetap tampilkan login agar pengguna tidak melihat
      // dashboard kosong tanpa penjelasan.
      setState({ status: 'anonymous', session: null, error: null })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const login = useCallback(
    async (username: string, password: string) => {
      setState((previous) => ({ ...previous, error: null }))
      await loginRequest(username, password)
      // Muat ulang semua query agar data terisi setelah sesi terbentuk.
      await queryClient.invalidateQueries()
      await load()
    },
    [load, queryClient],
  )

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    } finally {
      queryClient.clear()
      setState({ status: 'anonymous', session: null, error: null })
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, refresh: load }),
    [state, login, logout, load],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth harus dipakai di dalam <AuthProvider>')
  return context
}
