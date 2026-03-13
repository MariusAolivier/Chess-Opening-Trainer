import { useEffect, useRef, useState, useMemo } from 'react'
import './App.css'
import Chessboard from './components/Chessboard'
import { parseStudy, type Chapter, type MoveNode, extractForkMoves, extractLines } from './lib/pgn'
import { loadStudies, saveStudy, deleteStudy, deleteChapter, type StoredStudy, chapterId } from './lib/storage'
import { loadScores, recordReview, initScore, type ScoreRecord, syncChapterLines, updateForkMainlines, findConflicts, type ConflictInfo, getReviewStreak } from './lib/scores'
import { fetchAndMerge, uploadStudy, deleteStudyRemote, uploadScores, uploadForkMainlines, uploadReviewActivity, subscribeToScores, subscribeToReviewActivity } from './lib/sync'
import { Chess } from 'chess.js'

type InlineDetour = {
  forkFen: string
  forkMainlineIndex: number
  pendingInlines: MoveNode[]
  detourLine: Array<{ fen: string; san: string; comment?: string }>
  detourIndex: number  // -1 = at fork position before any detour move is played
}

function flattenDetour(root: MoveNode): Array<{ fen: string; san: string; comment?: string }> {
  const line: Array<{ fen: string; san: string; comment?: string }> = []
  let node: MoveNode | undefined = root
  while (node) {
    line.push({ fen: node.fen, san: node.san, comment: node.comment })
    node = node.children[0]
  }
  return line
}

