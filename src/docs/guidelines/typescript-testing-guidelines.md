---
title: TypeScript Testing Guidelines
description: Integration testing patterns for TypeScript -- test behavior and data flow, not mock existence
---
# TypeScript Testing Guidelines

Integration tests should verify that components work together correctly by testing real
interactions, data flow, error handling, business scenarios, and data contracts -- not
that mocks exist or methods are called.

## 1. Test Real System Interactions, Not Mock Existence

Don't test that mocks were created correctly. Test actual system behavior with
dependencies:

```typescript
// Bad -- tests nothing useful
it("should have all required methods", () => {
  const mockService = createMockService();
  expect(typeof mockService.process).toBe("function");
});

// Good -- tests real behavior
it("should process data through the pipeline", async () => {
  const mockDatabase = createMockDatabase();
  const processor = new DataProcessor(mockDatabase);
  await processor.handle(inputData);
  expect(mockDatabase.save).toHaveBeenCalledWith(
    expect.objectContaining({ processed: true }),
  );
});
```

## 2. Test Data Flow Between Components

Don't test isolated dependency calls. Test that data flows correctly through the system:

```typescript
it("should transform data correctly between services", async () => {
  const mockTransformer = createMockTransformer();
  const mockStorage = createMockStorage();
  const pipeline = new DataPipeline(mockTransformer, mockStorage);
  await pipeline.process(rawData);
  expect(mockTransformer.transform).toHaveBeenCalledWith(rawData);
  expect(mockStorage.store).toHaveBeenCalledWith(
    expect.objectContaining({ transformed: true }),
  );
});
```

## 3. Test Error Scenarios and Recovery

Don't only test the happy path. Test that error handling actually works:

```typescript
it("should retry when external service fails", async () => {
  const mockApi = vi
    .fn()
    .mockRejectedValueOnce(new Error("Network error"))
    .mockResolvedValueOnce({ success: true });
  const service = new ExternalService(mockApi);
  const result = await service.fetchWithRetry();
  expect(mockApi).toHaveBeenCalledTimes(2);
  expect(result.success).toBe(true);
});
```

## 4. Organize Tests Around Business Scenarios

Structure tests by what the system does, not how it's built:

```typescript
// Bad -- organized by technical component
describe("Database interface", () => { /* ... */ });

// Good -- organized by behavior
describe("Order processing workflow", () => {
  describe("when payment succeeds", () => {
    it("should update inventory");
    it("should send confirmation email");
  });
  describe("when payment fails", () => {
    it("should preserve cart contents");
    it("should notify user of failure");
  });
});
```

## 5. Validate Data Contracts

Don't just verify interactions happened. Verify the right data was passed:

```typescript
it("should pass complete user profile to recommendation engine", async () => {
  const mockRecommendations = createMockRecommendationService();
  const userService = new UserService(mockRecommendations);
  await userService.getRecommendations(userId);
  expect(mockRecommendations.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: expect.any(String),
      preferences: expect.any(Array),
      history: expect.any(Array),
    }),
  );
});
```

## Related Guidelines

- For TDD methodology, see `paw guidelines general-tdd-guidelines`
- For general test quality rules, see `paw guidelines general-testing-rules`
