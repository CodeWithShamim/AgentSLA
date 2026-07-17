"""Marketplace features: competitive bidding (FR-8), milestone escrow
groups (FR-9), reputation-gated bonds (FR-10). Every custody move stays
inside the backed-accounting invariant — asserted throughout."""
import json

import pytest

from conftest import BUYER, WORKER, OTHER, GEN, T0


# ----------------------------------------------------------------------
# FR-8 — competitive bidding
# ----------------------------------------------------------------------

def test_bid_book_records_and_replaces(env):
    tid = env.create(escrow=10 * GEN)
    env.bid(tid, 8 * GEN)
    env.bid(tid, 6 * GEN)                          # replaces own earlier bid
    env.bid(tid, 9 * GEN, sender=OTHER)
    bids = env.task(tid)['bids']
    assert len(bids) == 2
    assert {b['worker']: b['price'] for b in bids} == {
        env.task(tid)['bids'][0]['worker']: str(6 * GEN),
        OTHER.as_hex: str(9 * GEN),
    }


def test_bid_bounds_and_roles(env):
    tid = env.create(escrow=10 * GEN)
    env.set_sender(BUYER)
    with pytest.raises(Exception, match='EXPECTED.*own task'):
        env.contract.place_bid(tid, 5 * GEN)
    with pytest.raises(Exception, match='EXPECTED.*between'):
        env.bid(tid, 11 * GEN)                     # above escrow
    with pytest.raises(Exception, match='EXPECTED.*between'):
        env.bid(tid, GEN - 1)                      # below protocol minimum


def test_select_bid_refunds_surplus_and_locks_acceptance(env):
    tid = env.create(escrow=10 * GEN)
    env.bid(tid, 6 * GEN)                          # WORKER offers 6
    env.bid(tid, 9 * GEN, sender=OTHER)
    env.select(tid, WORKER)
    env.assert_backed()

    t = env.task(tid)
    assert t['selected_worker'] == WORKER.as_hex
    assert int(t['escrow']) == 6 * GEN             # repriced to the bid
    assert env.balance(BUYER) == 4 * GEN           # surplus back, withdrawable
    assert env.withdraw(BUYER) == 4 * GEN          # and real

    with pytest.raises(Exception, match='EXPECTED.*different bidder'):
        env.accept(tid, sender=OTHER)              # losing bidder locked out
    env.accept(tid)                                # bond = 20% of 6 GEN
    assert int(env.task(tid)['bond']) == 6 * GEN * 20 // 100
    env.assert_backed()


def test_selected_lifecycle_settles_at_bid_price(env):
    tid = env.create(escrow=10 * GEN)
    env.bid(tid, 5 * GEN)
    env.select(tid, WORKER)
    env.accept(tid)
    env.llm_verdict([True, True, True])
    env.deliver(tid)
    env.set_time(env.task(tid)['window_ends_ms'] + 1)
    env.set_sender(BUYER)
    env.contract.finalize(tid)
    # worker: bid price + bond back; buyer already reclaimed the surplus
    assert env.balance(WORKER) == 5 * GEN + 1 * GEN
    env.assert_backed()


def test_reselect_downward_ok_upward_rejected(env):
    """Re-selecting a bid is allowed but only to reprice DOWN. An upward
    re-select would inflate escrow without re-locking custody while the
    first surplus already left as a claim — over-extraction + cross-task
    insolvency. Downward reselection stays exactly backed."""
    tid = env.create(escrow=10 * GEN)
    env.bid(tid, 8 * GEN, sender=OTHER)            # high bid
    env.bid(tid, 5 * GEN, sender=WORKER)           # low bid

    # Pick the low bid: escrow 10 -> 5, surplus 5 to buyer, exactly backed.
    env.select(tid, WORKER)
    assert int(env.task(tid)['escrow']) == 5 * GEN
    assert env.balance(BUYER) == 5 * GEN
    env.assert_backed()

    # Re-selecting the higher bid must be rejected — it would set escrow to
    # 8 against only 5 locked, letting the buyer keep the inflated surplus.
    env.set_sender(BUYER)
    with pytest.raises(Exception, match='reprice down'):
        env.contract.select_bid(tid, OTHER.as_hex)
    assert int(env.task(tid)['escrow']) == 5 * GEN  # unchanged
    env.assert_backed()

    # A further downward reprice is still fine.
    env.bid(tid, 3 * GEN, sender=WORKER)
    env.select(tid, WORKER)
    assert int(env.task(tid)['escrow']) == 3 * GEN
    assert env.balance(BUYER) == 7 * GEN            # 5 + 2 more surplus
    env.assert_backed()


