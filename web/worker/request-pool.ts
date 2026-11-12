import type { Fetcher } from "./provider";

// A combined refresh shares the existing five-read ceiling across providers.
// Hold each slot through body consumption/cancellation, not just response headers.
export function pooledFetcher(fetcher: Fetcher, limit = 5): Fetcher {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (request) => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = waiting.shift();
      if (next) next();
      else active--;
    };
    try {
      request.signal.throwIfAborted();
      const response = await fetcher(request);
      if (!response.body) {
        release();
        return response;
      }
      const reader = response.body.getReader();
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) {
                release();
                controller.close();
              } else controller.enqueue(result.value);
            } catch (error) {
              release();
              controller.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              release();
            }
          },
        }),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } catch (error) {
      release();
      throw error;
    }
  };
}
