import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import './App.css'
import ConfirmDialog, { type ConfirmDialogState } from './components/ConfirmDialog'
import StreakAnimation from './components/StreakAnimation'
import HomeView from './components/views/HomeView'
import RepertoireView from './components/views/RepertoireView'
import TrainingView from './components/views/TrainingView'
import { parseStudyWithWarnings, parseStudiesWithWarnings, type Chapter, extractForkMoves, extractLines } from './lib/pgn'
import {
  loadStudies,
  saveStudy,
  deleteStudy,
  deleteChapter,
  buildChapterIds,
  loadSoundEnabled,
  saveSoundEnabled,
  loadRepeatFailedVariationsEnabled,
  saveRepeatFailedVariationsEnabled,
  loadSpacedRepetitionIntensity,
  saveSpacedRepetitionIntensity,
  loadCommentsVisible,
  saveCommentsVisible,
  type StoredStudy,
  chapterId,
  legacyChapterId,
} from './lib/storage'
import {
  loadScores,
  recordReview,
  initScore,
  importAllScores,
  importForkMainlines,
  importReviewActivity,
  pruneStudyChapterIds,
  remapChapterIds,
  syncChapterLines,
  updateForkMainlines,
  findConflicts,
  type ConflictInfo,
  type ScoreRecord,
  getReviewStreak,
} from './lib/scores'
import {
  uploadStudy,
  deleteStudyRemote,
  uploadScores,
  uploadForkMainlines,
  uploadReviewActivity,
} from './lib/sync'
import {
  HOME_FENS,
  STARTING_FEN,
  findQuizStartMoveIndex,
  flattenLine,
  type FlatMove,
  type TrainingLine,
  type SidelineAttachment,
} from './lib/training'
import {
  exportLichessStudiesPgn,
  fetchLichessAccount,
} from './lib/lichess'
import {
  STREAK_SHOWN_KEY,
  VARIATION_COMPLETE_DELAY_MS,
  buildChapterTrainingLines,
  buildParseWarningMessage,
  collectChapterVariationDetails,
  chapterConflictMap,
  colorFromLichessStudyName,
  findScoreForLine,
  pickNextChapterForTraining,
  todayDayKey,
} from './lib/appHelpers'
import { useInitialSync } from './hooks/useInitialSync'
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation'
import { useLichessSync } from './hooks/useLichessSync'

type GlobalEntry = { line: TrainingLine; chapter: Chapter; study: StoredStudy; cid: string }

