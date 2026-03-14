import { useState } from 'react'
import { extractLines } from '../lib/pgn'
import { loadScores, type ScoreRecord } from '../lib/scores'
import { chapterId, type StoredStudy } from '../lib/storage'

interface RepertoirePanelProps {
  studies: StoredStudy[]
  onTrainChapter: (study: StoredStudy, chapterIndex: number) => void
  onDeleteStudy: (id: string) => void
  onDeleteChapter: (studyId: string, chapterIndex: number) => void
  selectionMode: boolean
  selectedChapterIds: Set<string>
  onToggleChapter: (cid: string) => void
  onToggleStudy: (study: StoredStudy) => void
}

export default function RepertoirePanel({
  studies,
  onTrainChapter,
  onDeleteStudy,
  onDeleteChapter,
  selectionMode,
  selectedChapterIds,
  onToggleChapter,
  onToggleStudy,
}: RepertoirePanelProps) {
  const [expandedStudies, setExpandedStudies] = useState<Set<string>>(new Set())
  const scores = loadScores()
  const now = Date.now()

  const scoresByChapter = new Map<string, ScoreRecord[]>()
  scores.forEach(record => {
    const list = scoresByChapter.get(record.chapterId) ?? []
    list.push(record)
    scoresByChapter.set(record.chapterId, list)
  })

  function toggleExpandedStudy(id: string) {
    setExpandedStudies(previous => {
      const next = new Set(previous)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '6px', boxSizing: 'border-box' }}>
      {studies.map(study => {
        const expanded = expandedStudies.has(study.id)
        let totalLines = 0
        let startedLines = 0
        let dueLines = 0

        study.chapters.forEach((chapter, chapterIndex) => {
          const cid = chapterId(study.id, chapterIndex)
          const chapterLines = extractLines(chapter)
          const chapterScores = scoresByChapter.get(cid) ?? []

          totalLines += chapterLines.length
          startedLines += chapterLines.filter(line => chapterScores.some(score => score.lineId === line.lineId && score.interval > 0)).length
          dueLines += chapterScores.filter(score => new Date(score.dueDate).getTime() <= now).length
        })

        const progressPercent = totalLines > 0 ? Math.round((startedLines / totalLines) * 100) : 0
        const allChapterIds = study.chapters.map((_, chapterIndex) => chapterId(study.id, chapterIndex))
        const selectedCount = allChapterIds.filter(id => selectedChapterIds.has(id)).length
        const studyAllSelected = selectedCount === allChapterIds.length
        const studySomeSelected = selectedCount > 0 && selectedCount < allChapterIds.length

        return (
          <div key={study.id}>
            <div
              onClick={() => toggleExpandedStudy(study.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 12px',
                borderRadius: expanded ? '6px 6px 0 0' : '6px',
                background: '#2a2a3a',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {selectionMode && (
                <input
                  type="checkbox"
                  ref={node => { if (node) node.indeterminate = studySomeSelected }}
                  checked={studyAllSelected}
                  onChange={() => onToggleStudy(study)}
                  onClick={event => event.stopPropagation()}
                  style={{ width: '15px', height: '15px', flexShrink: 0, cursor: 'pointer', accentColor: '#5a9a5a' }}
                />
              )}
              <span style={{ color: '#aaa', fontSize: '0.75rem', width: '10px' }}>{expanded ? '▼' : '▶'}</span>
              <span style={{ flex: 1, fontWeight: 'bold', color: '#e8e8e8', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{study.name}</span>
              {dueLines > 0 && (
                <span style={{ background: '#7a3030', color: '#ffaaaa', fontSize: '0.68rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 'bold', flexShrink: 0 }}>
                  {dueLines} due
                </span>
              )}
              <span style={{ color: '#888', fontSize: '0.78rem', flexShrink: 0 }}>{progressPercent}%</span>
              {!selectionMode && (
                <button
                  onClick={event => { event.stopPropagation(); onDeleteStudy(study.id) }}
                  title="Delete study"
                  style={{ marginLeft: '4px', border: 'none', background: 'none', cursor: 'pointer', color: '#888', lineHeight: 1, flexShrink: 0, padding: '0 2px', display: 'flex', alignItems: 'center' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              )}
            </div>
            <div style={{ height: '4px', background: '#1e1e1e', borderRadius: expanded ? '0' : '0 0 4px 4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPercent}%`, background: '#3a6a3a' }} />
            </div>
            {expanded && (
              <div style={{ background: '#1e1e2e', borderRadius: '0 0 6px 6px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {study.chapters.map((chapter, chapterIndex) => {
                  const cid = chapterId(study.id, chapterIndex)
                  const chapterLines = extractLines(chapter)
                  const chapterScores = scoresByChapter.get(cid) ?? []
                  const chapterTotal = chapterLines.length
                  const chapterStarted = chapterLines.filter(line => chapterScores.some(score => score.lineId === line.lineId && score.interval > 0)).length
                  const chapterDue = chapterScores.filter(score => new Date(score.dueDate).getTime() <= now).length
                  const chapterPercent = chapterTotal > 0 ? Math.round((chapterStarted / chapterTotal) * 100) : 0
                  const chapterSelected = selectedChapterIds.has(cid)

                  return (
                    <div key={chapterIndex}>
                      <div
                        onClick={() => selectionMode ? onToggleChapter(cid) : onTrainChapter(study, chapterIndex)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 10px',
                          borderRadius: '4px 4px 0 0',
                          background: selectionMode && chapterSelected ? '#1e2e1e' : '#252535',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={event => (event.currentTarget.style.background = selectionMode && chapterSelected ? '#253525' : '#2e2e48')}
                        onMouseLeave={event => (event.currentTarget.style.background = selectionMode && chapterSelected ? '#1e2e1e' : '#252535')}
                      >
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={chapterSelected}
                            onChange={() => onToggleChapter(cid)}
                            onClick={event => event.stopPropagation()}
                            style={{ width: '13px', height: '13px', flexShrink: 0, cursor: 'pointer', accentColor: '#5a9a5a' }}
                          />
                        )}
                        <span style={{ flex: 1, color: '#ccc', fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chapter.title}</span>
                        {chapterDue > 0 && (
                          <span style={{ background: '#7a3030', color: '#ffaaaa', fontSize: '0.65rem', padding: '1px 5px', borderRadius: '10px', flexShrink: 0 }}>
                            {chapterDue} due
                          </span>
                        )}
                        <span style={{ color: '#888', fontSize: '0.72rem', flexShrink: 0 }}>{chapterPercent}%</span>
                        <button
                          onClick={event => { event.stopPropagation(); onDeleteChapter(study.id, chapterIndex) }}
                          title="Delete chapter"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#888', lineHeight: 1, flexShrink: 0, padding: '0 2px', display: 'flex', alignItems: 'center' }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </div>
                      <div style={{ height: '3px', background: '#1a1a2a', borderRadius: '0 0 3px 3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${chapterPercent}%`, background: chapterDue > 0 ? '#6a4a20' : '#2a5a2a' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
