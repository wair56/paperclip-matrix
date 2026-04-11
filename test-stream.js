export function foo() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      //...
    }
  });
}
