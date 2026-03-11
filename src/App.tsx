import { useEffect, useRef, useState, useMemo } from 'react'
import './App.css'
import Chessboard from './components/Chessboard'
import { parseStudy, type Chapter, type MoveNode, extractForkMoves, extractLines } from './lib/pgn'
import { loadStudies, saveStudy, deleteStudy, type StoredStudy, chapterId } from './lib/storage'
import { loadScores, recordReview, initScore, type ScoreRecord, syncChapterLines, updateForkMainlines, findConflicts, type ConflictInfo } from './lib/scores'
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
}: {
  studies: StoredStudy[]
  statsKey: number
  onTrainChapter: (study: StoredStudy, chapterIndex: number) => void
  onDeleteStudy: (id: string) => void
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
          startedLines += chLines.filter(l => chScores.some(s => s.lineId === l.lineId)).length
          dueLines += chScores.filter(s => new Date(s.dueDate).getTime() <= now).length
        })
        const pct = totalLines > 0 ? Math.round((startedLines / totalLines) * 100) : 0

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
              <span style={{ color: '#aaa', fontSize: '0.75rem', width: '10px' }}>{expanded ? '▼' : '▶'}</span>
              <span style={{ flex: 1, fontWeight: 'bold', color: '#e8e8e8', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{study.name}</span>
              {dueLines > 0 && (
                <span style={{ background: '#7a3030', color: '#ffaaaa', fontSize: '0.68rem', padding: '2px 7px', borderRadius: '10px', fontWeight: 'bold', flexShrink: 0 }}>
                  {dueLines} due
                </span>
              )}
              <span style={{ color: '#888', fontSize: '0.78rem', flexShrink: 0 }}>{pct}%</span>
              <button
                onClick={e => { e.stopPropagation(); onDeleteStudy(study.id) }}
                title="Delete study"
                style={{ marginLeft: '4px', border: 'none', background: 'none', cursor: 'pointer', color: '#888', fontSize: '1rem', lineHeight: 1, flexShrink: 0, padding: '0 2px' }}
              >×</button>
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
                  const chStarted = chLines.filter(l => chScores.some(s => s.lineId === l.lineId)).length
                  const chDue = chScores.filter(s => new Date(s.dueDate).getTime() <= now).length
                  const chPct = chTotal > 0 ? Math.round((chStarted / chTotal) * 100) : 0
                  return (
                    <div key={i}>
                      <div
                        onClick={() => onTrainChapter(study, i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '6px 10px', borderRadius: '4px 4px 0 0',
                          background: '#252535', cursor: 'pointer',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#2e2e48')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#252535')}
                      >
                        <span style={{ flex: 1, color: '#ccc', fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                        {chDue > 0 && (
                          <span style={{ background: '#7a3030', color: '#ffaaaa', fontSize: '0.65rem', padding: '1px 5px', borderRadius: '10px', flexShrink: 0 }}>
                            {chDue} due
                          </span>
                        )}
                        <span style={{ color: '#888', fontSize: '0.72rem', flexShrink: 0 }}>{chPct}%</span>
                        <span style={{ color: '#4a7a4a', fontSize: '0.75rem', flexShrink: 0 }}>▶</span>
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

  // Reset position and quiz when chapter changes
  useEffect(() => {
    setMoveIndex(-1)
    setQuizMode(false)
    setQuizDone(false)
    setQuizWrong(null)
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
    setStatsKey(k => k + 1)
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
        loadChapters(stored.chapters, uploadColor, stored.id)
      } catch {
        setError('Failed to parse PGN file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function startQuiz() {
    if (selectedStudyId && selectedChapter) {
      const cid = chapterId(selectedStudyId, chapters.indexOf(selectedChapter))
      extractLines(selectedChapter).forEach(l => initScore(cid, l.lineId, l.displaySan))
      setStatsKey(k => k + 1)
    }
    setQuizMode(true)
    setQuizDone(false)
    setQuizWrong(null)
    setMoveIndex(-1)
    setInlineDetour(null)
    visitedDetourForksRef.current = new Set()
    detourWrongCountRef.current = 0
    mainlineWrongCountRef.current = new Map()
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

  function trainNow() {
    if (storedStudies.length === 0) return
    const study = storedStudies[Math.floor(Math.random() * storedStudies.length)]
    const chapterIndex = Math.floor(Math.random() * study.chapters.length)
    trainChapter(study, chapterIndex)
  }

  function trainChapter(study: StoredStudy, chapterIndex: number) {
    loadChapters(study.chapters, study.playerColor, study.id)
    setSelectedChapter(study.chapters[chapterIndex])
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
      setMoveIndex(nextIndex)
      return true
    }
    mainlineWrongCountRef.current.set(nextIndex, (mainlineWrongCountRef.current.get(nextIndex) ?? 0) + 1)
    setQuizWrong(mainline[nextIndex].san)
    return false
  }

  return (
    <>
      {view === 'repertoire' && (
        /* ── Repertoire full page ── */
        <div style={{ position: 'fixed', inset: 0, background: '#1a1a2a', zIndex: 100, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ maxWidth: '640px', width: '100%', margin: '0 auto', padding: '24px 24px 48px' }}>
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
              onDeleteStudy={id => setStoredStudies(deleteStudy(id))}
            />
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box' }}>

      {view === 'home' ? (
        /* ── Home view ── */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', paddingBottom: '32px' }}>
          <Chessboard fen={STARTING_FEN} readonly={true} />
          <button
            onClick={trainNow}
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
        {chapters.length > 1 && (
          <select
            value={chapters.indexOf(selectedChapter!)}
            onChange={e => {
              setSelectedChapter(chapters[Number(e.target.value)])
              e.target.blur()
            }}
            style={{ padding: '6px 10px', alignSelf: 'flex-start' }}
          >
            {chapters.map((ch, i) => (
              <option key={i} value={i}>{ch.title}</option>
            ))}
          </select>
        )}
        {selectedChapter && (
          <button
            onClick={quizMode ? stopQuiz : startQuiz}
            style={{
              padding: '6px 20px', cursor: 'pointer', alignSelf: 'flex-start',
              background: quizMode ? '#555' : '#4a7a4a', color: '#fff',
              border: 'none', borderRadius: '4px', fontSize: '0.9rem',
            }}
          >
            {quizMode ? '■ Stop' : '▶ Practice'}
          </button>
        )}
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
          {quizMode && quizWrong && <span style={{ color: '#e55' }}>✗ Wrong — expected <strong>{quizWrong}</strong></span>}
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
              {showBranches ? '▲' : '▼'} Branch classification ({branchForks.length} fork{branchForks.length !== 1 ? 's' : ''})
            </button>
            {showBranches && (
              <div style={{ background: '#1e1e1e', border: '1px solid #444', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '8px', fontSize: '0.8rem', color: '#ccc' }}>
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
