import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  enqueueSend,
  dequeueByScheduleId,
  isInFlight,
  queueDepth,
  pendingScheduleIds,
  clearQueue,
  processNextInQueue,
  setExecutor,
  __resetForTests,
  type QueueItem
} from '../electron/services/sendQueue'

function item(id: string, priority: 0 | 1, scheduledTime: string): QueueItem {
  return { scheduleId: id, priority, scheduledTime, retryAttempt: 0 }
}

describe('sendQueue', () => {
  beforeEach(() => {
    __resetForTests()
  })

  describe('enqueue + ordering', () => {
    it('puts groups ahead of contacts regardless of insertion order', () => {
      enqueueSend(item('c1', 1, '2026-04-15T14:37:00.000Z'))
      enqueueSend(item('g1', 0, '2026-04-15T14:37:00.000Z'))
      expect(pendingScheduleIds()).toEqual(['g1', 'c1'])
    })

    it('tiebreaks same priority by scheduledTime ASC', () => {
      enqueueSend(item('g2', 0, '2026-04-15T14:37:30.000Z'))
      enqueueSend(item('g1', 0, '2026-04-15T14:37:00.000Z'))
      enqueueSend(item('g3', 0, '2026-04-15T14:38:00.000Z'))
      expect(pendingScheduleIds()).toEqual(['g1', 'g2', 'g3'])
    })

    it('rejects duplicate scheduleId while already queued', () => {
      expect(enqueueSend(item('x', 0, '2026-04-15T14:37:00.000Z'))).toBe(true)
      expect(enqueueSend(item('x', 0, '2026-04-15T14:37:00.000Z'))).toBe(false)
      expect(queueDepth()).toBe(1)
    })
  })

  describe('dequeueByScheduleId', () => {
    it('removes a specific item', () => {
      enqueueSend(item('a', 0, 'T1'))
      enqueueSend(item('b', 1, 'T2'))
      dequeueByScheduleId('a')
      expect(pendingScheduleIds()).toEqual(['b'])
    })

    it('no-op when scheduleId is not in queue', () => {
      enqueueSend(item('a', 0, 'T1'))
      dequeueByScheduleId('missing')
      expect(queueDepth()).toBe(1)
    })
  })

  describe('processNextInQueue', () => {
    it('drains the queue in priority order, passing keepOpen correctly', async () => {
      const calls: Array<{ id: string; keepOpen: boolean }> = []
      setExecutor(async (qi, keepOpen) => {
        calls.push({ id: qi.scheduleId, keepOpen })
      })

      enqueueSend(item('c1', 1, '2026-04-15T14:37:00.000Z'))
      enqueueSend(item('g1', 0, '2026-04-15T14:37:00.000Z'))
      enqueueSend(item('g2', 0, '2026-04-15T14:37:30.000Z'))

      await processNextInQueue()

      expect(calls.map((c) => c.id)).toEqual(['g1', 'g2', 'c1'])
      expect(calls[0].keepOpen).toBe(true)
      expect(calls[1].keepOpen).toBe(true)
      expect(calls[2].keepOpen).toBe(false)
      expect(queueDepth()).toBe(0)
      expect(isInFlight()).toBe(false)
    })

    it('continues past an executor throw without deadlock', async () => {
      const visited: string[] = []
      setExecutor(async (qi) => {
        visited.push(qi.scheduleId)
        if (qi.scheduleId === 'g1') throw new Error('boom')
      })

      enqueueSend(item('g1', 0, 'T1'))
      enqueueSend(item('g2', 0, 'T2'))

      await processNextInQueue()

      expect(visited).toEqual(['g1', 'g2'])
      expect(queueDepth()).toBe(0)
    })

    it('is a no-op when no executor is registered', async () => {
      enqueueSend(item('g1', 0, 'T1'))
      await processNextInQueue()
      expect(queueDepth()).toBe(1)
    })

    it('concurrent calls do not double-process', async () => {
      const visited: string[] = []
      setExecutor(async (qi) => {
        visited.push(qi.scheduleId)
        await new Promise((r) => setTimeout(r, 5))
      })

      enqueueSend(item('a', 0, 'T1'))
      enqueueSend(item('b', 0, 'T2'))

      await Promise.all([processNextInQueue(), processNextInQueue()])

      expect(visited).toEqual(['a', 'b']) // each processed exactly once
    })
  })

  describe('clearQueue', () => {
    it('empties pending items', () => {
      enqueueSend(item('a', 0, 'T1'))
      enqueueSend(item('b', 1, 'T2'))
      clearQueue()
      expect(queueDepth()).toBe(0)
      expect(isInFlight()).toBe(false)
    })
  })

  describe('isInFlight during processing', () => {
    it('reports in-flight while executor is running', async () => {
      let seenInFlight: string | null = null
      setExecutor(async (qi) => {
        seenInFlight = qi.scheduleId
        expect(isInFlight()).toBe(true)
      })
      enqueueSend(item('only', 0, 'T1'))
      await processNextInQueue()
      expect(seenInFlight).toBe('only')
      expect(isInFlight()).toBe(false)
    })

    it('rejects enqueue of the same scheduleId while it is in-flight', async () => {
      const results: boolean[] = []
      setExecutor(async () => {
        results.push(enqueueSend(item('same', 1, 'T2')))
      })
      enqueueSend(item('same', 0, 'T1'))
      await processNextInQueue()
      expect(results).toEqual([false])
    })
  })

  it('example: noise test that the vitest mock infra loads without issue', () => {
    // sanity check — keeps the file from looking empty if future tests are skipped
    expect(vi.isMockFunction(vi.fn())).toBe(true)
  })
})
