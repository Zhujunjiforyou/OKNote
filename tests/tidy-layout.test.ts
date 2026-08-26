import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createFullTidyRegion,
  createPreferredTidyRegions,
  packTidyItems,
  packTidyItemsResponsive,
} = require('../electron/tidy-layout.cjs') as {
  createFullTidyRegion: (workArea: Rect, margin?: number) => Region
  createPreferredTidyRegions: (workArea: Rect, calendarBounds: Rect, margin?: number, gap?: number) => Region[]
  packTidyItems: (items: Item[], regions: Region[], gap?: number) => { placements: Placement[]; remaining: Item[] }
  packTidyItemsResponsive: (items: Item[], regions: Region[], gap?: number) => { placements: Placement[]; remaining: Item[] }
}

interface Rect { x: number; y: number; width: number; height: number }
interface Region extends Rect { kind: string }
interface Item { id: string; width: number; height: number; minWidth: number; minHeight: number }
interface Placement { item: Item; regionKind: string; bounds: Rect }

const workArea = { x: 0, y: 0, width: 2560, height: 1392 }
const notes = Array.from({ length: 4 }, (_, index) => ({
  id: `note-${index}`,
  width: 278,
  height: 346,
  minWidth: 200,
  minHeight: 220,
}))

describe('tidy note layout', () => {
  it('left-aligns the lower strip with the calendar before using a larger side region', () => {
    const calendar = { x: 100, y: 300, width: 980, height: 760 }
    const regions = createPreferredTidyRegions(workArea, calendar)
    expect(regions[0].kind).toBe('below')
    expect(regions[0].x).toBe(calendar.x)
    expect(regions[0].width * regions[0].height).toBeLessThan(regions.find((region) => region.kind === 'right')!.width * regions.find((region) => region.kind === 'right')!.height)

    const result = packTidyItems(notes, regions)
    expect(result.remaining).toHaveLength(0)
    expect(result.placements.every((placement) => placement.regionKind === 'below')).toBe(true)
    expect(result.placements[0].bounds.x).toBe(calendar.x)
    expect(result.placements.every((placement) => placement.bounds.y >= calendar.y + calendar.height + 12)).toBe(true)
  })

  it('clamps the lower-strip alignment when the calendar extends beyond the work area', () => {
    const shiftedWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 }
    const calendar = { x: -1990, y: 120, width: 980, height: 600 }
    const [below] = createPreferredTidyRegions(shiftedWorkArea, calendar)

    expect(below.kind).toBe('below')
    expect(below.x).toBe(shiftedWorkArea.x + 12)
    expect(below.x + below.width).toBeLessThanOrEqual(shiftedWorkArea.x + shiftedWorkArea.width - 12)
  })

  it('uses non-overlapping side bands only when the lower strip cannot fit a minimum note', () => {
    const calendar = { x: 100, y: 500, width: 980, height: 760 }
    const regions = createPreferredTidyRegions(workArea, calendar)
    const result = packTidyItems(notes, regions)
    expect(result.remaining).toHaveLength(0)
    expect(result.placements.every((placement) => placement.regionKind === 'right')).toBe(true)
    expect(result.placements.every((placement) => placement.bounds.x >= calendar.x + calendar.width + 12)).toBe(true)
    expect(result.placements.every((placement) => placement.bounds.y + placement.bounds.height <= calendar.y + calendar.height)).toBe(true)
  })

  it('fills the lower strip before sending overflow notes to a side band', () => {
    const wideWorkArea = { x: 0, y: 0, width: 1600, height: 1000 }
    const calendar = { x: 500, y: 300, width: 600, height: 400 }
    const regions = createPreferredTidyRegions(wideWorkArea, calendar)
    const manyNotes = Array.from({ length: 6 }, (_, index) => ({
      id: `overflow-${index}`,
      width: 278,
      height: 346,
      minWidth: 200,
      minHeight: 220,
    }))
    const result = packTidyItems(manyNotes, regions)
    const kinds = result.placements.map((placement) => placement.regionKind)
    const firstNonBelow = kinds.findIndex((kind) => kind !== 'below')
    expect(firstNonBelow).toBeGreaterThan(0)
    expect(kinds.slice(0, firstNonBelow).every((kind) => kind === 'below')).toBe(true)
    expect(result.remaining).toHaveLength(0)
  })

  it('packs variable note sizes left-to-right without overlapping or leaving the work area', () => {
    const region = createFullTidyRegion({ x: -2560, y: 720, width: 2560, height: 1392 })
    const items = [
      { id: 'wide', width: 420, height: 360, minWidth: 200, minHeight: 220 },
      { id: 'small', width: 240, height: 280, minWidth: 200, minHeight: 220 },
      { id: 'tall', width: 280, height: 440, minWidth: 200, minHeight: 220 },
    ]
    const result = packTidyItems(items, [region])
    expect(result.remaining).toHaveLength(0)
    for (const placement of result.placements) {
      expect(placement.bounds.x).toBeGreaterThanOrEqual(region.x)
      expect(placement.bounds.y).toBeGreaterThanOrEqual(region.y)
      expect(placement.bounds.x + placement.bounds.width).toBeLessThanOrEqual(region.x + region.width)
      expect(placement.bounds.y + placement.bounds.height).toBeLessThanOrEqual(region.y + region.height)
    }
    for (let i = 0; i < result.placements.length; i += 1) {
      for (let j = i + 1; j < result.placements.length; j += 1) {
        const a = result.placements[i].bounds
        const b = result.placements[j].bounds
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
      }
    }
  })

  it('compacts crowded notes to their responsive minimums before allowing overlap', () => {
    const calendar = { x: 40, y: 40, width: 980, height: 760 }
    const regions = createPreferredTidyRegions(workArea, calendar)
    const crowdedNotes = Array.from({ length: 20 }, (_, index) => ({
      id: `crowded-${index}`,
      width: 272,
      height: 340,
      minWidth: 160,
      minHeight: 170,
    }))
    const result = packTidyItemsResponsive(crowdedNotes, regions)

    expect(result.remaining).toHaveLength(0)
    expect(result.placements[0].bounds.x).toBe(calendar.x)
    expect(result.placements.some((placement) => placement.bounds.width === 160)).toBe(true)
    for (let i = 0; i < result.placements.length; i += 1) {
      for (let j = i + 1; j < result.placements.length; j += 1) {
        const a = result.placements[i].bounds
        const b = result.placements[j].bounds
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
      }
    }
  })
})
