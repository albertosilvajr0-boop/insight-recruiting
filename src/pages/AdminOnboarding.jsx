import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, onSnapshot, orderBy, query, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { adminAuditFields } from '../security/auditFields'
import {
  ONBOARDING_TASKS,
  PERFORMANCE_CHECKPOINTS,
  checkpointProgress,
  dueDateForRule,
  dueStatus,
  overdueItemCount,
  taskProgress,
} from '../onboarding/plan'

const STATUS_LABELS = {
  active: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
}

const STATUS_STYLES = {
  active: 'bg-blue-100 text-blue-700',
  blocked: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
}

export default function AdminOnboarding() {
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('active')
  const [savingKey, setSavingKey] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const q = query(collection(db, 'onboardings'), orderBy('createdAt', 'desc'))
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
  }, [])

  useEffect(() => {
    if (selectedId && records.some((record) => record.id === selectedId)) return
    if (records.length > 0) setSelectedId(records[0].id)
  }, [records, selectedId])

  const filteredRecords = useMemo(() => {
    if (filter === 'all') return records
    if (filter === 'overdue') return records.filter((record) => overdueItemCount(record) > 0)
    return records.filter((record) => (record.status || 'active') === filter)
  }, [records, filter])

  const selected = records.find((record) => record.id === selectedId) || filteredRecords[0] || records[0] || null
  const startsThisWeek = records.filter((record) => {
    if (!record.startDate) return false
    const days = daysUntil(record.startDate)
    return days >= 0 && days <= 7
  }).length
  const overdueCount = records.reduce((sum, record) => sum + overdueItemCount(record), 0)
  const avgProgress = records.length
    ? Math.round(records.reduce((sum, record) => sum + taskProgress(record.tasks).pct, 0) / records.length)
    : 0

  const updateRecord = async (record, patch, key = 'record') => {
    setSavingKey(key)
    try {
      await updateDoc(doc(db, 'onboardings', record.id), {
        ...patch,
        ...adminAuditFields(),
      })
    } catch (err) {
      alert(`Save failed: ${err.message}`)
    } finally {
      setSavingKey('')
    }
  }

  const toggleTask = async (record, task) => {
    const current = record.tasks?.[task.key] || {}
    const completed = current.completed !== true
    await updateRecord(record, {
      [`tasks.${task.key}`]: {
        ...current,
        completed,
        completedAt: completed ? serverTimestamp() : null,
        completedBy: completed ? auth.currentUser?.email || null : null,
      },
    }, task.key)
  }

  const updateCheckpoint = async (record, checkpoint, patch) => {
    const current = record.performanceCheckpoints?.[checkpoint.key] || {}
    const next = { ...current, ...patch }
    if (patch.completed === true) {
      next.completedAt = serverTimestamp()
      next.completedBy = auth.currentUser?.email || null
    }
    if (patch.completed === false) {
      next.completedAt = null
      next.completedBy = null
    }
    await updateRecord(record, {
      [`performanceCheckpoints.${checkpoint.key}`]: next,
    }, checkpoint.key)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">&larr; Back</button>
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-gray-900 text-sm">Onboarding</span>
          </div>
          <button onClick={() => navigate('/admin/analytics')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
            Analytics
          </button>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Active onboardings" value={records.filter((record) => (record.status || 'active') === 'active').length} />
          <Kpi label="Starting in 7 days" value={startsThisWeek} color="blue" />
          <Kpi label="Overdue items" value={overdueCount} color={overdueCount ? 'red' : 'green'} />
          <Kpi label="Avg checklist progress" value={`${avgProgress}%`} color="green" />
        </div>

        <div className="flex items-center gap-2">
          {['active', 'blocked', 'completed', 'overdue', 'all'].map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                filter === item ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {item === 'all' ? 'All' : item === 'overdue' ? 'Overdue' : STATUS_LABELS[item]}
            </button>
          ))}
        </div>

        {records.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-sm font-medium text-gray-700">No onboarding records yet</p>
            <p className="text-xs text-gray-500 mt-1">Open a hired candidate and start onboarding from their profile.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase">New hires</p>
              </div>
              <div className="divide-y divide-gray-100 max-h-[calc(100vh-260px)] overflow-y-auto">
                {filteredRecords.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => setSelectedId(record.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected?.id === record.id ? 'bg-blue-50' : 'bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{record.candidateName || 'Unnamed candidate'}</p>
                        <p className="text-xs text-gray-500 truncate">{record.jobTitle || 'Role not set'}</p>
                      </div>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[record.status || 'active'] || STATUS_STYLES.active}`}>
                        {STATUS_LABELS[record.status || 'active'] || 'Active'}
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${taskProgress(record.tasks).pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-gray-400">
                        <span>{taskProgress(record.tasks).completed}/{taskProgress(record.tasks).total} tasks</span>
                        <span>{record.startDate ? formatDate(record.startDate) : 'No start date'}</span>
                      </div>
                    </div>
                  </button>
                ))}
                {filteredRecords.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-8">No records match this filter</p>
                )}
              </div>
            </div>

            {selected && (
              <OnboardingDetail
                record={selected}
                savingKey={savingKey}
                onUpdate={updateRecord}
                onToggleTask={toggleTask}
                onUpdateCheckpoint={updateCheckpoint}
                onOpenCandidate={() => navigate(`/admin/candidates/${selected.candidateDocId || selected.candidateId || selected.id}`)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function OnboardingDetail({ record, savingKey, onUpdate, onToggleTask, onUpdateCheckpoint, onOpenCandidate }) {
  const tasksByCategory = ONBOARDING_TASKS.reduce((acc, task) => {
    if (!acc[task.category]) acc[task.category] = []
    acc[task.category].push(task)
    return acc
  }, {})
  const progress = taskProgress(record.tasks)
  const checkpointStats = checkpointProgress(record.performanceCheckpoints)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">{record.candidateName || 'Unnamed candidate'}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[record.status || 'active'] || STATUS_STYLES.active}`}>
                {STATUS_LABELS[record.status || 'active'] || 'Active'}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{record.jobTitle || 'Role not set'} {record.email ? `- ${record.email}` : ''}</p>
          </div>
          <button onClick={onOpenCandidate} className="text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
            Open candidate
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1">Start date</span>
            <input
              type="date"
              value={record.startDate || ''}
              onChange={(e) => onUpdate(record, { startDate: e.target.value }, 'startDate')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-500 mb-1">Status</span>
            <select
              value={record.status || 'active'}
              onChange={(e) => onUpdate(record, { status: e.target.value }, 'status')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <div className="border border-gray-200 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-gray-500">Checklist</p>
            <p className="text-sm font-semibold text-gray-900">{progress.completed}/{progress.total} complete - {progress.pct}%</p>
          </div>
        </div>

        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950">
          <p className="font-semibold">Compliance watchpoints</p>
          <p className="text-xs text-amber-800 mt-1">
            Form I-9 Section 2 is tracked against the 3-business-day window from the first day of work. W-4 is tracked for payroll withholding setup.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Onboarding checklist</h2>
          {savingKey && <span className="text-[11px] text-gray-400">Saving...</span>}
        </div>
        <div className="space-y-5">
          {Object.entries(tasksByCategory).map(([category, tasks]) => (
            <div key={category}>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{category}</p>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskRow
                    key={task.key}
                    task={task}
                    state={record.tasks?.[task.key]}
                    startDate={record.startDate}
                    disabled={savingKey === task.key}
                    onToggle={() => onToggleTask(record, task)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Performance checkpoints</h2>
            <p className="text-xs text-gray-500 mt-0.5">These ratings become the bridge back to selection-score correlation.</p>
          </div>
          <span className="text-xs text-gray-500">{checkpointStats.completed}/{checkpointStats.total}</span>
        </div>
        <div className="space-y-3">
          {PERFORMANCE_CHECKPOINTS.map((checkpoint) => (
            <CheckpointRow
              key={checkpoint.key}
              checkpoint={checkpoint}
              state={record.performanceCheckpoints?.[checkpoint.key]}
              startDate={record.startDate}
              disabled={savingKey === checkpoint.key}
              onChange={(patch) => onUpdateCheckpoint(record, checkpoint, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskRow({ task, state = {}, startDate, disabled, onToggle }) {
  const status = dueStatus(state, startDate, task.dueRule)
  const dueDate = dueDateForRule(startDate, task.dueRule)
  return (
    <label className={`flex items-start gap-3 border rounded-xl p-3 cursor-pointer transition-colors ${statusClass(status)}`}>
      <input
        type="checkbox"
        checked={state.completed === true}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-gray-900">{task.label}</span>
        <span className="block text-xs text-gray-500 mt-0.5">{dueDate ? `Due ${formatDateObject(dueDate)}` : 'Add a start date to calculate due date'}</span>
      </span>
      <StatusPill status={status} />
    </label>
  )
}

function CheckpointRow({ checkpoint, state = {}, startDate, disabled, onChange }) {
  const status = dueStatus(state, startDate, checkpoint.dueRule)
  const dueDate = dueDateForRule(startDate, checkpoint.dueRule)
  return (
    <div className={`border rounded-xl p-3 ${statusClass(status)}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={state.completed === true}
          onChange={(e) => onChange({ completed: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{checkpoint.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{dueDate ? `Due ${formatDateObject(dueDate)}` : 'Add a start date to calculate due date'}</p>
            </div>
            <StatusPill status={status} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)] gap-2 mt-3">
            <select
              value={state.rating || ''}
              onChange={(e) => onChange({ rating: e.target.value ? Number(e.target.value) : null })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">No rating</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}
            </select>
            <input
              type="text"
              defaultValue={state.notes || ''}
              onBlur={(e) => onChange({ notes: e.target.value })}
              placeholder="Checkpoint notes"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  const labels = {
    complete: 'Done',
    overdue: 'Overdue',
    due_soon: 'Due soon',
    upcoming: 'Upcoming',
    unscheduled: 'Unscheduled',
  }
  const styles = {
    complete: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700',
    due_soon: 'bg-amber-100 text-amber-700',
    upcoming: 'bg-gray-100 text-gray-600',
    unscheduled: 'bg-gray-100 text-gray-500',
  }
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${styles[status]}`}>{labels[status]}</span>
}

function Kpi({ label, value, color }) {
  const colors = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${colors[color] || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function statusClass(status) {
  if (status === 'complete') return 'border-green-200 bg-green-50'
  if (status === 'overdue') return 'border-red-200 bg-red-50'
  if (status === 'due_soon') return 'border-amber-200 bg-amber-50'
  return 'border-gray-200 bg-white'
}

function daysUntil(dateString) {
  const date = new Date(`${dateString}T00:00:00`)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((date - todayStart) / (24 * 60 * 60 * 1000))
}

function formatDate(dateString) {
  return formatDateObject(new Date(`${dateString}T00:00:00`))
}

function formatDateObject(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
