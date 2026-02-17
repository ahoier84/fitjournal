import { useState, useCallback } from 'react'
import { Download, Upload, Trash2, HardDrive, AlertTriangle } from 'lucide-react'
import { db } from '@/db/database'
import { useLiveQuery } from 'dexie-react-hooks'

export function SettingsPage() {
  const [clearing, setClearing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const counts = useLiveQuery(async () => {
    const workouts = await db.workouts.count()
    const metrics = await db.dailyMetrics.count()
    const summaries = await db.activitySummaries.count()
    const journals = await db.journalEntries.count()
    const imports = await db.importRecords.count()
    return { workouts, metrics, summaries, journals, imports }
  })

  const storageEstimate = useLiveQuery(async () => {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate()
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      }
    }
    return null
  })

  const handleExport = useCallback(async () => {
    try {
      setExportStatus('Exporting...')
      const data = {
        workouts: await db.workouts.toArray(),
        dailyMetrics: await db.dailyMetrics.toArray(),
        activitySummaries: await db.activitySummaries.toArray(),
        journalEntries: await db.journalEntries.toArray(),
        importRecords: await db.importRecords.toArray(),
        exportedAt: new Date().toISOString(),
      }

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fitjournal-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('Export complete!')
      setTimeout(() => setExportStatus(null), 3000)
    } catch {
      setExportStatus('Export failed')
    }
  }, [])

  const handleImportBackup = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      if (data.workouts) await db.workouts.bulkPut(data.workouts)
      if (data.dailyMetrics) await db.dailyMetrics.bulkPut(data.dailyMetrics)
      if (data.activitySummaries) await db.activitySummaries.bulkPut(data.activitySummaries)
      if (data.journalEntries) await db.journalEntries.bulkPut(data.journalEntries)

      setExportStatus('Backup restored!')
      setTimeout(() => setExportStatus(null), 3000)
    } catch {
      setExportStatus('Restore failed - invalid backup file')
    }

    e.target.value = ''
  }, [])

  const handleClearAll = useCallback(async () => {
    setClearing(true)
    try {
      await db.workouts.clear()
      await db.dailyMetrics.clear()
      await db.activitySummaries.clear()
      await db.journalEntries.clear()
      await db.importRecords.clear()
    } finally {
      setClearing(false)
      setShowConfirm(false)
    }
  }, [])

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {/* Data Summary */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> Data Summary
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Workouts</p>
            <p className="text-lg font-semibold">{counts?.workouts ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Daily Metrics</p>
            <p className="text-lg font-semibold">{counts?.metrics ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Activity Summaries</p>
            <p className="text-lg font-semibold">{counts?.summaries ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Journal Entries</p>
            <p className="text-lg font-semibold">{counts?.journals ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Imports</p>
            <p className="text-lg font-semibold">{counts?.imports ?? 0}</p>
          </div>
          {storageEstimate && (
            <div>
              <p className="text-muted-foreground">Storage Used</p>
              <p className="text-lg font-semibold">{formatBytes(storageEstimate.usage)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Export / Import Backup */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h3 className="font-medium mb-4">Backup & Restore</h3>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="w-4 h-4" /> Export Backup
          </button>

          <label className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors cursor-pointer">
            <Upload className="w-4 h-4" /> Restore Backup
            <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
          </label>
        </div>
        {exportStatus && (
          <p className="text-sm text-muted-foreground mt-3">{exportStatus}</p>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-card rounded-xl border border-destructive/30 p-5">
        <h3 className="font-medium mb-2 text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> Danger Zone
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Permanently delete all data stored in this app. This cannot be undone.
        </p>

        {showConfirm ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className="px-4 py-2.5 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Yes, delete everything'}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-destructive/10 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Clear All Data
          </button>
        )}
      </div>
    </div>
  )
}
