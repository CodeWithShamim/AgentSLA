"""Asset invariants, end to end (FR-3.0).

Escrow, worker bond, and appeal bond are real native GEN taken into
custody by payable methods; settlement converts custody into withdrawable
claims; withdraw() pays claims out with a native transfer. These tests
drive full lifecycles and check, at every step:

  1. BACKED     — contract balance == locked + withdrawable (never a
                  claim the contract cannot pay).
  2. CONSERVED  — every wei paid in is paid out to some party, exactly
                  once; nothing minted, nothing stranded.
  3. EXACT      — payable intake requires exactly the declared stake.
  4. FINAL      — a claim withdrawn once cannot be withdrawn again.
"""
import pytest

from conftest import BUYER, WORKER, OTHER, GEN, T0, TREASURY_HEX


def _adjudicated(env, bools, escrow=10 * GEN):
    tid = env.create(escrow=escrow)
    env.accept(tid)
    env.llm_verdict(bools)
    env.deliver(tid)
    return tid


def _finalize(env, tid):
    env.set_time(env.task(tid)['window_ends_ms'] + 1)
    env.set_sender(BUYER)
    env.contract.finalize(tid)


# ----------------------------------------------------------------------
# payable custody in
# ----------------------------------------------------------------------

def test_create_takes_exact_escrow_into_custody(env):
    assert env.custody == 0
    env.create(escrow=10 * GEN)
    assert env.custody == 10 * GEN                # escrow is real, held here
    v = env.vault()
    assert int(v['locked']) == 10 * GEN
    assert int(v['withdrawable']) == 0
    env.assert_backed()


def test_accept_requires_exact_bond_value(env):
    tid = env.create(escrow=10 * GEN)             # bond = 2 GEN
    with pytest.raises(Exception, match='EXPECTED.*worker bond'):
        env.accept(tid, bond=2 * GEN - 1)         # underfunded stake
    with pytest.raises(Exception, match='EXPECTED.*worker bond'):
        env.accept(tid, bond=2 * GEN + 1)         # overfunded stake
    assert env.custody == 10 * GEN                # failed stakes reverted
    env.accept(tid)                               # exact bond
    assert env.custody == 12 * GEN
    env.assert_backed()


def test_appeal_requires_exact_bond_value(env):
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([True, False, True])
    with pytest.raises(Exception, match='EXPECTED.*appeal bond'):
        env.appeal(tid, sender=WORKER, bond=1)    # 10% of 10 GEN required
    env.assert_backed()
    env.appeal(tid, sender=WORKER)                # exact appeal bond
    env.assert_backed()


def test_rejected_create_reverts_custody(env):
    with pytest.raises(Exception, match='EXPECTED.*minimum'):
        env.create(escrow=GEN - 1)
    assert env.custody == 0
    with pytest.raises(Exception, match='EXPECTED.*deadline'):
        env.create(deadline_ms=T0 - 1)            # cannot lock escrow on a dead task
    assert env.custody == 0


# ----------------------------------------------------------------------
# withdraw — the real payout path
# ----------------------------------------------------------------------

def test_met_lifecycle_pays_out_native_and_drains_custody(env):
    tid = _adjudicated(env, [True, True, True])
    _finalize(env, tid)
    env.assert_backed()

    paid = env.withdraw(WORKER)
    assert paid == 12 * GEN                        # escrow + bond, native out
    assert env.native_received(WORKER) == 12 * GEN # actual emit_transfer
    assert env.balance(WORKER) == 0                # claim zeroed
    assert env.custody == 0                        # vault fully drained
    env.assert_backed()


def test_withdraw_is_single_shot(env):
    tid = _adjudicated(env, [True, True, True])
    _finalize(env, tid)
    env.withdraw(WORKER)
    with pytest.raises(Exception, match='EXPECTED.*nothing to withdraw'):
        env.withdraw(WORKER)                       # no double payout
    assert env.native_received(WORKER) == 12 * GEN


def test_withdraw_without_claim_rejected(env):
    with pytest.raises(Exception, match='EXPECTED.*nothing to withdraw'):
        env.withdraw(OTHER)


def test_partial_conserves_every_wei_across_withdrawals(env):
    tid = _adjudicated(env, [True, False, True])   # 2/3 → pro-rata split
    _finalize(env, tid)
    env.assert_backed()

    total_in = 12 * GEN                            # 10 escrow + 2 bond
    paid = env.withdraw(WORKER) + env.withdraw(BUYER)
    assert paid == total_in                        # conservation, to the wei
    assert env.custody == 0
    env.assert_backed()


def test_not_met_slash_routes_real_funds_incl_treasury(env):
    tid = _adjudicated(env, [False, False, False])
    _finalize(env, tid)
    # buyer: refund 10 + half slash 1; treasury: half slash 1 (still custodied)
    assert env.withdraw(BUYER) == 11 * GEN
    assert env.native_received(BUYER) == 11 * GEN
    assert int(env.contract.get_balance(TREASURY_HEX)) == 1 * GEN
    assert env.custody == 1 * GEN                  # treasury claim stays backed
    env.assert_backed()


