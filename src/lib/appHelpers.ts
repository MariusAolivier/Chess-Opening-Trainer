import type { Chapter, MoveNode } from './pgn'
import { extractLines, mainlineLineId, variationLineId } from './pgn'
import type { ScoreRecord } from './scores'
import type { StoredStudy } from './storage'
import { chapterId } from './storage'
import type { FlatMove } from './training'

export const STREAK_SHOWN_KEY = 'chess-opening-trainer:streak-shown-day'
export const VARIATION_COMPLETE_DELAY_MS = 1000

export function todayDayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildParseWarningMessage(messages: string[]): string {
  if (messages.length === 0) return ''
  const unique = Array.from(new Set(messages))
  const preview = unique.slice(0, 3).join(' ')
  const more = unique.length > 3 ? ` (+${unique.length - 3} more)` : ''
  return `Warning: Deep variation nesting detected. ${preview}${more}`
}

export function buildDetourRetryId(forkMainlineIndex: number, detourLine: FlatMove[]): string {
  const firstSan = detourLine[0]?.san ?? ''
  const leafFen = detourLine[detourLine.length - 1]?.fen ?? ''
  return `${forkMainlineIndex}::${variationLineId('', firstSan, leafFen)}`
}

export type VariationType = 'main' | 'sideline' | 'independent'

export interface ChapterVariationDetail {
  lineId: string
  branchLabel: string
  type: VariationType
}

export interface ChapterForkAlternative {
  lineId: string
  branchLabel: string
  type: Exclude<VariationType, 'main'>
  forkFen: string
  forkMainlineIndex: number
  pathFromStart: FlatMove[]
  alternative: MoveNode
}

function formatBranchLabel(parentFen: string, san: string): string {
  const parts = parentFen.split(' ')
  const sideToMove = parts[1] as 'w' | 'b' | undefined
  const fullmove = Number.parseInt(parts[5] ?? '', 10)

  if (!Number.isFinite(fullmove) || fullmove <= 0) return san
  if (sideToMove === 'b') return `${fullmove}... ${san}`
  return `${fullmove}. ${san}`
}

function leafOnPrimaryPath(root: MoveNode): MoveNode {
  let node = root
  while (node.children.length > 0) {
    node = node.children[0]
  }
  return node
}

export function collectChapterForkAlternatives(chapter: Chapter): ChapterForkAlternative[] {
  const details: ChapterForkAlternative[] = []

  function walk(nodes: MoveNode[], parentFen: string, plyFromStart: number, pathFromStart: FlatMove[]) {
    if (nodes.length === 0) return

    for (let index = 1; index < nodes.length; index += 1) {
      const alternative = nodes[index]
      const leaf = leafOnPrimaryPath(alternative)
      details.push({
        lineId: variationLineId(parentFen, alternative.san, leaf.fen),
        branchLabel: formatBranchLabel(parentFen, alternative.san),
        type: alternative.independent ? 'independent' : 'sideline',
        forkFen: parentFen,
        forkMainlineIndex: Math.max(0, plyFromStart - 1),
        pathFromStart,
        alternative,
      })

      walk(alternative.children, alternative.fen, plyFromStart + 1, [
        ...pathFromStart,
        {
          fen: alternative.fen,
          san: alternative.san,
          comment: alternative.comment,
          annotation: alternative.annotation,
        },
      ])
    }

    const main = nodes[0]
    walk(main.children, main.fen, plyFromStart + 1, [
      ...pathFromStart,
      {
        fen: main.fen,
        san: main.san,
        comment: main.comment,
        annotation: main.annotation,
      },
    ])
  }

  const startColor = chapter.startFen.split(' ')[1] as 'w' | 'b'
  walk(chapter.moves, chapter.startFen, startColor === 'w' ? 1 : 2, [])

  return details
}

export function collectChapterVariationDetails(chapter: Chapter): ChapterVariationDetail[] {
  const details: ChapterVariationDetail[] = []

  const forkAlternatives = collectChapterForkAlternatives(chapter)
  forkAlternatives.forEach(item => {
    details.push({ lineId: item.lineId, branchLabel: item.branchLabel, type: item.type })
  })

  let nodes = chapter.moves
  let mainLeaf: MoveNode | null = null
  while (nodes.length > 0) {
    const main = nodes[0]
    mainLeaf = main
    nodes = main.children
  }

  if (mainLeaf) {
    details.push({ lineId: mainlineLineId(mainLeaf.fen), branchLabel: 'Main line', type: 'main' })
  }

  return details
}

export function buildVariationSessionSequence(roots: MoveNode[]): MoveNode[] {
  if (roots.length === 0) return []

  // Queue every eligible branch. The independent flag controls ordering only,
  // so no candidate variation is dropped from a session.
  const inlineRoots = roots.filter(node => !node.independent)
  const independentRoots = roots.filter(node => node.independent)
  return [...inlineRoots, ...independentRoots]
}

