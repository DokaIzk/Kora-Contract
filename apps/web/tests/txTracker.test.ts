/**
 * Tests for Real-Time Transaction Status Tracker (#776)
 */

import { TxTrackerService } from '../src/services/txTrackerService';

describe('Real-Time Transaction Status Tracker Tests (#776)', () => {
  it('manages state transitions correctly', () => {
    let state = TxTrackerService.createInitialState();
    expect(state.state).toBe('idle');

    state = TxTrackerService.transitionToSimulating(state);
    expect(state.state).toBe('simulating');

    state = TxTrackerService.transitionToSubmitting(state);
    expect(state.state).toBe('submitting');

    state = TxTrackerService.transitionToPending(state, '0xabc123');
    expect(state.state).toBe('pending');
    expect(state.txHash).toBe('0xabc123');

    state = TxTrackerService.transitionToConfirmed(state, 123456);
    expect(state.state).toBe('confirmed');
    expect(state.ledgerSequence).toBe(123456);
    expect(state.isLateSuccess).toBe(false);
  });

  it('classifies simulation failure accurately', () => {
    let state = TxTrackerService.createInitialState();
    state = TxTrackerService.transitionToFailure(state, 'simulation_failed', 'Err: Exceeded max bounds');
    expect(state.state).toBe('failed');
    expect(state.failureClass).toBe('simulation_failed');
    expect(state.userFacingMessage).toContain('Simulation error');
    expect(state.rawErrorDetails).toBe('Err: Exceeded max bounds');
  });

  it('handles late confirmation reconciliation after timeout', () => {
    let state = TxTrackerService.createInitialState();
    state = TxTrackerService.transitionToPending(state, '0xlate123');
    state = TxTrackerService.transitionToFailure(state, 'timeout_unconfirmed', 'Timeout 30s');
    expect(state.state).toBe('timeout');

    // Polling eventually confirms transaction
    state = TxTrackerService.transitionToConfirmed(state, 99999);
    expect(state.state).toBe('confirmed');
    expect(state.isLateSuccess).toBe(true);
    expect(state.userFacingMessage).toContain('Reconciled!');
  });
});