def test_select_requires_buyer_and_existing_bid(env):
    tid = env.create(escrow=10 * GEN)
    env.bid(tid, 5 * GEN)
    env.set_sender(OTHER)
    with pytest.raises(Exception, match='EXPECTED.*buyer'):
        env.contract.select_bid(tid, WORKER.as_hex)
    env.set_sender(BUYER)
    with pytest.raises(Exception, match='EXPECTED.*no bid'):
        env.contract.select_bid(tid, OTHER.as_hex)


# ----------------------------------------------------------------------
# FR-9 — milestone escrow groups
# ----------------------------------------------------------------------

MILESTONES = [
    ('Research', ('sources listed',), 2 * GEN),
    ('Draft', ('draft covers outline', 'no placeholder text'), 3 * GEN),
    ('Final', ('all feedback addressed',), 5 * GEN),
]


def test_group_creates_fully_funded_stages(env):
    gid = env.create_group(MILESTONES)
    group = json.loads(env.contract.get_group(gid))
    assert [int(t['escrow']) for t in group] == [2 * GEN, 3 * GEN, 5 * GEN]
    assert [t['group_index'] for t in group] == [0, 1, 2]
    assert all(t['group_size'] == 3 for t in group)
    assert env.custody == 10 * GEN                 # every stage funded upfront
    env.assert_backed()


def test_group_value_must_equal_stage_sum(env):
    payload = json.dumps([
        {'title': 'a', 'criteria': ['c'], 'amount': 2 * GEN},
        {'title': 'b', 'criteria': ['c'], 'amount': 3 * GEN},
    ])
    with pytest.raises(Exception, match='EXPECTED.*sum to the attached value'):
        env.pay(BUYER, 4 * GEN, env.contract.create_task_group,
                'P', 'sla', payload, T0 + 86_400_000)
    assert env.custody == 0                        # underfunded group reverted


def test_milestone_pays_out_independently(env):
    gid = env.create_group(MILESTONES)
    group = json.loads(env.contract.get_group(gid))
    first = group[0]['id']
    env.accept(first)
    env.llm_verdict([True])
    env.deliver(first)
    env.set_time(env.task(first)['window_ends_ms'] + 1)
    env.set_sender(BUYER)
    env.contract.finalize(first)

    # Stage 1 paid (2 GEN + 0.4 bond); stages 2 and 3 still locked.
    assert env.balance(WORKER) == 2 * GEN + (2 * GEN * 20 // 100)
    v = env.vault()
    assert int(v['locked']) == 8 * GEN
    env.assert_backed()


def test_group_shape_validation(env):
    with pytest.raises(Exception, match='EXPECTED.*2-5'):
        env.create_group(MILESTONES[:1])
    with pytest.raises(Exception, match='EXPECTED.*below minimum'):
        env.create_group([('a', ('c',), GEN - 1), ('b', ('c',), 2 * GEN)])


# ----------------------------------------------------------------------
# FR-10 — reputation-gated bonds
# ----------------------------------------------------------------------

def _finish_met(env):
    tid = env.create(escrow=2 * GEN)
    env.accept(tid)
    env.llm_verdict([True, True, True])
    env.deliver(tid)
    env.set_time(env.task(tid)['window_ends_ms'] + 1)
    env.set_sender(BUYER)
    env.contract.finalize(tid)


def test_bond_tiers_follow_reputation(env):
    tid = env.create(escrow=10 * GEN)
    assert int(env.contract.get_required_bond(tid, WORKER.as_hex)) == 2 * GEN  # 20%

    for _ in range(3):                              # 3 × MET → score 6 → 15%
        _finish_met(env)
    tid2 = env.create(escrow=10 * GEN)
    assert int(env.contract.get_required_bond(tid2, WORKER.as_hex)) == 15 * GEN // 10

    for _ in range(2):                              # score 10 → 10%
        _finish_met(env)
    tid3 = env.create(escrow=10 * GEN)
    quote = int(env.contract.get_required_bond(tid3, WORKER.as_hex))
    assert quote == 1 * GEN                         # 10% of 10 GEN
    env.accept(tid3)                                # accept charges the quote
    assert int(env.task(tid3)['bond']) == quote
    env.assert_backed()


def test_underquoted_bond_rejected_for_fresh_worker(env):
    """A fresh worker cannot claim a veteran's discount."""
    tid = env.create(escrow=10 * GEN)
    with pytest.raises(Exception, match='EXPECTED.*worker bond'):
        env.accept(tid, sender=OTHER, bond=1 * GEN)  # 10% tier needs score ≥ 10
    env.accept(tid, sender=OTHER, bond=2 * GEN)      # 20% is the fresh rate
    env.assert_backed()
