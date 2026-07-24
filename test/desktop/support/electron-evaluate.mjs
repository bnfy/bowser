const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isTransientElectronEvaluationError(error) {
  return /Execution context was destroyed/i.test(String(error?.message || error));
}

export async function evaluateElectronAppWithRetry(
  electronApp,
  evaluator,
  { timeoutMs = 2_000, retryMs = 50 } = {}
) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      return await electronApp.evaluate(evaluator);
    } catch (error) {
      if (!isTransientElectronEvaluationError(error) || Date.now() >= deadline) {
        throw error;
      }
      await sleep(retryMs);
    }
  }
}
