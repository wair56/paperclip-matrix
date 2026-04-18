declare module "vitest" {
  type ImportOriginal = <T = unknown>() => Promise<T>;
  export const describe: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const test: (...args: any[]) => any;
  export const expect: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => any;
  export const afterEach: (...args: any[]) => any;
  export const beforeAll: (...args: any[]) => any;
  export const afterAll: (...args: any[]) => any;
  export const vi: {
    fn: (...args: any[]) => any;
    mock: (path: string, factory?: (importOriginal: ImportOriginal) => any) => any;
    hoisted: <T>(factory: () => T) => T;
    resetAllMocks: (...args: any[]) => any;
    clearAllMocks: (...args: any[]) => any;
    restoreAllMocks: (...args: any[]) => any;
  };
}
