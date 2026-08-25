declare module '@deepseek-ai/cordis' {
  export interface Context {
    tools: { register(tool: unknown): void }
    logger: { info(format?: unknown, ...values: unknown[]): void }
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolOutputChunk {
    type: string
    text: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(args: any, value: string): ToolOutputChunk[]
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute(args: any): Promise<any>
  }

  export function defineTool(definition: ToolDefinition): ToolDefinition
}

declare module '@deepseek-ai/schemastery' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface z<T = any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default(value: T): z<T>
    required(): z<T>
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function z<T = any>(definition?: unknown): z<T>

  namespace z {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function object(fields: Record<string, unknown>): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function union(options: readonly unknown[]): any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function array(item: unknown): any
    function string(): z<string>
    function number(): z<number>
  }

  export default z
}
