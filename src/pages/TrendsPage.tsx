import { useState } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useActivityTrends, useWorkoutFrequency, type MetricType } from '@/hooks/useActivityTrends'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

const TIME_RANGES = [
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
  { label: '1 Year', value: 365 },
]

function MetricChart({ metricType, days, title, color, unit, chartType = 'bar' }: {
  metricType: MetricType
  days: number
  title: string
  color: string
  unit: string
  chartType?: 'bar' | 'line'
}) {
  const data = useActivityTrends(metricType, days)

  if (!data) return null

  const formattedData = data.map(d => ({
    ...d,
    label: format(new Date(d.date), days <= 30 ? 'MMM d' : 'MMM d'),
  }))

  const avg = data.length > 0
    ? Math.round(data.reduce((sum, d) => sum + d.value, 0) / data.filter(d => d.value > 0).length || 0)
    : 0

  const max = Math.max(...data.map(d => d.value), 0)

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">{title}</h3>
        <div className="flex gap-4 text-sm">
          <span className="text-muted-foreground">Avg: <span className="font-medium text-foreground">{avg.toLocaleString()} {unit}</span></span>
          <span className="text-muted-foreground">Max: <span className="font-medium text-foreground">{max.toLocaleString()} {unit}</span></span>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={formattedData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                interval={days <= 30 ? 4 : days <= 90 ? 13 : 30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                formatter={(value: number | undefined) => [((value ?? 0)).toLocaleString() + ' ' + unit, title]}
              />
              <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={formattedData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                interval={days <= 30 ? 4 : days <= 90 ? 13 : 30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                formatter={(value: number | undefined) => [((value ?? 0)).toLocaleString() + ' ' + unit, title]}
              />
              <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function WorkoutFrequencyChart({ days }: { days: number }) {
  const data = useWorkoutFrequency(days)

  if (!data || data.length === 0) return null

  const formattedData = data.map(d => ({
    ...d,
    label: format(new Date(d.week), 'MMM d'),
  }))

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="font-medium mb-4">Workout Frequency (per week)</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={formattedData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}
              formatter={(value: number | undefined) => [(value ?? 0) + ' workouts', 'Frequency']}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function TrendsPage() {
  const [days, setDays] = useState(30)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Trends</h2>
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {TIME_RANGES.map(range => (
            <button
              key={range.value}
              onClick={() => setDays(range.value)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                days === range.value
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <MetricChart metricType="steps" days={days} title="Daily Steps" color="#3b82f6" unit="steps" />
        <MetricChart metricType="activeEnergy" days={days} title="Active Energy" color="#ef4444" unit="cal" chartType="line" />
        <MetricChart metricType="distanceWalkingRunning" days={days} title="Walking + Running Distance" color="#10b981" unit="km" chartType="line" />
        <WorkoutFrequencyChart days={days} />
      </div>
    </div>
  )
}