# ----------------------------------------------------------------------
# full-lifecycle conservation, including appeals and error paths
# ----------------------------------------------------------------------

def test_appeal_lifecycle_conserves_all_three_stakes(env):
    """escrow + bond + appeal bond all enter as value and all leave."""
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([False, False, False])
    env.appeal(tid, sender=WORKER)                 # upheld → bond forfeited
    env.assert_backed()

    total_in = 10 * GEN + 2 * GEN + 1 * GEN
    assert env.custody == total_in
    # buyer takes refund + half slash + forfeited appeal bond; treasury
    # holds the other half slash; worker walks away with nothing.
    assert env.withdraw(BUYER) == 12 * GEN
    assert env.native_received(BUYER) == 12 * GEN
    assert int(env.contract.get_balance(TREASURY_HEX)) == 1 * GEN
    assert env.balance(WORKER) == 0
    assert env.custody == 1 * GEN                  # exactly the treasury claim
    env.assert_backed()


def test_neutral_resolution_returns_appeal_bond(env):
    """Round-2 non-convergence after a paid appeal: all three stakes go
    home — the appeal bond must never strand in custody."""
    tid = _adjudicated(env, [False, False, False])
    env.set_llm(lambda p: 'not json at all')       # round 2 fails → SOFT_ERROR
    env.appeal(tid, sender=WORKER)
    assert env.task(tid)['status'] == 'SOFT_ERROR'
    assert env.custody == 13 * GEN
    env.assert_backed()

    env.set_sender(BUYER)
    env.contract.resolve_neutral(tid)
    env.assert_backed()
    assert env.balance(BUYER) == 10 * GEN          # escrow home
    assert env.balance(WORKER) == 2 * GEN + 1 * GEN  # bond + appeal bond home
    assert env.withdraw(BUYER) + env.withdraw(WORKER) == 13 * GEN
    assert env.custody == 0                        # nothing stranded
    env.assert_backed()


def test_cancel_refund_is_withdrawable_native(env):
    tid = env.create(escrow=10 * GEN)
    env.set_sender(BUYER)
    env.contract.cancel_task(tid)
    assert env.withdraw(BUYER) == 10 * GEN
    assert env.native_received(BUYER) == 10 * GEN
    assert env.custody == 0
    env.assert_backed()


def test_expired_reclaim_pays_escrow_plus_slashed_bond(env):
    tid = env.create(escrow=10 * GEN, deadline_ms=T0 + 1000)
    env.accept(tid)
    env.set_time(T0 + 2000)
    env.set_sender(BUYER)
    env.contract.reclaim_expired(tid)
    assert env.withdraw(BUYER) == 12 * GEN         # escrow + full bond slash
    assert env.custody == 0
    env.assert_backed()


def test_backed_invariant_holds_across_interleaved_cases(env):
    """Several concurrent cases at different lifecycle stages: the vault
    stays exactly backed after every single state transition."""
    a = env.create(escrow=10 * GEN); env.assert_backed()
    b = env.create(escrow=4 * GEN);  env.assert_backed()
    c = env.create(escrow=2 * GEN);  env.assert_backed()

    env.accept(a); env.assert_backed()
    env.accept(b); env.assert_backed()

    env.llm_verdict([True, True, True])
    env.deliver(a); env.assert_backed()
    _finalize(env, a); env.assert_backed()

    env.llm_verdict([False, False, False])
    env.deliver(b); env.assert_backed()
    env.llm_verdict([True, False, True])
    env.appeal(b, sender=WORKER); env.assert_backed()

    env.set_sender(BUYER)
    env.contract.cancel_task(c); env.assert_backed()

    env.withdraw(WORKER); env.assert_backed()
    env.withdraw(BUYER);  env.assert_backed()

    # Nothing is locked anymore; whatever remains custodied is exactly
    # the sum of unclaimed withdrawable claims (e.g. the treasury's).
    v = env.vault()
    assert int(v['locked']) == 0
    assert env.custody == int(v['withdrawable'])

    # Global conservation: everything ever paid in equals native paid
    # out plus what the vault still holds.
    total_in = (
        10 * GEN + (10 * GEN * 20 // 100)          # case a: escrow + bond
        + 4 * GEN + (4 * GEN * 20 // 100)          # case b: escrow + bond
        + (4 * GEN * 10 // 100)                    # case b: appeal bond
        + 2 * GEN                                  # case c: escrow (canceled)
    )
    paid_native = sum(amount for _, amount in env.transfers)
    assert paid_native + env.custody == total_in


def test_vault_report_shape_and_paid_out_counter(env):
    tid = _adjudicated(env, [True, True, True])
    _finalize(env, tid)
    env.withdraw(WORKER)
    v = env.vault()
    assert set(v) == {'custody', 'locked', 'withdrawable', 'paid_out', 'surplus', 'backed'}
    assert int(v['paid_out']) == 12 * GEN
    assert int(v['surplus']) == 0
    assert v['backed'] is True
