/**
 * Utility functions for handling timeouts in async operations
 */

export interface TimeoutOptions {
  timeoutMs: number;
  errorMessage?: string;
  onTimeout?: () => void;
}

/**
 * Creates a promise that rejects after a specified timeout
 */
export function createTimeoutPromise<T = never>(
  timeoutMs: number,
  errorMessage: string = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> {
  return new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
}

/**
 * Wraps a promise with a timeout, racing the original promise against a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs, errorMessage, onTimeout } = options;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (onTimeout) {
        onTimeout();
      }
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Validates and clamps timeout values to reasonable bounds
 */
export function validateTimeout(
  timeout: number,
  min: number = 1000,
  max: number = 30000,
): number {
  return Math.min(Math.max(timeout, min), max);
}

/**
 * Creates a timeout wrapper for SNMP operations with logging
 */
export async function withSNMPTimeout<T>(
  promise: Promise<T>,
  deviceName: string,
  deviceIP: string,
  timeoutMs: number,
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await withTimeout(promise, {
      timeoutMs,
      errorMessage: `SNMP timeout after ${timeoutMs}ms for ${deviceName} (${deviceIP})`,
      onTimeout: () => {
        console.warn(
          `[SNMP] ⏰ Timeout after ${timeoutMs}ms for ${deviceName} (${deviceIP})`,
        );
      },
    });

    const duration = Date.now() - startTime;
    console.debug(
      `[SNMP] ✅ Operation completed for ${deviceName} (${deviceIP}) in ${duration}ms`,
    );

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message.includes('timeout');

    if (isTimeout) {
      console.warn(
        `[SNMP] ⏰ Timeout for ${deviceName} (${deviceIP}) after ${duration}ms`,
      );
    } else {
      console.error(
        `[SNMP] ❌ Error for ${deviceName} (${deviceIP}) after ${duration}ms:`,
        error,
      );
    }

    throw error;
  }
}
