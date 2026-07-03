"""Settlement math, finalization, neutral resolution, deadline reclaim,
reputation writes (FR-3, FR-4.1, FR-6). All amounts integer wei."""
import pytest

from conftest import BUYER, WORKER, GEN, T0, TREASURY_HEX


def _adjudicated(env, bools, escrow=10 * GEN):
    tid = env.create(escrow=escrow)
    env.accept(tid)
    env.llm_verdict(bools)
    env.deliver(tid)
    return tid


def _finalize(env, tid):
    env.set_time(env.task(tid)['window_ends_ms'] + 1)  # window closed
    env.set_sender(BUYER)
    env.contract.finalize(tid)
    return env.task(tid)


def test_finalize_blocked_while_window_open(env):
    tid = _adjudicated(env, [True, True, True])
    env.set_time(T0 + 60_000)
    with pytest.raises(Exception, match='EXPECTED.*window still open'):
        env.contract.finalize(tid)


def test_met_releases_escrow_and_returns_bond(env):
    tid = _adjudicated(env, [True, True, True])
    t = _finalize(env, tid)
    assert t['status'] == 'FINAL'
    assert env.balance(WORKER) == 12 * GEN  # 10 escrow + 2 bond
    assert env.balance(BUYER) == 0


def test_partial_splits_pro_rata(env):
    tid = _adjudicated(env, [True, False, True])  # 2 of 3
    _finalize(env, tid)
    worker_share = 10 * GEN * 2 // 3
    assert env.balance(WORKER) == worker_share + 2 * GEN  # + bond back
    assert env.balance(BUYER) == 10 * GEN - worker_share
    # conservation: everything staked is redistributed, nothing minted
    assert env.balance(WORKER) + env.balance(BUYER) == 12 * GEN


def test_not_met_refunds_and_slashes_50_50(env):
    tid = _adjudicated(env, [False, False, False])
    t = _finalize(env, tid)
    assert env.balance(BUYER) == 10 * GEN + 1 * GEN     # refund + half bond
    assert int(env.contract.get_balance(TREASURY_HEX)) == 1 * GEN
    assert env.balance(WORKER) == 0
    kinds = [l['kind'] for l in t['settlement']]
    assert kinds == ['refund', 'slash', 'slash']


def test_reputation_deltas_per_verdict(env):
    for bools, delta in [([True] * 3, 2), ([True, False, False], 0), ([False] * 3, -3)]:
        tid = _adjudicated(env, bools)
        _finalize(env, tid)
        ev = [e for e in env.rep() if e['task_id'] == tid and e['role'] == 'worker'][0]
        assert ev['delta'] == delta
    # score floors at 0: +2 +0 -3 = -1 → 0
    assert env.contract.get_score(WORKER.as_hex) == 0


def test_neutral_resolution_moves_funds_but_writes_no_reputation(env):
    tid = env.create()
    env.accept(tid)
    env.set_llm(lambda p: 'not json at all')
    env.deliver(tid)
    assert env.task(tid)['status'] == 'SOFT_ERROR'

    env.set_sender(BUYER)
    env.contract.resolve_neutral(tid)
    t = env.task(tid)
    assert t['status'] == 'RESOLVED_NEUTRAL'
    assert env.balance(BUYER) == 10 * GEN   # escrow back
    assert env.balance(WORKER) == 2 * GEN   # bond back, no slash
    assert env.rep() == []                  # FR-6.4


def test_resolve_neutral_requires_soft_error(env):
    tid = env.create()
    with pytest.raises(Exception, match='EXPECTED.*not SOFT_ERROR'):
        env.contract.resolve_neutral(tid)


def test_deadline_reclaim_slashes_full_bond(env):
    tid = env.create(deadline_ms=T0 + 1000)
    env.accept(tid)
    env.set_sender(BUYER)
    with pytest.raises(Exception, match='EXPECTED.*deadline has not passed'):
        env.contract.reclaim_expired(tid)
    env.set_time(T0 + 2000)
    env.contract.reclaim_expired(tid)
    t = env.task(tid)
    assert t['status'] == 'EXPIRED'
    assert env.balance(BUYER) == 12 * GEN  # escrow + full bond (FR-3.4)
    ev = [e for e in env.rep() if e['role'] == 'worker'][0]
    assert ev['verdict'] == 'DEADLINE_MISS' and ev['delta'] == -5
