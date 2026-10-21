import { View } from 'react-native'
import OfferCard from '../../components/OfferCard'
import WorkplaceHeader from '../../components/WorkplaceHeader'
import { useOpenOffers } from '../../state/market'
import { useToday } from '../../state/shifts'
import { useWorkspace } from '../../state/workspace'
import { Banner, EmptyState, Screen, SkeletonCard, Text } from '../../ui/components'

export default function Marketplace() {
  const today = useToday()
  const { active, workplaces } = useWorkspace()
  const { items, error } = useOpenOffers()

  return (
    <View style={{ flex: 1 }}>
      <WorkplaceHeader title="Marketplace" />
      <Screen>
        <Text tone="muted">
          Shifts your coworkers at {active?.name || 'this workplace'} want to give away.
          {workplaces?.length > 1 ? ' Each workplace has its own marketplace; switch above to see another.' : ''}
        </Text>
        <Banner message={error} />
        {items === null ? <><SkeletonCard lines={2} /><SkeletonCard lines={2} /></> : items.length ? (
          <View style={{ gap: 10 }}>
            {items.map(o => <OfferCard key={o.id} offer={o} today={today} />)}
          </View>
        ) : (
          <EmptyState icon="repeat" title="Nothing on offer"
            message="When someone offers a shift, it shows up here. To offer one of yours, open it from Home or Calendar." />
        )}
      </Screen>
    </View>
  )
}
