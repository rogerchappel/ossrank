import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legitimacyScore,
  momentumScore,
  movement,
  rankContributors,
  rankProjectMomentum,
  rankProjects,
  rankRisingContributors
} from '../src/lib/ranking.js';
import type { RankedContributor, RankedProject } from '../src/lib/types.js';

function contributor(overrides: Partial<Omit<RankedContributor, 'rank'>>): Omit<RankedContributor, 'rank'> {
  return {
    login: 'builder',
    profile_url: 'https://github.com/builder',
    public_contributions: 0,
    observed_public_commits: 0,
    observed_public_pull_requests: 0,
    public_repos: 0,
    followers: 0,
    ...overrides
  };
}

function project(overrides: Partial<Omit<RankedProject, 'rank'>>): Omit<RankedProject, 'rank'> {
  return {
    full_name: 'rogerchappel/tool',
    url: 'https://github.com/rogerchappel/tool',
    stars: 0,
    pull_requests_merged_7d: 0,
    active_contributors_30d: 0,
    ...overrides
  };
}

test('rankContributors uses adjusted commit signals before secondary public signals', () => {
  const bursty = contributor({
    login: 'bursty',
    public_contributions: 900,
    observed_public_commits: 900,
    contribution_burst_adjustment: {
      raw_public_commits: 900,
      adjusted_public_commits: 90,
      baseline_daily_contributions: 2,
      daily_burst_cap: 40,
      capped_days: 3,
      excess_contributions: 810,
      reason: 'fixture burst'
    },
    followers: 100
  });
  const steady = contributor({
    login: 'steady',
    public_contributions: 200,
    observed_public_commits: 200,
    followers: 1
  });

  assert.deepEqual(rankContributors([bursty, steady]).map((entry) => entry.login), ['steady', 'bursty']);
});

test('rankContributors tie-breaks on pull requests, repositories, followers, then login', () => {
  const entries = [
    contributor({ login: 'zeta', observed_public_commits: 10, observed_public_pull_requests: 1, public_repos: 1, followers: 1 }),
    contributor({ login: 'alpha', observed_public_commits: 10, observed_public_pull_requests: 1, public_repos: 1, followers: 1 }),
    contributor({ login: 'repos', observed_public_commits: 10, observed_public_pull_requests: 1, public_repos: 2, followers: 1 }),
    contributor({ login: 'prs', observed_public_commits: 10, observed_public_pull_requests: 2, public_repos: 0, followers: 1 })
  ];

  assert.deepEqual(rankContributors(entries).map((entry) => entry.login), ['prs', 'repos', 'alpha', 'zeta']);
});

test('project rankings prefer sustained pull request activity over stars', () => {
  const active = project({
    full_name: 'rogerchappel/active',
    stars: 50,
    pull_requests_merged_7d: 2,
    pull_requests_merged_30d: 20,
    recent_commits_30d: 10,
    active_contributors_30d: 4
  });
  const popularIdle = project({
    full_name: 'rogerchappel/popular-idle',
    stars: 5000,
    pull_requests_merged_7d: 1,
    pull_requests_merged_30d: 1,
    recent_commits_30d: 2,
    active_contributors_30d: 1
  });

  assert.equal(rankProjects([popularIdle, active])[0].full_name, 'rogerchappel/active');
  assert.equal(rankProjectMomentum([popularIdle, active])[0].full_name, 'rogerchappel/active');
  assert.ok(momentumScore(active) > momentumScore(popularIdle));
  assert.ok(legitimacyScore(popularIdle) > 0);
});

test('rising contributors and movement labels stay deterministic', () => {
  const newBuilder = contributor({ login: 'new-builder', observed_public_commits: 120, observed_public_pull_requests: 6, public_repos: 3, followers: 1 });
  const famousBuilder = contributor({ login: 'famous-builder', observed_public_commits: 125, observed_public_pull_requests: 6, public_repos: 3, followers: 5000 });

  assert.equal(rankRisingContributors([famousBuilder, newBuilder])[0].login, 'new-builder');
  assert.equal(movement({ rank: 3 }), 'new');
  assert.equal(movement({ rank: 3, previous_rank: 3 }), 'steady');
  assert.equal(movement({ rank: 2, previous_rank: 5 }), '↑ 3');
  assert.equal(movement({ rank: 5, previous_rank: 2 }), '↓ 3');
});
