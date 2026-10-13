export class UnparsedProviderOutput {
  constructor(readonly rawText: string) {}
}

export function parseProviderJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    return new UnparsedProviderOutput(outputText);
  }
}
