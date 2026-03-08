import { useEffect, useRef, useState, useMemo } from 'react'
import Chessboard from './components/Chessboard'
import { parseStudy, type Chapter, type MoveNode } from './lib/pgn'
import { loadStudies, saveStudy, deleteStudy, type StoredStudy, chapterId } from './lib/storage'
import { loadScores, recordReview, initScore, type ScoreRecord } from './lib/scores'
import { Chess } from 'chess.js'

type InlineDetour = {
  forkFen: string
  forkMainlineIndex: number
  pendingInlines: MoveNode[]
  detourLine: Array<{ fen: string; san: string; comment?: string }>
  detourIndex: number  // -1 = at fork position before any detour move is played
}

function StatsPanel({ studies, statsKey }: { studies: StoredStudy[], statsKey: number }) {
  void statsKey // used only to trigger re-render
  const scores = loadScores()
  const now = Date.now()

  if (scores.length === 0) {
    return (
      <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#888', padding: '8px', background: '#1a1a2a', borderRadius: '4px' }}>
        No reviews yet. Run a quiz to start tracking.
      </div>
    )
  }

  // Build a lookup: "studyId_chapterIndex" -> study name + chapter title
  const labelMap = new Map<string, string>()
  studies.forEach(study => {
    study.chapters.forEach((ch, i) => {
      labelMap.set(`${study.id}_${i}`, `${study.name} · ${ch.title}`)
    })
  })

  // Group by chapterId
  const grouped = new Map<string, ScoreRecord[]>()
  scores.forEach(r => {
    const list = grouped.get(r.chapterId) ?? []
    list.push(r)
    grouped.set(r.chapterId, list)
  })

  function dueBadge(record: ScoreRecord) {
    const msUntilDue = new Date(record.dueDate).getTime() - now
    const daysUntilDue = msUntilDue / 86_400_000
    if (daysUntilDue <= 0) return { label: 'Due now', color: '#e55' }
    if (daysUntilDue < 1) return { label: `Due in ${Math.ceil(msUntilDue / 3_600_000)}h`, color: '#f0c040' }
    return { label: `Due in ${Math.round(daysUntilDue)}d`, color: '#5c5' }
  }

  return (
    <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#ccc' }}>
      {[...grouped.entries()].map(([cid, records]) => (
        <div key={cid} style={{ marginBottom: '10px' }}>
          <div style={{ fontWeight: 'bold', color: '#aaa', marginBottom: '4px', fontSize: '0.72rem', wordBreak: 'break-word' }}>
            {labelMap.get(cid) ?? cid}
          </div>
          {records.map(r => {
            const badge = dueBadge(r)
            return (
              <div key={r.firstMoveSan + r.forkFen} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 6px', marginBottom: '2px', borderRadius: '3px',
                background: '#252535',
              }}>
                <span style={{ fontWeight: 'bold', color: '#e8e8e8' }}>{r.firstMoveSan}</span>
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ color: '#888' }}>ease {r.ease.toFixed(2)}</span>
                  <span style={{ color: '#888' }}>{r.interval}d</span>
                  <span style={{ color: badge.color, fontWeight: 'bold' }}>{badge.label}</span>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
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

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [showStats, setShowStats] = useState(false)

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
          recordReview(chapterId(selectedStudyId, cidx), forkFen, detourLine[0].san, quality)
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
      // Opponent's move — if it's at a fork, seed score records so they appear in stats
      const alts = mainline[nextIndex].alternatives
      if (alts.length > 0 && selectedStudyId && selectedChapter) {
        const cid = chapterId(selectedStudyId, chapters.indexOf(selectedChapter))
        initScore(cid, fen, mainline[nextIndex].san)
        alts.forEach(alt => initScore(cid, fen, alt.san))
        setStatsKey(k => k + 1)
      }
      const t = setTimeout(() => { setMoveIndex(nextIndex); setQuizWrong(null) }, 700)
      return () => clearTimeout(t)
    }
  }, [quizMode, moveIndex, selectedChapter, userColor, mainline, quizDone, inlineDetour])

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
        const parsed = parseStudy(pgn)
        const studyName = file.name.replace(/\.pgn$/i, '')
        const stored = saveStudy(studyName, uploadColor, parsed)
        setStoredStudies(loadStudies())
        loadChapters(stored.chapters, uploadColor, stored.id)
      } catch {
        setError('Failed to parse PGN file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleDeleteStudy(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setStoredStudies(deleteStudy(id))
  }

  function startQuiz() {
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
      // If this is a fork point, record reviews and init scores for all alternatives
      const alts = mainline[nextIndex].alternatives
      if (alts.length > 0 && selectedStudyId && selectedChapter) {
        const wrongs = mainlineWrongCountRef.current.get(nextIndex) ?? 0
        const quality: 0 | 1 | 2 | 3 | 4 | 5 = wrongs === 0 ? 5 : wrongs === 1 ? 3 : 1
        const cidx = chapters.indexOf(selectedChapter)
        const cid = chapterId(selectedStudyId, cidx)
        // Score the mainline move at this fork
        recordReview(cid, fen, mainline[nextIndex].san, quality)
        // Ensure all alternatives have a record (so they show in stats)
        alts.forEach(alt => initScore(cid, fen, alt.san))
        setStatsKey(k => k + 1)
      }
      setQuizWrong(null)
      setMoveIndex(nextIndex)
      return true
    }
    mainlineWrongCountRef.current.set(nextIndex, (mainlineWrongCountRef.current.get(nextIndex) ?? 0) + 1)
    setQuizWrong(mainline[nextIndex].san)
    return false
  }

  return (
    <div style={{ display: 'flex', gap: '24px', padding: '24px', alignItems: 'flex-start' }}>
      {/* Sidebar */}
      <div style={{ width: '200px', flexShrink: 0, background: '#2b2b2b', borderRadius: '8px', padding: '12px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#f0f0f0' }}>Studies</div>
        {storedStudies.length === 0 && (
          <div style={{ fontSize: '0.85rem', color: '#999' }}>No studies yet</div>
        )}
        {storedStudies.map(study => (
          <div
            key={study.id}
            onClick={() => loadChapters(study.chapters, study.playerColor, study.id)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
              cursor: 'pointer', background: chapters === study.chapters ? '#4a4a7a' : '#3a3a3a',
              fontSize: '0.875rem', color: '#e8e8e8',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#4a4a5a')}
            onMouseLeave={e => (e.currentTarget.style.background = chapters === study.chapters ? '#4a4a7a' : '#3a3a3a')}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {study.name}
            </span>
            <button
              onClick={e => handleDeleteStudy(study.id, e)}
              title="Delete"
              style={{ marginLeft: '6px', border: 'none', background: 'none', cursor: 'pointer', color: '#aaa', fontSize: '1rem', lineHeight: 1, flexShrink: 0 }}
            >×</button>
          </div>
        ))}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ marginTop: '10px', padding: '6px 10px', cursor: 'pointer', width: '100%' }}
        >
          + Upload PGN
        </button>
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          <button
            onClick={() => setUploadColor('white')}
            style={{ flex: 1, padding: '4px', cursor: 'pointer', fontSize: '0.75rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'white' ? '#aaa' : 'transparent', background: '#f0f0f0', color: '#222', fontWeight: uploadColor === 'white' ? 'bold' : 'normal' }}
          >♔ White</button>
          <button
            onClick={() => setUploadColor('black')}
            style={{ flex: 1, padding: '4px', cursor: 'pointer', fontSize: '0.75rem', borderRadius: '4px', border: '2px solid', borderColor: uploadColor === 'black' ? '#aaa' : 'transparent', background: '#444', color: '#fff', fontWeight: uploadColor === 'black' ? 'bold' : 'normal' }}
          >♚ Black</button>
        </div>
        <input ref={fileInputRef} type="file" accept=".pgn" style={{ display: 'none' }} onChange={handleFileChange} />
        {error && <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '6px' }}>{error}</div>}
        <button
          onClick={() => setShowStats(v => !v)}
          style={{ marginTop: '12px', padding: '6px 10px', cursor: 'pointer', width: '100%', background: '#3a3a5a', color: '#ccc', border: '1px solid #555', borderRadius: '4px', fontSize: '0.8rem' }}
        >
          {showStats ? '▲ Hide stats' : '▼ Learning stats'}
        </button>
          {showStats && <StatsPanel studies={storedStudies} statsKey={statsKey} />}
      </div>

      {/* Board area */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
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
    </div>
  )
}

export default App
