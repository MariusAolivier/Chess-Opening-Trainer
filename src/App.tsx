import { useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import './App.css'
import ConfirmDialog, { type ConfirmDialogState } from './components/ConfirmDialog'
import StreakAnimation from './components/StreakAnimation'
import HomeView from './components/views/HomeView'
import RepertoireView from './components/views/RepertoireView'
import TrainingView from './components/views/TrainingView'
import { parseStudy, parseStudies, type Chapter, type MoveNode, extractForkMoves, extractLines } from './lib/pgn'
import {
  loadStudies,
  saveStudy,
  deleteStudy,
  deleteChapter,
  buildChapterIds,
  loadSoundEnabled,
  saveSoundEnabled,
  type StoredStudy,
  chapterId,
  legacyChapterId,
} from './lib/storage'
import {
  loadScores,
  recordReview,
  initScore,
  pruneStudyChapterIds,
  remapChapterIds,
  syncChapterLines,
  updateForkMainlines,
  findConflicts,
  type ConflictInfo,
  getReviewStreak,
} from './lib/scores'
import {
  fetchAndMerge,
  uploadStudy,
  deleteStudyRemote,
  uploadScores,
  uploadForkMainlines,
  uploadReviewActivity,
  subscribeToScores,
  subscribeToReviewActivity,
} from './lib/sync'
import {
  HOME_FENS,
  STARTING_FEN,
  findQuizStartMoveIndex,
  flattenDetour,
  nextPlayableDetourIndex,
  type InlineDetour,
  type MainlineMove,
} from './lib/training'
import {
  beginLichessOAuthLoginAndSync,
  clearLichessToken,
  completeLichessOAuthFromUrl,
  exportLichessStudiesPgn,
  fetchLichessAccount,
  loadLichessToken,
} from './lib/lichess'

const STREAK_SHOWN_KEY = 'chess-opening-trainer:streak-shown-day'

function todayDayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const visitedDetourForksRef = useRef<Set<number>>(new Set())
  const detourWrongCountRef = useRef(0)
  const mainlineWrongCountRef = useRef<Map<number, number>>(new Map())

  const [view, setView] = useState<'home' | 'repertoire' | 'training'>('home')
  const [storedStudies, setStoredStudies] = useState<StoredStudy[]>(() => loadStudies())
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)

  const [moveIndex, setMoveIndex] = useState(-1)
  const [quizMode, setQuizMode] = useState(false)
  const [quizDone, setQuizDone] = useState(false)
  const [quizWrong, setQuizWrong] = useState<string | null>(null)
  const [wrongGuessTick, setWrongGuessTick] = useState(0)
  const [revealedAnswer, setRevealedAnswer] = useState(false)
  const [inlineDetour, setInlineDetour] = useState<InlineDetour | null>(null)
  const [boardResetKey, setBoardResetKey] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [showBranches, setShowBranches] = useState(false)
  const [conflictWarnings, setConflictWarnings] = useState<ConflictInfo[]>([])
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())

  const [statsKey, setStatsKey] = useState(0)
  const [uploadColor, setUploadColor] = useState<'white' | 'black'>('white')
  const [activePlayerColor, setActivePlayerColor] = useState<'white' | 'black'>('white')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundEnabled())
  const [homeFen] = useState(() => HOME_FENS[Math.floor(Math.random() * HOME_FENS.length)] ?? STARTING_FEN)
  const [showStreakAnimation, setShowStreakAnimation] = useState<number | null>(null)
  const [lichessSyncing, setLichessSyncing] = useState(false)
  const [lichessUsername, setLichessUsername] = useState<string | null>(null)

  function resetTrainingProgress() {
    setMoveIndex(-1)
    setQuizDone(false)
    setQuizWrong(null)
    setWrongGuessTick(0)
    setRevealedAnswer(false)
    setInlineDetour(null)
    setShowBranches(false)
    visitedDetourForksRef.current = new Set()
    detourWrongCountRef.current = 0
    mainlineWrongCountRef.current = new Map()
  }

  async function persistReviewData() {
    try {
      await Promise.all([uploadScores(), uploadReviewActivity()])
      setSyncStatus('ok')
      setSyncError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[sync] persistReviewData failed:', err)
      setSyncStatus('error')
      setSyncError(message)
    }
    setStatsKey(key => key + 1)
  }

  function migrateLegacyChapterIdsForStudies(studiesToMigrate: StoredStudy[]): boolean {
    const remap = new Map<string, string>()

    studiesToMigrate.forEach(study => {
      const nextChapterIds = buildChapterIds(study.id, study.chapters)
      study.chapters.forEach((_, chapterIndex) => {
        remap.set(legacyChapterId(study.id, chapterIndex), nextChapterIds[chapterIndex])
      })
    })

    return remapChapterIds(remap)
  }

  function recordMainlineReview() {
    if (!selectedStudyId || !selectedChapter) return
    const chapterIndex = chapters.indexOf(selectedChapter)
    if (chapterIndex < 0) return

    const leaf = mainline[mainline.length - 1]
    if (!leaf) return

    const totalWrongs = [...mainlineWrongCountRef.current.values()].reduce((acc, value) => acc + value, 0)
    const quality: 0 | 1 | 2 | 3 | 4 | 5 = totalWrongs === 0 ? 5 : totalWrongs <= 2 ? 3 : 1
    recordReview(chapterId(selectedStudyId, chapters, chapterIndex), leaf.fen, 'Main line', quality)
    void persistReviewData()
  }

  function maybeFireDailyChapterStreakAnimation() {
    const today = todayDayKey()
    if (localStorage.getItem(STREAK_SHOWN_KEY) === today) return
    localStorage.setItem(STREAK_SHOWN_KEY, today)
    const { current } = getReviewStreak()
    setShowStreakAnimation(Math.max(1, current))
  }

  function handleSoundToggle() {
    setSoundEnabled(previous => {
      const next = !previous
      saveSoundEnabled(next)
      return next
    })
  }

  function loadChapters(chaptersToLoad: Chapter[], playerColor: 'white' | 'black' = 'white', studyId?: string) {
    setChapters(chaptersToLoad)
    setSelectedChapter(chaptersToLoad[0] ?? null)
    setActivePlayerColor(playerColor)
    setSelectedStudyId(studyId ?? null)
    setError(null)
  }

  function stopQuiz() {
    setQuizMode(false)
    resetTrainingProgress()
  }

  useEffect(() => {
    setSyncStatus('syncing')
    fetchAndMerge()
      .then(changed => {
        const mergedStudies = loadStudies()
        const migrated = migrateLegacyChapterIdsForStudies(mergedStudies)
        setSyncStatus('ok')
        setStoredStudies(mergedStudies)
        if (changed || migrated) {
          setStatsKey(key => key + 1)
        }
        if (migrated) {
          uploadScores()
          uploadForkMainlines()
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[sync] fetchAndMerge failed:', err)
        setSyncStatus('error')
        setSyncError(message)
      })

    const unsubScores = subscribeToScores(() => {
      const studies = loadStudies()
      const migrated = migrateLegacyChapterIdsForStudies(studies)
      if (migrated) {
        uploadScores()
        uploadForkMainlines()
      }
      setStatsKey(key => key + 1)
    })
    const unsubReviewActivity = subscribeToReviewActivity(() => {
      setStatsKey(key => key + 1)
    })

    return () => {
      unsubScores()
      unsubReviewActivity()
    }
  }, [])

  const userColor = useMemo(() => (activePlayerColor === 'white' ? 'w' : 'b'), [activePlayerColor])

  const mainline = useMemo<MainlineMove[]>(() => {
    if (!selectedChapter) return []
    const line: MainlineMove[] = []
    let nodes: MoveNode[] = selectedChapter.moves
    while (nodes.length > 0) {
      const node = nodes[0]
      line.push({ fen: node.fen, san: node.san, comment: node.comment, annotation: node.annotation, alternatives: nodes.slice(1) })
      nodes = node.children
    }
    return line
  }, [selectedChapter])

  const branchForks = useMemo(() => {
    if (!selectedChapter) return []
    const forks: { moveNumber: number; side: 'w' | 'b'; mainSan: string; alts: MoveNode[] }[] = []

    function walk(nodes: MoveNode[], plyFromStart: number) {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]
        if (index === 0 && nodes.length > 1) {
          const moveNum = Math.ceil(plyFromStart / 2)
          const side = plyFromStart % 2 === 1 ? 'w' : 'b'
          forks.push({ moveNumber: moveNum, side, mainSan: node.san, alts: nodes.slice(1) })
        }
        walk(node.children, plyFromStart + 1)
      }
    }

    const startColor = selectedChapter.startFen.split(' ')[1] as 'w' | 'b'
    walk(selectedChapter.moves, startColor === 'w' ? 1 : 2)
    return forks
  }, [selectedChapter])

  const totalDue = useMemo(() => {
    const scores = loadScores()
    const now = Date.now()
    return scores.filter(score => new Date(score.dueDate).getTime() <= now).length
  }, [statsKey, storedStudies])

  const estimatedMinutes = useMemo(() => Math.ceil((totalDue * 45) / 60), [totalDue])
  const streak = useMemo(() => getReviewStreak(), [statsKey])

  useEffect(() => {
    resetTrainingProgress()
  }, [selectedChapter])

  useEffect(() => {
    if (!quizMode || !selectedChapter) return
    setMoveIndex(findQuizStartMoveIndex(selectedChapter, mainline, userColor))
    setBoardResetKey(key => key + 1)
  }, [quizMode, selectedChapter, mainline, userColor])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (quizMode) return
      const tag = (event.target as HTMLElement).tagName
      if (tag === 'SELECT' || tag === 'INPUT') return

      if (event.key === 'ArrowRight') {
        setMoveIndex(index => Math.min(index + 1, mainline.length - 1))
      } else if (event.key === 'ArrowLeft') {
        setMoveIndex(index => Math.max(index - 1, -1))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mainline, quizMode])

  useEffect(() => {
    if (!quizMode || !selectedChapter || quizDone) return

    if (inlineDetour) {
      const { detourLine, detourIndex, forkFen, pendingInlines, forkMainlineIndex } = inlineDetour
      const detourFen = detourIndex === -1 ? forkFen : detourLine[detourIndex]?.fen
      if (!detourFen) return

      const nextDetourIndex = nextPlayableDetourIndex(detourLine, detourIndex, detourFen)
      if (nextDetourIndex >= detourLine.length) {
        const wrongs = detourWrongCountRef.current
        const quality: 0 | 1 | 2 | 3 | 4 | 5 = wrongs === 0 ? 5 : wrongs === 1 ? 3 : 1

        if (selectedStudyId && selectedChapter) {
          const chapterIndex = chapters.indexOf(selectedChapter)
          const detourLeaf = detourLine[detourLine.length - 1]
          recordReview(chapterId(selectedStudyId, chapters, chapterIndex), detourLeaf.fen, detourLine[0].san, quality)
          void persistReviewData()
        }

        const timeout = setTimeout(() => {
          setQuizWrong(null)
          setBoardResetKey(key => key + 1)

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

        return () => clearTimeout(timeout)
      }

      const colorToMove = detourFen.split(' ')[1] as 'w' | 'b'
      if (colorToMove !== userColor) {
        const timeout = setTimeout(() => {
          setInlineDetour(detour => (detour ? { ...detour, detourIndex: nextDetourIndex } : null))
          setQuizWrong(null)
        }, 700)
        return () => clearTimeout(timeout)
      }

      return
    }

    const fen = moveIndex === -1 ? selectedChapter.startFen : mainline[moveIndex]?.fen
    if (!fen) return

    const nextIndex = moveIndex + 1
    if (nextIndex >= mainline.length) {
      recordMainlineReview()
      setQuizDone(true)
      return
    }

    if (!visitedDetourForksRef.current.has(nextIndex)) {
      const queuedAlternatives = mainline[nextIndex].alternatives.filter(node => !node.independent)
      if (queuedAlternatives.length > 0) {
        setInlineDetour({
          forkFen: fen,
          forkMainlineIndex: nextIndex,
          pendingInlines: queuedAlternatives.slice(1),
          detourLine: flattenDetour(queuedAlternatives[0]),
          detourIndex: -1,
        })
        detourWrongCountRef.current = 0
        return
      }
    }

    const colorToMove = fen.split(' ')[1] as 'w' | 'b'
    if (colorToMove !== userColor) {
      const timeout = setTimeout(() => {
        setMoveIndex(nextIndex)
        setQuizWrong(null)
      }, 700)
      return () => clearTimeout(timeout)
    }
  }, [quizMode, moveIndex, selectedChapter, userColor, mainline, quizDone, inlineDetour, selectedStudyId, chapters])

  useEffect(() => {
    if (!quizDone) return
    maybeFireDailyChapterStreakAnimation()
    const timeout = setTimeout(() => pickAndTrainNext(), 500)
    return () => clearTimeout(timeout)
  }, [quizDone])

  const currentFen = inlineDetour
    ? (inlineDetour.detourIndex === -1 ? inlineDetour.forkFen : inlineDetour.detourLine[inlineDetour.detourIndex]?.fen)
    : (moveIndex === -1 ? selectedChapter?.startFen : mainline[moveIndex]?.fen)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = loaded => {
      try {
        const pgn = loaded.target?.result as string
        const { name: parsedName, chapters: parsedChapters } = parseStudy(pgn)
        const studyName = parsedName ?? file.name.replace(/\.pgn$/i, '')
        const imported = importSingleStudy(studyName, parsedChapters, uploadColor)

        Promise.all([uploadStudy(imported.stored), uploadScores(), uploadForkMainlines()])
          .then(() => {
            setSyncStatus('ok')
            setSyncError(null)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error('[sync] upload failed after PGN import:', err)
            setSyncStatus('error')
            setSyncError(message)
          })
        loadChapters(imported.stored.chapters, uploadColor, imported.stored.id)
      } catch {
        setError('Failed to parse PGN file.')
      }
    }

    reader.readAsText(file)
    event.target.value = ''
  }

  function importSingleStudy(studyName: string, parsedChapters: Chapter[], playerColor: 'white' | 'black'): { stored: StoredStudy; notice: string } {
    const existingStudy = loadStudies().find(study => study.name === studyName)
    const previousSnapshot = existingStudy
      ? JSON.stringify({ playerColor: existingStudy.playerColor, chapters: existingStudy.chapters })
      : null

    const stored = saveStudy(studyName, playerColor, parsedChapters)
    migrateLegacyChapterIdsForStudies([stored])

    const currentSnapshot = JSON.stringify({ playerColor: stored.playerColor, chapters: stored.chapters })
    const structureChanged = previousSnapshot === null || previousSnapshot !== currentSnapshot

    let totalReset = 0
    totalReset += pruneStudyChapterIds(stored.id, new Set(buildChapterIds(stored.id, stored.chapters)))
    stored.chapters.forEach((chapter, chapterIndex) => {
      const cid = chapterId(stored.id, stored.chapters, chapterIndex)
      const lines = extractLines(chapter)
      totalReset += syncChapterLines(cid, new Set(lines.map(line => line.lineId)))
      updateForkMainlines(cid, extractForkMoves(chapter))
    })

    let notice: string
    if (!existingStudy) {
      notice = `Uploaded "${studyName}" with ${stored.chapters.length} chapter${stored.chapters.length === 1 ? '' : 's'}.`
    } else if (!structureChanged && totalReset === 0) {
      notice = `Uploaded "${studyName}". No changes were detected.`
    } else {
      const resetSummary = totalReset > 0
        ? `${totalReset} score record${totalReset === 1 ? '' : 's'} removed because lines or chapters no longer exist.`
        : 'No score records needed cleanup.'
      notice = `Updated "${studyName}". ${resetSummary}`
    }

    const allStudies = loadStudies()
    const allChaptersMap = new Map<string, string>()
    allStudies.forEach(study => {
      study.chapters.forEach((chapter, chapterIndex) => {
        allChaptersMap.set(chapterId(study.id, study.chapters, chapterIndex), `${study.name} · ${chapter.title}`)
      })
    })

    setConflictWarnings(findConflicts(allChaptersMap))
    setStoredStudies(allStudies)
    setResetNotice(notice)

    return { stored, notice }
  }

  async function runLichessSync(accessToken: string): Promise<void> {
    function colorFromLichessStudyName(studyName: string): 'white' | 'black' {
      return studyName.trimStart().toLocaleLowerCase().startsWith('(black)') ? 'black' : 'white'
    }

    const account = await fetchLichessAccount(accessToken)
    setLichessUsername(account.username)

    const exportPgn = await exportLichessStudiesPgn(accessToken, account.username)
    const parsedStudies = parseStudies(exportPgn)
    const studiesToSync = parsedStudies.filter(study => !study.name.startsWith('/'))

    if (parsedStudies.length === 0) {
      setResetNotice(`Connected as ${account.username}, but no studies were found to sync.`)
      return
    }

    if (studiesToSync.length === 0) {
      setResetNotice(`Connected as ${account.username}, but all studies were ignored by your '/' prefix rule.`)
      return
    }

    const uploaded: StoredStudy[] = []
    studiesToSync.forEach(study => {
      const imported = importSingleStudy(study.name, study.chapters, colorFromLichessStudyName(study.name))
      uploaded.push(imported.stored)
    })

    await Promise.all([
      ...uploaded.map(study => uploadStudy(study)),
      uploadScores(),
      uploadForkMainlines(),
    ])

    const ignoredCount = parsedStudies.length - studiesToSync.length
    setResetNotice(
      `Synced ${studiesToSync.length} Lichess stud${studiesToSync.length === 1 ? 'y' : 'ies'} from ${account.username}.` +
      (ignoredCount > 0 ? ` Ignored ${ignoredCount} stud${ignoredCount === 1 ? 'y' : 'ies'} starting with '/'.` : '')
    )
  }

  async function handleSyncWithLichess() {
    if (lichessSyncing) return
    setLichessSyncing(true)
    setError(null)

    try {
      const existingToken = loadLichessToken()
      if (!existingToken) {
        await beginLichessOAuthLoginAndSync()
        return
      }

      await runLichessSync(existingToken)
      setSyncStatus('ok')
      setSyncError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setSyncStatus('error')
      setSyncError(message)
    } finally {
      setLichessSyncing(false)
    }
  }

  function startLichessSyncFromToken(accessToken: string) {
    setLichessSyncing(true)
    runLichessSync(accessToken)
      .then(() => {
        setSyncStatus('ok')
        setSyncError(null)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('expired')) {
          clearLichessToken()
        }
        setError(message)
        setSyncStatus('error')
        setSyncError(message)
      })
      .finally(() => setLichessSyncing(false))
  }

  useEffect(() => {
    completeLichessOAuthFromUrl()
      .then(result => {
        if (result?.shouldSync) {
          startLichessSyncFromToken(result.accessToken)
          return
        }

        const existingToken = loadLichessToken()
        if (!existingToken) return
        startLichessSyncFromToken(existingToken)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      })
  }, [])

  function requestDeleteStudy(id: string) {
    const study = storedStudies.find(item => item.id === id)
    const studyName = study?.name ?? 'this study'

    setConfirmDialog({
      title: 'Delete study?',
      message: `This will permanently delete "${studyName}" and all its chapters.`,
      confirmLabel: 'Delete study',
      action: () => {
        setStoredStudies(deleteStudy(id))
        Promise.all([deleteStudyRemote(id, study?.name), uploadScores(), uploadForkMainlines()])
          .then(() => {
            setSyncStatus('ok')
            setSyncError(null)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error('[sync] delete study sync failed:', err)
            setSyncStatus('error')
            setSyncError(message)
          })
      },
    })
  }

  function requestDeleteChapter(studyId: string, chapterIndex: number) {
    const study = storedStudies.find(item => item.id === studyId)
    const chapter = study?.chapters[chapterIndex]
    const chapterName = chapter?.title ?? 'this chapter'
    const studyName = study?.name ?? 'this study'

    setConfirmDialog({
      title: 'Delete chapter?',
      message: `This will permanently delete "${chapterName}" from "${studyName}".`,
      confirmLabel: 'Delete chapter',
      action: () => {
        const updated = deleteChapter(studyId, chapterIndex)
        setStoredStudies(updated)

        const updatedStudy = updated.find(item => item.id === studyId)
        const studyOp = updatedStudy ? uploadStudy(updatedStudy) : deleteStudyRemote(studyId, study?.name)
        Promise.all([studyOp, uploadScores(), uploadForkMainlines()])
          .then(() => {
            setSyncStatus('ok')
            setSyncError(null)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error('[sync] delete chapter sync failed:', err)
            setSyncStatus('error')
            setSyncError(message)
          })
      },
    })
  }

  function trainChapter(study: StoredStudy, chapterIndex: number) {
    const chapter = study.chapters[chapterIndex]
    const cid = chapterId(study.id, study.chapters, chapterIndex)

    const lines = extractLines(chapter)
    syncChapterLines(cid, new Set(lines.map(line => line.lineId)))
    lines.forEach(line => initScore(cid, line.lineId, line.displaySan))

    loadChapters(study.chapters, study.playerColor, study.id)
    setSelectedChapter(chapter)
    setQuizMode(true)
    resetTrainingProgress()
    setStatsKey(key => key + 1)
    setView('training')
  }

  function pickAndTrainNext() {
    if (storedStudies.length === 0) return

    const scores = loadScores()
    const now = Date.now()
    const allEntries: Array<{ study: StoredStudy; chapterIndex: number }> = []

    storedStudies.forEach(study => {
      study.chapters.forEach((_, chapterIndex) => {
        const cid = chapterId(study.id, study.chapters, chapterIndex)
        if (selectedChapterIds.size > 0 && !selectedChapterIds.has(cid)) return
        allEntries.push({ study, chapterIndex })
      })
    })

    if (allEntries.length === 0) return

    const dueEntries = allEntries.filter(({ study, chapterIndex }) => {
      const cid = chapterId(study.id, study.chapters, chapterIndex)
      return scores.some(score => score.chapterId === cid && new Date(score.dueDate).getTime() <= now)
    })

    const pool = dueEntries.length > 0 ? dueEntries : allEntries
    const picked = pool[Math.floor(Math.random() * pool.length)]
    trainChapter(picked.study, picked.chapterIndex)
  }

  function trainFromSelection() {
    if (selectedChapterIds.size === 0) return
    setSelectionMode(false)
    pickAndTrainNext()
  }

  function toggleChapter(cid: string) {
    setSelectedChapterIds(previous => {
      const next = new Set(previous)
      next.has(cid) ? next.delete(cid) : next.add(cid)
      return next
    })
  }

  function toggleStudy(study: StoredStudy) {
    const allIds = study.chapters.map((_, chapterIndex) => chapterId(study.id, study.chapters, chapterIndex))
    const allSelected = allIds.every(id => selectedChapterIds.has(id))

    setSelectedChapterIds(previous => {
      const next = new Set(previous)
      if (allSelected) allIds.forEach(id => next.delete(id))
      else allIds.forEach(id => next.add(id))
      return next
    })
  }

  function handleQuizMove(from: string, to: string): boolean {
    if (!quizMode || !selectedChapter || quizDone) return false

    if (inlineDetour) {
      const { detourLine, detourIndex, forkFen } = inlineDetour
      const fen = detourIndex === -1 ? forkFen : detourLine[detourIndex]?.fen
      if (!fen) return false

      const nextDetourIndex = nextPlayableDetourIndex(detourLine, detourIndex, fen)
      if (nextDetourIndex >= detourLine.length) return false

      const expected = detourLine[nextDetourIndex]
      const chess = new Chess(fen)
      const result = chess.move({ from, to, promotion: 'q' })
      if (!result) return false

      if (chess.fen() === expected.fen) {
        setQuizWrong(null)
        setInlineDetour(detour => (detour ? { ...detour, detourIndex: nextDetourIndex } : null))
        return true
      }

      detourWrongCountRef.current += 1
      setQuizWrong(expected.san)
      setWrongGuessTick(tick => tick + 1)
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
    setWrongGuessTick(tick => tick + 1)
    setRevealedAnswer(false)
    return false
  }

  function revealAnswer() {
    setRevealedAnswer(true)
    if (inlineDetour) {
      detourWrongCountRef.current = 99
    } else {
      const nextIndex = moveIndex + 1
      mainlineWrongCountRef.current.set(nextIndex, 99)
    }
  }

  function handleRepertoireGoHome() {
    setError(null)
    setResetNotice(null)
    setConflictWarnings([])
    setView('home')
  }

  return (
    <>
      {view === 'repertoire' && (
        <RepertoireView
          storedStudies={storedStudies}
          streak={streak}
          selectionMode={selectionMode}
          selectedChapterIds={selectedChapterIds}
          uploadColor={uploadColor}
          soundEnabled={soundEnabled}
          error={error}
          resetNotice={resetNotice}
          conflictWarnings={conflictWarnings}
          onGoHome={handleRepertoireGoHome}
          onTrainChapter={trainChapter}
          onDeleteStudy={requestDeleteStudy}
          onDeleteChapter={requestDeleteChapter}
          onToggleChapter={toggleChapter}
          onToggleStudy={toggleStudy}
          onEnterSelectionMode={() => setSelectionMode(true)}
          onCancelSelection={() => {
            setSelectionMode(false)
            setSelectedChapterIds(new Set())
          }}
          onTrainFromSelection={trainFromSelection}
          onSetUploadColor={setUploadColor}
          lichessSyncing={lichessSyncing}
          lichessUsername={lichessUsername}
          onSyncWithLichess={handleSyncWithLichess}
          onOpenUpload={() => fileInputRef.current?.click()}
          onFileChange={handleFileChange}
          onDismissConflicts={() => setConflictWarnings([])}
          onToggleSound={handleSoundToggle}
          fileInputRef={fileInputRef}
        />
      )}

      <div className={`app-main ${view === 'training' ? 'app-main-training' : 'app-main-home'}`}>
        {view === 'home' ? (
          <HomeView
            syncStatus={syncStatus}
            syncError={syncError}
            totalDue={totalDue}
            estimatedMinutes={estimatedMinutes}
            storedStudies={storedStudies}
            homeFen={homeFen}
            soundEnabled={soundEnabled}
            onTrainNow={pickAndTrainNext}
            onOpenRepertoire={() => setView('repertoire')}
          />
        ) : view === 'repertoire' ? (
          <></>
        ) : (
          <TrainingView
            selectedChapter={selectedChapter}
            storedStudies={storedStudies}
            selectedStudyId={selectedStudyId}
            quizMode={quizMode}
            quizDone={quizDone}
            quizWrong={quizWrong}
            wrongGuessTick={wrongGuessTick}
            revealedAnswer={revealedAnswer}
            inlineDetour={inlineDetour}
            moveIndex={moveIndex}
            mainline={mainline}
            currentFen={currentFen}
            soundEnabled={soundEnabled}
            activePlayerColor={activePlayerColor}
            boardResetKey={boardResetKey}
            branchForks={branchForks}
            showBranches={showBranches}
            onBackHome={() => {
              stopQuiz()
              setView('home')
            }}
            onMove={handleQuizMove}
            onToggleBranches={() => setShowBranches(show => !show)}
            onRevealAnswer={revealAnswer}
          />
        )}
      </div>

      {showStreakAnimation !== null && (
        <StreakAnimation
          streakDays={showStreakAnimation}
          onDone={() => setShowStreakAnimation(null)}
        />
      )}

      <ConfirmDialog
        state={confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          if (!confirmDialog) return
          confirmDialog.action()
          setConfirmDialog(null)
        }}
      />
    </>
  )
}

export default App
