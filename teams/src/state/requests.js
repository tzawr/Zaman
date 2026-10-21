import { usePendingTimeOff } from './availability'
import { useApprovals, useMySwaps } from './market'

// How many things are waiting on this person: swaps addressed to them, and
// for managers, everything awaiting approval, time off included.
export function useRequestCount() {
  const swaps = useMySwaps()
  const approvals = useApprovals()
  const timeOff = usePendingTimeOff()
  return swaps.incoming.length + approvals.count + (timeOff.items?.length || 0)
}
