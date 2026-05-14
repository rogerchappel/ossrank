import assert from 'node:assert/strict';
import { contributionBurstAdjustment, contributorCommitSignal, rankContributors } from '../src/lib/ranking.js';
import type { RankedContributor } from '../src/lib/types.js';

function days(normal: number, burst: number, burstDays: number): number[] {
  return [...Array(365 - burstDays).fill(normal), ...Array(burstDays).fill(burst)];
}

const quietAccountBurst = contributionBurstAdjustment(7007, days(1, 1000, 7));
assert(quietAccountBurst, 'low-baseline 1/day -> 1000/day burst should be adjusted');
assert.equal(quietAccountBurst.daily_burst_cap, 20);
assert.equal(quietAccountBurst.capped_days, 7);
assert.equal(quietAccountBurst.adjusted_public_commits, 147);

assert.equal(
  contributionBurstAdjustment(41980, days(200, 4000, 7)),
  undefined,
  'high-baseline 200/day -> 4000/day should be allowed'
);

assert.equal(
  contributionBurstAdjustment(42140, days(20, 6000, 7)),
  undefined,
  'established 20/day -> 6000/day should be allowed by the adaptive cap'
);

const adjusted: Omit<RankedContributor, 'rank'> = {
  login: 'burst-account',
  profile_url: 'https://github.com/burst-account',
  public_contributions: 7007,
  observed_public_commits: 7007,
  contribution_burst_adjustment: quietAccountBurst,
  followers: 1
};
const steady: Omit<RankedContributor, 'rank'> = {
  login: 'steady-builder',
  profile_url: 'https://github.com/steady-builder',
  public_contributions: 500,
  observed_public_commits: 500,
  followers: 1
};
assert.equal(contributorCommitSignal(adjusted), 147);
assert.equal(rankContributors([adjusted, steady])[0].login, 'steady-builder');

console.log('Burst adjustment checks passed');
