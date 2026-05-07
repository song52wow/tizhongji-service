import { resetDb, getDb, closeDb } from '../src/db';
import {
  createReminder,
  listReminders,
  updateReminder,
  deleteReminder,
} from '../src/reminder';

beforeEach(() => {
  resetDb();
  getDb(true);
});

afterAll(() => {
  closeDb();
});

describe('createReminder', () => {
  it('should create a reminder with valid input', () => {
    const result = createReminder({
      userId: 'user1',
      remindTime: '08:00',
      period: 'morning',
    });

    expect(result).not.toHaveProperty('success', false);
    const reminder = result as any;
    expect(reminder.userId).toBe('user1');
    expect(reminder.remindTime).toBe('08:00');
    expect(reminder.period).toBe('morning');
    expect(reminder.enabled).toBe(true);
    expect(reminder.id).toBeDefined();
    expect(reminder.createdAt).toBeDefined();
    expect(reminder.updatedAt).toBeDefined();
  });

  it('should create a reminder with enabled=false', () => {
    const result = createReminder({
      userId: 'user1',
      remindTime: '20:00',
      period: 'evening',
      enabled: false,
    });

    const reminder = result as any;
    expect(reminder.enabled).toBe(false);
  });

  it('should reject empty userId', () => {
    const result = createReminder({
      userId: '',
      remindTime: '08:00',
      period: 'morning',
    });

    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('userId');
  });

  it('should reject invalid remindTime format', () => {
    const result = createReminder({
      userId: 'user1',
      remindTime: '25:00',
      period: 'morning',
    });

    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('remindTime');
  });

  it('should reject invalid period', () => {
    const result = createReminder({
      userId: 'user1',
      remindTime: '08:00',
      period: 'afternoon' as any,
    });

    expect(result).toHaveProperty('success', false);
    expect((result as any).error).toContain('period');
  });

  it('should reject missing remindTime', () => {
    const result = createReminder({
      userId: 'user1',
      remindTime: '',
      period: 'morning',
    });

    expect(result).toHaveProperty('success', false);
  });
});

describe('listReminders', () => {
  it('should return empty list for a user with no reminders', () => {
    const result = listReminders('nonexistent');
    expect(result).toEqual([]);
  });

  it('should list all reminders for a user ordered by remind_time', () => {
    createReminder({ userId: 'user1', remindTime: '20:00', period: 'evening' });
    createReminder({ userId: 'user1', remindTime: '08:00', period: 'morning' });

    const result = listReminders('user1');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    // Should be ordered by remind_time ASC
    expect((result as any)[0].remindTime).toBe('08:00');
    expect((result as any)[1].remindTime).toBe('20:00');
  });

  it('should not return reminders from other users', () => {
    createReminder({ userId: 'user1', remindTime: '08:00', period: 'morning' });
    createReminder({ userId: 'user2', remindTime: '20:00', period: 'evening' });

    const result = listReminders('user1');
    expect(result).toHaveLength(1);
    expect((result as any)[0].userId).toBe('user1');
  });

  it('should reject empty userId', () => {
    const result = listReminders('');
    expect(result).toHaveProperty('success', false);
  });
});

describe('updateReminder', () => {
  it('should update remindTime', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user1', { remindTime: '09:00' });
    expect((result as any).remindTime).toBe('09:00');
    expect((result as any).period).toBe('morning');
  });

  it('should update enabled status', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user1', { enabled: false });
    expect((result as any).enabled).toBe(false);
  });

  it('should update period', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user1', { period: 'both' });
    expect((result as any).period).toBe('both');
  });

  it('should return 404 for non-existent reminder', () => {
    const result = updateReminder('nonexistent', 'user1', { enabled: false });
    expect(result).toHaveProperty('success', false);
    expect((result as any).statusCode).toBe(404);
  });

  it('should return 404 when updating another user reminder', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user2', { enabled: false });
    expect(result).toHaveProperty('success', false);
    expect((result as any).statusCode).toBe(404);
  });

  it('should reject invalid remindTime on update', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user1', { remindTime: '99:99' });
    expect(result).toHaveProperty('success', false);
  });

  it('should reject invalid period on update', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = updateReminder(created.id, 'user1', { period: 'afternoon' as any });
    expect(result).toHaveProperty('success', false);
  });
});

describe('deleteReminder', () => {
  it('should delete an existing reminder', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = deleteReminder(created.id, 'user1');
    expect(result).toBe(true);

    const list = listReminders('user1');
    expect(list).toHaveLength(0);
  });

  it('should return 404 when deleting non-existent reminder', () => {
    const result = deleteReminder('nonexistent', 'user1');
    expect(result).toHaveProperty('success', false);
    expect((result as any).statusCode).toBe(404);
  });

  it('should return 404 when deleting another user reminder', () => {
    const created = createReminder({
      userId: 'user1', remindTime: '08:00', period: 'morning',
    }) as any;

    const result = deleteReminder(created.id, 'user2');
    expect(result).toHaveProperty('success', false);
    expect((result as any).statusCode).toBe(404);
  });
});
