import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import './App.css'
import ConfirmDialog, { type ConfirmDialogState } from './components/ConfirmDialog'
import StreakAnimation from './components/StreakAnimation'
import HomeView from './components/views/HomeView'
import RepertoireView from './components/views/RepertoireView'
import TrainingView from './components/views/TrainingView'
import { parseStudyWithWarnings, parseStudiesWithWarnings, type Chapter, type MoveNode, extractForkMoves, extractLines, mainlineLineId, variationLineId } from './lib/pgn'
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
  flattenDetour,
  type FlatMove,
  nextPlayableDetourIndex,
  type InlineDetour,
  type MainlineMove,
} from './lib/training'
import {
  exportLichessStudiesPgn,
  fetchLichessAccount,
} from './lib/lichess'
import {
  STREAK_SHOWN_KEY,
  VARIATION_COMPLETE_DELAY_MS,
  buildParseWarningMessage,
  buildVariationSessionSequence,
  collectChapterForkAlternatives,
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

function App() {
  type SessionVariationQueueVariationItem = {
    kind: 'variation'
    forkMainlineIndex: number
    startFen: string
    forkFen: string
    scoreFirstSan: string
    leadInLine: FlatMove[]
    pendingInlines: MoveNode[]
    detourLine: FlatMove[]
    isIndependent: boolean
    label: string
  }

  type SessionVariationQueueMainlineItem = {
    kind: 'mainline'
    forkMainlineIndex: number
    label: string
  }

  type SessionVariationQueueItem = SessionVariationQueueVariationItem | SessionVariationQueueMainlineItem

  const fileInputRef = useRef<HTMLInputElement>(null)
  const detourWrongCountRef = useRef(0)
  const mainlineWrongCountRef = useRef<Map<number, number>>(new Map())
  const activeVariationScoreRef = useRef<{ forkFen: string; firstSan: string } | null>(null)
  const activeVariationLeadInRef = useRef<FlatMove[]>([])

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
  const [trainingSessionKey, setTrainingSessionKey] = useState(0)
  const [inlineDetour, setInlineDetour] = useState<InlineDetour | null>(null)
  const [isRetryingVariation, setIsRetryingVariation] = useState(false)
  const [boardResetKey, setBoardResetKey] = useState(0)

  const [error, setError] = useState<string | null>(null)
  const [conflictWarnings, setConflictWarnings] = useState<ConflictInfo[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set())
  const [sessionVariationQueue, setSessionVariationQueue] = useState<SessionVariationQueueItem[]>([])

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
    setMoveIndex(-1)
    setQuizDone(false)
    setQuizWrong(null)
    setWrongGuessTick(0)
    setRevealedAnswer(false)
    setInlineDetour(null)
    setIsRetryingVariation(false)
    activeVariationScoreRef.current = null
    activeVariationLeadInRef.current = []
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

  function recordMainlineReview() {
    if (!selectedStudyId || !selectedChapter) return
    const chapterIndex = chapters.indexOf(selectedChapter)
    if (chapterIndex < 0) return

    const leaf = mainline[mainline.length - 1]
    if (!leaf) return

    const totalWrongs = [...mainlineWrongCountRef.current.values()].reduce((acc, value) => acc + value, 0)
    const quality: 0 | 1 | 2 | 3 | 4 | 5 = totalWrongs === 0 ? 5 : totalWrongs <= 2 ? 3 : 1
    recordReview(chapterId(selectedStudyId, chapters, chapterIndex), mainlineLineId(leaf.fen), 'Main line', quality, spacedRepetitionIntensity)
    void persistReviewData()
  }

  function alternativeSortKey(studyId: string, chapter: Chapter, forkFen: string, alternative: MoveNode): { priority: number; dueAt: number } {
    const chapterIndex = chapters.indexOf(chapter)
    if (chapterIndex < 0) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }

    const cid = chapterId(studyId, chapters, chapterIndex)
    const detourLine = flattenDetour(alternative)
    const lineLeafFen = detourLine.at(-1)?.fen
    if (!lineLeafFen) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }

    const lineId = variationLineId(forkFen, alternative.san, lineLeafFen)
    const score = findScoreForLine(loadScores(), cid, lineId)
    if (!score || !score.lastReviewedAt || score.interval <= 0) {
      return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
    }

    const dueAt = Date.parse(score.dueDate)
    if (Number.isNaN(dueAt)) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
    if (dueAt <= Date.now()) return { priority: 1, dueAt }

    return { priority: 2, dueAt }
  }

  function mainlineSortKey(studyId: string, chapter: Chapter): { priority: number; dueAt: number } {
    const chapterIndex = chapters.indexOf(chapter)
    if (chapterIndex < 0) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }

    const leaf = mainline[mainline.length - 1]
    if (!leaf) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }

    const cid = chapterId(studyId, chapters, chapterIndex)
    const score = findScoreForLine(loadScores(), cid, mainlineLineId(leaf.fen))
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
    setSessionVariationQueue([])
    setError(null)
  }

  function stopQuiz() {
    setQuizMode(false)
    resetTrainingProgress()
  }
  useInitialSync({
    setSyncStatus,
    setSyncError,
    setStoredStudies,
    setStatsKey,
    migrateLegacyChapterIdsForStudies,
  })

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
  }, [quizMode, selectedChapter, mainline, userColor, trainingSessionKey])

  useEffect(() => {
    if (!quizMode || !selectedChapter) return
    const chapterForQueue = selectedChapter
    const quizStartIndex = findQuizStartMoveIndex(chapterForQueue, mainline, userColor)
    const sessionStartPly = quizStartIndex + 1
    const sessionStartFen = quizStartIndex === -1
      ? chapterForQueue.startFen
      : (mainline[quizStartIndex]?.fen ?? chapterForQueue.startFen)

    const queue: SessionVariationQueueItem[] = []

    const forkAlternatives = collectChapterForkAlternatives(chapterForQueue)
    const alternativesByLineId = new Map<string, typeof forkAlternatives>()
    forkAlternatives.forEach(item => {
      const list = alternativesByLineId.get(item.lineId) ?? []
      list.push(item)
      alternativesByLineId.set(item.lineId, list)
    })

    const repertoireOrdered = collectChapterVariationDetails(chapterForQueue)
      .filter(item => item.type !== 'main')

    const orderedAlternatives = repertoireOrdered.flatMap(detail => {
      const list = alternativesByLineId.get(detail.lineId)
      if (!list || list.length === 0) return []
      const next = list[0]
      alternativesByLineId.set(detail.lineId, list.slice(1))
      return [next]
    })

    const filteredAlternatives = selectedStudyId
      ? orderedAlternatives
        .map(item => ({
          item,
          sortKey: alternativeSortKey(selectedStudyId, chapterForQueue, item.forkFen, item.alternative),
        }))
        .filter(entry => selectedRunPriority === null || entry.sortKey.priority === selectedRunPriority)
        .map(entry => entry.item)
      : orderedAlternatives

    const groupedByFork = new Map<string, typeof filteredAlternatives>()
    filteredAlternatives.forEach(item => {
      const pathKey = item.pathFromStart.map(move => move.fen).join('|')
      const key = `${item.forkFen}::${item.forkMainlineIndex}::${pathKey}`
      const list = groupedByFork.get(key) ?? []
      list.push(item)
      groupedByFork.set(key, list)
    })

    groupedByFork.forEach(group => {
      if (group.length === 0) return

      const orderedRoots = buildVariationSessionSequence(group.map(entry => entry.alternative))
      const orderedEntries = orderedRoots
        .map(root => group.find(entry => entry.alternative === root))
        .filter((entry): entry is (typeof group)[number] => Boolean(entry))

      const firstEntry = orderedEntries[0]
      if (!firstEntry) return

      const leadInLine = firstEntry.pathFromStart.slice(sessionStartPly)
      queue.push({
        kind: 'variation',
        forkMainlineIndex: firstEntry.forkMainlineIndex,
        startFen: sessionStartFen,
        forkFen: firstEntry.forkFen,
        scoreFirstSan: firstEntry.alternative.san,
        leadInLine,
        pendingInlines: orderedEntries.slice(1).map(entry => entry.alternative),
        detourLine: flattenDetour(firstEntry.alternative),
        isIndependent: firstEntry.type === 'independent',
        label: firstEntry.alternative.san,
      })
    })

    if (selectedStudyId) {
      const mainSortKey = mainlineSortKey(selectedStudyId, chapterForQueue)
      if (selectedRunPriority === null || mainSortKey.priority === selectedRunPriority) {
        queue.push({
          kind: 'mainline',
          forkMainlineIndex: 0,
          label: 'Main line',
        })
      }
    } else {
      queue.push({
        kind: 'mainline',
        forkMainlineIndex: 0,
        label: 'Main line',
      })
    }

    setSessionVariationQueue(queue)
  }, [quizMode, selectedChapter, selectedStudyId, selectedRunPriority, mainline, userColor])

  useKeyboardNavigation({
    quizMode,
    maxMoveIndex: mainline.length - 1,
    setMoveIndex,
  })

  useEffect(() => {
    if (!quizMode || !selectedChapter || quizDone) return

    if (inlineDetour) {
      const { detourLine, detourIndex, forkFen, pendingInlines, forkMainlineIndex, isIndependent } = inlineDetour
      const detourFen = detourIndex === -1 ? forkFen : detourLine[detourIndex]?.fen
      if (!detourFen) return

      const nextDetourIndex = nextPlayableDetourIndex(detourLine, detourIndex, detourFen)
      if (nextDetourIndex >= detourLine.length) {
        const wrongs = detourWrongCountRef.current
        const quality: 0 | 1 | 2 | 3 | 4 | 5 = wrongs === 0 ? 5 : wrongs === 1 ? 3 : 1

        if (repeatFailedVariationsEnabled && wrongs > 0 && !isRetryingVariation) {
          const timeout = setTimeout(() => {
            setQuizWrong(null)
            setRevealedAnswer(false)
            setBoardResetKey(key => key + 1)
            setIsRetryingVariation(true)
            setInlineDetour({
              forkFen,
              labelForkFen: inlineDetour.labelForkFen,
              labelSan: inlineDetour.labelSan,
              forkMainlineIndex,
              pendingInlines,
              detourLine,
              detourIndex: -1,
              isIndependent,
            })
          }, VARIATION_COMPLETE_DELAY_MS)

          return () => clearTimeout(timeout)
        }

        if (selectedStudyId && selectedChapter) {
          const chapterIndex = chapters.indexOf(selectedChapter)
          const detourLeaf = detourLine[detourLine.length - 1]
          const scoreMeta = activeVariationScoreRef.current
          const scoreForkFen = scoreMeta?.forkFen ?? forkFen
          const scoreFirstSan = scoreMeta?.firstSan ?? detourLine[0].san
          recordReview(
            chapterId(selectedStudyId, chapters, chapterIndex),
            variationLineId(scoreForkFen, scoreFirstSan, detourLeaf.fen),
            scoreFirstSan,
            quality,
            spacedRepetitionIntensity
          )
          void persistReviewData()
        }

        const timeout = setTimeout(() => {
          setQuizWrong(null)
          setRevealedAnswer(false)
          setBoardResetKey(key => key + 1)

          if (pendingInlines.length > 0) {
            const nextRoot = pendingInlines[0]
            if (!nextRoot) return
            detourWrongCountRef.current = 0
            setIsRetryingVariation(false)
            setInlineDetour({
              forkFen,
              labelForkFen: inlineDetour.labelForkFen,
              labelSan: nextRoot.san,
              forkMainlineIndex,
              pendingInlines: pendingInlines.slice(1),
              detourLine: [...activeVariationLeadInRef.current, ...flattenDetour(nextRoot)],
              detourIndex: -1,
              isIndependent: Boolean(nextRoot.independent),
            })
            const currentScoreMeta = activeVariationScoreRef.current
            if (currentScoreMeta) {
              activeVariationScoreRef.current = {
                forkFen: currentScoreMeta.forkFen,
                firstSan: nextRoot.san,
              }
            }
          } else {
            detourWrongCountRef.current = 0
            setIsRetryingVariation(false)
            setInlineDetour(null)
            activeVariationScoreRef.current = null
            activeVariationLeadInRef.current = []
          }
        }, VARIATION_COMPLETE_DELAY_MS)

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

    if (sessionVariationQueue.length > 0) {
      const queued = sessionVariationQueue[0]
      if (!queued) return
      if (queued.kind === 'mainline') {
        setSessionVariationQueue(previous => previous.slice(1))
        return
      }
      setSessionVariationQueue(previous => previous.slice(1))
      activeVariationScoreRef.current = {
        forkFen: queued.forkFen,
        firstSan: queued.scoreFirstSan,
      }
      activeVariationLeadInRef.current = queued.leadInLine
      setInlineDetour({
        forkFen: queued.startFen,
        labelForkFen: queued.forkFen,
        labelSan: queued.scoreFirstSan,
        forkMainlineIndex: queued.forkMainlineIndex,
        pendingInlines: queued.pendingInlines,
        detourLine: [...queued.leadInLine, ...queued.detourLine],
        detourIndex: -1,
        isIndependent: queued.isIndependent,
      })
      detourWrongCountRef.current = 0
      setIsRetryingVariation(false)
      setMoveIndex(findQuizStartMoveIndex(selectedChapter, mainline, userColor))
      setBoardResetKey(key => key + 1)
      return
    }

    const nextIndex = moveIndex + 1
    if (nextIndex >= mainline.length) {
      recordMainlineReview()
      setIsRetryingVariation(false)
      setQuizDone(true)
      return
    }

    const colorToMove = fen.split(' ')[1] as 'w' | 'b'
    if (colorToMove !== userColor) {
      const timeout = setTimeout(() => {
        setMoveIndex(nextIndex)
        setQuizWrong(null)
      }, 700)
      return () => clearTimeout(timeout)
    }
  }, [quizMode, moveIndex, selectedChapter, userColor, mainline, quizDone, inlineDetour, selectedStudyId, chapters, repeatFailedVariationsEnabled, spacedRepetitionIntensity, isRetryingVariation, selectedRunPriority, sessionVariationQueue])

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

  function pickAndTrainNext() {
    const picked = pickNextChapterForTraining(storedStudies, selectedChapterIds, Date.now(), loadScores())
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

  function skipCurrentVariation() {
    if (!inlineDetour || !selectedChapter || !selectedStudyId) return

    const chapterIndex = chapters.indexOf(selectedChapter)
    if (chapterIndex < 0) return

    setQuizWrong(null)
    setRevealedAnswer(false)

    const detourLeaf = inlineDetour.detourLine[inlineDetour.detourLine.length - 1]
    if (!detourLeaf) return
    const scoreMeta = activeVariationScoreRef.current
    const scoreForkFen = scoreMeta?.forkFen ?? inlineDetour.forkFen
    const scoreFirstSan = scoreMeta?.firstSan ?? inlineDetour.detourLine[0].san

    recordReview(
      chapterId(selectedStudyId, chapters, chapterIndex),
      variationLineId(scoreForkFen, scoreFirstSan, detourLeaf.fen),
      scoreFirstSan,
      1,
      spacedRepetitionIntensity
    )
    void persistReviewData()

    const nextRoot = inlineDetour.pendingInlines[0]
    if (nextRoot) {
      detourWrongCountRef.current = 0
      setIsRetryingVariation(false)
      setInlineDetour({
        forkFen: inlineDetour.forkFen,
        labelForkFen: inlineDetour.labelForkFen,
        labelSan: nextRoot.san,
        forkMainlineIndex: inlineDetour.forkMainlineIndex,
        pendingInlines: inlineDetour.pendingInlines.slice(1),
        detourLine: [...activeVariationLeadInRef.current, ...flattenDetour(nextRoot)],
        detourIndex: -1,
        isIndependent: Boolean(nextRoot.independent),
      })
      if (scoreMeta) {
        activeVariationScoreRef.current = {
          forkFen: scoreMeta.forkFen,
          firstSan: nextRoot.san,
        }
      }
      setBoardResetKey(key => key + 1)
      return
    }

    detourWrongCountRef.current = 0
    setIsRetryingVariation(false)
    setInlineDetour(null)
    activeVariationScoreRef.current = null
    activeVariationLeadInRef.current = []
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
            isRetryingVariation={isRetryingVariation}
            moveIndex={moveIndex}
            mainline={mainline}
            currentFen={currentFen}
            soundEnabled={soundEnabled}
            commentsVisible={commentsVisible}
            activePlayerColor={activePlayerColor}
            boardResetKey={boardResetKey}
            queuePreview={sessionVariationQueue.slice(0, 5).map(item => ({
              label: item.label,
              forkMainlineIndex: item.forkMainlineIndex,
            }))}
            onBackHome={() => {
              stopQuiz()
              setView('home')
            }}
            onMove={handleQuizMove}
            onRevealAnswer={revealAnswer}
            onSkipCurrentVariation={skipCurrentVariation}
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
