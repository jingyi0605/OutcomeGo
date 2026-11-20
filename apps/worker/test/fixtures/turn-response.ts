export function turnResponse(produce: () => Promise<readonly unknown[]>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("\n"));
      void produce().then((events) => {
        for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        controller.close();
      }).catch((error) => controller.error(error));
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}