export function findScoreForLine(chapterScores: ScoreRecord[], chapterScoreId: string, lineId: string): ScoreRecord | undefined {
  return chapterScores.find(score => score.chapterId === chapterScoreId && score.lineId === lineId)
}

export interface ChapterTrainingPick {
  study: StoredStudy
  chapterIndex: number
  priority: 0 | 1 | 2 | null
}

export function pickNextChapterForTraining(
  storedStudies: StoredStudy[],
  selectedChapterIds: Set<string>,
  now: number,
  scores: ScoreRecord[]
): ChapterTrainingPick | null {
  if (storedStudies.length === 0) return null

  const allEntries: Array<{ study: StoredStudy; chapterIndex: number; cid: string }> = []
  storedStudies.forEach(study => {
    study.chapters.forEach((_, chapterIndex) => {
      const cid = chapterId(study.id, study.chapters, chapterIndex)
      if (selectedChapterIds.size > 0 && !selectedChapterIds.has(cid)) return
      allEntries.push({ study, chapterIndex, cid })
    })
  })

  if (allEntries.length === 0) return null

  if (selectedChapterIds.size > 0) {
    const pickOrder = allEntries
      .map(entry => {
        const chapter = entry.study.chapters[entry.chapterIndex]
        const chapterLines = chapter ? extractLines(chapter, entry.study.playerColor) : []
        const chapterScores = scores.filter(score => score.chapterId === entry.cid)

        const hasNotReviewed = chapterLines.some(line => {
          const lineScore = findScoreForLine(chapterScores, entry.cid, line.lineId)
          return !lineScore || !lineScore.lastReviewedAt || lineScore.interval <= 0
        })

        const hasDue = chapterLines.some(line => {
          const lineScore = findScoreForLine(chapterScores, entry.cid, line.lineId)
          if (!lineScore || !lineScore.lastReviewedAt || lineScore.interval <= 0) return false
          const dueAt = Date.parse(lineScore.dueDate)
          return !Number.isNaN(dueAt) && dueAt <= now
        })

        const nextDueAt = chapterLines.reduce((earliest, line) => {
          const lineScore = findScoreForLine(chapterScores, entry.cid, line.lineId)
          if (!lineScore || !lineScore.lastReviewedAt || lineScore.interval <= 0) return earliest
          const dueAt = Date.parse(lineScore.dueDate)
          if (Number.isNaN(dueAt)) return earliest
          return Math.min(earliest, dueAt)
        }, Number.POSITIVE_INFINITY)

        const priority = hasNotReviewed ? 0 : hasDue ? 1 : 2

        return {
          entry,
          priority,
          nextDueAt,
          studyName: entry.study.name.toLocaleLowerCase(),
          chapterTitle: (entry.study.chapters[entry.chapterIndex]?.title ?? '').toLocaleLowerCase(),
        }
      })
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority - right.priority
        if (left.nextDueAt !== right.nextDueAt) return left.nextDueAt - right.nextDueAt
        if (left.studyName !== right.studyName) return left.studyName.localeCompare(right.studyName)
        if (left.chapterTitle !== right.chapterTitle) return left.chapterTitle.localeCompare(right.chapterTitle)
        return left.entry.cid.localeCompare(right.entry.cid)
      })

    const picked = pickOrder[0]
    if (!picked) return null

    return {
      study: picked.entry.study,
      chapterIndex: picked.entry.chapterIndex,
      priority: picked.priority as 0 | 1 | 2,
    }
  }

  const dueEntries = allEntries.filter(({ study, chapterIndex }) => {
    const cid = chapterId(study.id, study.chapters, chapterIndex)
    return scores.some(score => score.chapterId === cid && new Date(score.dueDate).getTime() <= now)
  })

  const pool = dueEntries.length > 0 ? dueEntries : allEntries
  const picked = pool[Math.floor(Math.random() * pool.length)]
  if (!picked) return null

  return {
    study: picked.study,
    chapterIndex: picked.chapterIndex,
    priority: null,
  }
}

export function colorFromLichessStudyName(studyName: string): 'white' | 'black' {
  return studyName.trimStart().toLocaleLowerCase().startsWith('(black)') ? 'black' : 'white'
}

export function chapterConflictMap(studies: StoredStudy[]): Map<string, string> {
  const allChaptersMap = new Map<string, string>()
  studies.forEach((study: StoredStudy) => {
    study.chapters.forEach((chapter: Chapter, chapterIndex: number) => {
      allChaptersMap.set(chapterId(study.id, study.chapters, chapterIndex), `${study.name} · ${chapter.title}`)
    })
  })
  return allChaptersMap
}
