# Verifier Nomination and Staking

`verifier_nomination` collects community support for prospective risk-registry
verifiers. It does not register verifiers or bypass the existing risk-registry
admin approval and stake checks.

## Flow

1. Initialize with the staking token, minimum total support, per-address cap,
   and nomination window.
2. `nominate(supporter, candidate, amount)` opens a nomination and escrows the
   first support stake. `stake` adds support to an open nomination.
3. `select_candidate` selects the open, unexpired nomination with the highest
   total stake that meets the minimum. Selection is permissionless and bounded
   to 50 nominations per deployment.
4. The selected candidate calls `accept_onboarding` or `decline_onboarding`.
   Only an accepted nomination is reported by `is_eligible`; an operator must
   still submit the candidate to `risk_registry.add_verifier` for formal
   approval and registry staking.
5. Supporters can withdraw after the nomination window, after the nominee
   declines, or after the selected-candidate response window expires.

Each supporter is capped independently per nomination. Stakes are held in the
contract and returned to the same supporter address. Selection does not transfer
or slash support. A declined or timed-out nomination cannot be selected again.
When support is withdrawn from a timed-out accepted nomination, it is marked
expired so eligibility is revoked before the backing is returned.

## Operational limits

The current implementation caps a deployment at 50 nomination IDs to keep
selection iteration bounded. Deploy a fresh instance for a later nomination
cycle. Configure a meaningful nomination window and per-address cap in the
staking token's smallest units. The nomination contract and risk registry are
separate; deployments must publish the accepted candidate ID/address for the
normal admin/governance onboarding step.