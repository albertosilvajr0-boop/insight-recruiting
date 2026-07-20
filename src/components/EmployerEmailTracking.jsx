import { Fragment, useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { format } from 'date-fns'
import { functions } from '../firebase'

const EMAIL_TRACKING_INITIAL_ROWS = 12
const EMAIL_TRACKING_LOAD_MORE_ROWS = 20

function toDate(ts) {
  return ts?.toDate ? ts.toDate() : null
}

function recipientCount(share) {
  return Array.isArray(share.recipients) ? share.recipients.length : 0
}

function candidateShareCount(share) {
  if (Array.isArray(share.candidateIds)) return share.candidateIds.length
  return share.candidateId ? 1 : 0
}

function isTrackingPixelEvent(event) {
  return event.target === 'open'
}

function isVideoEvent(event) {
  const target = String(event.target || '').toLowerCase()
  const label = String(event.label || '').toLowerCase()
  return target.startsWith('v') || /^c\d+v/.test(target) || label.includes(' q')
}

function uniqueRecipientCount(events) {
  return new Set(events.map(event => event.recipient || 'unknown')).size
}

function buildVideoClickRecipients(events) {
  const byRecipient = new Map()
  events.filter(isVideoEvent).forEach((event) => {
    const recipient = String(event.recipient || '').trim()
    if (!recipient) return
    const existing = byRecipient.get(recipient) || { recipient, clicks: 0, labels: new Map() }
    const label = String(event.label || event.target || 'Video response').trim()
    existing.clicks += 1
    existing.labels.set(label, (existing.labels.get(label) || 0) + 1)
    byRecipient.set(recipient, existing)
  })
  return Array.from(byRecipient.values())
    .map((entry) => ({
      ...entry,
      labels: Array.from(entry.labels.entries()).map(([label, count]) => ({ label, count })),
    }))
    .sort((a, b) => b.clicks - a.clicks || a.recipient.localeCompare(b.recipient))
}

function percent(part, total) {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function shareLabel(share) {
  const count = candidateShareCount(share)
  if (count > 1) return `${count} candidate shortlist`
  return share.candidateName || 'Candidate share'
}

function shareVersionLabel(share) {
  if (share.emailVersion === 'v2') return 'Send Email V2'
  if (share.emailVersion === 'v1') return 'Send Email V1'
  return 'Candidate profile'
}

function emailTrackingOptionLabel(share) {
  const sentAt = toDate(share.createdAt)
  const date = sentAt ? format(sentAt, 'MMM d, h:mm a') : 'Pending send'
  const recipients = Array.isArray(share.recipients) ? share.recipients : []
  const firstRecipient = recipients[0] || 'No recipient'
  const extra = recipients.length > 1 ? ` +${recipients.length - 1}` : ''
  return `${date} - ${shareLabel(share)} - ${firstRecipient}${extra}`
}

function followUpCount(share) {
  const count = Number(share.followUpCount || 0)
  if (Number.isFinite(count) && count > 0) return count
  return Array.isArray(share.followUps) ? share.followUps.length : 0
}

function buildRows(shares, shareClicksByShareId) {
  return shares.map((share) => {
    const clicks = shareClicksByShareId[share.id] || []
    const linkEvents = clicks.filter(event => !isTrackingPixelEvent(event))
    const videoEvents = linkEvents.filter(isVideoEvent)
    const recipients = recipientCount(share)
    return {
      share,
      recipients,
      candidateCount: candidateShareCount(share),
      linkEvents: linkEvents.length,
      videoEvents: videoEvents.length,
      videoClickRecipients: buildVideoClickRecipients(videoEvents),
      uniqueClicks: uniqueRecipientCount(linkEvents),
      followUps: followUpCount(share),
    }
  })
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

export default function EmployerEmailTracking({ shares, shareClicksByShareId, dateRange }) {
  const [emailTrackingFilter, setEmailTrackingFilter] = useState('all')
  const [emailTrackingVisibleCount, setEmailTrackingVisibleCount] = useState(EMAIL_TRACKING_INITIAL_ROWS)
  const [expandedVideoClickRows, setExpandedVideoClickRows] = useState({})
  const [followUpConfirmTarget, setFollowUpConfirmTarget] = useState(null)
  const [followUpSendingId, setFollowUpSendingId] = useState(null)
  const [followUpPreviewEmail, setFollowUpPreviewEmail] = useState('')
  const [followUpPreviewSending, setFollowUpPreviewSending] = useState(false)
  const [followUpPreviewNotice, setFollowUpPreviewNotice] = useState(null)
  const [followUpNotice, setFollowUpNotice] = useState(null)

  useEffect(() => {
    setEmailTrackingVisibleCount(EMAIL_TRACKING_INITIAL_ROWS)
    setExpandedVideoClickRows({})
  }, [dateRange, emailTrackingFilter])

  const emailTrackingRows = buildRows(shares, shareClicksByShareId)
  const visibleEmailTrackingRows = emailTrackingFilter === 'all'
    ? emailTrackingRows
    : emailTrackingRows.filter(row => row.share.id === emailTrackingFilter)
  const displayedEmailTrackingRows = visibleEmailTrackingRows.slice(0, emailTrackingVisibleCount)
  const hiddenEmailTrackingRows = Math.max(0, visibleEmailTrackingRows.length - displayedEmailTrackingRows.length)
  const nextEmailTrackingRows = Math.min(EMAIL_TRACKING_LOAD_MORE_ROWS, hiddenEmailTrackingRows)
  const emailTrackingTotals = visibleEmailTrackingRows.reduce((acc, row) => {
    acc.shares += 1
    acc.recipients += row.recipients
    acc.clickedRecipients += row.uniqueClicks
    acc.linkEvents += row.linkEvents
    acc.videoEvents += row.videoEvents
    acc.followUps += row.followUps
    return acc
  }, { shares: 0, recipients: 0, clickedRecipients: 0, linkEvents: 0, videoEvents: 0, followUps: 0 })

  const followUpConfirmRecipients = Array.isArray(followUpConfirmTarget?.recipients)
    ? followUpConfirmTarget.recipients
    : []
  const followUpConfirmSending = Boolean(followUpConfirmTarget && followUpSendingId === followUpConfirmTarget.id)
  const previewEmailReady = isValidEmail(followUpPreviewEmail)

  const toggleVideoClickRow = (shareId) => {
    setExpandedVideoClickRows(prev => ({ ...prev, [shareId]: !prev[shareId] }))
  }

  const openFollowUpConfirm = (share) => {
    setFollowUpConfirmTarget(share)
    setFollowUpPreviewEmail('')
    setFollowUpPreviewNotice(null)
  }

  const closeFollowUpConfirm = () => {
    if (followUpSendingId || followUpPreviewSending) return
    setFollowUpConfirmTarget(null)
    setFollowUpPreviewEmail('')
    setFollowUpPreviewNotice(null)
  }

  const sendFollowUp = async (share) => {
    if (!share?.id || followUpSendingId) return
    setFollowUpSendingId(share.id)
    setFollowUpNotice(null)
    try {
      const followUpShare = httpsCallable(functions, 'followUpShare')
      const { data } = await followUpShare({ shareId: share.id })
      setFollowUpNotice({
        type: 'success',
        message: `Follow-up sent to ${(data.recipients || []).join(', ') || 'the original recipients'}.`,
      })
      setFollowUpConfirmTarget(null)
      setFollowUpPreviewEmail('')
      setFollowUpPreviewNotice(null)
    } catch (err) {
      setFollowUpNotice({
        type: 'error',
        message: err?.message || 'Follow-up email failed. Please try again.',
      })
    } finally {
      setFollowUpSendingId(null)
    }
  }

  const sendFollowUpPreview = async () => {
    if (!followUpConfirmTarget?.id || followUpPreviewSending || !isValidEmail(followUpPreviewEmail)) return
    setFollowUpPreviewSending(true)
    setFollowUpPreviewNotice(null)
    try {
      const followUpShare = httpsCallable(functions, 'followUpShare')
      const { data } = await followUpShare({
        shareId: followUpConfirmTarget.id,
        previewToEmail: followUpPreviewEmail.trim(),
      })
      setFollowUpPreviewNotice({
        type: 'success',
        message: `Preview sent to ${(data.recipients || []).join(', ') || followUpPreviewEmail.trim()}.`,
      })
    } catch (err) {
      setFollowUpPreviewNotice({
        type: 'error',
        message: err?.message || 'Preview email failed. Please try again.',
      })
    } finally {
      setFollowUpPreviewSending(false)
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Employer email tracking</h3>
            <p className="text-xs text-gray-500 mt-1">
              Tracks app-sent share emails, video clicks, other link clicks, and follow-ups. Campaign-level employer records now roll up under Employers.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <select
              value={emailTrackingFilter}
              onChange={(e) => setEmailTrackingFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-full"
            >
              <option value="all">All tracked emails</option>
              {emailTrackingRows.map((row) => (
                <option key={row.share.id} value={row.share.id}>{emailTrackingOptionLabel(row.share)}</option>
              ))}
            </select>
            <span className="text-[11px] text-gray-500 px-2 py-1 rounded-full bg-gray-100 h-fit w-fit">
              Last {dateRange} days
            </span>
          </div>
        </div>

        {emailTrackingRows.length === 0 ? (
          <p className="text-xs text-gray-400 py-8 text-center">No tracked employer share emails in this period.</p>
        ) : (
          <div className="space-y-5">
            {followUpNotice && (
              <div className={`text-xs rounded-lg px-3 py-2 border ${
                followUpNotice.type === 'success'
                  ? 'bg-green-50 border-green-100 text-green-700'
                  : 'bg-red-50 border-red-100 text-red-700'
              }`}>
                {followUpNotice.message}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Metric label="Share emails" value={emailTrackingTotals.shares} />
              <Metric label="Recipients" value={emailTrackingTotals.recipients} />
              <Metric label="Click rate" value={percent(emailTrackingTotals.clickedRecipients, emailTrackingTotals.recipients)} />
              <Metric label="Video clicks" value={emailTrackingTotals.videoEvents} />
              <Metric label="Follow-ups" value={emailTrackingTotals.followUps} />
            </div>

            <div className="border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Sent</th>
                    <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Packet</th>
                    <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Recipients</th>
                    <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Clicks</th>
                    <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Videos</th>
                    <th className="text-right text-[11px] font-semibold text-gray-500 px-4 py-2">Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedEmailTrackingRows.map((row) => {
                    const sentAt = toDate(row.share.createdAt)
                    const lastFollowUpAt = toDate(row.share.lastFollowUpAt)
                    const recipients = row.share.recipients || []
                    const extraRecipients = Math.max(0, recipients.length - 2)
                    const sending = followUpSendingId === row.share.id
                    const videoDetailsOpen = expandedVideoClickRows[row.share.id] === true
                    return (
                      <Fragment key={row.share.id}>
                        <tr className="border-b border-gray-100 last:border-0">
                          <td className="px-4 py-3 align-top">
                            {sentAt ? (
                              <>
                                <p className="text-xs font-medium text-gray-900">{format(sentAt, 'MMM d')}</p>
                                <p className="text-[11px] text-gray-400">{format(sentAt, 'h:mm a')}</p>
                              </>
                            ) : (
                              <span className="text-xs text-gray-400">Pending</span>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="text-xs font-medium text-gray-900">{shareLabel(row.share)}</p>
                            <p className="text-[11px] text-gray-400">
                              {shareVersionLabel(row.share)} - {row.candidateCount || 'No'} candidate{row.candidateCount === 1 ? '' : 's'} - {row.share.videoCount || 0} video link{row.share.videoCount === 1 ? '' : 's'}
                            </p>
                            {row.share.by && <p className="text-[11px] text-gray-400">Sent by {row.share.by}</p>}
                            {row.share.reviewUrl && <p className="text-[11px] text-blue-600 mt-0.5">Secure review page included</p>}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="text-xs text-gray-700">{recipients.slice(0, 2).join(', ') || 'No recipients'}</p>
                            {extraRecipients > 0 && <p className="text-[11px] text-gray-400">+{extraRecipients} more</p>}
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <p className="text-xs font-semibold text-green-700">{row.uniqueClicks}/{row.recipients}</p>
                            <p className="text-[11px] text-gray-400">{row.linkEvents} click{row.linkEvents === 1 ? '' : 's'}</p>
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <p className="text-xs font-semibold text-purple-700">{row.videoEvents}</p>
                            {row.videoClickRecipients.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleVideoClickRow(row.share.id)}
                                className="text-[11px] font-medium text-purple-700 hover:text-purple-900 mt-1"
                              >
                                {videoDetailsOpen ? 'Hide emails' : `View ${row.videoClickRecipients.length} email${row.videoClickRecipients.length === 1 ? '' : 's'}`}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            <button
                              type="button"
                              onClick={() => openFollowUpConfirm(row.share)}
                              disabled={sending || followUpSendingId !== null || row.recipients === 0}
                              className="whitespace-nowrap text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 disabled:cursor-wait px-3 py-1.5 rounded-lg"
                            >
                              {sending ? 'Sending...' : 'Send follow up'}
                            </button>
                            {lastFollowUpAt ? (
                              <p className="text-[11px] text-gray-400 mt-1">Last {format(lastFollowUpAt, 'MMM d, h:mm a')}</p>
                            ) : row.followUps > 0 ? (
                              <p className="text-[11px] text-gray-400 mt-1">{row.followUps} sent</p>
                            ) : null}
                          </td>
                        </tr>
                        {videoDetailsOpen && (
                          <tr className="border-b border-purple-100 bg-purple-50/40">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="rounded-xl border border-purple-100 bg-white overflow-hidden">
                                <div className="px-3 py-2 border-b border-purple-50 flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-gray-900">Video clicks by recipient</p>
                                  <span className="text-[11px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5">
                                    {row.videoClickRecipients.length} recipient{row.videoClickRecipients.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                <div className="divide-y divide-gray-100">
                                  {row.videoClickRecipients.map((recipient) => (
                                    <div key={recipient.recipient} className="px-3 py-2 flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                                      <div>
                                        <p className="text-xs font-medium text-gray-900">{recipient.recipient}</p>
                                        <p className="text-[11px] text-gray-400">{recipient.clicks} video click{recipient.clicks === 1 ? '' : 's'}</p>
                                      </div>
                                      <div className="md:text-right space-y-1">
                                        {recipient.labels.map((item) => (
                                          <p key={item.label} className="text-[11px] text-gray-600">
                                            {item.label}{item.count > 1 ? ` (${item.count})` : ''}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {hiddenEmailTrackingRows > 0 ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-xs text-gray-400">
                  Showing {displayedEmailTrackingRows.length} of {visibleEmailTrackingRows.length} tracked share{visibleEmailTrackingRows.length === 1 ? '' : 's'}.
                </p>
                <button
                  type="button"
                  onClick={() => setEmailTrackingVisibleCount(count => Math.min(count + EMAIL_TRACKING_LOAD_MORE_ROWS, visibleEmailTrackingRows.length))}
                  className="text-xs font-medium text-gray-700 border border-gray-200 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg w-fit"
                >
                  Load next {nextEmailTrackingRows}
                </button>
              </div>
            ) : (
              visibleEmailTrackingRows.length > EMAIL_TRACKING_INITIAL_ROWS && (
                <p className="text-xs text-gray-400 text-right">
                  Showing all {visibleEmailTrackingRows.length} tracked share{visibleEmailTrackingRows.length === 1 ? '' : 's'}.
                </p>
              )
            )}
          </div>
        )}
      </div>

      {followUpConfirmTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={closeFollowUpConfirm}>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Send follow-up?</h3>
              <p className="text-sm text-gray-500 mt-1">
                Are you sure? This will send a simple follow-up email to the original recipient{followUpConfirmRecipients.length === 1 ? '' : 's'} for {shareLabel(followUpConfirmTarget)}.
              </p>
            </div>

            <div className="border border-gray-100 bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-600 mb-1">Recipients</p>
              <p className="text-sm text-gray-800 break-words">{followUpConfirmRecipients.join(', ') || 'No recipients on this share'}</p>
            </div>

            <div className="border border-blue-100 bg-blue-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-blue-800 mb-1">Preview first</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={followUpPreviewEmail}
                  onChange={(e) => {
                    setFollowUpPreviewEmail(e.target.value)
                    setFollowUpPreviewNotice(null)
                  }}
                  placeholder="Preview email address"
                  className="flex-1 text-sm border border-blue-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <button
                  type="button"
                  onClick={sendFollowUpPreview}
                  disabled={!previewEmailReady || followUpPreviewSending || followUpConfirmSending}
                  className="text-sm font-medium text-blue-700 border border-blue-200 bg-white hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-2 rounded-lg"
                >
                  {followUpPreviewSending ? 'Sending preview...' : 'Send preview'}
                </button>
              </div>
              {followUpPreviewNotice && (
                <p className={`text-xs mt-2 ${followUpPreviewNotice.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                  {followUpPreviewNotice.message}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={closeFollowUpConfirm}
                disabled={followUpConfirmSending || followUpPreviewSending}
                className="text-sm font-medium text-gray-700 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 px-4 py-2 rounded-lg"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => sendFollowUp(followUpConfirmTarget)}
                disabled={followUpConfirmSending || followUpPreviewSending || followUpConfirmRecipients.length === 0}
                className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 rounded-lg"
              >
                {followUpConfirmSending ? 'Sending...' : 'Yes, send follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
