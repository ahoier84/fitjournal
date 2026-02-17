import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router'
import { ArrowLeft, Clock, Flame, MapPin, Smartphone, Camera, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkout } from '@/hooks/useWorkouts'
import { useJournalEntry, saveJournalEntry } from '@/hooks/useJournalEntry'
import { formatDateTime } from '@/lib/date-utils'
import { formatDuration, formatCalories, formatDistance, getWorkoutIcon, getWorkoutColor } from '@/lib/workout-utils'
import { cn } from '@/lib/utils'

const MOOD_LABELS = ['', 'Terrible', 'Poor', 'Okay', 'Good', 'Amazing']
const MOOD_EMOJIS = ['', '\u{1F629}', '\u{1F614}', '\u{1F610}', '\u{1F60A}', '\u{1F929}']
const ENERGY_LABELS = ['', 'Exhausted', 'Low', 'Moderate', 'High', 'Energized']
const ENERGY_EMOJIS = ['', '\u{1FAB8}', '\u{1F50B}', '\u{26A1}', '\u{1F525}', '\u{2B50}']

function RatingSelector({ label, value, onChange, emojis, labels }: {
  label: string
  value: number
  onChange: (v: number) => void
  emojis: string[]
  labels: string[]
}) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              'flex flex-col items-center gap-1 p-2 rounded-lg border transition-all min-w-14',
              value === n
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:border-primary/30'
            )}
          >
            <span className="text-lg">{emojis[n]}</span>
            <span className="text-[10px] text-muted-foreground">{labels[n]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function WorkoutDetailPage() {
  const { user } = useAuth()
  const { id } = useParams()
  const workout = useWorkout(id)
  const existingEntry = useJournalEntry(id)

  const [notes, setNotes] = useState('')
  const [moodBefore, setMoodBefore] = useState(0)
  const [energyBefore, setEnergyBefore] = useState(0)
  const [moodAfter, setMoodAfter] = useState(0)
  const [energyAfter, setEnergyAfter] = useState(0)
  const [photos, setPhotos] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Initialize form from existing journal entry
  if (existingEntry && !initialized) {
    setNotes(existingEntry.notes)
    setMoodBefore(existingEntry.moodBefore)
    setEnergyBefore(existingEntry.energyBefore)
    setMoodAfter(existingEntry.moodAfter)
    setEnergyAfter(existingEntry.energyAfter)
    setPhotos(existingEntry.photos)
    setInitialized(true)
  } else if (existingEntry === undefined && id && !initialized) {
    setInitialized(true)
  }

  const handleSave = useCallback(async () => {
    if (!id || !user) return
    setSaving(true)
    try {
      await saveJournalEntry(user.uid, {
        id: existingEntry?.id,
        workoutId: id,
        notes,
        moodBefore,
        energyBefore,
        moodAfter,
        energyAfter,
        photos,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [user, id, existingEntry?.id, notes, moodBefore, energyBefore, moodAfter, energyAfter, photos])

  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        // Resize image using canvas
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const maxSize = 1200
          let { width, height } = img
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize
              width = maxSize
            } else {
              width = (width / height) * maxSize
              height = maxSize
            }
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, width, height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
          setPhotos(prev => [...prev, dataUrl])
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }, [])

  if (!workout) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Workout not found.</p>
        <Link to="/workouts" className="text-primary hover:underline text-sm">Back to workouts</Link>
      </div>
    )
  }

  const Icon = getWorkoutIcon(workout.activityName)
  const color = getWorkoutColor(workout.activityName)

  return (
    <div className="max-w-3xl">
      <Link to="/workouts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to workouts
      </Link>

      {/* Workout Stats */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + '15', color }}>
            <Icon className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{workout.activityName}</h2>
            <p className="text-muted-foreground">{formatDateTime(workout.startDate)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-medium">{formatDuration(workout.duration)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Energy</p>
              <p className="font-medium">{formatCalories(workout.totalEnergyBurned)}</p>
            </div>
          </div>
          {workout.totalDistance > 0 && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Distance</p>
                <p className="font-medium">{formatDistance(workout.totalDistance)}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">Source</p>
              <p className="font-medium truncate">{workout.sourceName}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Journal Entry */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-lg font-semibold mb-4">Journal Entry</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">Before Workout</h4>
            <RatingSelector label="Mood" value={moodBefore} onChange={setMoodBefore} emojis={MOOD_EMOJIS} labels={MOOD_LABELS} />
            <RatingSelector label="Energy" value={energyBefore} onChange={setEnergyBefore} emojis={ENERGY_EMOJIS} labels={ENERGY_LABELS} />
          </div>
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">After Workout</h4>
            <RatingSelector label="Mood" value={moodAfter} onChange={setMoodAfter} emojis={MOOD_EMOJIS} labels={MOOD_LABELS} />
            <RatingSelector label="Energy" value={energyAfter} onChange={setEnergyAfter} emojis={ENERGY_EMOJIS} labels={ENERGY_LABELS} />
          </div>
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="How did this workout feel? What did you focus on? Any achievements or observations..."
            rows={5}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
          />
        </div>

        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">Photos</label>
          <div className="flex flex-wrap gap-3">
            {photos.map((photo, i) => (
              <div key={i} className="relative w-24 h-24 rounded-lg overflow-hidden border border-border">
                <img src={photo} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center text-white hover:bg-black/70"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <label className="w-24 h-24 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
              <Camera className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground mt-1">Add Photo</span>
              <input type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
            </label>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'px-6 py-2.5 rounded-lg font-medium text-sm transition-colors',
            saved
              ? 'bg-accent text-accent-foreground'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
            saving && 'opacity-50 cursor-not-allowed'
          )}
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : existingEntry ? 'Update Entry' : 'Save Entry'}
        </button>
      </div>
    </div>
  )
}
