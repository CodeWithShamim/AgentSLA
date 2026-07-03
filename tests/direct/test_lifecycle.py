"""State transitions + access control (FR-1, FR-2.1)."""
import json

import pytest

from conftest import BUYER, WORKER, OTHER, GEN, T0


def test_create_task_opens_case(env):
    tid = env.create()
    t = env.task(tid)
    assert t['status'] == 'OPEN'
    assert t['buyer'] == BUYER.as_hex
    assert t['worker'] is None
    assert int(t['escrow']) == 10 * GEN
    assert int(t['bond']) == 2 * GEN  # 20% (FR-1.3)


@pytest.mark.parametrize('criteria', [[], ['x'] * 11])
def test_criteria_count_enforced(env, criteria):
    with pytest.raises(Exception, match='EXPECTED.*criteria'):
        env.create(criteria=criteria)


def test_empty_criterion_rejected(env):
    with pytest.raises(Exception, match='EXPECTED.*empty criterion'):
        env.create(criteria=['fine', '   '])


def test_min_escrow_enforced(env):
    with pytest.raises(Exception, match='EXPECTED.*minimum'):
        env.create(escrow=GEN - 1)


def test_buyer_cannot_accept_own_task(env):
    tid = env.create()
    with pytest.raises(Exception, match='EXPECTED.*own task'):
        env.accept(tid, sender=BUYER)


def test_accept_transitions_and_binds_worker(env):
    tid = env.create()
    env.accept(tid)
    t = env.task(tid)
    assert t['status'] == 'ACCEPTED'
    assert t['worker'] == WORKER.as_hex


def test_accept_requires_open(env):
    tid = env.create()
    env.accept(tid)
    with pytest.raises(Exception, match='EXPECTED.*not OPEN'):
        env.accept(tid, sender=OTHER)


def test_only_worker_may_deliver(env):
    tid = env.create()
    env.accept(tid)
    with pytest.raises(Exception, match='EXPECTED.*accepted worker'):
        env.deliver(tid, sender=OTHER)


def test_delivery_requires_evidence(env):
    tid = env.create()
    env.accept(tid)
    with pytest.raises(Exception, match='EXPECTED.*evidence'):
        env.deliver(tid, inline='', url='')


def test_delivery_rejected_past_deadline(env):
    tid = env.create(deadline_ms=T0 + 1000)
    env.accept(tid)
    env.set_time(T0 + 2000)
    with pytest.raises(Exception, match='EXPECTED.*deadline'):
        env.deliver(tid)


def test_cancel_only_buyer_only_open(env):
    tid = env.create()
    env.set_sender(OTHER)
    with pytest.raises(Exception, match='EXPECTED.*buyer'):
        env.contract.cancel_task(tid)
    env.set_sender(BUYER)
    env.contract.cancel_task(tid)
    t = env.task(tid)
    assert t['status'] == 'CANCELED'
    assert env.balance(BUYER) == 10 * GEN  # full refund (FR-1.4)
    with pytest.raises(Exception, match='EXPECTED.*not OPEN'):
        env.contract.cancel_task(tid)


def test_unknown_task_is_expected_error(env):
    with pytest.raises(Exception, match='EXPECTED.*no task'):
        env.task(999)
