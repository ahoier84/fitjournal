import { useState, useCallback, useRef, useMemo } from 'react'
import { Upload, FileUp, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { query, orderBy } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection } from '@/db/database'
import { useFirestoreQuery } from '@/hooks/useFirestoreQuery'
import { parseHealthExport, type ImportProgress, type ImportResult } from '@/import/health-xml-parser'
import type { ImportRecord } from '@/db/models'
import { formatDate } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export function ImportPage() {
  const { user } = useAuth()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const importQuery = useMemo(() => {
    if (!user) return null
    return query(userCollection(user.uid, 'importRecords'), orderBy('importedAt', 'desc'))
  }, [user])

  const importRecords = useFirestoreQuery<ImportRecord>(importQuery, [user?.uid])

  const handleFile = useCallback(async (file: File) => {
    if (!user) return
    if (!file.name.endsWith('.xml') && !file.name.endsWith('.zip')) {
      setError('Please select an Apple Health export file (.xml or .zip)')
      return
    }

    setImporting(true)
    setProgress(null)
    setResult(null)
    setError(null)

    try {
      const importResult = await parseHealthExport(user.uid, file, (p) => {
        setProgress({ ...p })
      })
      setResult(importResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [user])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const progressPercent = progress
    ? Math.round((progress.bytesRead / Math.max(progress.totalBytes, 1)) * 100)
    : 0

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-2">Import Health Data</h2>
      <p className="text-muted-foreground mb-6">
        Export your health data from your iPhone (Settings &gt; Health &gt; Export All Health Data) and drop the file here.
      </p>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !importing && fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-6 sm:p-12 text-center cursor-pointer transition-all mb-6',
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
          importing && 'pointer-events-none opacity-60'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,.zip"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
            e.target.value = ''
          }}
          className="hidden"
        />

        {importing ? (
          <div>
            <FileUp className="w-10 h-10 mx-auto mb-4 text-primary animate-pulse" />
            <p className="font-medium mb-1">
              {progress?.phase === 'reading' && 'Reading file...'}
              {progress?.phase === 'parsing' && 'Parsing health data...'}
              {progress?.phase === 'saving' && 'Saving to database...'}
              {progress?.phase === 'complete' && 'Complete!'}
            </p>

            <div className="w-full max-w-xs mx-auto bg-secondary rounded-full h-2 mb-3">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>{progress?.workoutsFound ?? 0} workouts found</p>
              <p>{(progress?.recordsProcessed ?? 0).toLocaleString()} records processed</p>
            </div>
          </div>
        ) : (
          <div>
            <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
            <p className="font-medium mb-1">Drop your Apple Health export here</p>
            <p className="text-sm text-muted-foreground">Supports export.xml or export.zip</p>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-6 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-accent">Import Complete</p>
            <p className="text-sm text-muted-foreground mt-1">
              {result.workoutsImported} workouts, {result.recordsImported.toLocaleString()} daily metrics,
              and {result.activitySummariesImported} activity summaries imported
              in {(result.durationMs / 1000).toFixed(1)}s.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-destructive">Import Failed</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Import History */}
      {importRecords && importRecords.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Import History</h3>
          <div className="space-y-3">
            {importRecords.map(record => (
              <div key={record.id} className="flex items-center gap-3 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{record.filename}</p>
                  <p className="text-muted-foreground">
                    {record.workoutsImported} workouts, {record.recordsImported.toLocaleString()} metrics
                  </p>
                </div>
                <p className="text-muted-foreground">{formatDate(record.importedAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
