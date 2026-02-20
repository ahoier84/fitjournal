import { useState, useCallback, useRef, useEffect } from 'react'
import { Pencil, Check, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EditableStatCardProps {
  icon: LucideIcon
  label: string
  value: number
  displayValue: string
  unit: string
  color: string
  onSave: (value: number) => Promise<void>
}

export function EditableStatCard({ icon: Icon, label, value, displayValue, unit, color, onSave }: EditableStatCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleEdit = useCallback(() => {
    setInputValue(value > 0 ? String(value) : '')
    setIsEditing(true)
  }, [value])

  const handleCancel = useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleSave = useCallback(async () => {
    const parsed = parseFloat(inputValue)
    if (isNaN(parsed) || parsed < 0) return

    setSaving(true)
    try {
      await onSave(parsed)
    } finally {
      setSaving(false)
      setIsEditing(false)
    }
  }, [inputValue, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleSave, handleCancel])

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center')} style={{ backgroundColor: color + '15', color }}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>

      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="number"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            min="0"
            className="w-28 px-2 py-1 rounded-lg border border-primary bg-background text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <span className="text-sm text-muted-foreground">{unit}</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1 rounded hover:bg-accent/10 text-accent transition-colors disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-2xl font-bold">
            {displayValue} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
          </p>
          <button
            onClick={handleEdit}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title={`Edit ${label.toLowerCase()}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
