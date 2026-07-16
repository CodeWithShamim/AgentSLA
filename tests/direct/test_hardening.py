"""Security hardening + new-feature coverage.

Audit findings fixed and locked in here:
  H1 resolve_neutral was permissionless → parties only
  H2 treasury was a keyless placeholder (slash revenue burned) → deployer,
     with a real native withdrawal path
  H3 no deadline horizon → a typo could lock escrow for decades
  H4 unbounded counterparty inputs → size caps
  H5 unlimited EXTERNAL/TRANSIENT re-deliveries → capped, then neutral path

New features: abandon_task (honest fail-fast worker exit) and paginated
docket reads.
"""
import json

import pytest

from conftest import BUYER, WORKER, OTHER, DEPLOYER, GEN, T0


def _accepted(env, **kw):
    tid = env.create(**kw)
    env.accept(tid)
    return tid


# ----------------------------------------------------------------------
# H1 — neutral resolution is for parties, not passers-by
# ----------------------------------------------------------------------

def test_outsider_cannot_resolve_neutral(env):
    tid = _accepted(env)
    env.set_llm(lambda p: 'not json at all')
    env.deliver(tid)
    assert env.task(tid)['status'] == 'SOFT_ERROR'
    env.set_sender(OTHER)
    with pytest.raises(Exception, match='EXPECTED.*party'):
        env.contract.resolve_neutral(tid)
    env.set_sender(WORKER)                        # a party may resolve
    env.contract.resolve_neutral(tid)
    assert env.task(tid)['status'] == 'RESOLVED_NEUTRAL'


# ----------------------------------------------------------------------
# H2 — slash revenue is real and withdrawable by the operator
# ----------------------------------------------------------------------

def test_treasury_is_deployer_and_slash_is_withdrawable(env):
    assert json.loads(env.contract.get_params())['treasury'] == DEPLOYER.as_hex
    tid = _accepted(env)
    env.llm_verdict([False, False, False])
    env.deliver(tid)
    env.set_time(env.task(tid)['window_ends_ms'] + 1)
    env.contract.finalize(tid)
    assert env.balance(DEPLOYER) == 1 * GEN       # half of the 2 GEN bond
    assert env.withdraw(DEPLOYER) == 1 * GEN      # native payout, not burned
    assert env.native_received(DEPLOYER) == 1 * GEN
    env.assert_backed()


# ----------------------------------------------------------------------
# H3/H4 — bounded inputs
# ----------------------------------------------------------------------

def test_deadline_horizon_capped(env):
    with pytest.raises(Exception, match='EXPECTED.*too far out'):
        env.create(deadline_ms=T0 + 400 * 86_400_000)   # 400 days
    assert env.custody == 0                       # rejected escrow reverted


def test_oversized_inputs_rejected(env):
    with pytest.raises(Exception, match='EXPECTED.*criterion exceeds'):
        env.create(criteria=['x' * 301])
    with pytest.raises(Exception, match='EXPECTED.*size limit'):
        env.create(title='t' * 201)
    tid = _accepted(env)
    with pytest.raises(Exception, match='EXPECTED.*evidence exceeds'):
        env.deliver(tid, inline='e' * 20_001)
    assert env.custody == 12 * GEN                # escrow + bond intact


# ----------------------------------------------------------------------
# H5 — bounded retries, then the neutral path (funds can't be strung along)
# ----------------------------------------------------------------------

def test_external_failures_capped_then_neutral(env):
    tid = _accepted(env)
    env.set_web(lambda url, mode='text': (_ for _ in ()).throw(RuntimeError('down')))
    for i in range(2):                            # retries 1 and 2 stay deliverable
        assert env.deliver(tid, inline='', url='https://evidence.invalid/x') == 'EXTERNAL'
        assert env.task(tid)['status'] == 'ACCEPTED'
    assert env.deliver(tid, inline='', url='https://evidence.invalid/x') == 'EXTERNAL'
    assert env.task(tid)['status'] == 'SOFT_ERROR'  # 3rd failure → neutral path
    env.set_sender(BUYER)
    env.contract.resolve_neutral(tid)
    assert env.balance(BUYER) == 10 * GEN
    assert env.balance(WORKER) == 2 * GEN
    env.assert_backed()


# ----------------------------------------------------------------------
# feature — abandon_task: honest fail-fast exit
# ----------------------------------------------------------------------

def test_abandon_pays_buyer_immediately(env):
    tid = _accepted(env)
    env.set_sender(WORKER)
    env.contract.abandon_task(tid)
    t = env.task(tid)
    assert t['status'] == 'ABANDONED'
    assert env.balance(BUYER) == 12 * GEN         # escrow + full bond, no waiting
    assert env.withdraw(BUYER) == 12 * GEN        # and it is real, native GEN
    env.assert_backed()
    ev = [e for e in env.rep() if e['role'] == 'worker'][0]
    assert ev['verdict'] == 'ABANDONED' and ev['delta'] == -2   # softer than -5


def test_abandon_only_worker_only_accepted(env):
    tid = _accepted(env)
    env.set_sender(BUYER)
    with pytest.raises(Exception, match='EXPECTED.*worker'):
        env.contract.abandon_task(tid)
    env.set_sender(WORKER)
    env.contract.abandon_task(tid)
    with pytest.raises(Exception, match='EXPECTED.*not ACCEPTED'):
        env.contract.abandon_task(tid)


# ----------------------------------------------------------------------
# feature — paginated docket reads
# ----------------------------------------------------------------------

def test_task_pagination(env):
    for _ in range(5):
        env.create()
    assert env.contract.get_task_count() == 5
    page = json.loads(env.contract.get_tasks_page(2, 2))
    assert page['total'] == 5
    assert [t['id'] for t in page['tasks']] == [3, 4]
    tail = json.loads(env.contract.get_tasks_page(4, 50))
    assert [t['id'] for t in tail['tasks']] == [5]
    with pytest.raises(Exception, match='EXPECTED.*limit'):
        env.contract.get_tasks_page(0, 0)
