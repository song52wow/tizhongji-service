# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: weight-record.e2e.spec.ts >> Weight Record E2E Tests >> Statistics Endpoint >> stats respects date range filter
- Location: tests/e2e/weight-record.e2e.spec.ts:381:9

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 70
Received: 66
```

# Test source

```ts
  297 | 
  298 |       await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
  299 |       await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);
  300 | 
  301 |       const response = await ctx.get(`${BASE_URL}/weight-records?period=morning`, { headers });
  302 |       const body = await response.json();
  303 | 
  304 |       expect(body.items.every((item: any) => item.period === 'morning')).toBe(true);
  305 |     });
  306 | 
  307 |     test('filters records by evening period', async () => {
  308 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  309 |       const headers = createAuthHeaders(testUserId);
  310 |       const today = getToday();
  311 | 
  312 |       await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
  313 |       await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);
  314 | 
  315 |       const response = await ctx.get(`${BASE_URL}/weight-records?period=evening`, { headers });
  316 |       const body = await response.json();
  317 | 
  318 |       expect(body.items.every((item: any) => item.period === 'evening')).toBe(true);
  319 |     });
  320 | 
  321 |     test('calculates weight diff when both morning and evening exist', async () => {
  322 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  323 |       const headers = createAuthHeaders(testUserId);
  324 |       const today = getToday();
  325 | 
  326 |       await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
  327 |       await createWeightRecord(ctx, testUserId, today, 'evening', 66.5);
  328 | 
  329 |       const response = await ctx.get(`${BASE_URL}/weight-records`, { headers });
  330 |       const body = await response.json();
  331 | 
  332 |       const todayItems = body.items.filter((item: any) => item.date === today);
  333 |       const morning = todayItems.find((item: any) => item.period === 'morning');
  334 |       const evening = todayItems.find((item: any) => item.period === 'evening');
  335 | 
  336 |       expect(morning.weightDiff).toBeCloseTo(1.5, 1);
  337 |       expect(evening.weightDiff).toBeCloseTo(1.5, 1);
  338 |     });
  339 |   });
  340 | 
  341 |   test.describe('Statistics Endpoint', () => {
  342 |     test('calculates stats for weight records', async () => {
  343 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  344 |       const headers = createAuthHeaders(testUserId);
  345 |       const today = getToday();
  346 |       const yesterday = getYesterday();
  347 | 
  348 |       await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
  349 |       await createWeightRecord(ctx, testUserId, yesterday, 'evening', 66.0);
  350 |       await createWeightRecord(ctx, testUserId, today, 'morning', 64.5);
  351 |       await createWeightRecord(ctx, testUserId, today, 'evening', 65.8);
  352 | 
  353 |       const response = await ctx.get(`${BASE_URL}/weight-records/stats`, { headers });
  354 |       expect(response.status()).toBe(200);
  355 |       const body = await response.json();
  356 | 
  357 |       expect(body.avgMorningWeight).toBeDefined();
  358 |       expect(body.avgEveningWeight).toBeDefined();
  359 |       expect(body.minWeight).toBeDefined();
  360 |       expect(body.maxWeight).toBeDefined();
  361 |       expect(body.change).toBeDefined();
  362 |       expect(body.avgWeightDiff).toBeDefined();
  363 |     });
  364 | 
  365 |     test('stats returns null for avg fields when no records', async () => {
  366 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  367 |       const headers = createAuthHeaders('user-with-no-records-' + Date.now());
  368 | 
  369 |       const response = await ctx.get(`${BASE_URL}/weight-records/stats`, { headers });
  370 |       expect(response.status()).toBe(200);
  371 |       const body = await response.json();
  372 | 
  373 |       expect(body.avgMorningWeight).toBeNull();
  374 |       expect(body.avgEveningWeight).toBeNull();
  375 |       expect(body.minWeight).toBeNull();
  376 |       expect(body.maxWeight).toBeNull();
  377 |       expect(body.change).toBeNull();
  378 |       expect(body.avgWeightDiff).toBeNull();
  379 |     });
  380 | 
  381 |     test('stats respects date range filter', async () => {
  382 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  383 |       const headers = createAuthHeaders(testUserId);
  384 |       const today = getToday();
  385 |       const yesterday = getYesterday();
  386 | 
  387 |       await createWeightRecord(ctx, testUserId, yesterday, 'morning', 70.0);
  388 |       await createWeightRecord(ctx, testUserId, today, 'morning', 65.0);
  389 | 
  390 |       const response = await ctx.get(
  391 |         `${BASE_URL}/weight-records/stats?startDate=${yesterday}&endDate=${yesterday}`,
  392 |         { headers }
  393 |       );
  394 |       const body = await response.json();
  395 | 
  396 |       // Should only include yesterday's weight
> 397 |       expect(body.minWeight).toBe(70.0);
      |                              ^ Error: expect(received).toBe(expected) // Object.is equality
  398 |       expect(body.maxWeight).toBe(70.0);
  399 |     });
  400 |   });
  401 | 
  402 |   test.describe('Pagination and Listing', () => {
  403 |     test('lists weight records with pagination', async () => {
  404 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  405 |       const headers = createAuthHeaders(testUserId);
  406 | 
  407 |       const response = await ctx.get(`${BASE_URL}/weight-records?page=1&pageSize=10`, { headers });
  408 |       expect(response.status()).toBe(200);
  409 |       const body = await response.json();
  410 | 
  411 |       expect(body.items).toBeDefined();
  412 |       expect(body.total).toBeDefined();
  413 |       expect(body.page).toBe(1);
  414 |       expect(body.pageSize).toBe(10);
  415 |     });
  416 | 
  417 |     test('lists weight records sorted by date ascending', async () => {
  418 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  419 |       const headers = createAuthHeaders(testUserId);
  420 |       const today = getToday();
  421 |       const yesterday = getYesterday();
  422 | 
  423 |       await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
  424 |       await createWeightRecord(ctx, testUserId, today, 'morning', 66.0);
  425 | 
  426 |       const response = await ctx.get(`${BASE_URL}/weight-records`, { headers });
  427 |       const body = await response.json();
  428 | 
  429 |       // Should be sorted by date ascending
  430 |       const dates = body.items.map((item: any) => item.date);
  431 |       expect(dates).toEqual([...dates].sort());
  432 |     });
  433 | 
  434 |     test('filters records by date range', async () => {
  435 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  436 |       const headers = createAuthHeaders(testUserId);
  437 |       const today = getToday();
  438 |       const yesterday = getYesterday();
  439 | 
  440 |       await createWeightRecord(ctx, testUserId, yesterday, 'morning', 65.0);
  441 |       await createWeightRecord(ctx, testUserId, today, 'morning', 66.0);
  442 | 
  443 |       const response = await ctx.get(
  444 |         `${BASE_URL}/weight-records?startDate=${yesterday}&endDate=${yesterday}`,
  445 |         { headers }
  446 |       );
  447 |       const body = await response.json();
  448 | 
  449 |       expect(body.items.every((item: any) => item.date === yesterday)).toBe(true);
  450 |     });
  451 |   });
  452 | 
  453 |   test.describe('Auth Header Variations', () => {
  454 |     test('requires both X-User-Id and X-User-Signature', async () => {
  455 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  456 | 
  457 |       // Only X-User-Id
  458 |       const resp1 = await ctx.get('/weight-records', {
  459 |         headers: { 'X-User-Id': testUserId, 'Content-Type': 'application/json' },
  460 |       });
  461 |       expect(resp1.status()).toBe(401);
  462 | 
  463 |       // Only X-User-Signature
  464 |       const resp2 = await ctx.get('/weight-records', {
  465 |         headers: { 'X-User-Signature': 'abc123', 'Content-Type': 'application/json' },
  466 |       });
  467 |       expect(resp2.status()).toBe(401);
  468 |     });
  469 | 
  470 |     test('user isolation - different users cannot see each others records', async () => {
  471 |       const ctx = await request.newContext({ baseURL: BASE_URL });
  472 |       const user1 = testUserId + '-isolate-1';
  473 |       const user2 = testUserId + '-isolate-2';
  474 |       const today = getToday();
  475 | 
  476 |       // User 1 creates a record
  477 |       await createWeightRecord(ctx, user1, today, 'morning', 65.0, 'user1 record');
  478 | 
  479 |       // User 2 queries - should get empty or different records
  480 |       const headers2 = createAuthHeaders(user2);
  481 |       const response = await ctx.get(`${BASE_URL}/weight-records`, { headers: headers2 });
  482 |       const body = await response.json();
  483 | 
  484 |       const user1Records = body.items.filter((item: any) => item.note === 'user1 record');
  485 |       expect(user1Records.length).toBe(0);
  486 |     });
  487 |   });
  488 | });
```