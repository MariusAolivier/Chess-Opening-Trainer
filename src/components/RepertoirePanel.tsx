import { useState } from 'react'
import { extractTrainableLines } from '../lib/pgn'
import type { ScoreRecord } from '../lib/scores'
import { chapterId, type StoredStudy } from '../lib/storage'
import { collectChapterVariationDetails } from '../lib/appHelpers'
import { useCurrentTime, useScoresSnapshot } from '../hooks/useReviewData'
import './RepertoirePanel.css'

function formatDueIn(scores: ScoreRecord[], now: number): string {
  const reviewedScores = scores.filter(score => {
    if (score.interval > 0) return true
    if (typeof score.lastReviewedAt === 'string' && !Number.isNaN(Date.parse(score.lastReviewedAt))) return true
    return false
  })

  if (reviewedScores.length === 0) return 'not reviewed yet'

  const nextDue = reviewedScores.reduce<number | null>((min, score) => {
    const due = Date.parse(score.dueDate)
    if (Number.isNaN(due)) return min
    if (min === null || due < min) return due
    return min
  }, null)

  if (nextDue === null) return 'not reviewed yet'

  const days = Math.max(0, Math.ceil((nextDue - now) / 86_400_000))
  if (days === 0) return 'due now'
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

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

function scoreForLine(chapterScores: ScoreRecord[], lineId: string): ScoreRecord | undefined {
  const exact = chapterScores.find(score => score.lineId === lineId)
  if (exact) return exact

  if (lineId.startsWith('main::')) {
    const legacy = lineId.slice('main::'.length)
    return chapterScores.find(score => score.lineId === legacy)
  }

  if (lineId.startsWith('var::')) {
    const lastSep = lineId.lastIndexOf('::')
    const legacy = lastSep > 0 ? lineId.slice(lastSep + 2) : lineId
    return chapterScores.find(score => score.lineId === legacy)
  }

  return undefined
}

function formatVariationDue(score: ScoreRecord | undefined, now: number): string {
  if (!score || !score.lastReviewedAt || score.interval <= 0) return 'not reviewed yet'
  const dueAt = Date.parse(score.dueDate)
  if (Number.isNaN(dueAt)) return 'due date unknown'
  const days = Math.max(0, Math.ceil((dueAt - now) / 86_400_000))
  if (days === 0) return 'due now'
  return `due in ${days} day${days === 1 ? '' : 's'}`
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
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set())
  const scores = useScoresSnapshot()
  const now = useCurrentTime()

  const scoresByChapter = new Map<string, ScoreRecord[]>()
  scores.forEach(record => {
    const list = scoresByChapter.get(record.chapterId) ?? []
    list.push(record)
    scoresByChapter.set(record.chapterId, list)
  })

  function toggleExpandedStudy(id: string) {
    setExpandedStudies(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleExpandedChapter(cid: string) {
    setExpandedChapters(previous => {
      const next = new Set(previous)
      if (next.has(cid)) next.delete(cid)
      else next.add(cid)
      return next
    })
  }

  return (
    <div className="rp-root">
      {studies.map(study => {
        const expanded = expandedStudies.has(study.id)
        let totalMoves = 0
        let dueMoves = 0
        let healthyMoves = 0
        let dueLines = 0

        study.chapters.forEach((chapter, chapterIndex) => {
          const cid = chapterId(study.id, study.chapters, chapterIndex)
          const chapterLines = extractTrainableLines(chapter, study.playerColor)
          const chapterScores = scoresByChapter.get(cid) ?? []

          chapterLines.forEach(line => {
            const score = chapterScores.find(s => s.lineId === line.lineId && s.interval > 0)
            totalMoves += line.plyCount
            if (score) {
              if (new Date(score.dueDate).getTime() <= now) {
                dueMoves += line.plyCount
              } else {
                healthyMoves += line.plyCount
              }
            }
          })
          dueLines += chapterScores.filter(score => score.interval > 0 && new Date(score.dueDate).getTime() <= now).length
        })

        const progressPercent = totalMoves > 0 ? Math.round(((dueMoves + healthyMoves) / totalMoves) * 100) : 0
        const studyHealthyPct = totalMoves > 0 ? (healthyMoves / totalMoves) * 100 : 0
        const studyDuePct = totalMoves > 0 ? (dueMoves / totalMoves) * 100 : 0
        const allChapterIds = study.chapters.map((_, chapterIndex) => chapterId(study.id, study.chapters, chapterIndex))
        const selectedCount = allChapterIds.filter(id => selectedChapterIds.has(id)).length
        const studyAllSelected = selectedCount === allChapterIds.length
        const studySomeSelected = selectedCount > 0 && selectedCount < allChapterIds.length

        return (
          <div key={study.id} className="rp-study-shell">
            <div
              className={`rp-study-header ${expanded ? 'rp-study-header-expanded' : 'rp-study-header-collapsed'}`}
            >
              {selectionMode && (
                <input
                  type="checkbox"
                  ref={node => { if (node) node.indeterminate = studySomeSelected }}
                  checked={studyAllSelected}
                  onChange={() => onToggleStudy(study)}
                  className="rp-study-checkbox"
                  aria-label={`Select all chapters in ${study.name}`}
                />
              )}
              <button
                type="button"
                onClick={() => toggleExpandedStudy(study.id)}
                className="rp-study-toggle"
                aria-expanded={expanded}
              >
                <span className="rp-expand-icon">{expanded ? '▼' : '▶'}</span>
                <span className="rp-study-name">{study.name}</span>
                {dueLines > 0 && (
                  <span className="rp-due-badge">
                    {dueLines} due
                  </span>
                )}
                <span className="rp-percent">{progressPercent}%</span>
              </button>
              {!selectionMode && (
                <button
                  onClick={() => onDeleteStudy(study.id)}
                  title="Delete study"
                  className="rp-trash-btn"
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
            <div className={`rp-progress-wrap ${expanded ? 'rp-progress-wrap-expanded' : 'rp-progress-wrap-collapsed'}`}>
              <div className="rp-progress-seg rp-progress-seg-healthy" style={{ width: `${studyHealthyPct}%` }} />
              <div className="rp-progress-seg rp-progress-seg-due" style={{ width: `${studyDuePct}%` }} />
            </div>
            {expanded && (
              <div className="rp-chapters-wrap">
                {study.chapters.map((chapter, chapterIndex) => {
                  const cid = chapterId(study.id, study.chapters, chapterIndex)
                  const chapterLines = extractTrainableLines(chapter, study.playerColor)
                  const chapterVariationDetails = collectChapterVariationDetails(chapter)
                  const chapterScores = scoresByChapter.get(cid) ?? []
                  const chapterTotalMoves = chapterLines.reduce((sum, line) => sum + line.plyCount, 0)
                  let chapterDueMoves = 0
                  let chapterHealthyMoves = 0
                  chapterLines.forEach(line => {
                    const lineScore = scoreForLine(chapterScores, line.lineId)
                    if (!lineScore || lineScore.interval <= 0) return
                    if (new Date(lineScore.dueDate).getTime() <= now) {
                      chapterDueMoves += line.plyCount
                    } else {
                      chapterHealthyMoves += line.plyCount
                    }
                  })
                  const chapterDue = chapterScores.filter(score => score.interval > 0 && new Date(score.dueDate).getTime() <= now).length
                  const chapterPercent = chapterTotalMoves > 0 ? Math.round(((chapterDueMoves + chapterHealthyMoves) / chapterTotalMoves) * 100) : 0
                  const chapterHealthyPct = chapterTotalMoves > 0 ? (chapterHealthyMoves / chapterTotalMoves) * 100 : 0
                  const chapterDuePct = chapterTotalMoves > 0 ? (chapterDueMoves / chapterTotalMoves) * 100 : 0
                  const chapterSelected = selectedChapterIds.has(cid)
                  const chapterDueIn = formatDueIn(chapterScores, now)
                  const chapterExpanded = expandedChapters.has(cid)

                  return (
                    <div key={chapterIndex} className="rp-chapter-shell">
                      <div
                        className={`rp-chapter-row ${selectionMode && chapterSelected ? 'rp-chapter-row-selected' : ''}`}
                      >
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={chapterSelected}
                            onChange={() => onToggleChapter(cid)}
                            className="rp-chapter-checkbox"
                            aria-label={`Select ${chapter.title}`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => selectionMode ? onToggleChapter(cid) : toggleExpandedChapter(cid)}
                          className="rp-chapter-toggle"
                          aria-expanded={selectionMode ? undefined : chapterExpanded}
                        >
                          {!selectionMode && (
                            <span className="rp-chapter-expand-btn" aria-hidden="true">
                              {chapterExpanded ? '▼' : '▶'}
                            </span>
                          )}
                          <span className="rp-chapter-labels">
                            <span className="rp-chapter-title">{chapter.title}</span>
                            <span className="rp-chapter-last-reviewed">{chapterDueIn}</span>
                          </span>
                          {chapterDue > 0 && (
                            <span className="rp-chapter-due">
                              {chapterDue} due
                            </span>
                          )}
                          <span className="rp-chapter-percent">{chapterPercent}%</span>
                        </button>
                        {!selectionMode && (
                          <>
                            <button
                              type="button"
                              onClick={() => onTrainChapter(study, chapterIndex)}
                              className="rp-chapter-train-btn"
                            >
                              Train
                            </button>
                            <button
                              onClick={() => onDeleteChapter(study.id, chapterIndex)}
                              title="Delete chapter"
                              className="rp-trash-btn"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                      <div className="rp-chapter-progress-wrap">
                        <div className="rp-chapter-progress-seg rp-chapter-progress-seg-healthy" style={{ width: `${chapterHealthyPct}%` }} />
                        <div className="rp-chapter-progress-seg rp-chapter-progress-seg-due" style={{ width: `${chapterDuePct}%` }} />
                      </div>
                      {chapterExpanded && (
                        <div className="rp-variation-list">
                          {chapterVariationDetails.length === 0 ? (
                            <div className="rp-variation-empty">No variations in this chapter.</div>
                          ) : (
                            chapterVariationDetails.map((variation, variationIndex) => {
                              const lineScore = scoreForLine(chapterScores, variation.lineId)
                              const dueLabel = formatVariationDue(lineScore, now)
                              const varState = (() => {
                                if (!lineScore || lineScore.interval <= 0) return 'pending'
                                return new Date(lineScore.dueDate).getTime() <= now ? 'due' : 'complete'
                              })()

                              return (
                              <div key={`${cid}-${variationIndex}`} className="rp-variation-row">
                                <div className="rp-variation-head">
                                  <span className="rp-variation-name">
                                    Variation #{variationIndex + 1} {variation.branchLabel}
                                    {variation.type === 'sideline' && <span className="rp-variation-tag rp-variation-tag-sideline">sideline</span>}
                                    {variation.type === 'independent' && <span className="rp-variation-tag rp-variation-tag-independent">independent</span>}
                                  </span>
                                  <span className="rp-variation-due">{dueLabel}</span>
                                </div>
                                <div className="rp-variation-progress-wrap">
                                  <div
                                    className={`rp-variation-progress-fill rp-variation-progress-fill-${varState}`}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              </div>
                              )
                            })
                          )}
                        </div>
                      )}
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
