"""Appeal flows: window enforcement, bonded re-adjudication, second verdict
finality, bond routing (FR-5)."""
import pytest

from conftest import BUYER, WORKER, OTHER, GEN, T0


def _adjudicated(env, bools):
    tid = env.create()          # escrow 10 GEN, bond 2 GEN, appeal bond 1 GEN
    env.accept(tid)
    env.llm_verdict(bools)
    env.deliver(tid)
    return tid


def test_only_parties_may_appeal(env):
    tid = _adjudicated(env, [False, False, False])
    with pytest.raises(Exception, match='EXPECTED.*party'):
        env.appeal(tid, sender=OTHER)


def test_appeal_window_enforced(env):
    tid = _adjudicated(env, [False, False, False])
    env.set_time(T0 + 120_001)
    with pytest.raises(Exception, match='EXPECTED.*window closed'):
        env.appeal(tid, sender=WORKER)


def test_overturned_appeal_returns_bond_and_is_final(env):
    """Worker appeals NOT_MET; round 2 finds PARTIAL → overturned."""
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([True, False, True])          # round-2 judgment
    outcome = env.appeal(tid, sender=WORKER)
    t = env.task(tid)

    assert outcome == 'OVERTURNED'
    assert t['status'] == 'FINAL'                  # second verdict is final (FR-5.3)
    assert t['round'] == 2
    assert t['verdict'] == 'PARTIAL'
    assert t['first_verdict'] == 'NOT_MET'         # preserved for the record

    share = 10 * GEN * 2 // 3
    # worker: escrow share + bond back + appeal bond returned (FR-5.4)
    assert env.balance(WORKER) == share + 2 * GEN + 1 * GEN
    assert env.balance(BUYER) == 10 * GEN - share


def test_upheld_appeal_forfeits_bond_to_counterparty(env):
    """Worker appeals NOT_MET; round 2 agrees → bond to buyer."""
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([False, False, False])
    outcome = env.appeal(tid, sender=WORKER)
    t = env.task(tid)

    assert outcome == 'UPHELD'
    assert t['verdict'] == 'NOT_MET'
    # buyer: refund 10 + half slash 1 + forfeited appeal bond 1
    assert env.balance(BUYER) == 12 * GEN
    assert env.balance(WORKER) == 0


def test_buyer_appeal_direction(env):
    """Buyer appeals MET; round 2 downgrades to PARTIAL → overturned
    (improvement is judged relative to the appellant)."""
    tid = _adjudicated(env, [True, True, True])
    env.llm_verdict([True, True, False])
    assert env.appeal(tid, sender=BUYER) == 'OVERTURNED'


def test_no_second_appeal(env):
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([False, False, False])
    env.appeal(tid, sender=WORKER)
    with pytest.raises(Exception, match='EXPECTED.*not ADJUDICATED'):
        env.appeal(tid, sender=WORKER)


def test_reputation_written_once_from_final_verdict(env):
    tid = _adjudicated(env, [False, False, False])
    env.llm_verdict([True, False, True])
    env.appeal(tid, sender=WORKER)
    worker_events = [e for e in env.rep() if e['role'] == 'worker' and e['task_id'] == tid]
    assert len(worker_events) == 1
    assert worker_events[0]['verdict'] == 'PARTIAL'  # final verdict, delta 0
