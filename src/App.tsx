import { useEffect, useRef, useState, useMemo } from 'react'
import Chessboard from './components/Chessboard'
import { parseStudy, type Chapter, type MoveNode } from './lib/pgn'
import { loadStudies, saveStudy, deleteStudy, type StoredStudy } from './lib/storage'

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [storedStudies, setStoredStudies] = useState<StoredStudy[]>(() => loadStudies())
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [moveIndex, setMoveIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  const [showBranches, setShowBranches] = useState(false)

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

  // Reset position when chapter changes
  useEffect(() => { setMoveIndex(-1) }, [selectedChapter])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
  }, [mainline])

  const currentFen = moveIndex === -1
    ? selectedChapter?.startFen
    : mainline[moveIndex]?.fen

  function loadChapters(ch: Chapter[]) {
    setChapters(ch)
    setSelectedChapter(ch[0] ?? null)
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
        const stored = saveStudy(studyName, parsed)
        setStoredStudies(loadStudies())
        loadChapters(stored.chapters)
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
            onClick={() => loadChapters(study.chapters)}
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
        <input ref={fileInputRef} type="file" accept=".pgn" style={{ display: 'none' }} onChange={handleFileChange} />
        {error && <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '6px' }}>{error}</div>}
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
          <div style={{ fontSize: '0.9rem', color: '#555', minHeight: '1.2em' }}>
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
          </div>
        )}
        <Chessboard fen={currentFen} readonly={!!selectedChapter} />
        {selectedChapter && (() => {
          const comment = moveIndex === -1
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
