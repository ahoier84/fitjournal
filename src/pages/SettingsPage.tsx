import { useState, useCallback, useMemo } from 'react'
import { Download, Upload, Trash2, HardDrive, AlertTriangle, LogOut } from 'lucide-react'
import { getDocs, writeBatch, doc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection } from '@/db/database'
import { useFirestoreQuery } from '@/hooks/useFirestoreQuery'
import type { Workout, DailyMetric, ActivitySummary, JournalEntry, ImportRecord } from '@/db/models'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const [clearing, setClearing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const workoutsQ = useMemo(() => user ? userCollection(user.uid, 'workouts') : null, [user])
  const metricsQ = useMemo(() => user ? userCollection(user.uid, 'dailyMetrics') : null, [user])
  const summariesQ = useMemo(() => user ? userCollection(user.uid, 'activitySummaries') : null, [user])
  const journalsQ = useMemo(() => user ? userCollection(user.uid, 'journalEntries') : null, [user])
  const importsQ = useMemo(() => user ? userCollection(user.uid, 'importRecords') : null, [user])

  const workouts = useFirestoreQuery<Workout>(workoutsQ, [user?.uid, 'workouts'])
  const metrics = useFirestoreQuery<DailyMetric>(metricsQ, [user?.uid, 'metrics'])
  const summaries = useFirestoreQuery<ActivitySummary>(summariesQ, [user?.uid, 'summaries'])
  const journals = useFirestoreQuery<JournalEntry>(journalsQ, [user?.uid, 'journals'])
  const imports = useFirestoreQuery<ImportRecord>(importsQ, [user?.uid, 'imports'])

  const handleExport = useCallback(async () => {
    if (!user) return
    try {
      setExportStatus('Exporting...')
      const data = {
        workouts: workouts ?? [],
        dailyMetrics: metrics ?? [],
        activitySummaries: summaries ?? [],
        journalEntries: journals ?? [],
        importRecords: imports ?? [],
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
  }, [user, workouts, metrics, summaries, journals, imports])

  const handleImportBackup = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    try {
      setExportStatus('Restoring...')
      const text = await file.text()
      const data = JSON.parse(text)

      const collections = ['workouts', 'dailyMetrics', 'activitySummaries', 'journalEntries'] as const
      for (const col of collections) {
        if (data[col] && Array.isArray(data[col])) {
          const items = data[col] as Record<string, unknown>[]
          for (let i = 0; i < items.length; i += 500) {
            const batch = writeBatch(firestore)
            const chunk = items.slice(i, i + 500)
            for (const item of chunk) {
              const { id: _id, ...rest } = item
              const ref = doc(userCollection(user.uid, col))
              batch.set(ref, rest)
            }
            await batch.commit()
          }
        }
      }

      setExportStatus('Backup restored!')
      setTimeout(() => setExportStatus(null), 3000)
    } catch {
      setExportStatus('Restore failed - invalid backup file')
    }

    e.target.value = ''
  }, [user])

  const handleClearAll = useCallback(async () => {
    if (!user) return
    setClearing(true)
    try {
      const collections = ['workouts', 'dailyMetrics', 'activitySummaries', 'journalEntries', 'importRecords']
      for (const col of collections) {
        const snap = await getDocs(userCollection(user.uid, col))
        for (let i = 0; i < snap.docs.length; i += 500) {
          const batch = writeBatch(firestore)
          const chunk = snap.docs.slice(i, i + 500)
          for (const d of chunk) {
            batch.delete(d.ref)
          }
          await batch.commit()
        }
      }
    } finally {
      setClearing(false)
      setShowConfirm(false)
    }
  }, [user])

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {/* Account */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h3 className="font-medium mb-4">Account</h3>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
            )}
            <div>
              <p className="font-medium">{user?.displayName}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>

      {/* Data Summary */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> Data Summary
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Workouts</p>
            <p className="text-lg font-semibold">{workouts?.length ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Daily Metrics</p>
            <p className="text-lg font-semibold">{metrics?.length ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Activity Summaries</p>
            <p className="text-lg font-semibold">{summaries?.length ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Journal Entries</p>
            <p className="text-lg font-semibold">{journals?.length ?? 0}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Imports</p>
            <p className="text-lg font-semibold">{imports?.length ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Export / Import Backup */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <h3 className="font-medium mb-4">Backup & Restore</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="w-4 h-4" /> Export Backup
          </button>

          <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors cursor-pointer">
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
