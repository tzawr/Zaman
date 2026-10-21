const { withEntitlementsPlist } = require('expo/config-plugins')

// A free Apple account cannot sign push, Sign in with Apple or associated
// domains, and Expo adds the first two whenever their modules are
// installed. Used only for the free-account build (scripts/ios-device.js).
const PAID_ONLY = ['aps-environment', 'com.apple.developer.applesignin', 'com.apple.developer.associated-domains']

module.exports = function withoutPaidEntitlements(config) {
  return withEntitlementsPlist(config, (mod) => {
    for (const key of PAID_ONLY) delete mod.modResults[key]
    return mod
  })
}
