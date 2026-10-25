/** Minimal XML parser used for legacy partner feeds. */
export class XMLParser {
  parse(text: string): string[] {
    return text.match(/<[^>]+>/g) ?? [];
  }
}

export class HTTPServer {
  start(): void {}
}