function RepertoirePanel({
  studies,
  statsKey,
  onTrainChapter,
  onDeleteStudy,
  onDeleteChapter,
  selectionMode,
  selectedChapterIds,
  onToggleChapter,
  onToggleStudy,
}: {
  studies: StoredStudy[]
  statsKey: number
  onTrainChapter: (study: StoredStudy, chapterIndex: number) => void
  onDeleteStudy: (id: string) => void
  onDeleteChapter: (studyId: string, chapterIndex: number) => void
  selectionMode: boolean
  selectedChapterIds: Set<string>
  onToggleChapter: (cid: string) => void
  onToggleStudy: (study: StoredStudy) => void
}) {
  void statsKey
  const [expandedStudies, setExpandedStudies] = useState<Set<string>>(new Set())
  const scores = loadScores()
  const now = Date.now()

  const scoresByChapter = new Map<string, ScoreRecord[]>()
  scores.forEach(r => {
    const list = scoresByChapter.get(r.chapterId) ?? []
    list.push(r)
    scoresByChapter.set(r.chapterId, list)
  })

  function toggleStudy(id: string) {
    setExpandedStudies(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {studies.map(study => {
        const expanded = expandedStudies.has(study.id)
        let totalLines = 0, startedLines = 0, dueLines = 0
        study.chapters.forEach((ch, i) => {
          const cid = chapterId(study.id, i)
          const chLines = extractLines(ch)
          const chScores = scoresByChapter.get(cid) ?? []
          totalLines += chLines.length
          startedLines += chLines.filter(l => chScores.some(s => s.lineId === l.lineId && s.interval > 0)).length
          dueLines += chScores.filter(s => new Date(s.dueDate).getTime() <= now).length
        })
        const pct = totalLines > 0 ? Math.round((startedLines / totalLines) * 100) : 0

        const allChapterIds = study.chapters.map((_, i) => chapterId(study.id, i))
        const selectedCount = allChapterIds.filter(id => selectedChapterIds.has(id)).length
        const studyAllSelected = selectedCount === allChapterIds.length
        const studySomeSelected = selectedCount > 0 && selectedCount < allChapterIds.length

        return (
          <div key={study.id}>
            <div
              onClick={() => toggleStudy(study.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '9px 12px', borderRadius: expanded ? '6px 6px 0 0' : '6px',
                background: '#2a2a3a', cursor: 'pointer', userSelect: 'none',
              }}
            >
              {selectionMode && (
                <input
                  type="checkbox"
                  ref={node => { if (node) node.indeterminate = studySomeSelected }}
                  checked={studyAllSelected}
                  onChange={() => onToggleStudy(study)}
                  onClick={e => e.stopPropagation()}
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
              <span style={{ color: '#888', fontSize: '0.78rem', flexShrink: 0 }}>{pct}%</span>
              {!selectionMode && (
                <button
                  onClick={e => { e.stopPropagation(); onDeleteStudy(study.id) }}
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
              <div style={{ height: '100%', width: `${pct}%`, background: '#3a6a3a' }} />
            </div>
            {expanded && (
              <div style={{ background: '#1e1e2e', borderRadius: '0 0 6px 6px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {study.chapters.map((ch, i) => {
                  const cid = chapterId(study.id, i)
                  const chLines = extractLines(ch)
                  const chScores = scoresByChapter.get(cid) ?? []
                  const chTotal = chLines.length
                  const chStarted = chLines.filter(l => chScores.some(s => s.lineId === l.lineId && s.interval > 0)).length
                  const chDue = chScores.filter(s => new Date(s.dueDate).getTime() <= now).length
                  const chPct = chTotal > 0 ? Math.round((chStarted / chTotal) * 100) : 0
                  const chSelected = selectedChapterIds.has(cid)
                  return (
                    <div key={i}>
                      <div
                        onClick={() => selectionMode ? onToggleChapter(cid) : onTrainChapter(study, i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '6px 10px', borderRadius: '4px 4px 0 0',
                          background: selectionMode && chSelected ? '#1e2e1e' : '#252535', cursor: 'pointer',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = selectionMode && chSelected ? '#253525' : '#2e2e48')}
                        onMouseLeave={e => (e.currentTarget.style.background = selectionMode && chSelected ? '#1e2e1e' : '#252535')}
                      >
                        {selectionMode && (
                          <input
                            type="checkbox"
                            checked={chSelected}
                            onChange={() => onToggleChapter(cid)}
                            onClick={e => e.stopPropagation()}
                            style={{ width: '13px', height: '13px', flexShrink: 0, cursor: 'pointer', accentColor: '#5a9a5a' }}
                          />
                        )}
                        <span style={{ flex: 1, color: '#ccc', fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                        {chDue > 0 && (
                          <span style={{ background: '#7a3030', color: '#ffaaaa', fontSize: '0.65rem', padding: '1px 5px', borderRadius: '10px', flexShrink: 0 }}>
                            {chDue} due
                          </span>
                        )}
                        <span style={{ color: '#888', fontSize: '0.72rem', flexShrink: 0 }}>{chPct}%</span>
                        <button
                          onClick={e => { e.stopPropagation(); onDeleteChapter(study.id, i) }}
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
                        <div style={{ height: '100%', width: `${chPct}%`, background: chDue > 0 ? '#6a4a20' : '#2a5a2a' }} />
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

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<'home' | 'repertoire' | 'training'>('home')
  const [storedStudies, setStoredStudies] = useState<StoredStudy[]>(() => loadStudies())
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [moveIndex, setMoveIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [quizMode, setQuizMode] = useState(false)
  const [quizDone, setQuizDone] = useState(false)
  const [quizWrong, setQuizWrong] = useState<string | null>(null)
  const [revealedAnswer, setRevealedAnswer] = useState(false)
  const [inlineDetour, setInlineDetour] = useState<InlineDetour | null>(null)
  const [boardResetKey, setBoardResetKey] = useState(0)
  const visitedDetourForksRef = useRef<Set<number>>(new Set())
  const detourWrongCountRef = useRef(0)
  const mainlineWrongCountRef = useRef<Map<number, number>>(new Map())
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)
  const [statsKey, setStatsKey] = useState(0)
  const [uploadColor, setUploadColor] = useState<'white' | 'black'>('white')
  const [activePlayerColor, setActivePlayerColor] = useState<'white' | 'black'>('white')

  const [showBranches, setShowBranches] = useState(false)
  const [conflictWarnings, setConflictWarnings] = useState<ConflictInfo[]>([])
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [showStreakPanel, setShowStreakPanel] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const streakPanelRef = useRef<HTMLDivElement>(null)

  // Sync with Firestore on mount, then subscribe to score changes from other devices
  useEffect(() => {
    setSyncStatus('syncing')
    fetchAndMerge()
      .then(changed => {
        setSyncStatus('ok')
        if (changed) {
          setStoredStudies(loadStudies())
          setStatsKey(k => k + 1)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[sync] fetchAndMerge failed:', err)
        setSyncStatus('error')
        setSyncError(msg)
      })
    const unsub = subscribeToScores(() => {
      setStatsKey(k => k + 1)
    })
    const unsubReviewActivity = subscribeToReviewActivity(() => {
      setStatsKey(k => k + 1)
    })
    return () => {
      unsub()
      unsubReviewActivity()
    }
  }, [])

  useEffect(() => {
    if (!showStreakPanel) return

    function handlePointerDown(event: PointerEvent) {
      if (!streakPanelRef.current?.contains(event.target as Node)) {
        setShowStreakPanel(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [showStreakPanel])

  // Flat mainline: [{fen, san, comment, alternatives}] following the first child at each node.
  // alternatives = sibling nodes that could have been played instead of this move.
  const mainline = useMemo(() => {
    if (!selectedChapter) return []
    const line: { fen: string; san: string; comment?: string; alternatives: MoveNode[] }[] = []
    let nodes: MoveNode[] = selectedChapter.moves
    while (nodes.length > 0) {
      const node = nodes[0]
      line.push({ fen: node.fen, san: node.san, comment: node.comment, alternatives: nodes.slice(1) })
      nodes = node.children
    }
    return line
  }, [selectedChapter])

  // Collect all fork points in the entire tree for the classification panel
  const branchForks = useMemo(() => {
    if (!selectedChapter) return []
    const forks: { moveNumber: number; side: 'w' | 'b'; mainSan: string; alts: MoveNode[] }[] = []
    function walk(nodes: MoveNode[], plyFromStart: number) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (i === 0 && nodes.length > 1) {
          // This is a mainline node with alternatives
          const moveNum = Math.ceil(plyFromStart / 2)
          const side = plyFromStart % 2 === 1 ? 'w' : 'b'
          forks.push({ moveNumber: moveNum, side, mainSan: node.san, alts: nodes.slice(1) })
        }
        walk(node.children, plyFromStart + 1)
      }
    }
    // plyFromStart starts at 1 for the first move
    const startColor = selectedChapter.startFen.split(' ')[1] as 'w' | 'b'
    walk(selectedChapter.moves, startColor === 'w' ? 1 : 2)
    return forks
  }, [selectedChapter])

  const userColor = useMemo(() =>
    activePlayerColor === 'white' ? 'w' : 'b'
  , [activePlayerColor])

  const totalDue = useMemo(() => {
    const scores = loadScores()
    const now = Date.now()
    return scores.filter(s => new Date(s.dueDate).getTime() <= now).length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsKey, storedStudies])

  const streak = useMemo(() => getReviewStreak(), [statsKey])

  // Reset position and quiz when chapter changes
  useEffect(() => {
    setMoveIndex(-1)
    setQuizDone(false)
    setQuizWrong(null)
    setRevealedAnswer(false)
    setInlineDetour(null)
    visitedDetourForksRef.current = new Set()
    detourWrongCountRef.current = 0
    mainlineWrongCountRef.current = new Map()
  }, [selectedChapter])

  // Keyboard navigation (disabled in quiz mode)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (quizMode) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'SELECT' || tag === 'INPUT') return
      if (e.key === 'ArrowRight') {
        setMoveIndex(i => Math.min(i + 1, mainline.length - 1))
      } else if (e.key === 'ArrowLeft') {
        setMoveIndex(i => Math.max(i - 1, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mainline, quizMode])

  // Auto-play opponent moves in quiz mode, with inline detour navigation
  useEffect(() => {
    if (!quizMode || !selectedChapter || quizDone) return

    if (inlineDetour) {
      const { detourLine, detourIndex, forkFen, pendingInlines, forkMainlineIndex } = inlineDetour
      const detourFen = detourIndex === -1 ? forkFen : detourLine[detourIndex]?.fen
      if (!detourFen) return
      const nextDetourIndex = detourIndex + 1

      if (nextDetourIndex >= detourLine.length) {
        // End of this detour – record score, pause, then move to next inline or return to mainline
        const wrongs = detourWrongCountRef.current
        const quality: 0 | 1 | 2 | 3 | 4 | 5 = wrongs === 0 ? 5 : wrongs === 1 ? 3 : 1
        if (selectedStudyId && selectedChapter) {
          const cidx = chapters.indexOf(selectedChapter)
          const detourLeaf = detourLine[detourLine.length - 1]
          // Display name = first move of the detour (the variation root)
          recordReview(chapterId(selectedStudyId, cidx), detourLeaf.fen, detourLine[0].san, quality)
          uploadScores()
          uploadReviewActivity()
          setStatsKey(k => k + 1)
        }
        const t = setTimeout(() => {
          setQuizWrong(null)
          setBoardResetKey(k => k + 1) // clear last-move highlight when snapping back
          if (pendingInlines.length > 0) {
            detourWrongCountRef.current = 0
            setInlineDetour({
              forkFen,
              forkMainlineIndex,
              pendingInlines: pendingInlines.slice(1),
              detourLine: flattenDetour(pendingInlines[0]),
              detourIndex: -1,
            })
          } else {
            visitedDetourForksRef.current.add(forkMainlineIndex)
            setInlineDetour(null)
          }
        }, 700)
        return () => clearTimeout(t)
      }

      const colorToMove = detourFen.split(' ')[1] as 'w' | 'b'
      if (colorToMove !== userColor) {
        // Auto-play opponent's detour move
        const t = setTimeout(() => {
          setInlineDetour(d => d ? { ...d, detourIndex: nextDetourIndex } : null)
          setQuizWrong(null)
        }, 700)
        return () => clearTimeout(t)
      }
      return // user's turn in the detour
    }

    // Normal mainline logic
    const fen = moveIndex === -1 ? selectedChapter.startFen : mainline[moveIndex]?.fen
    if (!fen) return
    const nextIndex = moveIndex + 1
    if (nextIndex >= mainline.length) { setQuizDone(true); return }

    // Before playing mainline[nextIndex], check for unvisited inline detours at this fork
    if (!visitedDetourForksRef.current.has(nextIndex)) {
      const inlineAlts = mainline[nextIndex].alternatives.filter(a => !a.independent)
      if (inlineAlts.length > 0) {
        setInlineDetour({
          forkFen: fen,
          forkMainlineIndex: nextIndex,
          pendingInlines: inlineAlts.slice(1),
          detourLine: flattenDetour(inlineAlts[0]),
          detourIndex: -1,
        })
        detourWrongCountRef.current = 0
        return
      }
    }

    const colorToMove = fen.split(' ')[1] as 'w' | 'b'
    if (colorToMove !== userColor) {
      const t = setTimeout(() => { setMoveIndex(nextIndex); setQuizWrong(null) }, 700)
      return () => clearTimeout(t)
    }
  }, [quizMode, moveIndex, selectedChapter, userColor, mainline, quizDone, inlineDetour])

  // Score the mainline when the quiz completes
  useEffect(() => {
    if (!quizDone || !selectedStudyId || !selectedChapter) return
    const cid = chapterId(selectedStudyId, chapters.indexOf(selectedChapter))
    const leaf = mainline[mainline.length - 1]
    if (!leaf) return
    const totalWrongs = [...mainlineWrongCountRef.current.values()].reduce((a, b) => a + b, 0)
    const quality: 0 | 1 | 2 | 3 | 4 | 5 = totalWrongs === 0 ? 5 : totalWrongs <= 2 ? 3 : 1
    recordReview(cid, leaf.fen, 'Main line', quality)
    uploadScores()
    uploadReviewActivity()
    setStatsKey(k => k + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizDone])

  // Auto-advance to the next chapter when a line is completed
  useEffect(() => {
    if (!quizDone) return
    const t = setTimeout(pickAndTrainNext, 500)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizDone])

  const currentFen = inlineDetour
    ? (inlineDetour.detourIndex === -1
      ? inlineDetour.forkFen
      : inlineDetour.detourLine[inlineDetour.detourIndex]?.fen)
    : (moveIndex === -1 ? selectedChapter?.startFen : mainline[moveIndex]?.fen)

  function loadChapters(ch: Chapter[], playerColor: 'white' | 'black' = 'white', studyId?: string) {
    setChapters(ch)
    setSelectedChapter(ch[0] ?? null)
    setActivePlayerColor(playerColor)
    setSelectedStudyId(studyId ?? null)
    setError(null)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const pgn = ev.target?.result as string
        const { name: parsedName, chapters: parsed } = parseStudy(pgn)
        const studyName = parsedName ?? file.name.replace(/\.pgn$/i, '')
        const stored = saveStudy(studyName, uploadColor, parsed)

        // Sync line records (remove stale) and update fork mainlines for conflict detection
        let totalReset = 0
        stored.chapters.forEach((ch, i) => {
          const cid = chapterId(stored.id, i)
          const lines = extractLines(ch)
          totalReset += syncChapterLines(cid, new Set(lines.map(l => l.lineId)))
          updateForkMainlines(cid, extractForkMoves(ch))
        })
        if (totalReset > 0) {
          setResetNotice(`${totalReset} score record${totalReset > 1 ? 's' : ''} reset (line removed or changed)`)
        } else {
          setResetNotice(null)
        }

        // Detect conflicts across all chapters of all stored studies
        const allStudies = loadStudies()
        const allChaptersMap = new Map<string, string>()
        allStudies.forEach(s => {
          s.chapters.forEach((ch, i) => {
            allChaptersMap.set(chapterId(s.id, i), `${s.name} · ${ch.title}`)
          })
        })
        setConflictWarnings(findConflicts(allChaptersMap))

        setStoredStudies(allStudies)
        uploadStudy(stored)
        uploadScores()
        uploadForkMainlines()
        loadChapters(stored.chapters, uploadColor, stored.id)
      } catch {
        setError('Failed to parse PGN file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function stopQuiz() {
    setQuizMode(false)
    setQuizWrong(null)
    setQuizDone(false)
    setInlineDetour(null)
    visitedDetourForksRef.current = new Set()
    detourWrongCountRef.current = 0
    mainlineWrongCountRef.current = new Map()
  }

  function pickAndTrainNext() {
    if (storedStudies.length === 0) return
    const scores = loadScores()
    const now = Date.now()

    type Entry = { study: StoredStudy; chapterIndex: number }
    const all: Entry[] = []
    storedStudies.forEach(study => {
      study.chapters.forEach((_, i) => {
        const cid = chapterId(study.id, i)
        if (selectedChapterIds.size > 0 && !selectedChapterIds.has(cid)) return
        all.push({ study, chapterIndex: i })
      })
    })
    if (all.length === 0) return

    const due = all.filter(({ study, chapterIndex: i }) => {
      const cid = chapterId(study.id, i)
      return scores.some(s => s.chapterId === cid && new Date(s.dueDate).getTime() <= now)
    })
    const pool = due.length > 0 ? due : all
    const { study, chapterIndex } = pool[Math.floor(Math.random() * pool.length)]
    trainChapter(study, chapterIndex)
  }

  function trainFromSelection() {
    if (selectedChapterIds.size === 0) return
    setSelectionMode(false)
    pickAndTrainNext()
  }

  function toggleChapter(cid: string) {
    setSelectedChapterIds(prev => {
      const next = new Set(prev)
      next.has(cid) ? next.delete(cid) : next.add(cid)
      return next
    })
  }

  function toggleStudy(study: StoredStudy) {
    const allIds = study.chapters.map((_, i) => chapterId(study.id, i))
    const allSelected = allIds.every(id => selectedChapterIds.has(id))
    setSelectedChapterIds(prev => {
      const next = new Set(prev)
      if (allSelected) {
        allIds.forEach(id => next.delete(id))
      } else {
        allIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  function trainChapter(study: StoredStudy, chapterIndex: number) {
    const ch = study.chapters[chapterIndex]
    const cid = chapterId(study.id, chapterIndex)
    extractLines(ch).forEach(l => initScore(cid, l.lineId, l.displaySan))
    loadChapters(study.chapters, study.playerColor, study.id)
    setSelectedChapter(ch)
    setQuizMode(true)
    setQuizDone(false)
    setQuizWrong(null)
    setMoveIndex(-1)
    setInlineDetour(null)
    visitedDetourForksRef.current = new Set()
    detourWrongCountRef.current = 0
    mainlineWrongCountRef.current = new Map()
    setStatsKey(k => k + 1)
    setView('training')
  }

  function handleQuizMove(from: string, to: string): boolean {
    if (!quizMode || !selectedChapter || quizDone) return false

    if (inlineDetour) {
      const { detourLine, detourIndex, forkFen } = inlineDetour
      const fen = detourIndex === -1 ? forkFen : detourLine[detourIndex]?.fen
      if (!fen) return false
      const nextDetourIndex = detourIndex + 1
      if (nextDetourIndex >= detourLine.length) return false
      const expected = detourLine[nextDetourIndex]
      const chess = new Chess(fen)
      const result = chess.move({ from, to, promotion: 'q' })
      if (!result) return false
      if (chess.fen() === expected.fen) {
        setQuizWrong(null)
        setInlineDetour(d => d ? { ...d, detourIndex: nextDetourIndex } : null)
        return true
      }
      detourWrongCountRef.current += 1
      setQuizWrong(expected.san)
      setRevealedAnswer(false)
      return false
    }

    const fen = moveIndex === -1 ? selectedChapter.startFen : mainline[moveIndex]?.fen
    if (!fen) return false
    const nextIndex = moveIndex + 1
    if (nextIndex >= mainline.length) return false
    const chess = new Chess(fen)
    const result = chess.move({ from, to, promotion: 'q' })
    if (!result) return false
    if (chess.fen() === mainline[nextIndex].fen) {
      setQuizWrong(null)
      setRevealedAnswer(false)
      setMoveIndex(nextIndex)
      return true
    }
    mainlineWrongCountRef.current.set(nextIndex, (mainlineWrongCountRef.current.get(nextIndex) ?? 0) + 1)
    setQuizWrong(mainline[nextIndex].san)
    setRevealedAnswer(false)
    return false
  }

  return (
    <>
      {view === 'repertoire' && (
        /* ── Repertoire full page ── */
        <div style={{ position: 'fixed', inset: 0, background: '#1a1a2a', zIndex: 100, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', padding: '24px 16px 48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <button
                onClick={() => setView('home')}
                style={{ background: 'none', border: '1px solid #555', color: '#aaa', cursor: 'pointer', borderRadius: '4px', padding: '4px 12px', fontSize: '0.85rem', flexShrink: 0 }}
              >
                ← Home
              </button>
              <h2 style={{ margin: 0, color: '#e8e8e8', fontSize: '1.2rem', fontWeight: 'bold' }}>My Repertoire</h2>
            </div>
            {storedStudies.length === 0 && (
              <p style={{ color: '#888', fontSize: '0.9rem', marginBottom: '16px' }}>No studies yet. Upload a PGN to get started.</p>
            )}
            <RepertoirePanel
              studies={storedStudies}
              statsKey={statsKey}
              onTrainChapter={trainChapter}
              onDeleteStudy={id => {
                setStoredStudies(deleteStudy(id))
                deleteStudyRemote(id)
                uploadScores()
                uploadForkMainlines()
              }}
              onDeleteChapter={(studyId, chapterIndex) => {
                const updated = deleteChapter(studyId, chapterIndex)
                setStoredStudies(updated)
                const updatedStudy = updated.find(s => s.id === studyId)
                if (updatedStudy) uploadStudy(updatedStudy)
                else deleteStudyRemote(studyId)
                uploadScores()
                uploadForkMainlines()
              }}
              selectionMode={selectionMode}
              selectedChapterIds={selectedChapterIds}
              onToggleChapter={toggleChapter}
              onToggleStudy={toggleStudy}
            />
            {/* Chapter selection / training launch */}
            {storedStudies.length > 0 && (
              <div style={{ marginTop: '16px', width: '100%', maxWidth: '440px' }}>
                {!selectionMode ? (
                  <button
                    onClick={() => setSelectionMode(true)}
                    style={{ width: '100%', padding: '8px 16px', cursor: 'pointer', background: '#1e2e3e', color: '#7ab4e0', border: '1px solid #3a5a7a', borderRadius: '6px', fontSize: '0.88rem' }}
                  >
                    ☑ Select chapters to train
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => { setSelectionMode(false); setSelectedChapterIds(new Set()) }}
                      style={{ flex: 1, padding: '8px', cursor: 'pointer', background: '#2a2a3a', color: '#aaa', border: '1px solid #555', borderRadius: '6px', fontSize: '0.88rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={trainFromSelection}
                      disabled={selectedChapterIds.size === 0}
                      style={{
                        flex: 2, padding: '8px', cursor: selectedChapterIds.size > 0 ? 'pointer' : 'not-allowed',
                        background: selectedChapterIds.size > 0 ? '#2a5a2a' : '#222',
                        color: selectedChapterIds.size > 0 ? '#aaffaa' : '#555',
                        border: '1px solid', borderColor: selectedChapterIds.size > 0 ? '#4a8a4a' : '#333',
                        borderRadius: '6px', fontSize: '0.88rem', fontWeight: 'bold',
                        opacity: selectedChapterIds.size > 0 ? 1 : 0.5,
                      }}
                    >
                      ▶ Start Training{selectedChapterIds.size > 0 ? ` (${selectedChapterIds.size})` : ''}
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Upload section */}
            <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #2e2e3e', width: '100%', maxWidth: '440px' }}>
              <div style={{ fontWeight: 'bold', color: '#aaa', fontSize: '0.85rem', marginBottom: '10px' }}>Upload study</div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <button
                  onClick={() => setUploadColor('white')}
                  style={{ flex: 1, padding: '6px', cursor: 'pointer', fontSize: '0.8rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'white' ? '#aaa' : 'transparent', background: '#f0f0f0', color: '#222', fontWeight: uploadColor === 'white' ? 'bold' : 'normal' }}
                >♔ White</button>
                <button
                  onClick={() => setUploadColor('black')}
                  style={{ flex: 1, padding: '6px', cursor: 'pointer', fontSize: '0.8rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'black' ? '#aaa' : 'transparent', background: '#444', color: '#fff', fontWeight: uploadColor === 'black' ? 'bold' : 'normal' }}
                >♚ Black</button>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '8px 16px', cursor: 'pointer', width: '100%', background: '#2a2a3a', color: '#ccc', border: '1px solid #444', borderRadius: '6px', fontSize: '0.9rem' }}
              >+ Upload PGN</button>
              <input ref={fileInputRef} type="file" accept=".pgn" style={{ display: 'none' }} onChange={handleFileChange} />
              {error && <div style={{ color: '#e55', fontSize: '0.82rem', marginTop: '8px' }}>{error}</div>}
              {resetNotice && (
                <div style={{ fontSize: '0.78rem', color: '#f0c040', marginTop: '8px', padding: '6px 8px', background: '#2a2a10', borderRadius: '4px', border: '1px solid #555' }}>
                  ↺ {resetNotice}
                </div>
              )}
              {conflictWarnings.length > 0 && (
                <div style={{ marginTop: '10px', background: '#3a1515', border: '1px solid #c44', borderRadius: '6px', padding: '10px', fontSize: '0.78rem', color: '#ffaaaa' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>⚠ {conflictWarnings.length} conflicting position{conflictWarnings.length > 1 ? 's' : ''}</div>
                  {conflictWarnings.map((c, idx) => (
                    <div key={idx} style={{ marginBottom: '6px', paddingBottom: '6px', borderBottom: idx < conflictWarnings.length - 1 ? '1px solid #5a2020' : 'none' }}>
                      {c.recommendations.map(r => (
                        <div key={r.chapterId} style={{ marginBottom: '2px' }}>
                          <span style={{ color: '#ffcccc', fontWeight: 'bold' }}>{r.mainlineSan}</span>
                          {' — '}
                          <span style={{ color: '#e08080', wordBreak: 'break-word' }}>{r.chapterLabel}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <button
                    onClick={() => setConflictWarnings([])}
                    style={{ fontSize: '0.72rem', cursor: 'pointer', background: '#5a1515', border: '1px solid #c44', color: '#ffaaaa', borderRadius: '3px', padding: '3px 10px' }}
                  >Dismiss</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', boxSizing: 'border-box' }}>

      {view === 'home' ? (
        /* ── Home view ── */
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', paddingBottom: '32px', width: '100%', maxWidth: '400px' }}>
          <div ref={streakPanelRef} style={{ position: 'absolute', top: '-8px', left: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', zIndex: 30 }}>
            <button
              onClick={() => setShowStreakPanel(open => !open)}
              aria-label="Toggle streak details"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '999px',
                border: '1px solid #5a4320',
                background: '#2a2113',
                color: '#ffd27a',
                fontSize: '0.95rem',
                fontWeight: 'bold',
                boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1 }}>🔥</span>
              <span>{streak.current}</span>
            </button>
            {showStreakPanel && (
              <div style={{
                minWidth: '190px',
                padding: '12px',
                borderRadius: '12px',
                background: '#202634',
                border: '1px solid #2f3b54',
                color: '#dbe6ff',
                boxShadow: '0 14px 30px rgba(0, 0, 0, 0.28)',
                position: 'relative',
                zIndex: 31,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Current</span>
                  <span style={{ fontWeight: 'bold', color: '#ffe28a' }}>{streak.current} day{streak.current === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Today</span>
                  <span style={{ fontWeight: 'bold' }}>{streak.todayCount} review{streak.todayCount === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                  <span style={{ fontSize: '0.78rem', color: '#8ea6d6' }}>Best</span>
                  <span style={{ fontWeight: 'bold' }}>{streak.best} day{streak.best === 1 ? '' : 's'}</span>
                </div>
              </div>
            )}
          </div>
          {syncStatus === 'error' && (
            <div style={{ fontSize: '0.75rem', color: '#ff8888', background: '#2a1010', border: '1px solid #8a3030', borderRadius: '6px', padding: '6px 12px', maxWidth: '340px', wordBreak: 'break-word' }}>
              ✗ Sync error: {syncError}
            </div>
          )}
          {syncStatus === 'syncing' && (
            <div style={{ fontSize: '0.75rem', color: '#aaa' }}>⟳ Syncing…</div>
          )}
          {syncStatus === 'ok' && (
            <div style={{ fontSize: '0.75rem', color: '#5a9a5a' }}>✓ Synced</div>
          )}
          <Chessboard fen={STARTING_FEN} readonly={true} />
          <button
            onClick={pickAndTrainNext}
            disabled={storedStudies.length === 0}
            style={{
              padding: '14px 52px', fontSize: '1.25rem', fontWeight: 'bold',
              cursor: storedStudies.length > 0 ? 'pointer' : 'not-allowed',
              background: storedStudies.length > 0 ? '#4a7a4a' : '#333',
              color: '#fff', border: 'none', borderRadius: '8px',
              opacity: storedStudies.length > 0 ? 1 : 0.5,
            }}
          >
            ▶ Train Now{totalDue > 0 ? ` — ${totalDue} due today` : ''}
          </button>
          {storedStudies.length === 0 ? (
            <button
              onClick={() => setView('repertoire')}
              style={{
                background: 'none', border: '1px solid #444', color: '#aaa',
                cursor: 'pointer', borderRadius: '6px', padding: '7px 20px',
                fontSize: '0.9rem',
              }}
            >
              + Create Repertoire
            </button>
          ) : (
            <button
              onClick={() => setView('repertoire')}
              style={{
                background: 'none', border: '1px solid #444', color: '#aaa',
                cursor: 'pointer', borderRadius: '6px', padding: '7px 20px',
                fontSize: '0.9rem',
              }}
            >
              My Repertoire →
            </button>
          )}
        </div>
      ) : view === 'repertoire' ? (
        /* placeholder – real view is the fixed overlay above */
        <></>
      ) : (
        /* ── Training view ── */
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={() => { stopQuiz(); setView('home') }}
          style={{ alignSelf: 'flex-start', background: 'none', border: '1px solid #555', color: '#aaa', cursor: 'pointer', borderRadius: '4px', padding: '4px 12px', fontSize: '0.85rem' }}
        >
          ← Home
        </button>
        {selectedChapter && (() => {
          const study = storedStudies.find(s => s.id === selectedStudyId)
          return (
            <div style={{ alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {study && <span style={{ fontSize: '0.72rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>{study.name}</span>}
              <span style={{ fontSize: '0.88rem', color: '#bbb', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>{selectedChapter.title}</span>
            </div>
          )
        })()}
        {selectedChapter && (
          <div style={{ fontSize: '0.9rem', color: '#555', minHeight: '1.2em' }}>
            {inlineDetour
              ? <>
                  <span style={{ color: '#f0c040' }}>↪ Sideline</span>
                  {inlineDetour.detourIndex >= 0 && (
                    <span style={{ marginLeft: '6px' }}>{inlineDetour.detourLine[inlineDetour.detourIndex]?.san}</span>
                  )}
                  <span style={{ marginLeft: '8px', color: '#aaa' }}>
                    ({Math.max(0, inlineDetour.detourIndex + 1)}/{inlineDetour.detourLine.length})
                  </span>
                </>
              : <>
                  {moveIndex === -1
                    ? 'Start position'
                    : `${Math.ceil((moveIndex + 1) / 2)}${mainline[moveIndex] ? (moveIndex % 2 === 0 ? '.' : '...') : ''} ${mainline[moveIndex]?.san ?? ''}`
                  }
                  {moveIndex >= 0 && (() => {
                    const alts = mainline[moveIndex]?.alternatives ?? []
                    const inlineCount = alts.filter(a => !a.independent).length
                    const indepCount = alts.filter(a => a.independent).length
                    if (!inlineCount && !indepCount) return null
                    return (
                      <span style={{ marginLeft: '6px', fontSize: '0.75rem' }}>
                        {inlineCount > 0 && (
                          <span title={`${inlineCount} inline sideline(s)`} style={{ color: '#f0c040' }}>{'●'.repeat(inlineCount)}</span>
                        )}
                        {indepCount > 0 && (
                          <span title={`${indepCount} independent variation(s)`} style={{ color: '#60adf0', marginLeft: inlineCount > 0 ? '3px' : undefined }}>{'●'.repeat(indepCount)}</span>
                        )}
                      </span>
                    )
                  })()}
                  <span style={{ marginLeft: '8px', color: '#aaa' }}>
                    ({moveIndex + 1} / {mainline.length})
                  </span>
                </>
            }
          </div>
        )}
        <Chessboard
          fen={currentFen}
          readonly={!quizMode && !!selectedChapter}
          playerColor={quizMode ? activePlayerColor : undefined}
          orientation={activePlayerColor}
          onMove={quizMode ? handleQuizMove : undefined}
          resetKey={boardResetKey}
        />
        <div style={{ maxWidth: '400px', width: '100%', padding: '8px 12px', borderRadius: '6px', textAlign: 'center', fontSize: '0.9rem', minHeight: '36px' }}>
          {quizMode && quizDone && <span style={{ color: '#5c5', fontWeight: 'bold' }}>✓ Line complete!</span>}
          {quizMode && quizWrong && !revealedAnswer && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#e55' }}>✗ Wrong move</span>
              <button
                onClick={() => {
                  setRevealedAnswer(true)
                  // Force worst score for this position
                  if (inlineDetour) {
                    detourWrongCountRef.current = 99
                  } else {
                    const nextIndex = moveIndex + 1
                    mainlineWrongCountRef.current.set(nextIndex, 99)
                  }
                }}
                style={{ padding: '4px 16px', cursor: 'pointer', background: '#3a2020', color: '#ffaaaa', border: '1px solid #7a3030', borderRadius: '4px', fontSize: '0.82rem' }}
              >Reveal answer</button>
            </div>
          )}
          {quizMode && quizWrong && revealedAnswer && (
            <span style={{ color: '#e55' }}>✗ Wrong — expected <strong>{quizWrong}</strong></span>
          )}
        </div>
        {selectedChapter && (() => {
          const comment = inlineDetour && inlineDetour.detourIndex >= 0
            ? inlineDetour.detourLine[inlineDetour.detourIndex]?.comment
            : moveIndex === -1
              ? selectedChapter.startComment
              : mainline[moveIndex]?.comment
          return comment ? (
            <div style={{
              maxWidth: '400px', padding: '8px 12px', borderRadius: '6px',
              background: '#f0ede4', color: '#444', fontSize: '0.875rem',
              fontStyle: 'italic', lineHeight: '1.5',
            }}>
              {comment}
            </div>
          ) : null
        })()
        }
        {selectedChapter && branchForks.length > 0 && (
          <div style={{ maxWidth: '400px', width: '100%' }}>
            <button
              onClick={() => setShowBranches(v => !v)}
              style={{ fontSize: '0.8rem', padding: '4px 10px', cursor: 'pointer', width: '100%', background: '#2b2b2b', color: '#ccc', border: '1px solid #444', borderRadius: '4px' }}
            >
              {showBranches ? '▲' : '▼'} See all variations in chapter
            </button>
            {showBranches && (
              <div style={{ background: '#1e1e1e', border: '1px solid #fa8c8c', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '8px', fontSize: '0.8rem', color: '#ccc' }}>
                {branchForks.map((fork, fi) => (
                  <div key={fi} style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: fi < branchForks.length - 1 ? '1px solid #333' : 'none' }}>
                    <span style={{ color: '#888' }}>
                      {fork.moveNumber}{fork.side === 'w' ? '.' : '...'}
                    </span>
                    {' '}
                    <strong style={{ color: '#fff' }}>{fork.mainSan}</strong>
                    <span style={{ color: '#888' }}> (mainline)</span>
                    {fork.alts.map((alt, ai) => (
                      <div key={ai} style={{ marginTop: '3px', paddingLeft: '12px' }}>
                        <span style={{ color: alt.independent ? '#60adf0' : '#f0c040' }}>●</span>
                        {' '}
                        <strong>{alt.san}</strong>
                        {' '}
                        <span style={{ color: '#888' }}>({alt.independent ? 'independent' : 'inline'})</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
    </>
  )
}

export default App
