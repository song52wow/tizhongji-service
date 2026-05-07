import { resetDb, getDb, closeDb } from '../src/db';
import { recordActivity, getAchievementStats } from '../src/achievement';
import { upsertWeightRecord } from '../src/weight-record';

beforeEach(() => {
  resetDb();
  getDb(true);
});

afterAll(() => {
  closeDb();
});

describe('recordActivity', () => {
  it('should record a login activity', () => {
    const result = recordActivity('user1', 'login', '2026-05-01');
    const activity = result as any;

    expect(activity.id).toBeDefined();
    expect(activity.userId).toBe('user1');
    expect(activity.activityType).toBe('login');
    expect(activity.date).toBe('2026-05-01');
    expect(activity.createdAt).toBeDefined();
  });

  it('should record a check_in activity', () => {
    const result = recordActivity('user1', 'check_in', '2026-05-01');
    expect(result).not.toHaveProperty('success', false);
  });

  it('should reject invalid activityType', () => {
    const result = recordActivity('user1', 'invalid' as any, '2026-05-01');
    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('activityType');
  });

  it('should reject empty userId', () => {
    const result = recordActivity('', 'login', '2026-05-01');
    expect(result).toHaveProperty('success', false);
  });

  it('should reject invalid date format', () => {
    const result = recordActivity('user1', 'login', '01-05-2026');
    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('date');
  });

  it('should return existing record for duplicate activity on same date', () => {
    const result1 = recordActivity('user1', 'login', '2026-05-01') as any;
    const result2 = recordActivity('user1', 'login', '2026-05-01') as any;

    // Should return same record (not create duplicate)
    expect(result1.id).toBe(result2.id);
  });

  it('should allow same type on different dates', () => {
    const result1 = recordActivity('user1', 'login', '2026-05-01') as any;
    const result2 = recordActivity('user1', 'login', '2026-05-02') as any;

    expect(result1.id).not.toBe(result2.id);
  });

  it('should allow different types on same date', () => {
    const result1 = recordActivity('user1', 'login', '2026-05-01') as any;
    const result2 = recordActivity('user1', 'check_in', '2026-05-01') as any;

    expect(result1.id).not.toBe(result2.id);
  });

  it('should store metadata when provided', () => {
    const result = recordActivity('user1', 'record_weight', '2026-05-01', 'weight=70.5') as any;
    expect(result.metadata).toBe('weight=70.5');
  });

  it('should trim whitespace from userId', () => {
    const result = recordActivity('  user1  ', 'login', '2026-05-01') as any;
    expect(result.userId).toBe('user1');
  });
});

describe('getAchievementStats', () => {
  it('should return all zeros for a new user', () => {
    const stats = getAchievementStats('newuser') as any;

    expect(stats.totalLoginDays).toBe(0);
    expect(stats.totalRecords).toBe(0);
    expect(stats.consecutiveRecordDays).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(0);
  });

  it('should count login days correctly', () => {
    recordActivity('user1', 'login', '2026-05-01');
    recordActivity('user1', 'login', '2026-05-02');
    recordActivity('user1', 'login', '2026-05-03');

    const stats = getAchievementStats('user1') as any;
    expect(stats.totalLoginDays).toBe(3);
  });

  it('should count only distinct login days', () => {
    recordActivity('user1', 'login', '2026-05-01');
    recordActivity('user1', 'login', '2026-05-01'); // duplicate

    const stats = getAchievementStats('user1') as any;
    expect(stats.totalLoginDays).toBe(1);
  });

  it('should count weight records from weight_records table', () => {
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-01', period: 'morning', weight: 70,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-01', period: 'evening', weight: 71,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-02', period: 'morning', weight: 69.5,
    });

    const stats = getAchievementStats('user1') as any;
    expect(stats.totalRecords).toBe(3);
    expect(stats.consecutiveRecordDays).toBe(2);
  });

  it('should calculate streaks correctly for consecutive days', () => {
    // Record weight on consecutive days
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-01', period: 'morning', weight: 70,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-02', period: 'morning', weight: 69.5,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-03', period: 'morning', weight: 69,
    });

    const stats = getAchievementStats('user1') as any;
    expect(stats.longestStreak).toBe(3);
  });

  it('should calculate streaks with gaps correctly', () => {
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-01', period: 'morning', weight: 70,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-02', period: 'morning', weight: 69.5,
    });
    // gap on 5/3
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-04', period: 'morning', weight: 69,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-05', period: 'morning', weight: 68.5,
    });

    const stats = getAchievementStats('user1') as any;
    expect(stats.longestStreak).toBe(2);
  });

  it('should count combined activity stats', () => {
    recordActivity('user1', 'login', '2026-05-01');
    recordActivity('user1', 'login', '2026-05-02');
    recordActivity('user1', 'check_in', '2026-05-02');
    recordActivity('user1', 'login', '2026-05-03');

    upsertWeightRecord({
      userId: 'user1', date: '2026-05-01', period: 'morning', weight: 70,
    });
    upsertWeightRecord({
      userId: 'user1', date: '2026-05-02', period: 'morning', weight: 69.5,
    });

    const stats = getAchievementStats('user1') as any;
    expect(stats.totalLoginDays).toBe(3);
    expect(stats.totalRecords).toBe(2);
    expect(stats.consecutiveRecordDays).toBe(2);
  });

  it('should reject empty userId', () => {
    const result = getAchievementStats('');
    expect(result).toHaveProperty('success', false);
  });
});