function App() {
  const MAX_QUEUE_SIZE = 10

  const fileInputRef = useRef<HTMLInputElement>(null)
  const wrongCountRef = useRef(0)
  const trainingQueueRef = useRef<TrainingLine[]>([])
  const globalQueueRef = useRef<GlobalEntry[]>([])
  const isGlobalSessionRef = useRef(false)
  const globalSessionDoneRef = useRef(false)

  const [view, setView] = useState<'home' | 'repertoire' | 'training'>('home')
  const [storedStudies, setStoredStudies] = useState<StoredStudy[]>(() => loadStudies())
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null)

  const [activeLine, setActiveLine] = useState<TrainingLine | null>(null)
  const [moveIndex, setMoveIndex] = useState(-1)
  const [quizMode, setQuizMode] = useState(false)
  const [quizDone, setQuizDone] = useState(false)
  const [quizWrong, setQuizWrong] = useState<string | null>(null)
  const [wrongGuessTick, setWrongGuessTick] = useState(0)
  const [revealedAnswer, setRevealedAnswer] = useState(false)
  const [trainingSessionKey, setTrainingSessionKey] = useState(0)
  const [isRetryingVariation, setIsRetryingVariation] = useState(false)
  const [boardResetKey, setBoardResetKey] = useState(0)
  const [parentLineState, setParentLineState] = useState<{ line: TrainingLine; moveIndex: number; wrongCount: number; sidelineStartFen: string } | null>(null)
  const [isSideline, setIsSideline] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [conflictWarnings, setConflictWarnings] = useState<ConflictInfo[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [trainingQueue, setTrainingQueue] = useState<TrainingLine[]>([])

  const [statsKey, setStatsKey] = useState(0)
  const [selectedRunPriority, setSelectedRunPriority] = useState<0 | 1 | 2 | null>(null)
  const [uploadColor, setUploadColor] = useState<'white' | 'black'>('white')
  const [activePlayerColor, setActivePlayerColor] = useState<'white' | 'black'>('white')
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(() => loadSoundEnabled())
  const [repeatFailedVariationsEnabled, setRepeatFailedVariationsEnabled] = useState(() => loadRepeatFailedVariationsEnabled())
  const [spacedRepetitionIntensity, setSpacedRepetitionIntensity] = useState<1 | 2 | 3 | 4 | 5>(() => loadSpacedRepetitionIntensity())
  const [commentsVisible, setCommentsVisible] = useState(() => loadCommentsVisible())
  const [homeFen] = useState(() => HOME_FENS[Math.floor(Math.random() * HOME_FENS.length)] ?? STARTING_FEN)
  const [showStreakAnimation, setShowStreakAnimation] = useState<number | null>(null)
  const [lichessUsername, setLichessUsername] = useState<string | null>(null)

  function resetTrainingProgress() {
    setActiveLine(null)
    setMoveIndex(-1)
    setQuizDone(false)
    setQuizWrong(null)
    setWrongGuessTick(0)
    setRevealedAnswer(false)
    setIsRetryingVariation(false)
    setParentLineState(null)
    setIsSideline(false)
    wrongCountRef.current = 0
    trainingQueueRef.current = []
    setTrainingQueue([])
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

  const migrateLegacyChapterIdsForStudies = useCallback((studiesToMigrate: StoredStudy[]): boolean => {
    const remap = new Map<string, string>()

    studiesToMigrate.forEach(study => {
      const nextChapterIds = buildChapterIds(study.id, study.chapters)
      study.chapters.forEach((_, chapterIndex) => {
        remap.set(legacyChapterId(study.id, chapterIndex), nextChapterIds[chapterIndex])
      })
    })

    return remapChapterIds(remap)
  }, [])

  function recordLineReview() {
    if (!selectedStudyId || !selectedChapter || !activeLine) return
    const chapterIndex = chapters.indexOf(selectedChapter)
    if (chapterIndex < 0) return

    const wrongs = wrongCountRef.current
    const quality: 0 | 1 | 2 | 3 | 4 | 5 = wrongs === 0 ? 5 : wrongs <= 2 ? 3 : 1
    recordReview(chapterId(selectedStudyId, chapters, chapterIndex), activeLine.lineId, activeLine.scoreDisplaySan, quality, spacedRepetitionIntensity)
    void persistReviewData()
  }

  function lineSortKey(lineId: string, cid: string, scores: ScoreRecord[]): { priority: number; dueAt: number } {
    const score = findScoreForLine(scores, cid, lineId)
    if (!score || !score.lastReviewedAt || score.interval <= 0) {
      return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
    }
    const dueAt = Date.parse(score.dueDate)
    if (Number.isNaN(dueAt)) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
    if (dueAt <= Date.now()) return { priority: 1, dueAt }
    return { priority: 2, dueAt }
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

  function handleRepeatFailedVariationsToggle() {
    setRepeatFailedVariationsEnabled(previous => {
      const next = !previous
      saveRepeatFailedVariationsEnabled(next)
      return next
    })
  }

  function handleSpacedRepetitionIntensityChange(value: number) {
    const clamped = Math.max(1, Math.min(5, Math.round(value))) as 1 | 2 | 3 | 4 | 5
    setSpacedRepetitionIntensity(clamped)
    saveSpacedRepetitionIntensity(clamped)
  }

  function handleCommentsVisibleToggle() {
    setCommentsVisible(previous => {
      const next = !previous
      saveCommentsVisible(next)
      return next
    })
  }

  function loadChapters(chaptersToLoad: Chapter[], playerColor: 'white' | 'black' = 'white', studyId?: string) {
    setChapters(chaptersToLoad)
    setSelectedChapter(chaptersToLoad[0] ?? null)
    setActivePlayerColor(playerColor)
    setSelectedStudyId(studyId ?? null)
    trainingQueueRef.current = []
    setTrainingQueue([])
    setError(null)
  }

  function stopQuiz() {
    isGlobalSessionRef.current = false
    globalSessionDoneRef.current = false
    globalQueueRef.current = []
    setQuizMode(false)
    resetTrainingProgress()
  }
  function startGlobalTrainingSession() {
    const scores = loadScores()
    const now = Date.now()
    const entries: GlobalEntry[] = []

    storedStudies.forEach(study => {
      study.chapters.forEach((chapter, chapterIndex) => {
        const cid = chapterId(study.id, study.chapters, chapterIndex)
        const chapterLines = extractLines(chapter, study.playerColor)
        syncChapterLines(cid, new Set(chapterLines.map(l => l.lineId)))
        chapterLines.forEach(l => initScore(cid, l.lineId, l.displaySan))
        const { lines: allLines, sidelineAlts } = buildChapterTrainingLines(chapter)
        const chapterScores = scores.filter(s => s.chapterId === cid)

        // Collect due main lines for this chapter
        const dueLines: TrainingLine[] = []
        for (const trainingLine of allLines) {
          const score = findScoreForLine(chapterScores, cid, trainingLine.lineId)
          const dueAt = score ? Date.parse(score.dueDate) : Number.NaN
          const isDue =
            !score ||
            !score.lastReviewedAt ||
            score.interval <= 0 ||
            (!Number.isNaN(dueAt) && dueAt <= now)
          if (isDue) {
            dueLines.push({ ...trainingLine, chapterTitle: chapter.title })
          }
        }

        // Attach due sidelines to their parent lines (mirrors per-chapter queue-build effect)
        if (sidelineAlts.length > 0) {
          const dueSidelines = sidelineAlts.filter(alt => {
            const score = findScoreForLine(chapterScores, cid, alt.lineId)
            if (!score || !score.lastReviewedAt || score.interval <= 0) return true
            const dueAt = Date.parse(score.dueDate)
            return !Number.isNaN(dueAt) && dueAt <= now
          })

          for (const alt of dueSidelines) {
            const forkMoveIndex = alt.pathFromStart.length
            const parent = dueLines.find(line => {
              if (line.line.length <= forkMoveIndex) return false
              const fenAtFork = forkMoveIndex === 0
                ? chapter.startFen
                : line.line[forkMoveIndex - 1]?.fen
              return fenAtFork === alt.forkFen
            })
            if (!parent) continue

            const sidelineMoves = flattenLine(alt.alternative)
            const attachment: SidelineAttachment = {
              forkMoveIndex,
              sidelineLine: {
                line: sidelineMoves,
                lineId: alt.lineId,
                label: alt.branchLabel,
                scoreDisplaySan: alt.alternative.san,
              },
            }
            if (!parent.sidelines) parent.sidelines = []
            parent.sidelines.push(attachment)
          }

          for (const line of dueLines) {
            if (line.sidelines) {
              line.sidelines.sort((a, b) => a.forkMoveIndex - b.forkMoveIndex)
            }
          }
        }

        for (const line of dueLines) {
          entries.push({ line, chapter, study, cid })
        }
      })
    })

    if (entries.length === 0) return

    entries.sort((a, b) => {
      const aKey = lineSortKey(a.line.lineId, a.cid, scores)
      const bKey = lineSortKey(b.line.lineId, b.cid, scores)
      if (aKey.priority !== bKey.priority) return aKey.priority - bKey.priority
      return aKey.dueAt - bKey.dueAt
    })

    isGlobalSessionRef.current = true
    globalSessionDoneRef.current = false
    const [first, ...rest] = entries
    globalQueueRef.current = rest

    const firstUserColor = first.study.playerColor === 'white' ? 'w' : 'b'
    setSelectedChapter(first.chapter)
    setSelectedStudyId(first.study.id)
    setChapters(first.study.chapters)
    setActivePlayerColor(first.study.playerColor)
    setSelectedRunPriority(null)
    setActiveLine(first.line)
    setMoveIndex(findQuizStartMoveIndex(first.chapter, first.line.line, firstUserColor, undefined, first.line.label))
    setQuizDone(false)
    setQuizWrong(null)
    setWrongGuessTick(0)
    setRevealedAnswer(false)
    setIsRetryingVariation(false)
    setParentLineState(null)
    setIsSideline(false)
    wrongCountRef.current = 0
    const queueLines = rest.map(e => e.line).slice(0, MAX_QUEUE_SIZE)
    trainingQueueRef.current = queueLines
    setTrainingQueue(queueLines)
    setStatsKey(k => k + 1)
    setQuizMode(true)
    setBoardResetKey(k => k + 1)
    setView('training')
  }

  useInitialSync({
    setSyncStatus,
    setSyncError,
    setStoredStudies,
    setStatsKey,
    migrateLegacyChapterIdsForStudies,
  })

  const userColor = useMemo(() => (activePlayerColor === 'white' ? 'w' : 'b'), [activePlayerColor])

  const mainline = useMemo<FlatMove[]>(() => {
    if (!selectedChapter) return []
    const line: FlatMove[] = []
    let nodes = selectedChapter.moves
    while (nodes.length > 0) {
      const node = nodes[0]
      line.push({ fen: node.fen, san: node.san, comment: node.comment, annotation: node.annotation })
      nodes = node.children
    }
    return line
  }, [selectedChapter])

  // Cache the expensive PGN tree walk — only recompute when studies or selection change, not on every score update
  const selectedChapterVariations = useMemo(() => {
    if (selectedChapterIds.size <= 1) return []

    const allSelectedEntries = storedStudies.flatMap(study =>
      study.chapters
        .map((chapter, chapterIndex) => ({
          study,
          chapter,
          chapterIndex,
          cid: chapterId(study.id, study.chapters, chapterIndex),
        }))
        .filter(entry => selectedChapterIds.has(entry.cid))
    )

    const ordered = allSelectedEntries.sort((left, right) => {
      const leftStudy = left.study.name.toLocaleLowerCase()
      const rightStudy = right.study.name.toLocaleLowerCase()
      if (leftStudy !== rightStudy) return leftStudy.localeCompare(rightStudy)

      const leftTitle = left.chapter.title.toLocaleLowerCase()
      const rightTitle = right.chapter.title.toLocaleLowerCase()
      if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle)

      return left.cid.localeCompare(right.cid)
    })

    return ordered.flatMap(entry => {
      const variationDetails = collectChapterVariationDetails(entry.chapter)
      return variationDetails.map(detail => ({
        lineId: detail.lineId,
        label: detail.branchLabel,
        chapterTitle: entry.chapter.title,
        cid: entry.cid,
        studyName: entry.study.name.toLocaleLowerCase(),
        chapterName: entry.chapter.title.toLocaleLowerCase(),
      }))
    })
  }, [selectedChapterIds, storedStudies])

  const queuePreviewItems = useMemo(() => {
    const scores = loadScores()
    const now = Date.now()
    const priorityOrder: Array<0 | 1 | 2> = [0, 1, 2]

    function linePriorityInfo(cid: string, lineId: string): { priority: 0 | 1 | 2; dueAt: number } {
      const score = findScoreForLine(scores, cid, lineId)
      if (!score || !score.lastReviewedAt || score.interval <= 0) {
        return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
      }
      const dueAt = Date.parse(score.dueDate)
      if (!Number.isNaN(dueAt) && dueAt <= now) return { priority: 1, dueAt }
      return { priority: 2, dueAt: Number.POSITIVE_INFINITY }
    }

    const baseItems = trainingQueue.slice(0, MAX_QUEUE_SIZE).map(item => ({
      label: item.label,
      chapterTitle: item.chapterTitle ?? selectedChapter?.title ?? '',
    }))

    if (selectedChapterIds.size <= 1 || baseItems.length >= MAX_QUEUE_SIZE) {
      return baseItems
    }

    if (selectedChapterVariations.length <= 0) return baseItems

    const projected = selectedChapterVariations.map(entry => {
      const priorityInfo = linePriorityInfo(entry.cid, entry.lineId)
      return {
        label: entry.label,
        chapterTitle: entry.chapterTitle,
        priority: priorityInfo.priority,
        dueAt: priorityInfo.dueAt,
        studyName: entry.studyName,
        chapterName: entry.chapterName,
      }
    })

    const orderRank = new Map(priorityOrder.map((priority, index) => [priority, index] as const))
    const orderedProjected = projected.sort((left, right) => {
      const leftRank = orderRank.get(left.priority) ?? Number.MAX_SAFE_INTEGER
      const rightRank = orderRank.get(right.priority) ?? Number.MAX_SAFE_INTEGER
      if (leftRank !== rightRank) return leftRank - rightRank
      if (left.priority === 1 && right.priority === 1 && left.dueAt !== right.dueAt) {
        return left.dueAt - right.dueAt
      }
      if (left.studyName !== right.studyName) return left.studyName.localeCompare(right.studyName)
      if (left.chapterName !== right.chapterName) return left.chapterName.localeCompare(right.chapterName)
      if (left.label !== right.label) return left.label.localeCompare(right.label)
      return 0
    })

    return orderedProjected.slice(0, MAX_QUEUE_SIZE).map(item => ({
      label: item.label,
      chapterTitle: item.chapterTitle,
    }))
  }, [trainingQueue, selectedChapterIds, selectedChapterVariations, statsKey, selectedChapter])

  const totalDue = useMemo(() => {
    const scores = loadScores()
    const now = Date.now()
    return scores.filter(score => new Date(score.dueDate).getTime() <= now).length
  }, [statsKey, storedStudies])

  const estimatedMinutes = useMemo(() => Math.ceil((totalDue * 45) / 60), [totalDue])
  const streak = useMemo(() => getReviewStreak(), [statsKey])

  useEffect(() => {
    if (isGlobalSessionRef.current) return
    resetTrainingProgress()
  }, [selectedChapter])

  // Build queue and start first line when quiz begins
  useEffect(() => {
    if (!quizMode || !selectedChapter) return
    if (isGlobalSessionRef.current) return

    const { lines: allLines, sidelineAlts } = buildChapterTrainingLines(selectedChapter)

    const chapterIndex = chapters.indexOf(selectedChapter)
    const cid = selectedStudyId && chapterIndex >= 0
      ? chapterId(selectedStudyId, chapters, chapterIndex)
      : null

    const allScores = loadScores()

    const filtered = (() => {
      if (!cid) return allLines

      const withPriority = allLines.map(line => ({
        line,
        sortKey: lineSortKey(line.lineId, cid, allScores),
      }))

      const allowedPriorities: number[] = selectedRunPriority === null
        ? [0, 1, 2]
        : selectedRunPriority === 0
          ? [0]
          : selectedRunPriority === 1
            ? [1]
            : [2]

      return allowedPriorities.flatMap(p =>
        withPriority
          .filter(entry => entry.sortKey.priority === p)
          .map(entry => entry.line)
      )
    })()

    // Attach due sidelines to parent lines
    if (cid && sidelineAlts.length > 0) {
      const now = Date.now()

      const dueSidelines = sidelineAlts.filter(alt => {
        const score = findScoreForLine(allScores, cid, alt.lineId)
        if (!score || !score.lastReviewedAt || score.interval <= 0) return true
        const dueAt = Date.parse(score.dueDate)
        return !Number.isNaN(dueAt) && dueAt <= now
      })

      for (const alt of dueSidelines) {
        const forkMoveIndex = alt.pathFromStart.length
        const parent = filtered.find(line => {
          if (line.line.length <= forkMoveIndex) return false
          // The FEN before the fork move must match the sideline's fork FEN
          const fenAtFork = forkMoveIndex === 0
            ? selectedChapter.startFen
            : line.line[forkMoveIndex - 1]?.fen
          return fenAtFork === alt.forkFen
        })
        if (!parent) continue

        const sidelineMoves = flattenLine(alt.alternative)
        const attachment: SidelineAttachment = {
          forkMoveIndex,
          sidelineLine: {
            line: sidelineMoves,
            lineId: alt.lineId,
            label: alt.branchLabel,
            scoreDisplaySan: alt.alternative.san,
          },
        }

        if (!parent.sidelines) parent.sidelines = []
        parent.sidelines.push(attachment)
      }

      // Sort sidelines on each parent by forkMoveIndex ascending
      for (const line of filtered) {
        if (line.sidelines) {
          line.sidelines.sort((a, b) => a.forkMoveIndex - b.forkMoveIndex)
        }
      }
    }

    if (filtered.length === 0) {
      setQuizDone(true)
      return
    }

    const [first, ...rest] = filtered
    setActiveLine(first)
    trainingQueueRef.current = rest.slice(0, MAX_QUEUE_SIZE)
    setTrainingQueue(rest.slice(0, MAX_QUEUE_SIZE))
    wrongCountRef.current = 0
    setParentLineState(null)
    setIsSideline(false)
    setMoveIndex(findQuizStartMoveIndex(selectedChapter, first.line, userColor, undefined, first.label))
    setBoardResetKey(key => key + 1)
  }, [quizMode, selectedChapter, selectedStudyId, selectedRunPriority, userColor, trainingSessionKey])

  useKeyboardNavigation({
    quizMode,
    maxMoveIndex: mainline.length - 1,
    setMoveIndex,
  })

  // The effective start FEN for the current active line
  const activeStartFen = isSideline && parentLineState
    ? parentLineState.sidelineStartFen
    : selectedChapter?.startFen ?? STARTING_FEN

  // Unified auto-advance: handles all lines (mainline and variations) the same way
  useEffect(() => {
    if (!quizMode || !selectedChapter || quizDone || !activeLine) return

    const { line } = activeLine
    const fen = moveIndex === -1 ? activeStartFen : line[moveIndex]?.fen
    if (!fen) return

    const nextIndex = moveIndex + 1

    // Check for sideline interruption at the fork point
    if (!isSideline && activeLine.sidelines?.length) {
      const nextSideline = activeLine.sidelines.find(s => s.forkMoveIndex === nextIndex)
      if (nextSideline) {
        const timeout = setTimeout(() => {
          const remainingSidelines = activeLine.sidelines!.filter(s => s !== nextSideline)
          const updatedParent: TrainingLine = { ...activeLine, sidelines: remainingSidelines.length > 0 ? remainingSidelines : undefined }
          setParentLineState({
            line: updatedParent,
            moveIndex,
            wrongCount: wrongCountRef.current,
            sidelineStartFen: fen,
          })
          setActiveLine(nextSideline.sidelineLine)
          setIsSideline(true)
          wrongCountRef.current = 0
          setQuizWrong(null)
          setRevealedAnswer(false)
          setMoveIndex(-1)
          setBoardResetKey(key => key + 1)
        }, 500)
        return () => clearTimeout(timeout)
      }
    }

    // Current line complete?
    if (nextIndex >= line.length) {
      recordLineReview()

      if (repeatFailedVariationsEnabled && wrongCountRef.current > 0) {
        const timeout = setTimeout(() => {
          setQuizWrong(null)
          setRevealedAnswer(false)
          setIsRetryingVariation(true)
          wrongCountRef.current = 0
          setMoveIndex(isSideline ? -1 : findQuizStartMoveIndex(selectedChapter, line, userColor, undefined, activeLine.label))
          setBoardResetKey(key => key + 1)
        }, VARIATION_COMPLETE_DELAY_MS)
        return () => clearTimeout(timeout)
      }

      // If this was a sideline, return to parent
      if (parentLineState) {
        const timeout = setTimeout(() => {
          setQuizWrong(null)
          setRevealedAnswer(false)
          setIsRetryingVariation(false)
          setActiveLine(parentLineState.line)
          setMoveIndex(parentLineState.moveIndex)
          wrongCountRef.current = parentLineState.wrongCount
          setParentLineState(null)
          setIsSideline(false)
          setBoardResetKey(key => key + 1)
        }, VARIATION_COMPLETE_DELAY_MS)
        return () => clearTimeout(timeout)
      }

      const timeout = setTimeout(() => {
        setQuizWrong(null)
        setRevealedAnswer(false)
        setIsRetryingVariation(false)
        wrongCountRef.current = 0

        if (isGlobalSessionRef.current) {
          const nextEntry = globalQueueRef.current[0]
          if (!nextEntry) {
            isGlobalSessionRef.current = false
            globalSessionDoneRef.current = true
            setQuizDone(true)
            return
          }
          globalQueueRef.current = globalQueueRef.current.slice(1)
          const queueLines = globalQueueRef.current.map(e => e.line).slice(0, MAX_QUEUE_SIZE)
          trainingQueueRef.current = queueLines
          setTrainingQueue(queueLines)
          if (nextEntry.chapter !== selectedChapter) {
            setSelectedChapter(nextEntry.chapter)
            setSelectedStudyId(nextEntry.study.id)
            setChapters(nextEntry.study.chapters)
            setActivePlayerColor(nextEntry.study.playerColor)
          }
          const nextUserColor = nextEntry.study.playerColor === 'white' ? 'w' : 'b'
          setActiveLine(nextEntry.line)
          setMoveIndex(findQuizStartMoveIndex(nextEntry.chapter, nextEntry.line.line, nextUserColor, undefined, nextEntry.line.label))
          setBoardResetKey(key => key + 1)
          return
        }
        const next = trainingQueueRef.current[0]
        if (!next) {
          setQuizDone(true)
          return
        }
        trainingQueueRef.current = trainingQueueRef.current.slice(1)
        setTrainingQueue(trainingQueueRef.current)
        setActiveLine(next)
        setMoveIndex(findQuizStartMoveIndex(selectedChapter, next.line, userColor, undefined, next.label))
        setBoardResetKey(key => key + 1)
      }, VARIATION_COMPLETE_DELAY_MS)
      return () => clearTimeout(timeout)
    }

    // Auto-advance opponent's move
    const colorToMove = fen.split(' ')[1] as 'w' | 'b'
    if (colorToMove !== userColor) {
      const timeout = setTimeout(() => {
        setMoveIndex(nextIndex)
        setQuizWrong(null)
      }, 700)
      return () => clearTimeout(timeout)
    }
  }, [quizMode, moveIndex, selectedChapter, userColor, quizDone, activeLine, selectedStudyId, chapters, repeatFailedVariationsEnabled, spacedRepetitionIntensity, isRetryingVariation, isSideline, parentLineState, activeStartFen])

  useEffect(() => {
    if (!quizDone) return
    maybeFireDailyChapterStreakAnimation()
    if (globalSessionDoneRef.current) {
      globalSessionDoneRef.current = false
      return
    }
    const timeout = setTimeout(() => pickAndTrainNext(), 500)
    return () => clearTimeout(timeout)
  }, [quizDone])

  const currentFen = activeLine && quizMode
    ? (moveIndex === -1 ? activeStartFen : activeLine.line[moveIndex]?.fen)
    : (moveIndex === -1 ? selectedChapter?.startFen : mainline[moveIndex]?.fen)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = loaded => {
      try {
        const pgn = loaded.target?.result as string
        const { name: parsedName, chapters: parsedChapters, warnings } = parseStudyWithWarnings(pgn)
        const studyName = parsedName ?? file.name.replace(/\.pgn$/i, '')
        const imported = importSingleStudy(studyName, parsedChapters, uploadColor)

        const warningMessage = buildParseWarningMessage(warnings.map(warning => warning.message))
        if (warningMessage) {
          setError(warningMessage)
        }

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

  const importSingleStudy = useCallback((studyName: string, parsedChapters: Chapter[], playerColor: 'white' | 'black'): { stored: StoredStudy } => {
    const stored = saveStudy(studyName, playerColor, parsedChapters)
    migrateLegacyChapterIdsForStudies([stored])

    pruneStudyChapterIds(stored.id, new Set(buildChapterIds(stored.id, stored.chapters)))
    stored.chapters.forEach((chapter, chapterIndex) => {
      const cid = chapterId(stored.id, stored.chapters, chapterIndex)
      const lines = extractLines(chapter, stored.playerColor)
      syncChapterLines(cid, new Set(lines.map(line => line.lineId)))
      updateForkMainlines(cid, extractForkMoves(chapter))
    })

    const allStudies = loadStudies()
    setConflictWarnings(findConflicts(chapterConflictMap(allStudies)))
    setStoredStudies(allStudies)

    return { stored }
  }, [migrateLegacyChapterIdsForStudies])

  const runLichessSync = useCallback(async (accessToken: string): Promise<void> => {
    const account = await fetchLichessAccount(accessToken)
    setLichessUsername(account.username)

    const exportPgn = await exportLichessStudiesPgn(accessToken, account.username)
    const parsed = parseStudiesWithWarnings(exportPgn)
    const parsedStudies = parsed.studies
    const studiesToSync = parsedStudies
      .filter(study => !study.name.startsWith('/'))
      .map(study => ({
        ...study,
        chapters: study.chapters.filter(chapter => !chapter.title.trimStart().startsWith('***')),
      }))
      .filter(study => study.chapters.length > 0)

    const warningMessage = buildParseWarningMessage(parsed.warnings.map(warning => warning.message))
    if (warningMessage) {
      setError(warningMessage)
    }

    if (parsedStudies.length === 0) {
      return
    }

    if (studiesToSync.length === 0) {
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
  }, [importSingleStudy])

  const { lichessSyncing, handleSyncWithLichess } = useLichessSync({
    runLichessSync,
    setError,
    setSyncStatus,
    setSyncError,
  })

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

  function trainChapter(study: StoredStudy, chapterIndex: number, runPriority: 0 | 1 | 2 | null = null) {
    const chapter = study.chapters[chapterIndex]
    const cid = chapterId(study.id, study.chapters, chapterIndex)

    const lines = extractLines(chapter, study.playerColor)
    syncChapterLines(cid, new Set(lines.map(line => line.lineId)))
    lines.forEach(line => initScore(cid, line.lineId, line.displaySan))

    loadChapters(study.chapters, study.playerColor, study.id)
    setSelectedChapter(chapter)
    setSelectedRunPriority(runPriority)
    setTrainingSessionKey(key => key + 1)
    setQuizMode(true)
    resetTrainingProgress()
    setStatsKey(key => key + 1)
    setView('training')
  }

  function pickAndTrainNext(chapterIdsOverride?: Set<string>) {
    const picked = pickNextChapterForTraining(
      storedStudies,
      chapterIdsOverride ?? selectedChapterIds,
      Date.now(),
      loadScores(),
    )
    if (!picked) return
    trainChapter(picked.study, picked.chapterIndex, picked.priority)
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
    if (!quizMode || !selectedChapter || quizDone || !activeLine) return false

    const { line } = activeLine
    const fen = moveIndex === -1 ? activeStartFen : line[moveIndex]?.fen
    if (!fen) return false

    const nextIndex = moveIndex + 1
    if (nextIndex >= line.length) return false

    const expected = line[nextIndex]
    const chess = new Chess(fen)
    const result = chess.move({ from, to, promotion: 'q' })
    if (!result) return false

    if (chess.fen() === expected.fen) {
      setQuizWrong(null)
      setRevealedAnswer(false)
      setMoveIndex(nextIndex)
      return true
    }

    wrongCountRef.current += 1
    setQuizWrong(expected.san)
    setWrongGuessTick(tick => tick + 1)
    setRevealedAnswer(false)
    return false
  }

  function revealAnswer() {
    setRevealedAnswer(true)
    wrongCountRef.current = 99
  }

  function skipCurrentLine() {
    if (!activeLine || !selectedChapter || !selectedStudyId) return

    const chapterIndex = chapters.indexOf(selectedChapter)
    if (chapterIndex < 0) return

    // Record as failed
    recordReview(
      chapterId(selectedStudyId, chapters, chapterIndex),
      activeLine.lineId,
      activeLine.scoreDisplaySan,
      1,
      spacedRepetitionIntensity
    )
    void persistReviewData()

    setQuizWrong(null)
    setRevealedAnswer(false)
    setIsRetryingVariation(false)
    wrongCountRef.current = 0

    // If skipping a sideline, return to parent
    if (parentLineState) {
      setActiveLine(parentLineState.line)
      setMoveIndex(parentLineState.moveIndex)
      wrongCountRef.current = parentLineState.wrongCount
      setParentLineState(null)
      setIsSideline(false)
      setBoardResetKey(key => key + 1)
      return
    }

    const next = trainingQueueRef.current[0]
    if (!next) {
      setQuizDone(true)
      return
    }
    trainingQueueRef.current = trainingQueueRef.current.slice(1)
    setTrainingQueue(trainingQueueRef.current)
    setActiveLine(next)
    setMoveIndex(findQuizStartMoveIndex(selectedChapter, next.line, userColor, undefined, next.label))
    setBoardResetKey(key => key + 1)
  }

  function handleRepertoireGoHome() {
    setError(null)
    setConflictWarnings([])
    setView('home')
  }

  function requestResetScores() {
    setConfirmDialog({
      title: 'Reset all scores?',
      message: 'This will permanently clear all review scores, due dates, streak activity, and variation retry data for every chapter.',
      confirmLabel: 'Reset scores',
      action: () => {
        importAllScores([])
        importForkMainlines([])
        importReviewActivity([])
        setStatsKey(key => key + 1)

        Promise.all([uploadScores(), uploadForkMainlines(), uploadReviewActivity()])
          .then(() => {
            setSyncStatus('ok')
            setSyncError(null)
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error('[sync] reset scores sync failed:', err)
            setSyncStatus('error')
            setSyncError(message)
          })
      },
    })
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
          repeatFailedVariationsEnabled={repeatFailedVariationsEnabled}
          spacedRepetitionIntensity={spacedRepetitionIntensity}
          commentsVisible={commentsVisible}
          error={error}
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
          onToggleRepeatFailedVariations={handleRepeatFailedVariationsToggle}
          onSetSpacedRepetitionIntensity={handleSpacedRepetitionIntensityChange}
          onToggleCommentsVisible={handleCommentsVisibleToggle}
          onRequestResetScores={requestResetScores}
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
            onTrainNow={startGlobalTrainingSession}
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
            isRetryingVariation={isRetryingVariation}
            isSideline={isSideline}
            activeLine={activeLine}
            moveIndex={moveIndex}
            currentFen={currentFen}
            soundEnabled={soundEnabled}
            commentsVisible={commentsVisible}
            activePlayerColor={activePlayerColor}
            boardResetKey={boardResetKey}
            queuePreview={queuePreviewItems}
            onBackHome={() => {
              stopQuiz()
              setView('home')
            }}
            onMove={handleQuizMove}
            onRevealAnswer={revealAnswer}
            onSkipCurrentLine={skipCurrentLine}
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
