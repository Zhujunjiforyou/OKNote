import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { reportPersistenceIssue, usePersistenceStore } from '@/stores/persistence.store'

export function PersistenceNotice() {
  const issue = usePersistenceStore((state) => state.issue)
  const clear = usePersistenceStore((state) => state.clear)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => setRetrying(false), [issue?.id])

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return
    return window.electronAPI.onPersistenceFailure((failure) => {
      reportPersistenceIssue(failure.title || '数据未保存', failure.message || '磁盘写入失败，请稍后重试。')
    })
  }, [])

  if (!issue) return null

  const retry = async () => {
    if (!issue.retry || retrying) return
    setRetrying(true)
    clear()
    try {
      await issue.retry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="persistence-notice" role="alert" aria-live="assertive">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="persistence-notice-copy">
        <strong>{issue.title}</strong>
        <span>{issue.message}</span>
      </div>
      {issue.retry && (
        <button type="button" onClick={retry} disabled={retrying} className="persistence-notice-retry">
          <RefreshCw size={15} className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
          {retrying ? '重试中' : '重试'}
        </button>
      )}
      <button type="button" onClick={clear} className="persistence-notice-close" aria-label="关闭保存错误提示">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
