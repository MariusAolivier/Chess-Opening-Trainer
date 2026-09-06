import type { Chapter } from './pgn'
import type { ScoreRecord } from './scores'
import type { StoredStudy } from './storage'
import type { SidelineAttachment, TrainingLine } from './training'
import { buildChapterTrainingLines, findScoreForLine } from './appHelpers'
import { flattenLine } from './training'
import { chapterId } from './storage'

export type LinePriority = 0 | 1 | 2

export interface LinePriorityInfo {
  priority: LinePriority
  dueAt: number
}

export interface GlobalTrainingEntry {
  line: TrainingLine
  chapter: Chapter
  study: StoredStudy
  cid: string
  promotedSideline: boolean
}

export function linePriorityInfo(
  lineId: string,
  chapterScoreId: string,
  scores: ScoreRecord[],
  now: number,
): LinePriorityInfo {
  const score = findScoreForLine(scores, chapterScoreId, lineId)
  if (!score || !score.lastReviewedAt || score.interval <= 0) {
    return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
  }
  const dueAt = Date.parse(score.dueDate)
  if (Number.isNaN(dueAt)) return { priority: 0, dueAt: Number.NEGATIVE_INFINITY }
  if (dueAt <= now) return { priority: 1, dueAt }
  return { priority: 2, dueAt }
}

function attachSideline(
  lines: TrainingLine[],
  chapter: Chapter,
  alt: ReturnType<typeof buildChapterTrainingLines>['sidelineAlts'][number],
): { line: TrainingLine; promoted: boolean } | null {
  const forkMoveIndex = alt.pathFromStart.length
  const parent = lines.find(line => {
    if (line.line.length <= forkMoveIndex) return false
    const fenAtFork = forkMoveIndex === 0
      ? chapter.startFen
      : line.line[forkMoveIndex - 1]?.fen
    return fenAtFork === alt.forkFen
  })

  const sidelineMoves = flattenLine(alt.alternative)
  if (!parent) {
    return {
      promoted: true,
      line: {
        line: [...alt.pathFromStart, ...sidelineMoves],
        lineId: alt.lineId,
        label: alt.branchLabel,
        scoreDisplaySan: alt.alternative.san,
      },
    }
  }

  const attachment: SidelineAttachment = {
    forkMoveIndex,
    sidelineLine: {
      line: sidelineMoves,
      lineId: alt.lineId,
      label: alt.branchLabel,
      scoreDisplaySan: alt.alternative.san,
    },
  }
  parent.sidelines = [...(parent.sidelines ?? []), attachment]
    .sort((left, right) => left.forkMoveIndex - right.forkMoveIndex)
  return null
}

export function buildChapterTrainingQueue(
  chapter: Chapter,
  chapterScoreId: string,
  scores: ScoreRecord[],
  allowedPriorities: LinePriority[],
  now: number,
  playerColor?: 'white' | 'black',
): Array<{ line: TrainingLine; promotedSideline: boolean }> {
  const { lines: baseLines, sidelineAlts } = buildChapterTrainingLines(chapter, playerColor)
  const lines: TrainingLine[] = baseLines
    .filter(line => allowedPriorities.includes(linePriorityInfo(line.lineId, chapterScoreId, scores, now).priority))
    .map(line => ({ ...line, sidelines: line.sidelines ? [...line.sidelines] : undefined }))
  const promotedIds = new Set<string>()

  sidelineAlts.forEach(alt => {
    const priority = linePriorityInfo(alt.lineId, chapterScoreId, scores, now).priority
    if (!allowedPriorities.includes(priority)) return
    const standalone = attachSideline(lines, chapter, alt)
    if (standalone) {
      promotedIds.add(standalone.line.lineId)
      lines.push(standalone.line)
    }
  })

  return lines
    .map(line => ({ line, promotedSideline: promotedIds.has(line.lineId) }))
    .sort((left, right) => {
      const leftPriority = linePriorityInfo(left.line.lineId, chapterScoreId, scores, now)
      const rightPriority = linePriorityInfo(right.line.lineId, chapterScoreId, scores, now)
      if (leftPriority.priority !== rightPriority.priority) {
        return leftPriority.priority - rightPriority.priority
      }
      if (left.promotedSideline !== right.promotedSideline) {
        return Number(left.promotedSideline) - Number(right.promotedSideline)
      }
      return leftPriority.dueAt - rightPriority.dueAt
    })
}

export function buildGlobalTrainingQueue(
  studies: StoredStudy[],
  selectedChapterIds: Set<string> | undefined,
  scores: ScoreRecord[],
  now: number,
): GlobalTrainingEntry[] {
  function collect(allowedPriorities: LinePriority[]): GlobalTrainingEntry[] {
    return studies.flatMap(study =>
      study.chapters.flatMap((chapter, chapterIndex) => {
        const cid = chapterId(study.id, study.chapters, chapterIndex)
        if (selectedChapterIds?.size && !selectedChapterIds.has(cid)) return []

        return buildChapterTrainingQueue(
          chapter,
          cid,
          scores,
          allowedPriorities,
          now,
          study.playerColor,
        ).map(item => ({
          ...item,
          line: { ...item.line, chapterTitle: chapter.title },
          chapter,
          study,
          cid,
        }))
      })
    )
  }

  const dueEntries = collect([0, 1])
  const entries = dueEntries.length > 0 ? dueEntries : collect([0, 1, 2])

  return entries.sort((left, right) => {
    const leftPriority = linePriorityInfo(left.line.lineId, left.cid, scores, now)
    const rightPriority = linePriorityInfo(right.line.lineId, right.cid, scores, now)
    if (leftPriority.priority !== rightPriority.priority) {
      return leftPriority.priority - rightPriority.priority
    }
    if (left.promotedSideline !== right.promotedSideline) {
      return Number(left.promotedSideline) - Number(right.promotedSideline)
    }
    return leftPriority.dueAt - rightPriority.dueAt
  })
}
