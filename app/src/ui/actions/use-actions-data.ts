import * as React from 'react'
import { actionsErrorMessage } from '../../lib/actions-client'
import { ActionsProvider } from '../../models/actions'

export const ActionsPollInterval = 30000

interface IActionsData<T> {
  readonly key: string
  readonly data: T | null
  readonly loading: boolean
  readonly error: string | null
  readonly updatedAt: number | null
}

/** One in-flight request per view, no background polling or stale responses. */
export function useActionsData<T>(
  key: string,
  load: () => Promise<T>,
  shouldPoll: (data: T) => boolean,
  provider: ActionsProvider = 'github'
) {
  const [state, setState] = React.useState<IActionsData<T>>({
    key,
    data: null,
    loading: true,
    error: null,
    updatedAt: null,
  })
  const requestRefresh = React.useRef<() => void>(() => {})
  const refresh = React.useCallback(() => requestRefresh.current(), [])

  React.useEffect(() => {
    let disposed = false
    let inFlight = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failed = false
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    const fetchData = async () => {
      if (disposed || inFlight || document.hidden) {
        return
      }
      clearTimer()
      inFlight = true
      failed = false
      setState(old => ({
        key,
        data: old.key === key ? old.data : null,
        updatedAt: old.key === key ? old.updatedAt : null,
        loading: true,
        error: null,
      }))
      try {
        const data = await load()
        if (!disposed) {
          setState({
            key,
            data,
            loading: false,
            error: null,
            updatedAt: Date.now(),
          })
          if (!document.hidden && shouldPoll(data)) {
            timer = setTimeout(fetchData, ActionsPollInterval)
          }
        }
      } catch (error) {
        failed = true
        if (!disposed) {
          setState(old => ({
            ...old,
            loading: false,
            error: actionsErrorMessage(error, provider),
          }))
        }
        // Stop on HTTP/network failures, including rate limits. Retry is explicit.
      } finally {
        inFlight = false
      }
    }
    const onVisibilityChanged = () => {
      clearTimer()
      if (!document.hidden && !failed) {
        fetchData()
      }
    }
    requestRefresh.current = fetchData
    document.addEventListener('visibilitychange', onVisibilityChanged)
    fetchData()
    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChanged)
      requestRefresh.current = () => {}
    }
  }, [key, load, shouldPoll, provider])

  // Even before effects run, a different repository/account/page cannot show
  // private data or a late response belonging to the previous target.
  return {
    ...(state.key === key
      ? state
      : {
          key,
          data: null,
          loading: true,
          error: null,
          updatedAt: null,
        }),
    refresh,
  }
}
