import { useApprovals, useMySwaps } from './market'

// How many things are waiting on this person: swaps addressed to them, and
// for managers, everything awaiting approval.
export function useRequestCount() {
  const swaps = useMySwaps()
  const approvals = useApprovals()
  return swaps.incoming.length + approvals.count
}
