// Picks the file to treat as "the" recording inside a question's folder.
//
// Storage rules forbid overwriting files (update: false), so a re-record can
// never replace recording.webm in place — instead every take uploads as
// take_{timestamp}.{ext} and the NEWEST take wins here. Legacy names
// (full_recording.webm from chunk stitching, recording.webm/mp4 from the
// original single-file flow) still resolve for candidates recorded before
// takes existed.
export function pickRecordingFile(items) {
  const takes = items
    .filter(f => /^take_\d+\.(webm|mp4)$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
  if (takes.length) return takes[0]
  return items.find(f => f.name === 'full_recording.webm')
    || items.find(f => /^recording\.(webm|mp4)$/.test(f.name))
    || items.find(f => /\.(webm|mp4)$/.test(f.name))
    || null
}
