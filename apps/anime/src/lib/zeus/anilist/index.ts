/* eslint-disable */

import { AllTypesProps, Ops, ReturnTypes } from "./const";

export const HOST = "Specify host";

export const HEADERS = {};
export const apiSubscription = (options: chainOptions) => (query: string) => {
  try {
    const queryString = `${options[0]}?query=${encodeURIComponent(query)}`;
    const wsString = queryString.replace("http", "ws");
    const host = (options.length > 1 && options[1]?.websocket?.[0]) || wsString;
    const webSocketOptions = options[1]?.websocket || [host];
    const ws = new WebSocket(...webSocketOptions);
    return {
      ws,
      on: (e: (args: any) => void) => {
        ws.onmessage = (event: any) => {
          if (event.data) {
            const parsed = JSON.parse(event.data);
            const data = parsed.data;
            return e(data);
          }
        };
      },
      off: (e: (args: any) => void) => {
        ws.onclose = e;
      },
      error: (e: (args: any) => void) => {
        ws.onerror = e;
      },
      open: (e: () => void) => {
        ws.onopen = e;
      },
    };
  } catch {
    throw new Error("No websockets implemented");
  }
};
export const apiSubscriptionSSE =
  (options: chainOptions) =>
  (query: string, variables?: Record<string, unknown>) => {
    const url = options[0];
    const fetchOptions = options[1] || {};

    let abortController: AbortController | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let onCallback: ((args: unknown) => void) | null = null;
    let errorCallback: ((args: unknown) => void) | null = null;
    let openCallback: (() => void) | null = null;
    let offCallback: ((args: unknown) => void) | null = null;
    let isClosing = false; // Flag to track intentional close

    const startStream = async () => {
      try {
        abortController = new AbortController();

        const response = await fetch(url, {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            ...fetchOptions.headers,
          },
          body: JSON.stringify({ query, variables }),
          signal: abortController.signal,
          ...fetchOptions,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (openCallback) {
          openCallback();
        }

        reader = response.body?.getReader() || null;
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (offCallback) {
              offCallback({
                data: null,
                code: 1000,
                reason: "Stream completed",
              });
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = line.slice(6);
                const parsed = JSON.parse(data);

                if (parsed.errors) {
                  if (errorCallback) {
                    errorCallback({ data: parsed.data, errors: parsed.errors });
                  }
                } else if (onCallback && parsed.data) {
                  onCallback(parsed.data);
                }
              } catch {
                if (errorCallback) {
                  errorCallback({ errors: ["Failed to parse SSE data"] });
                }
              }
            }
          }
        }
      } catch (err: unknown) {
        const error = err as Error;
        // Don't report errors if we're intentionally closing (AbortError) or during cleanup
        if (error.name !== "AbortError" && !isClosing && errorCallback) {
          errorCallback({ errors: [error.message || "Unknown error"] });
        }
      }
    };

    return {
      on: (e: (args: unknown) => void) => {
        onCallback = e;
      },
      off: (e: (args: unknown) => void) => {
        offCallback = e;
      },
      error: (e: (args: unknown) => void) => {
        errorCallback = e;
      },
      open: (e?: () => void) => {
        if (e) {
          openCallback = e;
        }
        startStream();
      },
      close: () => {
        isClosing = true; // Mark as intentionally closing to suppress error callbacks
        if (abortController) {
          abortController.abort();
        }
        if (reader) {
          // Wrap in try-catch to suppress AbortError during cleanup
          reader.cancel().catch(() => {
            // Ignore cancel errors - stream may already be closed
          });
        }
      },
    };
  };
const handleFetchResponse = (response: Response): Promise<GraphQLResponse> => {
  if (!response.ok) {
    return new Promise((_, reject) => {
      response
        .text()
        .then((text) => {
          try {
            reject(JSON.parse(text));
          } catch (_err) {
            reject(text);
          }
        })
        .catch(reject);
    });
  }
  return response.json() as Promise<GraphQLResponse>;
};

export const apiFetch =
  (options: fetchOptions) =>
  (query: string, variables: Record<string, unknown> = {}) => {
    const fetchOptions = options[1] || {};
    if (fetchOptions.method && fetchOptions.method === "GET") {
      return fetch(
        `${options[0]}?query=${encodeURIComponent(query)}`,
        fetchOptions,
      )
        .then(handleFetchResponse)
        .then((response: GraphQLResponse) => {
          if (response.errors) {
            throw new GraphQLError(response);
          }
          return response.data;
        });
    }
    return fetch(`${options[0]}`, {
      body: JSON.stringify({ query, variables }),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      ...fetchOptions,
    })
      .then(handleFetchResponse)
      .then((response: GraphQLResponse) => {
        if (response.errors) {
          throw new GraphQLError(response);
        }
        return response.data;
      });
  };

export const InternalsBuildQuery = ({
  ops,
  props,
  returns,
  options,
  scalars,
}: {
  props: AllTypesPropsType;
  returns: ReturnTypesType;
  ops: Operations;
  options?: OperationOptions;
  scalars?: ScalarDefinition;
}) => {
  const ibb = (
    k: string,
    o: InputValueType | VType,
    p = "",
    root = true,
    vars: Array<{ name: string; graphQLType: string }> = [],
  ): string => {
    const keyForPath = purifyGraphQLKey(k);
    const newPath = [p, keyForPath].join(SEPARATOR);
    if (!o) {
      return "";
    }
    if (typeof o === "boolean" || typeof o === "number") {
      return k;
    }
    if (typeof o === "string") {
      return `${k} ${o}`;
    }
    if (Array.isArray(o)) {
      const args = InternalArgsBuilt({
        props,
        returns,
        ops,
        scalars,
        vars,
      })(o[0], newPath);
      return `${ibb(args ? `${k}(${args})` : k, o[1], p, false, vars)}`;
    }
    if (k === "__alias") {
      return Object.entries(o)
        .map(([alias, objectUnderAlias]) => {
          if (
            typeof objectUnderAlias !== "object" ||
            Array.isArray(objectUnderAlias)
          ) {
            throw new Error(
              "Invalid alias it should be __alias:{ YOUR_ALIAS_NAME: { OPERATION_NAME: { ...selectors }}}",
            );
          }
          const operationName = Object.keys(objectUnderAlias)[0];
          const operation = objectUnderAlias[operationName];
          return ibb(`${alias}:${operationName}`, operation, p, false, vars);
        })
        .join("\n");
    }
    const hasOperationName =
      root && options?.operationName ? ` ${options.operationName}` : "";
    const keyForDirectives = o.__directives ?? "";
    const query = `{${Object.entries(o)
      .filter(([k]) => k !== "__directives")
      .map((e) =>
        ibb(...e, [p, `field<>${keyForPath}`].join(SEPARATOR), false, vars),
      )
      .join("\n")}}`;
    if (!root) {
      return `${k} ${keyForDirectives}${hasOperationName} ${query}`;
    }
    const varsString = vars
      .map((v) => `${v.name}: ${v.graphQLType}`)
      .join(", ");
    return `${k} ${keyForDirectives}${hasOperationName}${varsString ? `(${varsString})` : ""} ${query}`;
  };
  return ibb;
};

type UnionOverrideKeys<T, U> = Omit<T, keyof U> & U;

export const Thunder =
  <SCLR extends ScalarDefinition>(
    fn: FetchFunction,
    thunderGraphQLOptions?: ThunderGraphQLOptions<SCLR>,
  ) =>
  <
    O extends keyof typeof Ops,
    OVERRIDESCLR extends SCLR,
    R extends keyof ValueTypes = GenericOperation<O>,
  >(
    operation: O,
    graphqlOptions?: ThunderGraphQLOptions<OVERRIDESCLR>,
  ) =>
  <Z extends ValueTypes[R]>(
    o: Z & {
      [P in keyof Z]: P extends keyof ValueTypes[R] ? Z[P] : never;
    },
    ops?: OperationOptions & { variables?: Record<string, unknown> },
  ) => {
    const options = {
      ...thunderGraphQLOptions,
      ...graphqlOptions,
    };
    return fn(
      Zeus(operation, o, {
        operationOptions: ops,
        scalars: options?.scalars,
      }),
      ops?.variables,
    ).then((data) => {
      if (options?.scalars) {
        return decodeScalarsInResponse({
          response: data,
          initialOp: operation,
          initialZeusQuery: o as VType,
          returns: ReturnTypes,
          scalars: options.scalars,
          ops: Ops,
        });
      }
      return data;
    }) as Promise<
      InputType<GraphQLTypes[R], Z, UnionOverrideKeys<SCLR, OVERRIDESCLR>>
    >;
  };

export const Chain = (...options: chainOptions) => Thunder(apiFetch(options));

export const SubscriptionThunder =
  <SCLR extends ScalarDefinition>(
    fn: SubscriptionFunction,
    thunderGraphQLOptions?: ThunderGraphQLOptions<SCLR>,
  ) =>
  <
    O extends keyof typeof Ops,
    OVERRIDESCLR extends SCLR,
    R extends keyof ValueTypes = GenericOperation<O>,
  >(
    operation: O,
    graphqlOptions?: ThunderGraphQLOptions<OVERRIDESCLR>,
  ) =>
  <Z extends ValueTypes[R]>(
    o: Z & {
      [P in keyof Z]: P extends keyof ValueTypes[R] ? Z[P] : never;
    },
    ops?: OperationOptions & { variables?: Record<string, unknown> },
  ) => {
    const options = {
      ...thunderGraphQLOptions,
      ...graphqlOptions,
    };
    type CombinedSCLR = UnionOverrideKeys<SCLR, OVERRIDESCLR>;
    const returnedFunction = fn(
      Zeus(operation, o, {
        operationOptions: ops,
        scalars: options?.scalars,
      }),
    ) as SubscriptionToGraphQL<Z, GraphQLTypes[R], CombinedSCLR>;
    if (returnedFunction?.on && options?.scalars) {
      const wrapped = returnedFunction.on;
      returnedFunction.on = (
        fnToCall: (args: InputType<GraphQLTypes[R], Z, CombinedSCLR>) => void,
      ) =>
        wrapped((data: InputType<GraphQLTypes[R], Z, CombinedSCLR>) => {
          if (options?.scalars) {
            return fnToCall(
              decodeScalarsInResponse({
                response: data,
                initialOp: operation,
                initialZeusQuery: o as VType,
                returns: ReturnTypes,
                scalars: options.scalars,
                ops: Ops,
              }),
            );
          }
          return fnToCall(data);
        });
    }
    return returnedFunction;
  };

export const Subscription = (...options: chainOptions) =>
  SubscriptionThunder(apiSubscription(options));
export type SubscriptionToGraphQLSSE<Z, T, SCLR extends ScalarDefinition> = {
  on: (fn: (args: InputType<T, Z, SCLR>) => void) => void;
  off: (
    fn: (e: {
      data?: InputType<T, Z, SCLR>;
      code?: number;
      reason?: string;
      message?: string;
    }) => void,
  ) => void;
  error: (
    fn: (e: { data?: InputType<T, Z, SCLR>; errors?: string[] }) => void,
  ) => void;
  open: (fn?: () => void) => void;
  close: () => void;
};

export const SubscriptionThunderSSE =
  <SCLR extends ScalarDefinition>(
    fn: SubscriptionFunction,
    thunderGraphQLOptions?: ThunderGraphQLOptions<SCLR>,
  ) =>
  <
    O extends keyof typeof Ops,
    OVERRIDESCLR extends SCLR,
    R extends keyof ValueTypes = GenericOperation<O>,
  >(
    operation: O,
    graphqlOptions?: ThunderGraphQLOptions<OVERRIDESCLR>,
  ) =>
  <Z extends ValueTypes[R]>(
    o: Z & {
      [P in keyof Z]: P extends keyof ValueTypes[R] ? Z[P] : never;
    },
    ops?: OperationOptions & { variables?: Record<string, unknown> },
  ) => {
    const options = {
      ...thunderGraphQLOptions,
      ...graphqlOptions,
    };
    type CombinedSCLR = UnionOverrideKeys<SCLR, OVERRIDESCLR>;
    const returnedFunction = fn(
      Zeus(operation, o, {
        operationOptions: ops,
        scalars: options?.scalars,
      }),
      ops?.variables,
    ) as SubscriptionToGraphQLSSE<Z, GraphQLTypes[R], CombinedSCLR>;
    if (returnedFunction?.on && options?.scalars) {
      const wrapped = returnedFunction.on;
      returnedFunction.on = (
        fnToCall: (args: InputType<GraphQLTypes[R], Z, CombinedSCLR>) => void,
      ) =>
        wrapped((data: InputType<GraphQLTypes[R], Z, CombinedSCLR>) => {
          if (options?.scalars) {
            return fnToCall(
              decodeScalarsInResponse({
                response: data,
                initialOp: operation,
                initialZeusQuery: o as VType,
                returns: ReturnTypes,
                scalars: options.scalars,
                ops: Ops,
              }),
            );
          }
          return fnToCall(data);
        });
    }
    return returnedFunction;
  };
export const SubscriptionSSE = (...options: chainOptions) =>
  SubscriptionThunderSSE(apiSubscriptionSSE(options));
export const Zeus = <
  Z extends ValueTypes[R],
  O extends keyof typeof Ops,
  R extends keyof ValueTypes = GenericOperation<O>,
>(
  operation: O,
  o: Z,
  ops?: {
    operationOptions?: OperationOptions;
    scalars?: ScalarDefinition;
  },
) =>
  InternalsBuildQuery({
    props: AllTypesProps,
    returns: ReturnTypes,
    ops: Ops,
    options: ops?.operationOptions,
    scalars: ops?.scalars,
  })(operation, o as VType);

export const ZeusSelect = <T>() => ((t: unknown) => t) as SelectionFunction<T>;

export const Selector = <T extends keyof ValueTypes>(key: T) =>
  key && ZeusSelect<ValueTypes[T]>();

export const TypeFromSelector = <T extends keyof ValueTypes>(key: T) =>
  key && ZeusSelect<ValueTypes[T]>();
export const Gql = Chain(HOST, {
  headers: {
    "Content-Type": "application/json",
    ...HEADERS,
  },
});

export const ZeusScalars = ZeusSelect<ScalarCoders>();

type BaseSymbol = number | string | undefined | boolean | null;

type ScalarsSelector<T, V> = {
  [X in Required<{
    [P in keyof T]: P extends keyof V
      ? V[P] extends Array<any> | undefined
        ? never
        : T[P] extends BaseSymbol | Array<BaseSymbol>
          ? P
          : never
      : never;
  }>[keyof T]]: true;
};

export const fields = <T extends keyof ModelTypes>(k: T) => {
  const t = ReturnTypes[k];
  const fnType =
    k in AllTypesProps
      ? AllTypesProps[k as keyof typeof AllTypesProps]
      : undefined;
  const hasFnTypes = typeof fnType === "object" ? fnType : undefined;
  const o = Object.fromEntries(
    Object.entries(t)
      .filter(([k, value]) => {
        const isFunctionType =
          hasFnTypes &&
          k in hasFnTypes &&
          !!hasFnTypes[k as keyof typeof hasFnTypes];
        if (isFunctionType) return false;
        const isReturnType = ReturnTypes[value as string];
        if (!isReturnType) return true;
        if (typeof isReturnType !== "string") return false;
        if (isReturnType.startsWith("scalar.")) {
          return true;
        }
        return false;
      })
      .map(([key]) => [key, true as const]),
  );
  return o as ScalarsSelector<
    ModelTypes[T],
    T extends keyof ValueTypes ? ValueTypes[T] : never
  >;
};

export const decodeScalarsInResponse = <O extends Operations>({
  response,
  scalars,
  returns,
  ops,
  initialZeusQuery,
  initialOp,
}: {
  ops: O;
  response: any;
  returns: ReturnTypesType;
  scalars?: Record<string, ScalarResolver | undefined>;
  initialOp: keyof O;
  initialZeusQuery: InputValueType | VType;
}) => {
  if (!scalars) {
    return response;
  }
  const builder = PrepareScalarPaths({
    ops,
    returns,
  });

  const scalarPaths = builder(
    initialOp as string,
    ops[initialOp],
    initialZeusQuery,
  );
  if (scalarPaths) {
    const r = traverseResponse({ scalarPaths, resolvers: scalars })(
      initialOp as string,
      response,
      [ops[initialOp]],
    );
    return r;
  }
  return response;
};

export const traverseResponse = ({
  resolvers,
  scalarPaths,
}: {
  scalarPaths: { [x: string]: `scalar.${string}` };
  resolvers: {
    [x: string]: ScalarResolver | undefined;
  };
}) => {
  const ibb = (
    k: string,
    o: InputValueType | VType,
    p: string[] = [],
  ): unknown => {
    if (Array.isArray(o)) {
      return o.map((eachO) => ibb(k, eachO, p));
    }
    if (o == null) {
      return o;
    }
    const scalarPathString = p.join(SEPARATOR);
    const currentScalarString = scalarPaths[scalarPathString];
    if (currentScalarString) {
      const currentDecoder =
        resolvers[currentScalarString.split(".")[1]]?.decode;
      if (currentDecoder) {
        return currentDecoder(o);
      }
    }
    if (
      typeof o === "boolean" ||
      typeof o === "number" ||
      typeof o === "string" ||
      !o
    ) {
      return o;
    }
    const entries = Object.entries(o).map(
      ([k, v]) => [k, ibb(k, v, [...p, purifyGraphQLKey(k)])] as const,
    );
    const objectFromEntries = entries.reduce<Record<string, unknown>>(
      (a, [k, v]) => {
        a[k] = v;
        return a;
      },
      {},
    );
    return objectFromEntries;
  };
  return ibb;
};

export type AllTypesPropsType = {
  [x: string]:
    | undefined
    | `scalar.${string}`
    | "enum"
    | {
        [x: string]:
          | undefined
          | string
          | {
              [x: string]: string | undefined;
            };
      };
};

export type ReturnTypesType = {
  [x: string]:
    | {
        [x: string]: string | undefined;
      }
    | `scalar.${string}`
    | undefined;
};
export type InputValueType = {
  [x: string]:
    | undefined
    | boolean
    | string
    | number
    | [any, undefined | boolean | InputValueType]
    | InputValueType;
};
export type VType =
  | undefined
  | boolean
  | string
  | number
  | [any, undefined | boolean | InputValueType]
  | InputValueType;

export type PlainType = boolean | number | string | null | undefined;
export type ZeusArgsType =
  | PlainType
  | {
      [x: string]: ZeusArgsType;
    }
  | Array<ZeusArgsType>;

export type Operations = Record<string, string>;

export type VariableDefinition = {
  [x: string]: unknown;
};

export const SEPARATOR = "|";

export type fetchOptions = Parameters<typeof fetch>;
type websocketOptions = typeof WebSocket extends new (
  ...args: infer R
) => WebSocket
  ? R
  : never;
export type chainOptions =
  | [fetchOptions[0], fetchOptions[1] & { websocket?: websocketOptions }]
  | [fetchOptions[0]];
export type FetchFunction = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>;
export type SubscriptionFunction = (
  query: string,
  variables?: Record<string, unknown>,
) => any;
type NotUndefined<T> = T extends undefined ? never : T;
export type ResolverType<F> = NotUndefined<
  F extends [infer ARGS, any] ? ARGS : undefined
>;

export type OperationOptions = {
  operationName?: string;
};

export type ScalarCoder = Record<string, (s: unknown) => string>;

export interface GraphQLResponse {
  data?: Record<string, any>;
  errors?: Array<{
    message: string;
  }>;
}
export class GraphQLError extends Error {
  constructor(public response: GraphQLResponse) {
    super(response.errors?.[0]?.message || "GraphQL Response Error");
    console.error(response);
  }
  toString() {
    return "GraphQL Response Error";
  }
}
export type GenericOperation<O> = O extends keyof typeof Ops
  ? (typeof Ops)[O]
  : never;
export type ThunderGraphQLOptions<SCLR extends ScalarDefinition> = {
  scalars?: SCLR | ScalarCoders;
};

const ExtractScalar = (
  mappedParts: string[],
  returns: ReturnTypesType,
): `scalar.${string}` | undefined => {
  if (mappedParts.length === 0) {
    return;
  }
  const oKey = mappedParts[0];
  const returnP1 = returns[oKey];
  if (typeof returnP1 === "object") {
    const returnP2 = returnP1[mappedParts[1]];
    if (returnP2) {
      return ExtractScalar([returnP2, ...mappedParts.slice(2)], returns);
    }
    return undefined;
  }
  return returnP1 as `scalar.${string}` | undefined;
};

export const PrepareScalarPaths = ({
  ops,
  returns,
}: {
  returns: ReturnTypesType;
  ops: Operations;
}) => {
  const ibb = (
    k: string,
    originalKey: string,
    o: InputValueType | VType,
    p: string[] = [],
    pOriginals: string[] = [],
    root = true,
  ): { [x: string]: `scalar.${string}` } | undefined => {
    if (!o) {
      return;
    }
    if (
      typeof o === "boolean" ||
      typeof o === "number" ||
      typeof o === "string"
    ) {
      const extractionArray = [...pOriginals, originalKey];
      const isScalar = ExtractScalar(extractionArray, returns);
      if (isScalar?.startsWith("scalar")) {
        const partOfTree = {
          [[...p, k].join(SEPARATOR)]: isScalar,
        };
        return partOfTree;
      }
      return {};
    }
    if (Array.isArray(o)) {
      return ibb(k, k, o[1], p, pOriginals, false);
    }
    if (k === "__alias") {
      return Object.entries(o)
        .map(([alias, objectUnderAlias]) => {
          if (
            typeof objectUnderAlias !== "object" ||
            Array.isArray(objectUnderAlias)
          ) {
            throw new Error(
              "Invalid alias it should be __alias:{ YOUR_ALIAS_NAME: { OPERATION_NAME: { ...selectors }}}",
            );
          }
          const operationName = Object.keys(objectUnderAlias)[0];
          const operation = objectUnderAlias[operationName];
          return ibb(alias, operationName, operation, p, pOriginals, false);
        })
        .reduce((a, b) => ({
          ...a,
          ...b,
        }));
    }
    const keyName = root ? ops[k] : k;
    return Object.entries(o)
      .filter(([k]) => k !== "__directives")
      .map(([k, v]) => {
        // Inline fragments shouldn't be added to the path as they aren't a field
        const isInlineFragment = originalKey.match(/^...\s*on/) != null;
        return ibb(
          k,
          k,
          v,
          isInlineFragment ? p : [...p, purifyGraphQLKey(keyName || k)],
          isInlineFragment
            ? pOriginals
            : [...pOriginals, purifyGraphQLKey(originalKey)],
          false,
        );
      })
      .reduce((a, b) => ({
        ...a,
        ...b,
      }));
  };
  return ibb;
};

export const purifyGraphQLKey = (k: string) =>
  k.replace(/\([^)]*\)/g, "").replace(/^[^:]*:/g, "");

const mapPart = (p: string) => {
  const [isArg, isField] = p.split("<>");
  if (isField) {
    return {
      v: isField,
      __type: "field",
    } as const;
  }
  return {
    v: isArg,
    __type: "arg",
  } as const;
};

type Part = ReturnType<typeof mapPart>;

export const ResolveFromPath = (
  props: AllTypesPropsType,
  returns: ReturnTypesType,
  ops: Operations,
) => {
  const ResolvePropsType = (mappedParts: Part[]) => {
    const oKey = ops[mappedParts[0].v];
    const propsP1 = oKey ? props[oKey] : props[mappedParts[0].v];
    if (propsP1 === "enum" && mappedParts.length === 1) {
      return "enum";
    }
    if (
      typeof propsP1 === "string" &&
      propsP1.startsWith("scalar.") &&
      mappedParts.length === 1
    ) {
      return propsP1;
    }
    if (typeof propsP1 === "object") {
      if (mappedParts.length < 2) {
        return "not";
      }
      const propsP2 = propsP1[mappedParts[1].v];
      if (typeof propsP2 === "string") {
        return rpp(
          `${propsP2}${SEPARATOR}${mappedParts
            .slice(2)
            .map((mp) => mp.v)
            .join(SEPARATOR)}`,
        );
      }
      if (typeof propsP2 === "object") {
        if (mappedParts.length < 3) {
          return "not";
        }
        const propsP3 = propsP2[mappedParts[2].v];
        if (propsP3 && mappedParts[2].__type === "arg") {
          return rpp(
            `${propsP3}${SEPARATOR}${mappedParts
              .slice(3)
              .map((mp) => mp.v)
              .join(SEPARATOR)}`,
          );
        }
      }
    }
  };
  const ResolveReturnType = (mappedParts: Part[]) => {
    if (mappedParts.length === 0) {
      return "not";
    }
    const oKey = ops[mappedParts[0].v];
    const returnP1 = oKey ? returns[oKey] : returns[mappedParts[0].v];
    if (typeof returnP1 === "object") {
      if (mappedParts.length < 2) return "not";
      const returnP2 = returnP1[mappedParts[1].v];
      if (returnP2) {
        return rpp(
          `${returnP2}${SEPARATOR}${mappedParts
            .slice(2)
            .map((mp) => mp.v)
            .join(SEPARATOR)}`,
        );
      }
    }
  };
  const rpp = (path: string): "enum" | "not" | `scalar.${string}` => {
    const parts = path.split(SEPARATOR).filter((l) => l.length > 0);
    const mappedParts = parts.map(mapPart);
    const propsP1 = ResolvePropsType(mappedParts);
    if (propsP1) {
      return propsP1;
    }
    const returnP1 = ResolveReturnType(mappedParts);
    if (returnP1) {
      return returnP1;
    }
    return "not";
  };
  return rpp;
};

export const InternalArgsBuilt = ({
  props,
  ops,
  returns,
  scalars,
  vars,
}: {
  props: AllTypesPropsType;
  returns: ReturnTypesType;
  ops: Operations;
  scalars?: ScalarDefinition;
  vars: Array<{ name: string; graphQLType: string }>;
}) => {
  const arb = (a: ZeusArgsType, p = "", root = true): string => {
    if (typeof a === "string") {
      if (a.startsWith(START_VAR_NAME)) {
        const [varName, graphQLType] = a
          .replace(START_VAR_NAME, "$")
          .split(GRAPHQL_TYPE_SEPARATOR);
        const v = vars.find((v) => v.name === varName);
        if (!v) {
          vars.push({
            name: varName,
            graphQLType,
          });
        } else {
          if (v.graphQLType !== graphQLType) {
            throw new Error(
              `Invalid variable exists with two different GraphQL Types, "${v.graphQLType}" and ${graphQLType}`,
            );
          }
        }
        return varName;
      }
    }
    const checkType = ResolveFromPath(props, returns, ops)(p);
    if (checkType.startsWith("scalar.")) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, ...splittedScalar] = checkType.split(".");
      const scalarKey = splittedScalar.join(".");
      return (scalars?.[scalarKey]?.encode?.(a) as string) || JSON.stringify(a);
    }
    if (Array.isArray(a)) {
      return `[${a.map((arr) => arb(arr, p, false)).join(", ")}]`;
    }
    if (typeof a === "string") {
      if (checkType === "enum") {
        return a;
      }
      return `${JSON.stringify(a)}`;
    }
    if (typeof a === "object") {
      if (a === null) {
        return `null`;
      }
      const returnedObjectString = Object.entries(a)
        .filter(([, v]) => typeof v !== "undefined")
        .map(([k, v]) => `${k}: ${arb(v, [p, k].join(SEPARATOR), false)}`)
        .join(",\n");
      if (!root) {
        return `{${returnedObjectString}}`;
      }
      return returnedObjectString;
    }
    return `${a}`;
  };
  return arb;
};

export const resolverFor = <
  X,
  T extends keyof ResolverInputTypes,
  Z extends keyof ResolverInputTypes[T],
>(
  _type: T,
  _field: Z,
  fn: (
    args: Required<ResolverInputTypes[T]>[Z] extends [infer Input, any]
      ? Input
      : any,
    source: any,
  ) => Z extends keyof ModelTypes[T]
    ? ModelTypes[T][Z] | Promise<ModelTypes[T][Z]> | X
    : never,
) => fn as (args?: any, source?: any) => ReturnType<typeof fn>;

export type UnwrapPromise<T> = T extends Promise<infer R> ? R : T;
export type ZeusState<T extends (...args: any[]) => Promise<any>> = NonNullable<
  UnwrapPromise<ReturnType<T>>
>;
export type ZeusHook<
  T extends (
    ...args: any[]
  ) => Record<string, (...args: any[]) => Promise<any>>,
  N extends keyof ReturnType<T>,
> = ZeusState<ReturnType<T>[N]>;

export type WithTypeNameValue<T> = T & {
  __typename?: boolean;
  __directives?: string;
};
export type AliasType<T> = WithTypeNameValue<T> & {
  __alias?: Record<string, WithTypeNameValue<T>>;
};
type DeepAnify<T> = {
  [P in keyof T]?: any;
};
type IsPayLoad<T> = T extends [any, infer PayLoad] ? PayLoad : T;
export type ScalarDefinition = Record<string, ScalarResolver>;

type IsScalar<S, SCLR extends ScalarDefinition> = S extends "scalar" & {
  name: infer T;
}
  ? T extends keyof SCLR
    ? SCLR[T]["decode"] extends (s: unknown) => unknown
      ? ReturnType<SCLR[T]["decode"]>
      : unknown
    : unknown
  : S extends Array<infer R>
    ? Array<IsScalar<R, SCLR>>
    : S;

type IsArray<T, U, SCLR extends ScalarDefinition> =
  T extends Array<infer R> ? InputType<R, U, SCLR>[] : InputType<T, U, SCLR>;
type FlattenArray<T> = T extends Array<infer R> ? R : T;
type BaseZeusResolver = boolean | 1 | string | Variable<any, string>;

type IsInterfaced<
  SRC extends DeepAnify<DST>,
  DST,
  SCLR extends ScalarDefinition,
> =
  FlattenArray<SRC> extends ZEUS_INTERFACES | ZEUS_UNIONS
    ? {
        [P in keyof SRC]: SRC[P] extends "__union" & infer R
          ? P extends keyof DST
            ? IsArray<
                R,
                "__typename" extends keyof DST
                  ? DST[P] & { __typename: true }
                  : DST[P],
                SCLR
              >
            : IsArray<
                R,
                "__typename" extends keyof DST
                  ? { __typename: true }
                  : Record<string, never>,
                SCLR
              >
          : never;
      }[keyof SRC] & {
        [P in keyof Omit<
          Pick<
            SRC,
            {
              [P in keyof DST]: SRC[P] extends "__union" & infer _R ? never : P;
            }[keyof DST]
          >,
          "__typename"
        >]: IsPayLoad<DST[P]> extends BaseZeusResolver
          ? IsScalar<SRC[P], SCLR>
          : IsArray<SRC[P], DST[P], SCLR>;
      }
    : {
        [P in keyof Pick<SRC, keyof DST>]: IsPayLoad<
          DST[P]
        > extends BaseZeusResolver
          ? IsScalar<SRC[P], SCLR>
          : IsArray<SRC[P], DST[P], SCLR>;
      };

export type MapType<SRC, DST, SCLR extends ScalarDefinition> =
  SRC extends DeepAnify<DST> ? IsInterfaced<SRC, DST, SCLR> : never;
// eslint-disable-next-line @typescript-eslint/ban-types
export type InputType<SRC, DST, SCLR extends ScalarDefinition = {}> =
  IsPayLoad<DST> extends { __alias: infer R }
    ? {
        [P in keyof R]: MapType<SRC, R[P], SCLR>[keyof MapType<
          SRC,
          R[P],
          SCLR
        >];
      } & MapType<SRC, Omit<IsPayLoad<DST>, "__alias">, SCLR>
    : MapType<SRC, IsPayLoad<DST>, SCLR>;
export type SubscriptionToGraphQL<Z, T, SCLR extends ScalarDefinition> = {
  ws: WebSocket;
  on: (fn: (args: InputType<T, Z, SCLR>) => void) => void;
  off: (
    fn: (e: {
      data?: InputType<T, Z, SCLR>;
      code?: number;
      reason?: string;
      message?: string;
    }) => void,
  ) => void;
  error: (
    fn: (e: { data?: InputType<T, Z, SCLR>; errors?: string[] }) => void,
  ) => void;
  open: () => void;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export type FromSelector<
  SELECTOR,
  NAME extends keyof GraphQLTypes,
  SCLR extends ScalarDefinition = {},
> = InputType<GraphQLTypes[NAME], SELECTOR, SCLR>;

export type ScalarResolver = {
  encode?: (s: unknown) => string;
  decode?: (s: unknown) => unknown;
};

export type SelectionFunction<V> = <Z extends V>(
  t: Z & {
    [P in keyof Z]: P extends keyof V ? Z[P] : never;
  },
) => Z;

type BuiltInVariableTypes = {
  String: string;
  Int: number;
  Float: number;
  Boolean: boolean;
};
type AllVariableTypes = keyof BuiltInVariableTypes | keyof ZEUS_VARIABLES;
type VariableRequired<T extends string> =
  | `${T}!`
  | T
  | `[${T}]`
  | `[${T}]!`
  | `[${T}!]`
  | `[${T}!]!`;
type VR<T extends string> = VariableRequired<VariableRequired<T>>;

export type GraphQLVariableType = VR<AllVariableTypes>;

type ExtractVariableTypeString<T extends string> =
  T extends VR<infer R1>
    ? R1 extends VR<infer R2>
      ? R2 extends VR<infer R3>
        ? R3 extends VR<infer R4>
          ? R4 extends VR<infer R5>
            ? R5
            : R4
          : R3
        : R2
      : R1
    : T;

type DecomposeType<T, Type> = T extends `[${infer R}]`
  ? Array<DecomposeType<R, Type>> | undefined
  : T extends `${infer R}!`
    ? NonNullable<DecomposeType<R, Type>>
    : Type | undefined;

type ExtractTypeFromGraphQLType<T extends string> =
  T extends keyof ZEUS_VARIABLES
    ? ZEUS_VARIABLES[T]
    : T extends keyof BuiltInVariableTypes
      ? BuiltInVariableTypes[T]
      : any;

export type GetVariableType<T extends string> = DecomposeType<
  T,
  ExtractTypeFromGraphQLType<ExtractVariableTypeString<T>>
>;

type UndefinedKeys<T> = {
  [K in keyof T]-?: T[K] extends NonNullable<T[K]> ? never : K;
}[keyof T];

type WithNullableKeys<T> = Pick<T, UndefinedKeys<T>>;
type WithNonNullableKeys<T> = Omit<T, UndefinedKeys<T>>;

type OptionalKeys<T> = {
  [P in keyof T]?: T[P];
};

export type WithOptionalNullables<T> = OptionalKeys<WithNullableKeys<T>> &
  WithNonNullableKeys<T>;

export type ComposableSelector<T extends keyof ValueTypes> = ReturnType<
  SelectionFunction<ValueTypes[T]>
>;

export type Variable<T extends GraphQLVariableType, Name extends string> = {
  " __zeus_name": Name;
  " __zeus_type": T;
};

export type ExtractVariablesDeep<Query> =
  Query extends Variable<infer VType, infer VName>
    ? { [key in VName]: GetVariableType<VType> }
    : Query extends string | number | boolean | Array<string | number | boolean>
      ? // eslint-disable-next-line @typescript-eslint/ban-types
        {}
      : UnionToIntersection<
          {
            [K in keyof Query]: WithOptionalNullables<
              ExtractVariablesDeep<Query[K]>
            >;
          }[keyof Query]
        >;

export type ExtractVariables<Query> =
  Query extends Variable<infer VType, infer VName>
    ? { [key in VName]: GetVariableType<VType> }
    : Query extends [infer Inputs, infer Outputs]
      ? ExtractVariablesDeep<Inputs> & ExtractVariables<Outputs>
      : Query extends
            | string
            | number
            | boolean
            | Array<string | number | boolean>
        ? // eslint-disable-next-line @typescript-eslint/ban-types
          {}
        : UnionToIntersection<
            {
              [K in keyof Query]: WithOptionalNullables<
                ExtractVariables<Query[K]>
              >;
            }[keyof Query]
          >;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

export const START_VAR_NAME = `$ZEUS_VAR`;
export const GRAPHQL_TYPE_SEPARATOR = `__$GRAPHQL__`;

export const $ = <Type extends GraphQLVariableType, Name extends string>(
  name: Name,
  graphqlType: Type,
) => {
  return (START_VAR_NAME +
    name +
    GRAPHQL_TYPE_SEPARATOR +
    graphqlType) as unknown as Variable<Type, Name>;
};
type ZEUS_INTERFACES = never;
export type ScalarCoders = {
  CountryCode?: ScalarResolver;
  FuzzyDateInt?: ScalarResolver;
  Json?: ScalarResolver;
  ID?: ScalarResolver;
};
type ZEUS_UNIONS =
  | GraphQLTypes["ActivityUnion"]
  | GraphQLTypes["LikeableUnion"]
  | GraphQLTypes["NotificationUnion"];

export type ValueTypes = {
  /** Activity union type */
  ActivityUnion: AliasType<{
    "...on ListActivity"?: ValueTypes["ListActivity"];
    "...on MessageActivity"?: ValueTypes["MessageActivity"];
    "...on TextActivity"?: ValueTypes["TextActivity"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Likeable union type */
  LikeableUnion: AliasType<{
    "...on ActivityReply"?: ValueTypes["ActivityReply"];
    "...on ListActivity"?: ValueTypes["ListActivity"];
    "...on MessageActivity"?: ValueTypes["MessageActivity"];
    "...on TextActivity"?: ValueTypes["TextActivity"];
    "...on Thread"?: ValueTypes["Thread"];
    "...on ThreadComment"?: ValueTypes["ThreadComment"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification union type */
  NotificationUnion: AliasType<{
    "...on ActivityLikeNotification"?: ValueTypes["ActivityLikeNotification"];
    "...on ActivityMentionNotification"?: ValueTypes["ActivityMentionNotification"];
    "...on ActivityMessageNotification"?: ValueTypes["ActivityMessageNotification"];
    "...on ActivityReplyLikeNotification"?: ValueTypes["ActivityReplyLikeNotification"];
    "...on ActivityReplyNotification"?: ValueTypes["ActivityReplyNotification"];
    "...on ActivityReplySubscribedNotification"?: ValueTypes["ActivityReplySubscribedNotification"];
    "...on AiringNotification"?: ValueTypes["AiringNotification"];
    "...on FollowingNotification"?: ValueTypes["FollowingNotification"];
    "...on MediaDataChangeNotification"?: ValueTypes["MediaDataChangeNotification"];
    "...on MediaDeletionNotification"?: ValueTypes["MediaDeletionNotification"];
    "...on MediaMergeNotification"?: ValueTypes["MediaMergeNotification"];
    "...on RelatedMediaAdditionNotification"?: ValueTypes["RelatedMediaAdditionNotification"];
    "...on ThreadCommentLikeNotification"?: ValueTypes["ThreadCommentLikeNotification"];
    "...on ThreadCommentMentionNotification"?: ValueTypes["ThreadCommentMentionNotification"];
    "...on ThreadCommentReplyNotification"?: ValueTypes["ThreadCommentReplyNotification"];
    "...on ThreadCommentSubscribedNotification"?: ValueTypes["ThreadCommentSubscribedNotification"];
    "...on ThreadLikeNotification"?: ValueTypes["ThreadLikeNotification"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a activity is liked */
  ActivityLikeNotification: AliasType<{
    /** The liked activity */
    activity?: ValueTypes["ActivityUnion"];
    /** The id of the activity which was liked */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ValueTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityLikeNotification"?: Omit<
      ValueTypes["ActivityLikeNotification"],
      "...on ActivityLikeNotification"
    >;
  }>;
  /** Notification for when authenticated user is @ mentioned in activity or reply */
  ActivityMentionNotification: AliasType<{
    /** The liked activity */
    activity?: ValueTypes["ActivityUnion"];
    /** The id of the activity where mentioned */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who mentioned the authenticated user */
    user?: ValueTypes["User"];
    /** The id of the user who mentioned the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityMentionNotification"?: Omit<
      ValueTypes["ActivityMentionNotification"],
      "...on ActivityMentionNotification"
    >;
  }>;
  /** Notification for when a user is send an activity message */
  ActivityMessageNotification: AliasType<{
    /** The id of the activity message */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The message activity */
    message?: ValueTypes["MessageActivity"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who sent the message */
    user?: ValueTypes["User"];
    /** The if of the user who send the message */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityMessageNotification"?: Omit<
      ValueTypes["ActivityMessageNotification"],
      "...on ActivityMessageNotification"
    >;
  }>;
  /** Replay to an activity item */
  ActivityReply: AliasType<{
    /** The id of the parent activity */
    activityId?: boolean | `@${string}`;
    /** The time the reply was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the reply */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the reply */
    isLiked?: boolean | `@${string}`;
    /** The amount of likes the reply has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the reply */
    likes?: ValueTypes["User"];
    text?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The user who created reply */
    user?: ValueTypes["User"];
    /** The id of the replies creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityReply"?: Omit<
      ValueTypes["ActivityReply"],
      "...on ActivityReply"
    >;
  }>;
  /** Notification for when a activity reply is liked */
  ActivityReplyLikeNotification: AliasType<{
    /** The liked activity */
    activity?: ValueTypes["ActivityUnion"];
    /** The id of the activity where the reply which was liked */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity reply */
    user?: ValueTypes["User"];
    /** The id of the user who liked to the activity reply */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityReplyLikeNotification"?: Omit<
      ValueTypes["ActivityReplyLikeNotification"],
      "...on ActivityReplyLikeNotification"
    >;
  }>;
  /** Notification for when a user replies to the authenticated users activity */
  ActivityReplyNotification: AliasType<{
    /** The liked activity */
    activity?: ValueTypes["ActivityUnion"];
    /** The id of the activity which was replied too */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ValueTypes["User"];
    /** The id of the user who replied to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityReplyNotification"?: Omit<
      ValueTypes["ActivityReplyNotification"],
      "...on ActivityReplyNotification"
    >;
  }>;
  /** Notification for when a user replies to activity the authenticated user has replied to */
  ActivityReplySubscribedNotification: AliasType<{
    /** The liked activity */
    activity?: ValueTypes["ActivityUnion"];
    /** The id of the activity which was replied too */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ValueTypes["User"];
    /** The id of the user who replied to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ActivityReplySubscribedNotification"?: Omit<
      ValueTypes["ActivityReplySubscribedNotification"],
      "...on ActivityReplySubscribedNotification"
    >;
  }>;
  /** Notification for when an episode of anime airs */
  AiringNotification: AliasType<{
    /** The id of the aired anime */
    animeId?: boolean | `@${string}`;
    /** The notification context text */
    contexts?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The episode number that just aired */
    episode?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The associated media of the airing schedule */
    media?: ValueTypes["Media"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AiringNotification"?: Omit<
      ValueTypes["AiringNotification"],
      "...on AiringNotification"
    >;
  }>;
  /** Score & Watcher stats for airing anime by episode and mid-week */
  AiringProgression: AliasType<{
    /** The episode the stats were recorded at. .5 is the mid point between 2 episodes airing dates. */
    episode?: boolean | `@${string}`;
    /** The average score for the media */
    score?: boolean | `@${string}`;
    /** The amount of users watching the anime */
    watching?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AiringProgression"?: Omit<
      ValueTypes["AiringProgression"],
      "...on AiringProgression"
    >;
  }>;
  /** Media Airing Schedule. NOTE: We only aim to guarantee that FUTURE airing data is present and accurate. */
  AiringSchedule: AliasType<{
    /** The time the episode airs at */
    airingAt?: boolean | `@${string}`;
    /** The airing episode number */
    episode?: boolean | `@${string}`;
    /** The id of the airing schedule item */
    id?: boolean | `@${string}`;
    /** The associate media of the airing episode */
    media?: ValueTypes["Media"];
    /** The associate media id of the airing episode */
    mediaId?: boolean | `@${string}`;
    /** Seconds until episode starts airing */
    timeUntilAiring?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AiringSchedule"?: Omit<
      ValueTypes["AiringSchedule"],
      "...on AiringSchedule"
    >;
  }>;
  AiringScheduleConnection: AliasType<{
    edges?: ValueTypes["AiringScheduleEdge"];
    nodes?: ValueTypes["AiringSchedule"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on AiringScheduleConnection"?: Omit<
      ValueTypes["AiringScheduleConnection"],
      "...on AiringScheduleConnection"
    >;
  }>;
  /** AiringSchedule connection edge */
  AiringScheduleEdge: AliasType<{
    /** The id of the connection */
    id?: boolean | `@${string}`;
    node?: ValueTypes["AiringSchedule"];
    __typename?: boolean | `@${string}`;
    "...on AiringScheduleEdge"?: Omit<
      ValueTypes["AiringScheduleEdge"],
      "...on AiringScheduleEdge"
    >;
  }>;
  AniChartUser: AliasType<{
    highlights?: boolean | `@${string}`;
    settings?: boolean | `@${string}`;
    user?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on AniChartUser"?: Omit<
      ValueTypes["AniChartUser"],
      "...on AniChartUser"
    >;
  }>;
  /** A character that features in an anime or manga */
  Character: AliasType<{
    /** The character's age. Note this is a string, not an int, it may contain further text and additional ages. */
    age?: boolean | `@${string}`;
    /** The characters blood type */
    bloodType?: boolean | `@${string}`;
    /** The character's birth date */
    dateOfBirth?: ValueTypes["FuzzyDate"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The amount of user's who have favourited the character */
    favourites?: boolean | `@${string}`;
    /** The character's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: boolean | `@${string}`;
    /** The id of the character */
    id?: boolean | `@${string}`;
    /** Character images */
    image?: ValueTypes["CharacterImage"];
    /** If the character is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the character is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    media?: [
      {
        onList?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The names of the character */
    name?: ValueTypes["CharacterName"];
    /** The url for the character page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Character"?: Omit<ValueTypes["Character"], "...on Character">;
  }>;
  CharacterConnection: AliasType<{
    edges?: ValueTypes["CharacterEdge"];
    nodes?: ValueTypes["Character"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on CharacterConnection"?: Omit<
      ValueTypes["CharacterConnection"],
      "...on CharacterConnection"
    >;
  }>;
  /** Character connection edge */
  CharacterEdge: AliasType<{
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** The media the character is in */
    media?: ValueTypes["Media"];
    /** Media specific character name */
    name?: boolean | `@${string}`;
    node?: ValueTypes["Character"];
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    voiceActorRoles?: [
      {
        language?:
          | ValueTypes["StaffLanguage"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["StaffRoleType"],
    ];
    voiceActors?: [
      {
        language?:
          | ValueTypes["StaffLanguage"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Staff"],
    ];
    __typename?: boolean | `@${string}`;
    "...on CharacterEdge"?: Omit<
      ValueTypes["CharacterEdge"],
      "...on CharacterEdge"
    >;
  }>;
  CharacterImage: AliasType<{
    /** The character's image of media at its largest size */
    large?: boolean | `@${string}`;
    /** The character's image of media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CharacterImage"?: Omit<
      ValueTypes["CharacterImage"],
      "...on CharacterImage"
    >;
  }>;
  /** The names of the character */
  CharacterName: AliasType<{
    /** Other names the character might be referred to as */
    alternative?: boolean | `@${string}`;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: boolean | `@${string}`;
    /** The character's given name */
    first?: boolean | `@${string}`;
    /** The character's first and last name */
    full?: boolean | `@${string}`;
    /** The character's surname */
    last?: boolean | `@${string}`;
    /** The character's middle name */
    middle?: boolean | `@${string}`;
    /** The character's full name in their native language */
    native?: boolean | `@${string}`;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CharacterName"?: Omit<
      ValueTypes["CharacterName"],
      "...on CharacterName"
    >;
  }>;
  /** A submission for a character that features in an anime or manga */
  CharacterSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ValueTypes["User"];
    /** Character that the submission is referencing */
    character?: ValueTypes["Character"];
    createdAt?: boolean | `@${string}`;
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    /** Inner details of submission status */
    notes?: boolean | `@${string}`;
    source?: boolean | `@${string}`;
    /** Status of the submission */
    status?: boolean | `@${string}`;
    /** The character submission changes */
    submission?: ValueTypes["Character"];
    /** Submitter for the submission */
    submitter?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on CharacterSubmission"?: Omit<
      ValueTypes["CharacterSubmission"],
      "...on CharacterSubmission"
    >;
  }>;
  CharacterSubmissionConnection: AliasType<{
    edges?: ValueTypes["CharacterSubmissionEdge"];
    nodes?: ValueTypes["CharacterSubmission"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on CharacterSubmissionConnection"?: Omit<
      ValueTypes["CharacterSubmissionConnection"],
      "...on CharacterSubmissionConnection"
    >;
  }>;
  /** CharacterSubmission connection edge */
  CharacterSubmissionEdge: AliasType<{
    node?: ValueTypes["CharacterSubmission"];
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    /** The submitted voice actors of the character */
    submittedVoiceActors?: ValueTypes["StaffSubmission"];
    /** The voice actors of the character */
    voiceActors?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on CharacterSubmissionEdge"?: Omit<
      ValueTypes["CharacterSubmissionEdge"],
      "...on CharacterSubmissionEdge"
    >;
  }>;
  /** Deleted data type */
  Deleted: AliasType<{
    /** If an item has been successfully deleted */
    deleted?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Deleted"?: Omit<ValueTypes["Deleted"], "...on Deleted">;
  }>;
  /** User's favourite anime, manga, characters, staff & studios */
  Favourites: AliasType<{
    anime?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    characters?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CharacterConnection"],
    ];
    manga?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    staff?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["StaffConnection"],
    ];
    studios?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["StudioConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Favourites"?: Omit<ValueTypes["Favourites"], "...on Favourites">;
  }>;
  /** Notification for when the authenticated user is followed by another user */
  FollowingNotification: AliasType<{
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The liked activity */
    user?: ValueTypes["User"];
    /** The id of the user who followed the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on FollowingNotification"?: Omit<
      ValueTypes["FollowingNotification"],
      "...on FollowingNotification"
    >;
  }>;
  /** User's format statistics */
  FormatStats: AliasType<{
    amount?: boolean | `@${string}`;
    format?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on FormatStats"?: Omit<ValueTypes["FormatStats"], "...on FormatStats">;
  }>;
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDate: AliasType<{
    /** Numeric Day (24) */
    day?: boolean | `@${string}`;
    /** Numeric Month (3) */
    month?: boolean | `@${string}`;
    /** Numeric Year (2017) */
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on FuzzyDate"?: Omit<ValueTypes["FuzzyDate"], "...on FuzzyDate">;
  }>;
  /** User's genre statistics */
  GenreStats: AliasType<{
    amount?: boolean | `@${string}`;
    genre?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    /** The amount of time in minutes the genre has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on GenreStats"?: Omit<ValueTypes["GenreStats"], "...on GenreStats">;
  }>;
  /** Page of data (Used for internal use only) */
  InternalPage: AliasType<{
    activities?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ActivitySort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ActivityUnion"],
    ];
    activityReplies?: [
      {
        /** Filter by the parent id */
        activityId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the reply id */;
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityReply"],
    ];
    airingSchedules?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["AiringSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["AiringSchedule"],
    ];
    characterSubmissions?: [
      {
        assigneeId?: number | undefined | null | Variable<any, string>;
        characterId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the status of the submission */;
        status?:
          | ValueTypes["SubmissionStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the submitter of the submission */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CharacterSubmission"],
    ];
    characters?: [
      {
        /** Filter by character id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by character by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["CharacterSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Character"],
    ];
    followers?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    likes?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The type of model the id applies to */;
        type?:
          | ValueTypes["LikeableType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ValueTypes["CountryCode"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the season the media was released in */;
        season?:
          | ValueTypes["MediaSeason"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source?:
          | ValueTypes["MediaSource"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source_in?:
          | Array<ValueTypes["MediaSource"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    mediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaListSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the list entries media type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's name */;
        userName?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaList"],
    ];
    mediaSubmissions?: [
      {
        assigneeId?: number | undefined | null | Variable<any, string>;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
        status?:
          | ValueTypes["SubmissionStatus"]
          | undefined
          | null
          | Variable<any, string>;
        submissionId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string>;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaSubmission"],
    ];
    mediaTrends?: [
      {
        /** Filter by score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_not?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaTrend"],
    ];
    modActions?: [
      {
        modId?: number | undefined | null | Variable<any, string>;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ModAction"],
    ];
    notifications?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type?:
          | ValueTypes["NotificationType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type_in?:
          | Array<ValueTypes["NotificationType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["NotificationUnion"],
    ];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    recommendations?: [
      {
        /** Filter by recommendation id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by user who created the recommendation */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Recommendation"],
    ];
    reports?: [
      {
        reportedId?: number | undefined | null | Variable<any, string>;
        reporterId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Report"],
    ];
    reviews?: [
      {
        /** Filter by Review id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media type */;
        mediaType?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ReviewSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by user id */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Review"],
    ];
    revisionHistory?: [
      {
        /** Filter by the character id */
        characterId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        staffId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        studioId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the user id */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["RevisionHistory"],
    ];
    staff?: [
      {
        /** Filter by the staff id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by staff by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Staff"],
    ];
    staffSubmissions?: [
      {
        assigneeId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
        staffId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the status of the submission */;
        status?:
          | ValueTypes["SubmissionStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the submitter of the submission */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["StaffSubmission"],
    ];
    studios?: [
      {
        /** Filter by the studio id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StudioSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Studio"],
    ];
    threadComments?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ThreadComment"],
    ];
    threads?: [
      {
        /** Filter by thread category id */
        categoryId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Thread"],
    ];
    userBlockSearch?: [
      {
        /** Filter by search query */
        search?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    users?: [
      {
        /** Filter by the user id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the name of the user */;
        name?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
    "...on InternalPage"?: Omit<
      ValueTypes["InternalPage"],
      "...on InternalPage"
    >;
  }>;
  /** User list activity (anime & manga updates) */
  ListActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ValueTypes["User"];
    /** The associated media to the activity update */
    media?: ValueTypes["Media"];
    /** The list progress made */
    progress?: boolean | `@${string}`;
    /** The written replies to the activity */
    replies?: ValueTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The list item's textual status */
    status?: boolean | `@${string}`;
    /** The type of activity */
    type?: boolean | `@${string}`;
    /** The owner of the activity */
    user?: ValueTypes["User"];
    /** The user id of the activity's creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ListActivity"?: Omit<
      ValueTypes["ListActivity"],
      "...on ListActivity"
    >;
  }>;
  ListActivityOption: AliasType<{
    disabled?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ListActivityOption"?: Omit<
      ValueTypes["ListActivityOption"],
      "...on ListActivityOption"
    >;
  }>;
  /** User's list score statistics */
  ListScoreStats: AliasType<{
    meanScore?: boolean | `@${string}`;
    standardDeviation?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ListScoreStats"?: Omit<
      ValueTypes["ListScoreStats"],
      "...on ListScoreStats"
    >;
  }>;
  /** Anime or Manga */
  Media: AliasType<{
    airingSchedule?: [
      {
        /** Filter to episodes that have not yet aired */
        notYetAired?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["AiringScheduleConnection"],
    ];
    /** If the media should have forum thread automatically created for it on airing episode release */
    autoCreateForumThread?: boolean | `@${string}`;
    /** A weighted average score of all the user's scores of the media */
    averageScore?: boolean | `@${string}`;
    /** The banner image of the media */
    bannerImage?: boolean | `@${string}`;
    /** The amount of chapters the manga has when complete */
    chapters?: boolean | `@${string}`;
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        role?:
          | ValueTypes["CharacterRole"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CharacterSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CharacterConnection"],
    ];
    /** Where the media was created. (ISO 3166-1 alpha-2) */
    countryOfOrigin?: boolean | `@${string}`;
    /** The cover images of the media */
    coverImage?: ValueTypes["MediaCoverImage"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The general length of each anime episode in minutes */
    duration?: boolean | `@${string}`;
    /** The last official release date of the media */
    endDate?: ValueTypes["FuzzyDate"];
    /** The amount of episodes the anime has when complete */
    episodes?: boolean | `@${string}`;
    /** External links to another site related to the media */
    externalLinks?: ValueTypes["MediaExternalLink"];
    /** The amount of user's who have favourited the media */
    favourites?: boolean | `@${string}`;
    /** The format the media was released in */
    format?: boolean | `@${string}`;
    /** The genres of the media */
    genres?: boolean | `@${string}`;
    /** Official Twitter hashtags for the media */
    hashtag?: boolean | `@${string}`;
    /** The id of the media */
    id?: boolean | `@${string}`;
    /** The mal id of the media */
    idMal?: boolean | `@${string}`;
    /** If the media is intended only for 18+ adult audiences */
    isAdult?: boolean | `@${string}`;
    /** If the media is marked as favourite by the current authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the media is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    /** If the media is officially licensed or a self-published doujin release */
    isLicensed?: boolean | `@${string}`;
    /** Locked media may not be added to lists our favorited. This may be due to the entry pending for deletion or other reasons. */
    isLocked?: boolean | `@${string}`;
    /** If the media is blocked from being recommended to/from */
    isRecommendationBlocked?: boolean | `@${string}`;
    /** If the media is blocked from being reviewed */
    isReviewBlocked?: boolean | `@${string}`;
    /** Mean score of all the user's scores of the media */
    meanScore?: boolean | `@${string}`;
    /** The authenticated user's media list entry for the media */
    mediaListEntry?: ValueTypes["MediaList"];
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The media's next episode airing schedule */
    nextAiringEpisode?: ValueTypes["AiringSchedule"];
    /** The number of users with the media on their list */
    popularity?: boolean | `@${string}`;
    /** The ranking of the media in a particular time span and format compared to other media */
    rankings?: ValueTypes["MediaRank"];
    recommendations?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["RecommendationConnection"],
    ];
    /** Other media in the same or connecting franchise */
    relations?: ValueTypes["MediaConnection"];
    reviews?: [
      {
        limit?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["ReviewSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ReviewConnection"],
    ];
    /** The season the media was initially released in */
    season?: boolean | `@${string}`;
    /** The year & season the media was initially released in */
    seasonInt?: boolean | `@${string}`;
    /** The season year the media was initially released in */
    seasonYear?: boolean | `@${string}`;
    /** The url for the media page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    source?: [
      {
        /** Provide 2 or 3 to use new version 2 or 3 of sources enum */
        version?: number | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    staff?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["StaffConnection"],
    ];
    /** The first official release date of the media */
    startDate?: ValueTypes["FuzzyDate"];
    stats?: ValueTypes["MediaStats"];
    status?: [
      {
        /** Provide 2 to use new version 2 of sources enum */
        version?: number | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** Data and links to legal streaming episodes on external sites */
    streamingEpisodes?: ValueTypes["MediaStreamingEpisode"];
    studios?: [
      {
        isMain?: boolean | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StudioSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["StudioConnection"],
    ];
    /** Alternative titles of the media */
    synonyms?: boolean | `@${string}`;
    /** List of tags that describes elements and themes of the media */
    tags?: ValueTypes["MediaTag"];
    /** The official titles of the media in various languages */
    title?: ValueTypes["MediaTitle"];
    /** Media trailer or advertisement */
    trailer?: ValueTypes["MediaTrailer"];
    /** The amount of related activity in the past hour */
    trending?: boolean | `@${string}`;
    trends?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to stats recorded while the media was releasing */;
        releasing?: boolean | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaTrendConnection"],
    ];
    /** The type of the media; anime or manga */
    type?: boolean | `@${string}`;
    /** When the media's data was last updated */
    updatedAt?: boolean | `@${string}`;
    /** The amount of volumes the manga has when complete */
    volumes?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Media"?: Omit<ValueTypes["Media"], "...on Media">;
  }>;
  /** Internal - Media characters separated */
  MediaCharacter: AliasType<{
    /** The characters in the media voiced by the parent actor */
    character?: ValueTypes["Character"];
    /** Media specific character name */
    characterName?: boolean | `@${string}`;
    dubGroup?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    roleNotes?: boolean | `@${string}`;
    /** The voice actor of the character */
    voiceActor?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on MediaCharacter"?: Omit<
      ValueTypes["MediaCharacter"],
      "...on MediaCharacter"
    >;
  }>;
  MediaConnection: AliasType<{
    edges?: ValueTypes["MediaEdge"];
    nodes?: ValueTypes["Media"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on MediaConnection"?: Omit<
      ValueTypes["MediaConnection"],
      "...on MediaConnection"
    >;
  }>;
  MediaCoverImage: AliasType<{
    /** Average #hex color of cover image */
    color?: boolean | `@${string}`;
    /** The cover image url of the media at its largest size. If this size isn't available, large will be provided instead. */
    extraLarge?: boolean | `@${string}`;
    /** The cover image url of the media at a large size */
    large?: boolean | `@${string}`;
    /** The cover image url of the media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaCoverImage"?: Omit<
      ValueTypes["MediaCoverImage"],
      "...on MediaCoverImage"
    >;
  }>;
  /** Notification for when a media entry's data was changed in a significant way impacting users' list tracking */
  MediaDataChangeNotification: AliasType<{
    /** The reason for the media data change */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The media that received data changes */
    media?: ValueTypes["Media"];
    /** The id of the media that received data changes */
    mediaId?: boolean | `@${string}`;
    /** The reason for the media data change */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaDataChangeNotification"?: Omit<
      ValueTypes["MediaDataChangeNotification"],
      "...on MediaDataChangeNotification"
    >;
  }>;
  /** Notification for when a media tracked in a user's list is deleted from the site */
  MediaDeletionNotification: AliasType<{
    /** The reason for the media deletion */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The title of the deleted media */
    deletedMediaTitle?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The reason for the media deletion */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaDeletionNotification"?: Omit<
      ValueTypes["MediaDeletionNotification"],
      "...on MediaDeletionNotification"
    >;
  }>;
  /** Media connection edge */
  MediaEdge: AliasType<{
    /** Media specific character name */
    characterName?: boolean | `@${string}`;
    /** The characters role in the media */
    characterRole?: boolean | `@${string}`;
    /** The characters in the media voiced by the parent actor */
    characters?: ValueTypes["Character"];
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: boolean | `@${string}`;
    /** The order the media should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** If the studio is the main animation studio of the media (For Studio->MediaConnection field only) */
    isMainStudio?: boolean | `@${string}`;
    node?: ValueTypes["Media"];
    relationType?: [
      {
        /** Provide 2 to use new version 2 of relation enum */
        version?: number | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** Notes regarding the VA's role for the character */
    roleNotes?: boolean | `@${string}`;
    /** The role of the staff member in the production of the media */
    staffRole?: boolean | `@${string}`;
    voiceActorRoles?: [
      {
        language?:
          | ValueTypes["StaffLanguage"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["StaffRoleType"],
    ];
    voiceActors?: [
      {
        language?:
          | ValueTypes["StaffLanguage"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Staff"],
    ];
    __typename?: boolean | `@${string}`;
    "...on MediaEdge"?: Omit<ValueTypes["MediaEdge"], "...on MediaEdge">;
  }>;
  /** An external link to another site related to the media or staff member */
  MediaExternalLink: AliasType<{
    color?: boolean | `@${string}`;
    /** The icon image url of the site. Not available for all links. Transparent PNG 64x64 */
    icon?: boolean | `@${string}`;
    /** The id of the external link */
    id?: boolean | `@${string}`;
    isDisabled?: boolean | `@${string}`;
    /** Language the site content is in. See Staff language field for values. */
    language?: boolean | `@${string}`;
    notes?: boolean | `@${string}`;
    /** The links website site name */
    site?: boolean | `@${string}`;
    /** The links website site id */
    siteId?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    /** The url of the external link or base url of link source */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaExternalLink"?: Omit<
      ValueTypes["MediaExternalLink"],
      "...on MediaExternalLink"
    >;
  }>;
  /** List of anime or manga */
  MediaList: AliasType<{
    /** Map of advanced scores with name keys */
    advancedScores?: boolean | `@${string}`;
    /** When the entry was completed by the user */
    completedAt?: ValueTypes["FuzzyDate"];
    /** When the entry data was created */
    createdAt?: boolean | `@${string}`;
    customLists?: [
      {
        /** Change return structure to an array of objects */
        asArray?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** If the entry shown be hidden from non-custom lists */
    hiddenFromStatusLists?: boolean | `@${string}`;
    /** The id of the list entry */
    id?: boolean | `@${string}`;
    media?: ValueTypes["Media"];
    /** The id of the media */
    mediaId?: boolean | `@${string}`;
    /** Text notes */
    notes?: boolean | `@${string}`;
    /** Priority of planning */
    priority?: boolean | `@${string}`;
    /** If the entry should only be visible to authenticated user */
    private?: boolean | `@${string}`;
    /** The amount of episodes/chapters consumed by the user */
    progress?: boolean | `@${string}`;
    /** The amount of volumes read by the user */
    progressVolumes?: boolean | `@${string}`;
    /** The amount of times the user has rewatched/read the media */
    repeat?: boolean | `@${string}`;
    score?: [
      {
        /** Force the score to be returned in the provided format type. */
        format?:
          | ValueTypes["ScoreFormat"]
          | undefined
          | null
          | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** When the entry was started by the user */
    startedAt?: ValueTypes["FuzzyDate"];
    /** The watching/reading status */
    status?: boolean | `@${string}`;
    /** When the entry data was last updated */
    updatedAt?: boolean | `@${string}`;
    user?: ValueTypes["User"];
    /** The id of the user owner of the list entry */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaList"?: Omit<ValueTypes["MediaList"], "...on MediaList">;
  }>;
  /** List of anime or manga */
  MediaListCollection: AliasType<{
    customLists?: [
      { asArray?: boolean | undefined | null | Variable<any, string> },
      ValueTypes["MediaList"],
    ];
    /** If there is another chunk */
    hasNextChunk?: boolean | `@${string}`;
    /** Grouped media list entries */
    lists?: ValueTypes["MediaListGroup"];
    statusLists?: [
      { asArray?: boolean | undefined | null | Variable<any, string> },
      ValueTypes["MediaList"],
    ];
    /** The owner of the list */
    user?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on MediaListCollection"?: Omit<
      ValueTypes["MediaListCollection"],
      "...on MediaListCollection"
    >;
  }>;
  /** List group of anime or manga entries */
  MediaListGroup: AliasType<{
    /** Media list entries */
    entries?: ValueTypes["MediaList"];
    isCustomList?: boolean | `@${string}`;
    isSplitCompletedList?: boolean | `@${string}`;
    name?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaListGroup"?: Omit<
      ValueTypes["MediaListGroup"],
      "...on MediaListGroup"
    >;
  }>;
  /** A user's list options */
  MediaListOptions: AliasType<{
    /** The user's anime list options */
    animeList?: ValueTypes["MediaListTypeOptions"];
    /** The user's manga list options */
    mangaList?: ValueTypes["MediaListTypeOptions"];
    /** The default order list rows should be displayed in */
    rowOrder?: boolean | `@${string}`;
    /** The score format the user is using for media lists */
    scoreFormat?: boolean | `@${string}`;
    /** The list theme options for both lists */
    sharedTheme?: boolean | `@${string}`;
    /** If the shared theme should be used instead of the individual list themes */
    sharedThemeEnabled?: boolean | `@${string}`;
    useLegacyLists?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaListOptions"?: Omit<
      ValueTypes["MediaListOptions"],
      "...on MediaListOptions"
    >;
  }>;
  /** A user's list options for anime or manga lists */
  MediaListTypeOptions: AliasType<{
    /** The names of the user's advanced scoring sections */
    advancedScoring?: boolean | `@${string}`;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | `@${string}`;
    /** The names of the user's custom lists */
    customLists?: boolean | `@${string}`;
    /** The order each list should be displayed in */
    sectionOrder?: boolean | `@${string}`;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | `@${string}`;
    /** The list theme options */
    theme?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaListTypeOptions"?: Omit<
      ValueTypes["MediaListTypeOptions"],
      "...on MediaListTypeOptions"
    >;
  }>;
  /** Notification for when a media entry is merged into another for a user who had it on their list */
  MediaMergeNotification: AliasType<{
    /** The reason for the media data change */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The title of the deleted media */
    deletedMediaTitles?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The media that was merged into */
    media?: ValueTypes["Media"];
    /** The id of the media that was merged into */
    mediaId?: boolean | `@${string}`;
    /** The reason for the media merge */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaMergeNotification"?: Omit<
      ValueTypes["MediaMergeNotification"],
      "...on MediaMergeNotification"
    >;
  }>;
  /** The ranking of a media in a particular time span and format compared to other media */
  MediaRank: AliasType<{
    /** If the ranking is based on all time instead of a season/year */
    allTime?: boolean | `@${string}`;
    /** String that gives context to the ranking type and time span */
    context?: boolean | `@${string}`;
    /** The format the media is ranked within */
    format?: boolean | `@${string}`;
    /** The id of the rank */
    id?: boolean | `@${string}`;
    /** The numerical rank of the media */
    rank?: boolean | `@${string}`;
    /** The season the media is ranked within */
    season?: boolean | `@${string}`;
    /** The type of ranking */
    type?: boolean | `@${string}`;
    /** The year the media is ranked within */
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaRank"?: Omit<ValueTypes["MediaRank"], "...on MediaRank">;
  }>;
  /** A media's statistics */
  MediaStats: AliasType<{
    airingProgression?: ValueTypes["AiringProgression"];
    scoreDistribution?: ValueTypes["ScoreDistribution"];
    statusDistribution?: ValueTypes["StatusDistribution"];
    __typename?: boolean | `@${string}`;
    "...on MediaStats"?: Omit<ValueTypes["MediaStats"], "...on MediaStats">;
  }>;
  /** Data and links to legal streaming episodes on external sites */
  MediaStreamingEpisode: AliasType<{
    /** The site location of the streaming episodes */
    site?: boolean | `@${string}`;
    /** Url of episode image thumbnail */
    thumbnail?: boolean | `@${string}`;
    /** Title of the episode */
    title?: boolean | `@${string}`;
    /** The url of the episode */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaStreamingEpisode"?: Omit<
      ValueTypes["MediaStreamingEpisode"],
      "...on MediaStreamingEpisode"
    >;
  }>;
  /** Media submission */
  MediaSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ValueTypes["User"];
    changes?: boolean | `@${string}`;
    characters?: ValueTypes["MediaSubmissionComparison"];
    createdAt?: boolean | `@${string}`;
    externalLinks?: ValueTypes["MediaSubmissionComparison"];
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    media?: ValueTypes["Media"];
    notes?: boolean | `@${string}`;
    relations?: ValueTypes["MediaEdge"];
    source?: boolean | `@${string}`;
    staff?: ValueTypes["MediaSubmissionComparison"];
    /** Status of the submission */
    status?: boolean | `@${string}`;
    studios?: ValueTypes["MediaSubmissionComparison"];
    submission?: ValueTypes["Media"];
    /** User submitter of the submission */
    submitter?: ValueTypes["User"];
    submitterStats?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaSubmission"?: Omit<
      ValueTypes["MediaSubmission"],
      "...on MediaSubmission"
    >;
  }>;
  /** Media submission with comparison to current data */
  MediaSubmissionComparison: AliasType<{
    character?: ValueTypes["MediaCharacter"];
    externalLink?: ValueTypes["MediaExternalLink"];
    staff?: ValueTypes["StaffEdge"];
    studio?: ValueTypes["StudioEdge"];
    submission?: ValueTypes["MediaSubmissionEdge"];
    __typename?: boolean | `@${string}`;
    "...on MediaSubmissionComparison"?: Omit<
      ValueTypes["MediaSubmissionComparison"],
      "...on MediaSubmissionComparison"
    >;
  }>;
  MediaSubmissionEdge: AliasType<{
    character?: ValueTypes["Character"];
    characterName?: boolean | `@${string}`;
    characterRole?: boolean | `@${string}`;
    characterSubmission?: ValueTypes["Character"];
    dubGroup?: boolean | `@${string}`;
    externalLink?: ValueTypes["MediaExternalLink"];
    /** The id of the direct submission */
    id?: boolean | `@${string}`;
    isMain?: boolean | `@${string}`;
    media?: ValueTypes["Media"];
    roleNotes?: boolean | `@${string}`;
    staff?: ValueTypes["Staff"];
    staffRole?: boolean | `@${string}`;
    staffSubmission?: ValueTypes["Staff"];
    studio?: ValueTypes["Studio"];
    voiceActor?: ValueTypes["Staff"];
    voiceActorSubmission?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on MediaSubmissionEdge"?: Omit<
      ValueTypes["MediaSubmissionEdge"],
      "...on MediaSubmissionEdge"
    >;
  }>;
  /** A tag that describes a theme or element of the media */
  MediaTag: AliasType<{
    /** The categories of tags this tag belongs to */
    category?: boolean | `@${string}`;
    /** A general description of the tag */
    description?: boolean | `@${string}`;
    /** The id of the tag */
    id?: boolean | `@${string}`;
    /** If the tag is only for adult 18+ media */
    isAdult?: boolean | `@${string}`;
    /** If the tag could be a spoiler for any media */
    isGeneralSpoiler?: boolean | `@${string}`;
    /** If the tag is a spoiler for this media */
    isMediaSpoiler?: boolean | `@${string}`;
    /** The name of the tag */
    name?: boolean | `@${string}`;
    /** The relevance ranking of the tag out of the 100 for this media */
    rank?: boolean | `@${string}`;
    /** The user who submitted the tag */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaTag"?: Omit<ValueTypes["MediaTag"], "...on MediaTag">;
  }>;
  /** The official titles of the media in various languages */
  MediaTitle: AliasType<{
    english?: [
      { stylised?: boolean | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    native?: [
      { stylised?: boolean | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    romaji?: [
      { stylised?: boolean | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    /** The currently authenticated users preferred title language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaTitle"?: Omit<ValueTypes["MediaTitle"], "...on MediaTitle">;
  }>;
  /** Media trailer or advertisement */
  MediaTrailer: AliasType<{
    /** The trailer video id */
    id?: boolean | `@${string}`;
    /** The site the video is hosted by (Currently either youtube or dailymotion) */
    site?: boolean | `@${string}`;
    /** The url for the thumbnail image of the video */
    thumbnail?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaTrailer"?: Omit<
      ValueTypes["MediaTrailer"],
      "...on MediaTrailer"
    >;
  }>;
  /** Daily media statistics */
  MediaTrend: AliasType<{
    /** A weighted average score of all the user's scores of the media */
    averageScore?: boolean | `@${string}`;
    /** The day the data was recorded (timestamp) */
    date?: boolean | `@${string}`;
    /** The episode number of the anime released on this day */
    episode?: boolean | `@${string}`;
    /** The number of users with watching/reading the media */
    inProgress?: boolean | `@${string}`;
    /** The related media */
    media?: ValueTypes["Media"];
    /** The id of the tag */
    mediaId?: boolean | `@${string}`;
    /** The number of users with the media on their list */
    popularity?: boolean | `@${string}`;
    /** If the media was being released at this time */
    releasing?: boolean | `@${string}`;
    /** The amount of media activity on the day */
    trending?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaTrend"?: Omit<ValueTypes["MediaTrend"], "...on MediaTrend">;
  }>;
  MediaTrendConnection: AliasType<{
    edges?: ValueTypes["MediaTrendEdge"];
    nodes?: ValueTypes["MediaTrend"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on MediaTrendConnection"?: Omit<
      ValueTypes["MediaTrendConnection"],
      "...on MediaTrendConnection"
    >;
  }>;
  /** Media trend connection edge */
  MediaTrendEdge: AliasType<{
    node?: ValueTypes["MediaTrend"];
    __typename?: boolean | `@${string}`;
    "...on MediaTrendEdge"?: Omit<
      ValueTypes["MediaTrendEdge"],
      "...on MediaTrendEdge"
    >;
  }>;
  /** User message activity */
  MessageActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the message is private and only viewable to the sender and recipients */
    isPrivate?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ValueTypes["User"];
    message?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The user who sent the activity message */
    messenger?: ValueTypes["User"];
    /** The user id of the activity's sender */
    messengerId?: boolean | `@${string}`;
    /** The user who the activity message was sent to */
    recipient?: ValueTypes["User"];
    /** The user id of the activity's recipient */
    recipientId?: boolean | `@${string}`;
    /** The written replies to the activity */
    replies?: ValueTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The type of the activity */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MessageActivity"?: Omit<
      ValueTypes["MessageActivity"],
      "...on MessageActivity"
    >;
  }>;
  ModAction: AliasType<{
    createdAt?: boolean | `@${string}`;
    data?: boolean | `@${string}`;
    /** The id of the action */
    id?: boolean | `@${string}`;
    mod?: ValueTypes["User"];
    objectId?: boolean | `@${string}`;
    objectType?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    user?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on ModAction"?: Omit<ValueTypes["ModAction"], "...on ModAction">;
  }>;
  Mutation: AliasType<{
    DeleteActivity?: [
      {
        /** The id of the activity to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteActivityReply?: [
      {
        /** The id of the reply to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteCustomList?: [
      {
        /** The name of the custom list to delete */
        customList?:
          | string
          | undefined
          | null
          | Variable<any, string> /** The media list type of the custom list */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteMediaListEntry?: [
      {
        /** The id of the media list entry to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteReview?: [
      {
        /** The id of the review to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteThread?: [
      {
        /** The id of the thread to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    DeleteThreadComment?: [
      {
        /** The id of the thread comment to delete */
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Deleted"],
    ];
    RateReview?: [
      {
        /** The rating to apply to the review */
        rating?:
          | ValueTypes["ReviewRating"]
          | undefined
          | null
          | Variable<any, string> /** The id of the review to rate */;
        reviewId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Review"],
    ];
    SaveActivityReply?: [
      {
        /** The id of the parent activity being replied to */
        activityId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the reply should be sent from the Moderator account (Mod Only) */;
        asMod?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The activity reply id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The reply text */;
        text?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityReply"],
    ];
    SaveListActivity?: [
      {
        /** The activity's id, required for updating */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the activity should be locked. (Mod Only) */;
        locked?: boolean | undefined | null | Variable<any, string>;
      },
      ValueTypes["ListActivity"],
    ];
    SaveMediaListEntry?: [
      {
        /** Array of advanced scores */
        advancedScores?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** When the entry was completed by the user */;
        completedAt?:
          | ValueTypes["FuzzyDateInput"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Array of custom list names which should be enabled for this entry */;
        customLists?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the entry shown be hidden from non-custom lists */;
        hiddenFromStatusLists?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The list entry id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the media the entry is of */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Text notes */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Priority of planning */;
        priority?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the entry should only be visible to authenticated user */;
        private?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The amount of episodes/chapters consumed by the user */;
        progress?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of volumes read by the user */;
        progressVolumes?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The amount of times the user has rewatched/read the media */;
        repeat?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The score of the media in the user's chosen scoring method */;
        score?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The score of the media in 100 point */;
        scoreRaw?:
          | number
          | undefined
          | null
          | Variable<any, string> /** When the entry was started by the user */;
        startedAt?:
          | ValueTypes["FuzzyDateInput"]
          | undefined
          | null
          | Variable<any, string> /** The watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaList"],
    ];
    SaveMessageActivity?: [
      {
        /** If the message should be sent from the Moderator account (Mod Only) */
        asMod?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The activity id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the activity should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The activity message text */;
        message?:
          | string
          | undefined
          | null
          | Variable<any, string> /** If the activity should be private */;
        private?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The id of the user the message is being sent to */;
        recipientId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MessageActivity"],
    ];
    SaveRecommendation?: [
      {
        /** The id of the base media */
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the media to recommend */;
        mediaRecommendationId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The rating to give the recommendation */;
        rating?:
          | ValueTypes["RecommendationRating"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Recommendation"],
    ];
    SaveReview?: [
      {
        /** The main review text. Min:2200 characters */
        body?:
          | string
          | undefined
          | null
          | Variable<any, string> /** The review id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the media the review is of */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the review should only be visible to its creator */;
        private?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** A short summary/preview of the review. Min:20, Max:120 characters */;
        score?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** A short summary/preview of the review. Min:20, Max:120 characters */;
        summary?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["Review"],
    ];
    SaveTextActivity?: [
      {
        /** The activity's id, required for updating */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the activity should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The activity text */;
        text?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["TextActivity"],
    ];
    SaveThread?: [
      {
        /** The main text body of the thread */
        body?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Forum categories the thread should be within */;
        categories?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** The thread id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the thread should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Media related to the contents of the thread */;
        mediaCategories?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the thread should be stickied. (Mod Only) */;
        sticky?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The title of the thread */;
        title?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["Thread"],
    ];
    SaveThreadComment?: [
      {
        /** The comment markdown text */
        comment?:
          | string
          | undefined
          | null
          | Variable<any, string> /** The comment id, required for updating */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the comment tree should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The id of thread comment to reply to */;
        parentCommentId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The id of thread the comment belongs to */;
        threadId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ThreadComment"],
    ];
    ToggleActivityPin?: [
      {
        /** Toggle activity id to be pinned */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the activity should be pinned or unpinned */;
        pinned?: boolean | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityUnion"],
    ];
    ToggleActivitySubscription?: [
      {
        /** The id of the activity to un/subscribe */
        activityId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Whether to subscribe or unsubscribe from the activity */;
        subscribe?: boolean | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityUnion"],
    ];
    ToggleFavourite?: [
      {
        /** The id of the anime to un/favourite */
        animeId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The id of the character to un/favourite */;
        characterId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the manga to un/favourite */;
        mangaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the staff to un/favourite */;
        staffId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The id of the studio to un/favourite */;
        studioId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Favourites"],
    ];
    ToggleFollow?: [
      {
        /** The id of the user to un/follow */
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    ToggleLike?: [
      {
        /** The id of the likeable type */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The type of model to be un/liked */;
        type?:
          | ValueTypes["LikeableType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    ToggleLikeV2?: [
      {
        /** The id of the likeable type */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The type of model to be un/liked */;
        type?:
          | ValueTypes["LikeableType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LikeableUnion"],
    ];
    ToggleThreadSubscription?: [
      {
        /** Whether to subscribe or unsubscribe from the forum thread */
        subscribe?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The id of the forum thread to un/subscribe */;
        threadId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Thread"],
    ];
    UpdateAniChartHighlights?: [
      {
        highlights?:
          | Array<ValueTypes["AniChartHighlightInput"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    UpdateAniChartSettings?: [
      {
        outgoingLinkProvider?:
          | string
          | undefined
          | null
          | Variable<any, string>;
        sort?: string | undefined | null | Variable<any, string>;
        theme?: string | undefined | null | Variable<any, string>;
        titleLanguage?: string | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    UpdateFavouriteOrder?: [
      {
        /** The id of the anime to un/favourite */
        animeIds?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** List of integers which the anime should be ordered by (Asc) */;
        animeOrder?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The id of the character to un/favourite */;
        characterIds?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** List of integers which the character should be ordered by (Asc) */;
        characterOrder?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** The id of the manga to un/favourite */;
        mangaIds?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** List of integers which the manga should be ordered by (Asc) */;
        mangaOrder?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** The id of the staff to un/favourite */;
        staffIds?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** List of integers which the staff should be ordered by (Asc) */;
        staffOrder?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** The id of the studio to un/favourite */;
        studioIds?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** List of integers which the studio should be ordered by (Asc) */;
        studioOrder?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Favourites"],
    ];
    UpdateMediaListEntries?: [
      {
        /** Array of advanced scores */
        advancedScores?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** When the entry was completed by the user */;
        completedAt?:
          | ValueTypes["FuzzyDateInput"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the entry shown be hidden from non-custom lists */;
        hiddenFromStatusLists?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The list entries ids to update */;
        ids?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Text notes */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Priority of planning */;
        priority?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the entry should only be visible to authenticated user */;
        private?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The amount of episodes/chapters consumed by the user */;
        progress?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of volumes read by the user */;
        progressVolumes?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The amount of times the user has rewatched/read the media */;
        repeat?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The score of the media in the user's chosen scoring method */;
        score?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The score of the media in 100 point */;
        scoreRaw?:
          | number
          | undefined
          | null
          | Variable<any, string> /** When the entry was started by the user */;
        startedAt?:
          | ValueTypes["FuzzyDateInput"]
          | undefined
          | null
          | Variable<any, string> /** The watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaList"],
    ];
    UpdateUser?: [
      {
        /** User's about/bio text */
        about?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */;
        activityMergeTime?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the user should get notifications when a show they are watching aires */;
        airingNotifications?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The user's anime list options */;
        animeListOptions?:
          | ValueTypes["MediaListOptionsInput"]
          | undefined
          | null
          | Variable<any, string>;
        disabledListActivity?:
          | Array<ValueTypes["ListActivityOptionInput"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the user should see media marked as adult-only */;
        displayAdultContent?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Profile highlight color */;
        donatorBadge?:
          | string
          | undefined
          | null
          | Variable<any, string> /** The user's anime list options */;
        mangaListOptions?:
          | ValueTypes["MediaListOptionsInput"]
          | undefined
          | null
          | Variable<any, string> /** Notification options */;
        notificationOptions?:
          | Array<ValueTypes["NotificationOptionInput"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Profile highlight color */;
        profileColor?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Only allow messages from other users the user follows */;
        restrictMessagesToFollowing?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The user's default list order */;
        rowOrder?:
          | string
          | undefined
          | null
          | Variable<any, string> /** The user's list scoring system */;
        scoreFormat?:
          | ValueTypes["ScoreFormat"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The language the user wants to see staff and character names in */;
        staffNameLanguage?:
          | ValueTypes["UserStaffNameLanguage"]
          | undefined
          | null
          | Variable<any, string> /** Timezone offset format: -?HH:MM */;
        timezone?:
          | string
          | undefined
          | null
          | Variable<any, string> /** User's title language */;
        titleLanguage?:
          | ValueTypes["UserTitleLanguage"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Mutation"?: Omit<ValueTypes["Mutation"], "...on Mutation">;
  }>;
  /** Notification option */
  NotificationOption: AliasType<{
    /** Whether this type of notification is enabled */
    enabled?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on NotificationOption"?: Omit<
      ValueTypes["NotificationOption"],
      "...on NotificationOption"
    >;
  }>;
  /** Page of data */
  Page: AliasType<{
    activities?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ActivitySort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ActivityUnion"],
    ];
    activityReplies?: [
      {
        /** Filter by the parent id */
        activityId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the reply id */;
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityReply"],
    ];
    airingSchedules?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["AiringSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["AiringSchedule"],
    ];
    characters?: [
      {
        /** Filter by character id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by character by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["CharacterSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Character"],
    ];
    followers?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    likes?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The type of model the id applies to */;
        type?:
          | ValueTypes["LikeableType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ValueTypes["CountryCode"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the season the media was released in */;
        season?:
          | ValueTypes["MediaSeason"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source?:
          | ValueTypes["MediaSource"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source_in?:
          | Array<ValueTypes["MediaSource"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    mediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaListSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the list entries media type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's name */;
        userName?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaList"],
    ];
    mediaTrends?: [
      {
        /** Filter by score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_not?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaTrend"],
    ];
    notifications?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type?:
          | ValueTypes["NotificationType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type_in?:
          | Array<ValueTypes["NotificationType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["NotificationUnion"],
    ];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    recommendations?: [
      {
        /** Filter by recommendation id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by user who created the recommendation */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Recommendation"],
    ];
    reviews?: [
      {
        /** Filter by Review id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media type */;
        mediaType?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ReviewSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by user id */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Review"],
    ];
    staff?: [
      {
        /** Filter by the staff id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by staff by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Staff"],
    ];
    studios?: [
      {
        /** Filter by the studio id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StudioSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Studio"],
    ];
    threadComments?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ThreadComment"],
    ];
    threads?: [
      {
        /** Filter by thread category id */
        categoryId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Thread"],
    ];
    users?: [
      {
        /** Filter by the user id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the name of the user */;
        name?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Page"?: Omit<ValueTypes["Page"], "...on Page">;
  }>;
  PageInfo: AliasType<{
    /** The current page */
    currentPage?: boolean | `@${string}`;
    /** If there is another page */
    hasNextPage?: boolean | `@${string}`;
    /** The last page */
    lastPage?: boolean | `@${string}`;
    /** The count on a page */
    perPage?: boolean | `@${string}`;
    /** The total number of items. Note: This value is not guaranteed to be accurate, do not rely on this for logic */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on PageInfo"?: Omit<ValueTypes["PageInfo"], "...on PageInfo">;
  }>;
  /** Provides the parsed markdown as html */
  ParsedMarkdown: AliasType<{
    /** The parsed markdown as html */
    html?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ParsedMarkdown"?: Omit<
      ValueTypes["ParsedMarkdown"],
      "...on ParsedMarkdown"
    >;
  }>;
  Query: AliasType<{
    Activity?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ActivitySort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not?:
          | ValueTypes["ActivityType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of activity */;
        type_not_in?:
          | Array<ValueTypes["ActivityType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the owner user id */;
        userId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ActivityUnion"],
    ];
    ActivityReply?: [
      {
        /** Filter by the parent id */
        activityId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the reply id */;
        id?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ActivityReply"],
    ];
    AiringSchedule?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["AiringSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["AiringSchedule"],
    ];
    AniChartUser?: ValueTypes["AniChartUser"];
    Character?: [
      {
        /** Filter by character id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by character by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["CharacterSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Character"],
    ];
    ExternalLinkSourceCollection?: [
      {
        /** Filter by the link id */
        id?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["ExternalLinkMediaType"]
          | undefined
          | null
          | Variable<any, string>;
        type?:
          | ValueTypes["ExternalLinkType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaExternalLink"],
    ];
    Follower?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    Following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** User id of the follower/followed */;
        userId: number | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    /** Collection of all the possible media genres */
    GenreCollection?: boolean | `@${string}`;
    Like?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The type of model the id applies to */;
        type?:
          | ValueTypes["LikeableType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    Markdown?: [
      {
        /** The markdown to be parsed to html */
        markdown: string | Variable<any, string>;
      },
      ValueTypes["ParsedMarkdown"],
    ];
    Media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ValueTypes["CountryCode"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not?:
          | ValueTypes["MediaFormat"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's format */;
        format_not_in?:
          | Array<ValueTypes["MediaFormat"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the season the media was released in */;
        season?:
          | ValueTypes["MediaSeason"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source?:
          | ValueTypes["MediaSource"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the source type of the media */;
        source_in?:
          | Array<ValueTypes["MediaSource"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not?:
          | ValueTypes["MediaStatus"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ValueTypes["MediaStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    MediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaListSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the list entries media type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's name */;
        userName?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaList"],
    ];
    MediaListCollection?: [
      {
        /** Which chunk of list entries to load */
        chunk?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Always return completed list entries in one group, overriding the user's split completed option. */;
        forceSingleCompletedList?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The amount of entries per chunk, max 500 */;
        perChunk?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaListSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ValueTypes["FuzzyDateInt"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not?:
          | ValueTypes["MediaListStatus"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ValueTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the list entries media type */;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's id */;
        userId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by a user's name */;
        userName?: string | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaListCollection"],
    ];
    MediaTagCollection?: [
      {
        /** Mod Only */
        status?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaTag"],
    ];
    MediaTrend?: [
      {
        /** Filter by score */
        averageScore?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by score */;
        averageScore_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by date */;
        date_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by episode number */;
        episode_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by trending amount */;
        trending_not?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaTrend"],
    ];
    Notification?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type?:
          | ValueTypes["NotificationType"]
          | undefined
          | null
          | Variable<any, string> /** Filter by the type of notifications */;
        type_in?:
          | Array<ValueTypes["NotificationType"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["NotificationUnion"],
    ];
    Page?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 50 */;
        perPage?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Page"],
    ];
    Recommendation?: [
      {
        /** Filter by recommendation id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by user who created the recommendation */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Recommendation"],
    ];
    Review?: [
      {
        /** Filter by Review id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by media type */;
        mediaType?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ReviewSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by user id */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Review"],
    ];
    /** Site statistics query */
    SiteStatistics?: ValueTypes["SiteStatistics"];
    Staff?: [
      {
        /** Filter by the staff id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by staff by if its their birthday today */;
        isBirthday?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StaffSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Staff"],
    ];
    Studio?: [
      {
        /** Filter by the studio id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["StudioSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["Studio"],
    ];
    Thread?: [
      {
        /** Filter by thread category id */
        categoryId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadSort"] | undefined | null>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Thread"],
    ];
    ThreadComment?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ThreadComment"],
    ];
    User?: [
      {
        /** Filter by the user id */
        id?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** Filter by the name of the user */;
        name?:
          | string
          | undefined
          | null
          | Variable<any, string> /** Filter by search query */;
        search?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["UserSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["User"],
    ];
    /** Get the currently authenticated user */
    Viewer?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on Query"?: Omit<ValueTypes["Query"], "...on Query">;
  }>;
  /** Media recommendation */
  Recommendation: AliasType<{
    /** The id of the recommendation */
    id?: boolean | `@${string}`;
    /** The media the recommendation is from */
    media?: ValueTypes["Media"];
    /** The recommended media */
    mediaRecommendation?: ValueTypes["Media"];
    /** Users rating of the recommendation */
    rating?: boolean | `@${string}`;
    /** The user that first created the recommendation */
    user?: ValueTypes["User"];
    /** The rating of the recommendation by currently authenticated user */
    userRating?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Recommendation"?: Omit<
      ValueTypes["Recommendation"],
      "...on Recommendation"
    >;
  }>;
  RecommendationConnection: AliasType<{
    edges?: ValueTypes["RecommendationEdge"];
    nodes?: ValueTypes["Recommendation"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on RecommendationConnection"?: Omit<
      ValueTypes["RecommendationConnection"],
      "...on RecommendationConnection"
    >;
  }>;
  /** Recommendation connection edge */
  RecommendationEdge: AliasType<{
    node?: ValueTypes["Recommendation"];
    __typename?: boolean | `@${string}`;
    "...on RecommendationEdge"?: Omit<
      ValueTypes["RecommendationEdge"],
      "...on RecommendationEdge"
    >;
  }>;
  /** Notification for when new media is added to the site */
  RelatedMediaAdditionNotification: AliasType<{
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The associated media of the airing schedule */
    media?: ValueTypes["Media"];
    /** The id of the new media */
    mediaId?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on RelatedMediaAdditionNotification"?: Omit<
      ValueTypes["RelatedMediaAdditionNotification"],
      "...on RelatedMediaAdditionNotification"
    >;
  }>;
  Report: AliasType<{
    cleared?: boolean | `@${string}`;
    /** When the entry data was created */
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    reason?: boolean | `@${string}`;
    reported?: ValueTypes["User"];
    reporter?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on Report"?: Omit<ValueTypes["Report"], "...on Report">;
  }>;
  /** A Review that features in an anime or manga */
  Review: AliasType<{
    body?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The time of the thread creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the review */
    id?: boolean | `@${string}`;
    /** The media the review is of */
    media?: ValueTypes["Media"];
    /** The id of the review's media */
    mediaId?: boolean | `@${string}`;
    /** For which type of media the review is for */
    mediaType?: boolean | `@${string}`;
    /** If the review is not yet publicly published and is only viewable by creator */
    private?: boolean | `@${string}`;
    /** The total user rating of the review */
    rating?: boolean | `@${string}`;
    /** The amount of user ratings of the review */
    ratingAmount?: boolean | `@${string}`;
    /** The review score of the media */
    score?: boolean | `@${string}`;
    /** The url for the review page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** A short summary of the review */
    summary?: boolean | `@${string}`;
    /** The time of the thread last update */
    updatedAt?: boolean | `@${string}`;
    /** The creator of the review */
    user?: ValueTypes["User"];
    /** The id of the review's creator */
    userId?: boolean | `@${string}`;
    /** The rating of the review by currently authenticated user */
    userRating?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Review"?: Omit<ValueTypes["Review"], "...on Review">;
  }>;
  ReviewConnection: AliasType<{
    edges?: ValueTypes["ReviewEdge"];
    nodes?: ValueTypes["Review"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on ReviewConnection"?: Omit<
      ValueTypes["ReviewConnection"],
      "...on ReviewConnection"
    >;
  }>;
  /** Review connection edge */
  ReviewEdge: AliasType<{
    node?: ValueTypes["Review"];
    __typename?: boolean | `@${string}`;
    "...on ReviewEdge"?: Omit<ValueTypes["ReviewEdge"], "...on ReviewEdge">;
  }>;
  /** Feed of mod edit activity */
  RevisionHistory: AliasType<{
    /** The action taken on the objects */
    action?: boolean | `@${string}`;
    /** A JSON object of the fields that changed */
    changes?: boolean | `@${string}`;
    /** The character the mod feed entry references */
    character?: ValueTypes["Character"];
    /** When the mod feed entry was created */
    createdAt?: boolean | `@${string}`;
    /** The external link source the mod feed entry references */
    externalLink?: ValueTypes["MediaExternalLink"];
    /** The id of the media */
    id?: boolean | `@${string}`;
    /** The media the mod feed entry references */
    media?: ValueTypes["Media"];
    /** The staff member the mod feed entry references */
    staff?: ValueTypes["Staff"];
    /** The studio the mod feed entry references */
    studio?: ValueTypes["Studio"];
    /** The user who made the edit to the object */
    user?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on RevisionHistory"?: Omit<
      ValueTypes["RevisionHistory"],
      "...on RevisionHistory"
    >;
  }>;
  /** A user's list score distribution. */
  ScoreDistribution: AliasType<{
    /** The amount of list entries with this score */
    amount?: boolean | `@${string}`;
    score?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ScoreDistribution"?: Omit<
      ValueTypes["ScoreDistribution"],
      "...on ScoreDistribution"
    >;
  }>;
  SiteStatistics: AliasType<{
    anime?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    manga?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    reviews?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    staff?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    studios?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    users?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["SiteTrendConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on SiteStatistics"?: Omit<
      ValueTypes["SiteStatistics"],
      "...on SiteStatistics"
    >;
  }>;
  /** Daily site statistics */
  SiteTrend: AliasType<{
    /** The change from yesterday */
    change?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    /** The day the data was recorded (timestamp) */
    date?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on SiteTrend"?: Omit<ValueTypes["SiteTrend"], "...on SiteTrend">;
  }>;
  SiteTrendConnection: AliasType<{
    edges?: ValueTypes["SiteTrendEdge"];
    nodes?: ValueTypes["SiteTrend"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on SiteTrendConnection"?: Omit<
      ValueTypes["SiteTrendConnection"],
      "...on SiteTrendConnection"
    >;
  }>;
  /** Site trend connection edge */
  SiteTrendEdge: AliasType<{
    node?: ValueTypes["SiteTrend"];
    __typename?: boolean | `@${string}`;
    "...on SiteTrendEdge"?: Omit<
      ValueTypes["SiteTrendEdge"],
      "...on SiteTrendEdge"
    >;
  }>;
  /** Voice actors or production staff */
  Staff: AliasType<{
    /** The person's age in years */
    age?: boolean | `@${string}`;
    /** The persons blood type */
    bloodType?: boolean | `@${string}`;
    characterMedia?: [
      {
        onList?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CharacterSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CharacterConnection"],
    ];
    dateOfBirth?: ValueTypes["FuzzyDate"];
    dateOfDeath?: ValueTypes["FuzzyDate"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The amount of user's who have favourited the staff member */
    favourites?: boolean | `@${string}`;
    /** The staff's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: boolean | `@${string}`;
    /** The persons birthplace or hometown */
    homeTown?: boolean | `@${string}`;
    /** The id of the staff member */
    id?: boolean | `@${string}`;
    /** The staff images */
    image?: ValueTypes["StaffImage"];
    /** If the staff member is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the staff member is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    /** The primary language the staff member dub's in */
    language?: boolean | `@${string}`;
    /** The primary language of the staff member. Current values: Japanese, English, Korean, Italian, Spanish, Portuguese, French, German, Hebrew, Hungarian, Chinese, Arabic, Filipino, Catalan, Finnish, Turkish, Dutch, Swedish, Thai, Tagalog, Malaysian, Indonesian, Vietnamese, Nepali, Hindi, Urdu */
    languageV2?: boolean | `@${string}`;
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The names of the staff member */
    name?: ValueTypes["StaffName"];
    /** The person's primary occupations */
    primaryOccupations?: boolean | `@${string}`;
    /** The url for the staff page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** Staff member that the submission is referencing */
    staff?: ValueTypes["Staff"];
    staffMedia?: [
      {
        onList?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
        type?:
          | ValueTypes["MediaType"]
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    /** Inner details of submission status */
    submissionNotes?: boolean | `@${string}`;
    /** Status of the submission */
    submissionStatus?: boolean | `@${string}`;
    /** Submitter for the submission */
    submitter?: ValueTypes["User"];
    updatedAt?: boolean | `@${string}`;
    /** [startYear, endYear] (If the 2nd value is not present staff is still active) */
    yearsActive?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Staff"?: Omit<ValueTypes["Staff"], "...on Staff">;
  }>;
  StaffConnection: AliasType<{
    edges?: ValueTypes["StaffEdge"];
    nodes?: ValueTypes["Staff"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on StaffConnection"?: Omit<
      ValueTypes["StaffConnection"],
      "...on StaffConnection"
    >;
  }>;
  /** Staff connection edge */
  StaffEdge: AliasType<{
    /** The order the staff should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    node?: ValueTypes["Staff"];
    /** The role of the staff member in the production of the media */
    role?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StaffEdge"?: Omit<ValueTypes["StaffEdge"], "...on StaffEdge">;
  }>;
  StaffImage: AliasType<{
    /** The person's image of media at its largest size */
    large?: boolean | `@${string}`;
    /** The person's image of media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StaffImage"?: Omit<ValueTypes["StaffImage"], "...on StaffImage">;
  }>;
  /** The names of the staff member */
  StaffName: AliasType<{
    /** Other names the staff member might be referred to as (pen names) */
    alternative?: boolean | `@${string}`;
    /** The person's given name */
    first?: boolean | `@${string}`;
    /** The person's first and last name */
    full?: boolean | `@${string}`;
    /** The person's surname */
    last?: boolean | `@${string}`;
    /** The person's middle name */
    middle?: boolean | `@${string}`;
    /** The person's full name in their native language */
    native?: boolean | `@${string}`;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StaffName"?: Omit<ValueTypes["StaffName"], "...on StaffName">;
  }>;
  /** Voice actor role for a character */
  StaffRoleType: AliasType<{
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: boolean | `@${string}`;
    /** Notes regarding the VA's role for the character */
    roleNotes?: boolean | `@${string}`;
    /** The voice actors of the character */
    voiceActor?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on StaffRoleType"?: Omit<
      ValueTypes["StaffRoleType"],
      "...on StaffRoleType"
    >;
  }>;
  /** User's staff statistics */
  StaffStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    staff?: ValueTypes["Staff"];
    /** The amount of time in minutes the staff member has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StaffStats"?: Omit<ValueTypes["StaffStats"], "...on StaffStats">;
  }>;
  /** A submission for a staff that features in an anime or manga */
  StaffSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ValueTypes["User"];
    createdAt?: boolean | `@${string}`;
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    /** Inner details of submission status */
    notes?: boolean | `@${string}`;
    source?: boolean | `@${string}`;
    /** Staff that the submission is referencing */
    staff?: ValueTypes["Staff"];
    /** Status of the submission */
    status?: boolean | `@${string}`;
    /** The staff submission changes */
    submission?: ValueTypes["Staff"];
    /** Submitter for the submission */
    submitter?: ValueTypes["User"];
    __typename?: boolean | `@${string}`;
    "...on StaffSubmission"?: Omit<
      ValueTypes["StaffSubmission"],
      "...on StaffSubmission"
    >;
  }>;
  /** The distribution of the watching/reading status of media or a user's list */
  StatusDistribution: AliasType<{
    /** The amount of entries with this status */
    amount?: boolean | `@${string}`;
    /** The day the activity took place (Unix timestamp) */
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StatusDistribution"?: Omit<
      ValueTypes["StatusDistribution"],
      "...on StatusDistribution"
    >;
  }>;
  /** Animation or production company */
  Studio: AliasType<{
    /** The amount of user's who have favourited the studio */
    favourites?: boolean | `@${string}`;
    /** The id of the studio */
    id?: boolean | `@${string}`;
    /** If the studio is an animation studio or a different kind of company */
    isAnimationStudio?: boolean | `@${string}`;
    /** If the studio is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    media?: [
      {
        /** If the studio was the primary animation studio of the media */
        isMain?: boolean | undefined | null | Variable<any, string>;
        onList?:
          | boolean
          | undefined
          | null
          | Variable<any, string> /** The page */;
        page?:
          | number
          | undefined
          | null
          | Variable<any, string> /** The amount of entries per page, max 25 */;
        perPage?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** The order the results will be returned in */;
        sort?:
          | Array<ValueTypes["MediaSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    /** The name of the studio */
    name?: boolean | `@${string}`;
    /** The url for the studio page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Studio"?: Omit<ValueTypes["Studio"], "...on Studio">;
  }>;
  StudioConnection: AliasType<{
    edges?: ValueTypes["StudioEdge"];
    nodes?: ValueTypes["Studio"];
    /** The pagination information */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on StudioConnection"?: Omit<
      ValueTypes["StudioConnection"],
      "...on StudioConnection"
    >;
  }>;
  /** Studio connection edge */
  StudioEdge: AliasType<{
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** If the studio is the main animation studio of the anime */
    isMain?: boolean | `@${string}`;
    node?: ValueTypes["Studio"];
    __typename?: boolean | `@${string}`;
    "...on StudioEdge"?: Omit<ValueTypes["StudioEdge"], "...on StudioEdge">;
  }>;
  /** User's studio statistics */
  StudioStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    studio?: ValueTypes["Studio"];
    /** The amount of time in minutes the studio's works have been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StudioStats"?: Omit<ValueTypes["StudioStats"], "...on StudioStats">;
  }>;
  /** User's tag statistics */
  TagStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    tag?: ValueTypes["MediaTag"];
    /** The amount of time in minutes the tag has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on TagStats"?: Omit<ValueTypes["TagStats"], "...on TagStats">;
  }>;
  /** User text activity */
  TextActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ValueTypes["User"];
    /** The written replies to the activity */
    replies?: ValueTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    text?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The type of activity */
    type?: boolean | `@${string}`;
    /** The user who created the activity */
    user?: ValueTypes["User"];
    /** The user id of the activity's creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on TextActivity"?: Omit<
      ValueTypes["TextActivity"],
      "...on TextActivity"
    >;
  }>;
  /** Forum Thread */
  Thread: AliasType<{
    body?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The categories of the thread */
    categories?: ValueTypes["ThreadCategory"];
    /** The time of the thread creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the thread */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the thread */
    isLiked?: boolean | `@${string}`;
    /** If the thread is locked and can receive comments */
    isLocked?: boolean | `@${string}`;
    /** If the thread is stickied and should be displayed at the top of the page */
    isSticky?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the thread */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the thread has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the thread */
    likes?: ValueTypes["User"];
    /** The media categories of the thread */
    mediaCategories?: ValueTypes["Media"];
    /** The time of the last reply */
    repliedAt?: boolean | `@${string}`;
    /** The id of the most recent comment on the thread */
    replyCommentId?: boolean | `@${string}`;
    /** The number of comments on the thread */
    replyCount?: boolean | `@${string}`;
    /** The user to last reply to the thread */
    replyUser?: ValueTypes["User"];
    /** The id of the user who most recently commented on the thread */
    replyUserId?: boolean | `@${string}`;
    /** The url for the thread page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The title of the thread */
    title?: boolean | `@${string}`;
    /** The time of the thread last update */
    updatedAt?: boolean | `@${string}`;
    /** The owner of the thread */
    user?: ValueTypes["User"];
    /** The id of the thread owner user */
    userId?: boolean | `@${string}`;
    /** The number of times users have viewed the thread */
    viewCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Thread"?: Omit<ValueTypes["Thread"], "...on Thread">;
  }>;
  /** A forum thread category */
  ThreadCategory: AliasType<{
    /** The id of the category */
    id?: boolean | `@${string}`;
    /** The name of the category */
    name?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadCategory"?: Omit<
      ValueTypes["ThreadCategory"],
      "...on ThreadCategory"
    >;
  }>;
  /** Forum Thread Comment */
  ThreadComment: AliasType<{
    /** The comment's child reply comments */
    childComments?: boolean | `@${string}`;
    comment?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The time of the comments creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the comment */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the comment */
    isLiked?: boolean | `@${string}`;
    /** If the comment tree is locked and may not receive replies or edits */
    isLocked?: boolean | `@${string}`;
    /** The amount of likes the comment has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the comment */
    likes?: ValueTypes["User"];
    /** The url for the comment page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The thread the comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The id of thread the comment belongs to */
    threadId?: boolean | `@${string}`;
    /** The time of the comments last update */
    updatedAt?: boolean | `@${string}`;
    /** The user who created the comment */
    user?: ValueTypes["User"];
    /** The user id of the comment's owner */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadComment"?: Omit<
      ValueTypes["ThreadComment"],
      "...on ThreadComment"
    >;
  }>;
  /** Notification for when a thread comment is liked */
  ThreadCommentLikeNotification: AliasType<{
    /** The thread comment that was liked */
    comment?: ValueTypes["ThreadComment"];
    /** The id of the activity which was liked */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ValueTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadCommentLikeNotification"?: Omit<
      ValueTypes["ThreadCommentLikeNotification"],
      "...on ThreadCommentLikeNotification"
    >;
  }>;
  /** Notification for when authenticated user is @ mentioned in a forum thread comment */
  ThreadCommentMentionNotification: AliasType<{
    /** The thread comment that included the @ mention */
    comment?: ValueTypes["ThreadComment"];
    /** The id of the comment where mentioned */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who mentioned the authenticated user */
    user?: ValueTypes["User"];
    /** The id of the user who mentioned the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadCommentMentionNotification"?: Omit<
      ValueTypes["ThreadCommentMentionNotification"],
      "...on ThreadCommentMentionNotification"
    >;
  }>;
  /** Notification for when a user replies to your forum thread comment */
  ThreadCommentReplyNotification: AliasType<{
    /** The reply thread comment */
    comment?: ValueTypes["ThreadComment"];
    /** The id of the reply comment */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ValueTypes["User"];
    /** The id of the user who create the comment reply */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadCommentReplyNotification"?: Omit<
      ValueTypes["ThreadCommentReplyNotification"],
      "...on ThreadCommentReplyNotification"
    >;
  }>;
  /** Notification for when a user replies to a subscribed forum thread */
  ThreadCommentSubscribedNotification: AliasType<{
    /** The reply thread comment */
    comment?: ValueTypes["ThreadComment"];
    /** The id of the new comment in the subscribed thread */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the subscribed thread */
    user?: ValueTypes["User"];
    /** The id of the user who commented on the thread */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadCommentSubscribedNotification"?: Omit<
      ValueTypes["ThreadCommentSubscribedNotification"],
      "...on ThreadCommentSubscribedNotification"
    >;
  }>;
  /** Notification for when a thread is liked */
  ThreadLikeNotification: AliasType<{
    /** The liked thread comment */
    comment?: ValueTypes["ThreadComment"];
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ValueTypes["Thread"];
    /** The id of the thread which was liked */
    threadId?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ValueTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ThreadLikeNotification"?: Omit<
      ValueTypes["ThreadLikeNotification"],
      "...on ThreadLikeNotification"
    >;
  }>;
  /** A user */
  User: AliasType<{
    about?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null | Variable<any, string>;
      },
      boolean | `@${string}`,
    ];
    /** The user's avatar images */
    avatar?: ValueTypes["UserAvatar"];
    /** The user's banner images */
    bannerImage?: boolean | `@${string}`;
    bans?: boolean | `@${string}`;
    /** When the user's account was created. (Does not exist for accounts created before 2020) */
    createdAt?: boolean | `@${string}`;
    /** Custom donation badge text */
    donatorBadge?: boolean | `@${string}`;
    /** The donation tier of the user */
    donatorTier?: boolean | `@${string}`;
    favourites?: [
      {
        /** Deprecated. Use page arguments on each favourite field instead. */
        page?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["Favourites"],
    ];
    /** The id of the user */
    id?: boolean | `@${string}`;
    /** If the user is blocked by the authenticated user */
    isBlocked?: boolean | `@${string}`;
    /** If this user if following the authenticated user */
    isFollower?: boolean | `@${string}`;
    /** If the authenticated user if following this user */
    isFollowing?: boolean | `@${string}`;
    /** The user's media list options */
    mediaListOptions?: ValueTypes["MediaListOptions"];
    /** The user's moderator roles if they are a site moderator */
    moderatorRoles?: boolean | `@${string}`;
    /** If the user is a moderator or data moderator */
    moderatorStatus?: boolean | `@${string}`;
    /** The name of the user */
    name?: boolean | `@${string}`;
    /** The user's general options */
    options?: ValueTypes["UserOptions"];
    /** The user's previously used names. */
    previousNames?: ValueTypes["UserPreviousName"];
    /** The url for the user page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The users anime & manga list statistics */
    statistics?: ValueTypes["UserStatisticTypes"];
    /** The user's statistics */
    stats?: ValueTypes["UserStats"];
    /** The number of unread notifications the user has */
    unreadNotificationCount?: boolean | `@${string}`;
    /** When the user's data was last updated */
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on User"?: Omit<ValueTypes["User"], "...on User">;
  }>;
  /** A user's activity history stats. */
  UserActivityHistory: AliasType<{
    /** The amount of activity on the day */
    amount?: boolean | `@${string}`;
    /** The day the activity took place (Unix timestamp) */
    date?: boolean | `@${string}`;
    /** The level of activity represented on a 1-10 scale */
    level?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserActivityHistory"?: Omit<
      ValueTypes["UserActivityHistory"],
      "...on UserActivityHistory"
    >;
  }>;
  /** A user's avatars */
  UserAvatar: AliasType<{
    /** The avatar of user at its largest size */
    large?: boolean | `@${string}`;
    /** The avatar of user at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserAvatar"?: Omit<ValueTypes["UserAvatar"], "...on UserAvatar">;
  }>;
  UserCountryStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    country?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserCountryStatistic"?: Omit<
      ValueTypes["UserCountryStatistic"],
      "...on UserCountryStatistic"
    >;
  }>;
  UserFormatStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    format?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserFormatStatistic"?: Omit<
      ValueTypes["UserFormatStatistic"],
      "...on UserFormatStatistic"
    >;
  }>;
  UserGenreStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    genre?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserGenreStatistic"?: Omit<
      ValueTypes["UserGenreStatistic"],
      "...on UserGenreStatistic"
    >;
  }>;
  UserLengthStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    length?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserLengthStatistic"?: Omit<
      ValueTypes["UserLengthStatistic"],
      "...on UserLengthStatistic"
    >;
  }>;
  /** User data for moderators */
  UserModData: AliasType<{
    alts?: ValueTypes["User"];
    bans?: boolean | `@${string}`;
    counts?: boolean | `@${string}`;
    email?: boolean | `@${string}`;
    ip?: boolean | `@${string}`;
    privacy?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserModData"?: Omit<ValueTypes["UserModData"], "...on UserModData">;
  }>;
  /** A user's general options */
  UserOptions: AliasType<{
    /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */
    activityMergeTime?: boolean | `@${string}`;
    /** Whether the user receives notifications when a show they are watching aires */
    airingNotifications?: boolean | `@${string}`;
    /** The list activity types the user has disabled from being created from list updates */
    disabledListActivity?: ValueTypes["ListActivityOption"];
    /** Whether the user has enabled viewing of 18+ content */
    displayAdultContent?: boolean | `@${string}`;
    /** Notification options */
    notificationOptions?: ValueTypes["NotificationOption"];
    /** Profile highlight color (blue, purple, pink, orange, red, green, gray) */
    profileColor?: boolean | `@${string}`;
    /** Whether the user only allow messages from users they follow */
    restrictMessagesToFollowing?: boolean | `@${string}`;
    /** The language the user wants to see staff and character names in */
    staffNameLanguage?: boolean | `@${string}`;
    /** The user's timezone offset (Auth user only) */
    timezone?: boolean | `@${string}`;
    /** The language the user wants to see media titles in */
    titleLanguage?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserOptions"?: Omit<ValueTypes["UserOptions"], "...on UserOptions">;
  }>;
  /** A user's previous name */
  UserPreviousName: AliasType<{
    /** When the user first changed from this name. */
    createdAt?: boolean | `@${string}`;
    /** A previous name of the user. */
    name?: boolean | `@${string}`;
    /** When the user most recently changed from this name. */
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserPreviousName"?: Omit<
      ValueTypes["UserPreviousName"],
      "...on UserPreviousName"
    >;
  }>;
  UserReleaseYearStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    releaseYear?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserReleaseYearStatistic"?: Omit<
      ValueTypes["UserReleaseYearStatistic"],
      "...on UserReleaseYearStatistic"
    >;
  }>;
  UserScoreStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    score?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserScoreStatistic"?: Omit<
      ValueTypes["UserScoreStatistic"],
      "...on UserScoreStatistic"
    >;
  }>;
  UserStaffStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    staff?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on UserStaffStatistic"?: Omit<
      ValueTypes["UserStaffStatistic"],
      "...on UserStaffStatistic"
    >;
  }>;
  UserStartYearStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    startYear?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserStartYearStatistic"?: Omit<
      ValueTypes["UserStartYearStatistic"],
      "...on UserStartYearStatistic"
    >;
  }>;
  UserStatisticTypes: AliasType<{
    anime?: ValueTypes["UserStatistics"];
    manga?: ValueTypes["UserStatistics"];
    __typename?: boolean | `@${string}`;
    "...on UserStatisticTypes"?: Omit<
      ValueTypes["UserStatisticTypes"],
      "...on UserStatisticTypes"
    >;
  }>;
  UserStatistics: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    countries?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserCountryStatistic"],
    ];
    episodesWatched?: boolean | `@${string}`;
    formats?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserFormatStatistic"],
    ];
    genres?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserGenreStatistic"],
    ];
    lengths?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserLengthStatistic"],
    ];
    meanScore?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    releaseYears?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserReleaseYearStatistic"],
    ];
    scores?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserScoreStatistic"],
    ];
    staff?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserStaffStatistic"],
    ];
    standardDeviation?: boolean | `@${string}`;
    startYears?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserStartYearStatistic"],
    ];
    statuses?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserStatusStatistic"],
    ];
    studios?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserStudioStatistic"],
    ];
    tags?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserTagStatistic"],
    ];
    voiceActors?: [
      {
        limit?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["UserVoiceActorStatistic"],
    ];
    volumesRead?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserStatistics"?: Omit<
      ValueTypes["UserStatistics"],
      "...on UserStatistics"
    >;
  }>;
  /** A user's statistics */
  UserStats: AliasType<{
    activityHistory?: ValueTypes["UserActivityHistory"];
    animeListScores?: ValueTypes["ListScoreStats"];
    animeScoreDistribution?: ValueTypes["ScoreDistribution"];
    animeStatusDistribution?: ValueTypes["StatusDistribution"];
    /** The amount of manga chapters the user has read */
    chaptersRead?: boolean | `@${string}`;
    favouredActors?: ValueTypes["StaffStats"];
    favouredFormats?: ValueTypes["FormatStats"];
    favouredGenres?: ValueTypes["GenreStats"];
    favouredGenresOverview?: ValueTypes["GenreStats"];
    favouredStaff?: ValueTypes["StaffStats"];
    favouredStudios?: ValueTypes["StudioStats"];
    favouredTags?: ValueTypes["TagStats"];
    favouredYears?: ValueTypes["YearStats"];
    mangaListScores?: ValueTypes["ListScoreStats"];
    mangaScoreDistribution?: ValueTypes["ScoreDistribution"];
    mangaStatusDistribution?: ValueTypes["StatusDistribution"];
    /** The amount of anime the user has watched in minutes */
    watchedTime?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserStats"?: Omit<ValueTypes["UserStats"], "...on UserStats">;
  }>;
  UserStatusStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on UserStatusStatistic"?: Omit<
      ValueTypes["UserStatusStatistic"],
      "...on UserStatusStatistic"
    >;
  }>;
  UserStudioStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    studio?: ValueTypes["Studio"];
    __typename?: boolean | `@${string}`;
    "...on UserStudioStatistic"?: Omit<
      ValueTypes["UserStudioStatistic"],
      "...on UserStudioStatistic"
    >;
  }>;
  UserTagStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    tag?: ValueTypes["MediaTag"];
    __typename?: boolean | `@${string}`;
    "...on UserTagStatistic"?: Omit<
      ValueTypes["UserTagStatistic"],
      "...on UserTagStatistic"
    >;
  }>;
  UserVoiceActorStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    characterIds?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    voiceActor?: ValueTypes["Staff"];
    __typename?: boolean | `@${string}`;
    "...on UserVoiceActorStatistic"?: Omit<
      ValueTypes["UserVoiceActorStatistic"],
      "...on UserVoiceActorStatistic"
    >;
  }>;
  /** User's year statistics */
  YearStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on YearStats"?: Omit<ValueTypes["YearStats"], "...on YearStats">;
  }>;
  /** Activity sort enums */
  ActivitySort: ActivitySort;
  /** Activity type enum. */
  ActivityType: ActivityType;
  /** Airing schedule sort enums */
  AiringSort: AiringSort;
  /** The role the character plays in the media */
  CharacterRole: CharacterRole;
  /** Character sort enums */
  CharacterSort: CharacterSort;
  ExternalLinkMediaType: ExternalLinkMediaType;
  ExternalLinkType: ExternalLinkType;
  /** Types that can be liked */
  LikeableType: LikeableType;
  /** The format the media was released in */
  MediaFormat: MediaFormat;
  /** Media list sort enums */
  MediaListSort: MediaListSort;
  /** Media list watching/reading status enum. */
  MediaListStatus: MediaListStatus;
  /** The type of ranking */
  MediaRankType: MediaRankType;
  /** Type of relation media has to its parent. */
  MediaRelation: MediaRelation;
  MediaSeason: MediaSeason;
  /** Media sort enums */
  MediaSort: MediaSort;
  /** Source type the media was adapted from */
  MediaSource: MediaSource;
  /** The current releasing status of the media */
  MediaStatus: MediaStatus;
  /** Media trend sort enums */
  MediaTrendSort: MediaTrendSort;
  /** Media type enum, anime or manga. */
  MediaType: MediaType;
  ModActionType: ModActionType;
  /** Mod role enums */
  ModRole: ModRole;
  /** Notification type enum */
  NotificationType: NotificationType;
  /** Recommendation rating enums */
  RecommendationRating: RecommendationRating;
  /** Recommendation sort enums */
  RecommendationSort: RecommendationSort;
  /** Review rating enums */
  ReviewRating: ReviewRating;
  /** Review sort enums */
  ReviewSort: ReviewSort;
  /** Revision history actions */
  RevisionHistoryAction: RevisionHistoryAction;
  /** Media list scoring type */
  ScoreFormat: ScoreFormat;
  /** Site trend sort enums */
  SiteTrendSort: SiteTrendSort;
  /** The primary language of the voice actor */
  StaffLanguage: StaffLanguage;
  /** Staff sort enums */
  StaffSort: StaffSort;
  /** Studio sort enums */
  StudioSort: StudioSort;
  /** Submission sort enums */
  SubmissionSort: SubmissionSort;
  /** Submission status */
  SubmissionStatus: SubmissionStatus;
  /** Thread comments sort enums */
  ThreadCommentSort: ThreadCommentSort;
  /** Thread sort enums */
  ThreadSort: ThreadSort;
  /** User sort enums */
  UserSort: UserSort;
  /** The language the user wants to see staff and character names in */
  UserStaffNameLanguage: UserStaffNameLanguage;
  /** User statistics sort enum */
  UserStatisticsSort: UserStatisticsSort;
  /** The language the user wants to see media titles in */
  UserTitleLanguage: UserTitleLanguage;
  /** ISO 3166-1 alpha-2 country code */
  CountryCode: unknown;
  /** 8 digit long date integer (YYYYMMDD). Unknown dates represented by 0. E.g. 2016: 20160000, May 1976: 19760500 */
  FuzzyDateInt: unknown;
  Json: unknown;
  AiringScheduleInput: {
    airingAt?: number | undefined | null | Variable<any, string>;
    episode?: number | undefined | null | Variable<any, string>;
    timeUntilAiring?: number | undefined | null | Variable<any, string>;
  };
  AniChartHighlightInput: {
    highlight?: string | undefined | null | Variable<any, string>;
    mediaId?: number | undefined | null | Variable<any, string>;
  };
  /** The names of the character */
  CharacterNameInput: {
    /** Other names the character might be referred by */
    alternative?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** The character's given name */
    first?: string | undefined | null | Variable<any, string>;
    /** The character's surname */
    last?: string | undefined | null | Variable<any, string>;
    /** The character's middle name */
    middle?: string | undefined | null | Variable<any, string>;
    /** The character's full name in their native language */
    native?: string | undefined | null | Variable<any, string>;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDateInput: {
    /** Numeric Day (24) */
    day?: number | undefined | null | Variable<any, string>;
    /** Numeric Month (3) */
    month?: number | undefined | null | Variable<any, string>;
    /** Numeric Year (2017) */
    year?: number | undefined | null | Variable<any, string>;
  };
  ListActivityOptionInput: {
    disabled?: boolean | undefined | null | Variable<any, string>;
    type?:
      | ValueTypes["MediaListStatus"]
      | undefined
      | null
      | Variable<any, string>;
  };
  /** An external link to another site related to the media */
  MediaExternalLinkInput: {
    /** The id of the external link */
    id: number | Variable<any, string>;
    /** The site location of the external link */
    site: string | Variable<any, string>;
    /** The url of the external link */
    url: string | Variable<any, string>;
  };
  /** A user's list options for anime or manga lists */
  MediaListOptionsInput: {
    /** The names of the user's advanced scoring sections */
    advancedScoring?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null | Variable<any, string>;
    /** The names of the user's custom lists */
    customLists?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** The order each list should be displayed in */
    sectionOrder?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?:
      | boolean
      | undefined
      | null
      | Variable<any, string>;
    /** list theme */
    theme?: string | undefined | null | Variable<any, string>;
  };
  /** The official titles of the media in various languages */
  MediaTitleInput: {
    /** The official english title */
    english?: string | undefined | null | Variable<any, string>;
    /** Official title in it's native language */
    native?: string | undefined | null | Variable<any, string>;
    /** The romanization of the native language title */
    romaji?: string | undefined | null | Variable<any, string>;
  };
  /** Notification option input */
  NotificationOptionInput: {
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null | Variable<any, string>;
    /** The type of notification */
    type?:
      | ValueTypes["NotificationType"]
      | undefined
      | null
      | Variable<any, string>;
  };
  /** The names of the staff member */
  StaffNameInput: {
    /** Other names the character might be referred by */
    alternative?:
      | Array<string | undefined | null>
      | undefined
      | null
      | Variable<any, string>;
    /** The person's given name */
    first?: string | undefined | null | Variable<any, string>;
    /** The person's surname */
    last?: string | undefined | null | Variable<any, string>;
    /** The person's middle name */
    middle?: string | undefined | null | Variable<any, string>;
    /** The person's full name in their native language */
    native?: string | undefined | null | Variable<any, string>;
  };
  ID: unknown;
};

export type ResolverInputTypes = {
  schema: AliasType<{
    query?: ResolverInputTypes["Query"];
    mutation?: ResolverInputTypes["Mutation"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Activity union type */
  ActivityUnion: AliasType<{
    ListActivity?: ResolverInputTypes["ListActivity"];
    MessageActivity?: ResolverInputTypes["MessageActivity"];
    TextActivity?: ResolverInputTypes["TextActivity"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Likeable union type */
  LikeableUnion: AliasType<{
    ActivityReply?: ResolverInputTypes["ActivityReply"];
    ListActivity?: ResolverInputTypes["ListActivity"];
    MessageActivity?: ResolverInputTypes["MessageActivity"];
    TextActivity?: ResolverInputTypes["TextActivity"];
    Thread?: ResolverInputTypes["Thread"];
    ThreadComment?: ResolverInputTypes["ThreadComment"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification union type */
  NotificationUnion: AliasType<{
    ActivityLikeNotification?: ResolverInputTypes["ActivityLikeNotification"];
    ActivityMentionNotification?: ResolverInputTypes["ActivityMentionNotification"];
    ActivityMessageNotification?: ResolverInputTypes["ActivityMessageNotification"];
    ActivityReplyLikeNotification?: ResolverInputTypes["ActivityReplyLikeNotification"];
    ActivityReplyNotification?: ResolverInputTypes["ActivityReplyNotification"];
    ActivityReplySubscribedNotification?: ResolverInputTypes["ActivityReplySubscribedNotification"];
    AiringNotification?: ResolverInputTypes["AiringNotification"];
    FollowingNotification?: ResolverInputTypes["FollowingNotification"];
    MediaDataChangeNotification?: ResolverInputTypes["MediaDataChangeNotification"];
    MediaDeletionNotification?: ResolverInputTypes["MediaDeletionNotification"];
    MediaMergeNotification?: ResolverInputTypes["MediaMergeNotification"];
    RelatedMediaAdditionNotification?: ResolverInputTypes["RelatedMediaAdditionNotification"];
    ThreadCommentLikeNotification?: ResolverInputTypes["ThreadCommentLikeNotification"];
    ThreadCommentMentionNotification?: ResolverInputTypes["ThreadCommentMentionNotification"];
    ThreadCommentReplyNotification?: ResolverInputTypes["ThreadCommentReplyNotification"];
    ThreadCommentSubscribedNotification?: ResolverInputTypes["ThreadCommentSubscribedNotification"];
    ThreadLikeNotification?: ResolverInputTypes["ThreadLikeNotification"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a activity is liked */
  ActivityLikeNotification: AliasType<{
    /** The liked activity */
    activity?: ResolverInputTypes["ActivityUnion"];
    /** The id of the activity which was liked */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when authenticated user is @ mentioned in activity or reply */
  ActivityMentionNotification: AliasType<{
    /** The liked activity */
    activity?: ResolverInputTypes["ActivityUnion"];
    /** The id of the activity where mentioned */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who mentioned the authenticated user */
    user?: ResolverInputTypes["User"];
    /** The id of the user who mentioned the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a user is send an activity message */
  ActivityMessageNotification: AliasType<{
    /** The id of the activity message */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The message activity */
    message?: ResolverInputTypes["MessageActivity"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who sent the message */
    user?: ResolverInputTypes["User"];
    /** The if of the user who send the message */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Replay to an activity item */
  ActivityReply: AliasType<{
    /** The id of the parent activity */
    activityId?: boolean | `@${string}`;
    /** The time the reply was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the reply */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the reply */
    isLiked?: boolean | `@${string}`;
    /** The amount of likes the reply has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the reply */
    likes?: ResolverInputTypes["User"];
    text?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The user who created reply */
    user?: ResolverInputTypes["User"];
    /** The id of the replies creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a activity reply is liked */
  ActivityReplyLikeNotification: AliasType<{
    /** The liked activity */
    activity?: ResolverInputTypes["ActivityUnion"];
    /** The id of the activity where the reply which was liked */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity reply */
    user?: ResolverInputTypes["User"];
    /** The id of the user who liked to the activity reply */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a user replies to the authenticated users activity */
  ActivityReplyNotification: AliasType<{
    /** The liked activity */
    activity?: ResolverInputTypes["ActivityUnion"];
    /** The id of the activity which was replied too */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who replied to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a user replies to activity the authenticated user has replied to */
  ActivityReplySubscribedNotification: AliasType<{
    /** The liked activity */
    activity?: ResolverInputTypes["ActivityUnion"];
    /** The id of the activity which was replied too */
    activityId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who replied to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when an episode of anime airs */
  AiringNotification: AliasType<{
    /** The id of the aired anime */
    animeId?: boolean | `@${string}`;
    /** The notification context text */
    contexts?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The episode number that just aired */
    episode?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The associated media of the airing schedule */
    media?: ResolverInputTypes["Media"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Score & Watcher stats for airing anime by episode and mid-week */
  AiringProgression: AliasType<{
    /** The episode the stats were recorded at. .5 is the mid point between 2 episodes airing dates. */
    episode?: boolean | `@${string}`;
    /** The average score for the media */
    score?: boolean | `@${string}`;
    /** The amount of users watching the anime */
    watching?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media Airing Schedule. NOTE: We only aim to guarantee that FUTURE airing data is present and accurate. */
  AiringSchedule: AliasType<{
    /** The time the episode airs at */
    airingAt?: boolean | `@${string}`;
    /** The airing episode number */
    episode?: boolean | `@${string}`;
    /** The id of the airing schedule item */
    id?: boolean | `@${string}`;
    /** The associate media of the airing episode */
    media?: ResolverInputTypes["Media"];
    /** The associate media id of the airing episode */
    mediaId?: boolean | `@${string}`;
    /** Seconds until episode starts airing */
    timeUntilAiring?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  AiringScheduleConnection: AliasType<{
    edges?: ResolverInputTypes["AiringScheduleEdge"];
    nodes?: ResolverInputTypes["AiringSchedule"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** AiringSchedule connection edge */
  AiringScheduleEdge: AliasType<{
    /** The id of the connection */
    id?: boolean | `@${string}`;
    node?: ResolverInputTypes["AiringSchedule"];
    __typename?: boolean | `@${string}`;
  }>;
  AniChartUser: AliasType<{
    highlights?: boolean | `@${string}`;
    settings?: boolean | `@${string}`;
    user?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A character that features in an anime or manga */
  Character: AliasType<{
    /** The character's age. Note this is a string, not an int, it may contain further text and additional ages. */
    age?: boolean | `@${string}`;
    /** The characters blood type */
    bloodType?: boolean | `@${string}`;
    /** The character's birth date */
    dateOfBirth?: ResolverInputTypes["FuzzyDate"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The amount of user's who have favourited the character */
    favourites?: boolean | `@${string}`;
    /** The character's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: boolean | `@${string}`;
    /** The id of the character */
    id?: boolean | `@${string}`;
    /** Character images */
    image?: ResolverInputTypes["CharacterImage"];
    /** If the character is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the character is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    media?: [
      {
        onList?: boolean | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null;
        type?: ResolverInputTypes["MediaType"] | undefined | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The names of the character */
    name?: ResolverInputTypes["CharacterName"];
    /** The url for the character page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  CharacterConnection: AliasType<{
    edges?: ResolverInputTypes["CharacterEdge"];
    nodes?: ResolverInputTypes["Character"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Character connection edge */
  CharacterEdge: AliasType<{
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** The media the character is in */
    media?: ResolverInputTypes["Media"];
    /** Media specific character name */
    name?: boolean | `@${string}`;
    node?: ResolverInputTypes["Character"];
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    voiceActorRoles?: [
      {
        language?: ResolverInputTypes["StaffLanguage"] | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["StaffRoleType"],
    ];
    voiceActors?: [
      {
        language?: ResolverInputTypes["StaffLanguage"] | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Staff"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  CharacterImage: AliasType<{
    /** The character's image of media at its largest size */
    large?: boolean | `@${string}`;
    /** The character's image of media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The names of the character */
  CharacterName: AliasType<{
    /** Other names the character might be referred to as */
    alternative?: boolean | `@${string}`;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: boolean | `@${string}`;
    /** The character's given name */
    first?: boolean | `@${string}`;
    /** The character's first and last name */
    full?: boolean | `@${string}`;
    /** The character's surname */
    last?: boolean | `@${string}`;
    /** The character's middle name */
    middle?: boolean | `@${string}`;
    /** The character's full name in their native language */
    native?: boolean | `@${string}`;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A submission for a character that features in an anime or manga */
  CharacterSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ResolverInputTypes["User"];
    /** Character that the submission is referencing */
    character?: ResolverInputTypes["Character"];
    createdAt?: boolean | `@${string}`;
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    /** Inner details of submission status */
    notes?: boolean | `@${string}`;
    source?: boolean | `@${string}`;
    /** Status of the submission */
    status?: boolean | `@${string}`;
    /** The character submission changes */
    submission?: ResolverInputTypes["Character"];
    /** Submitter for the submission */
    submitter?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  CharacterSubmissionConnection: AliasType<{
    edges?: ResolverInputTypes["CharacterSubmissionEdge"];
    nodes?: ResolverInputTypes["CharacterSubmission"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** CharacterSubmission connection edge */
  CharacterSubmissionEdge: AliasType<{
    node?: ResolverInputTypes["CharacterSubmission"];
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    /** The submitted voice actors of the character */
    submittedVoiceActors?: ResolverInputTypes["StaffSubmission"];
    /** The voice actors of the character */
    voiceActors?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Deleted data type */
  Deleted: AliasType<{
    /** If an item has been successfully deleted */
    deleted?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User's favourite anime, manga, characters, staff & studios */
  Favourites: AliasType<{
    anime?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    characters?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["CharacterConnection"],
    ];
    manga?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    staff?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["StaffConnection"],
    ];
    studios?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["StudioConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when the authenticated user is followed by another user */
  FollowingNotification: AliasType<{
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The liked activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who followed the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User's format statistics */
  FormatStats: AliasType<{
    amount?: boolean | `@${string}`;
    format?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDate: AliasType<{
    /** Numeric Day (24) */
    day?: boolean | `@${string}`;
    /** Numeric Month (3) */
    month?: boolean | `@${string}`;
    /** Numeric Year (2017) */
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User's genre statistics */
  GenreStats: AliasType<{
    amount?: boolean | `@${string}`;
    genre?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    /** The amount of time in minutes the genre has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Page of data (Used for internal use only) */
  InternalPage: AliasType<{
    activities?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null /** Filter by the activity id */;
        id?: number | undefined | null /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the activity id */;
        id_not?: number | undefined | null /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ActivitySort"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type_not?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_not_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId?: number | undefined | null /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null /** Filter by the owner user id */;
        userId_not_in?: Array<number | undefined | null> | undefined | null;
      },
      ResolverInputTypes["ActivityUnion"],
    ];
    activityReplies?: [
      {
        /** Filter by the parent id */
        activityId?: number | undefined | null /** Filter by the reply id */;
        id?: number | undefined | null;
      },
      ResolverInputTypes["ActivityReply"],
    ];
    airingSchedules?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["AiringSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["AiringSchedule"],
    ];
    characterSubmissions?: [
      {
        assigneeId?: number | undefined | null;
        characterId?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null /** Filter by the status of the submission */;
        status?:
          | ResolverInputTypes["SubmissionStatus"]
          | undefined
          | null /** Filter by the submitter of the submission */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["CharacterSubmission"],
    ];
    characters?: [
      {
        /** Filter by character id */
        id?: number | undefined | null /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character id */;
        id_not?: number | undefined | null /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["CharacterSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Character"],
    ];
    followers?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    likes?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null /** The type of model the id applies to */;
        type?: ResolverInputTypes["LikeableType"] | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ResolverInputTypes["CountryCode"]
          | undefined
          | null /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null /** Filter by the end date of the media */;
        endDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null /** Filter by the media's format */;
        format?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's format */;
        format_not?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_not_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre?: string | undefined | null /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_not?: number | undefined | null /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** Filter by the season the media was released in */;
        season?:
          | ResolverInputTypes["MediaSeason"]
          | undefined
          | null /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null /** Filter by the source type of the media */;
        source?:
          | ResolverInputTypes["MediaSource"]
          | undefined
          | null /** Filter by the source type of the media */;
        source_in?:
          | Array<ResolverInputTypes["MediaSource"] | undefined | null>
          | undefined
          | null /** Filter by the start date of the media */;
        startDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null /** Filter by the media's current release status */;
        status?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's current release status */;
        status_not?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null;
      },
      ResolverInputTypes["Media"],
    ];
    mediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by note words and #tags */;
        notes?: string | undefined | null /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaListSort"] | undefined | null>
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null /** Filter by the watching/reading status */;
        status?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the list entries media type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by a user's id */;
        userId?: number | undefined | null /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by a user's name */;
        userName?: string | undefined | null;
      },
      ResolverInputTypes["MediaList"],
    ];
    mediaSubmissions?: [
      {
        assigneeId?: number | undefined | null;
        mediaId?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null;
        status?: ResolverInputTypes["SubmissionStatus"] | undefined | null;
        submissionId?:
          | number
          | undefined
          | null /** Filter by the media's type */;
        type?: ResolverInputTypes["MediaType"] | undefined | null;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["MediaSubmission"],
    ];
    mediaTrends?: [
      {
        /** Filter by score */
        averageScore?: number | undefined | null /** Filter by score */;
        averageScore_greater?: number | undefined | null /** Filter by score */;
        averageScore_lesser?: number | undefined | null /** Filter by score */;
        averageScore_not?: number | undefined | null /** Filter by date */;
        date?: number | undefined | null /** Filter by date */;
        date_greater?: number | undefined | null /** Filter by date */;
        date_lesser?: number | undefined | null /** Filter by episode number */;
        episode?: number | undefined | null /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_not?: number | undefined | null /** Filter by the media id */;
        mediaId?: number | undefined | null /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        mediaId_not?: number | undefined | null /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by popularity */;
        popularity?: number | undefined | null /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null /** Filter by trending amount */;
        trending?: number | undefined | null /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_not?: number | undefined | null;
      },
      ResolverInputTypes["MediaTrend"],
    ];
    modActions?: [
      { modId?: number | undefined | null; userId?: number | undefined | null },
      ResolverInputTypes["ModAction"],
    ];
    notifications?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null /** Filter by the type of notifications */;
        type?:
          | ResolverInputTypes["NotificationType"]
          | undefined
          | null /** Filter by the type of notifications */;
        type_in?:
          | Array<ResolverInputTypes["NotificationType"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["NotificationUnion"],
    ];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    recommendations?: [
      {
        /** Filter by recommendation id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null /** Filter by user who created the recommendation */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Recommendation"],
    ];
    reports?: [
      {
        reportedId?: number | undefined | null;
        reporterId?: number | undefined | null;
      },
      ResolverInputTypes["Report"],
    ];
    reviews?: [
      {
        /** Filter by Review id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?: number | undefined | null /** Filter by media type */;
        mediaType?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ReviewSort"] | undefined | null>
          | undefined
          | null /** Filter by user id */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Review"],
    ];
    revisionHistory?: [
      {
        /** Filter by the character id */
        characterId?: number | undefined | null /** Filter by the media id */;
        mediaId?: number | undefined | null /** Filter by the staff id */;
        staffId?: number | undefined | null /** Filter by the studio id */;
        studioId?: number | undefined | null /** Filter by the user id */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["RevisionHistory"],
    ];
    staff?: [
      {
        /** Filter by the staff id */
        id?: number | undefined | null /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the staff id */;
        id_not?: number | undefined | null /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by staff by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Staff"],
    ];
    staffSubmissions?: [
      {
        assigneeId?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["SubmissionSort"] | undefined | null>
          | undefined
          | null;
        staffId?:
          | number
          | undefined
          | null /** Filter by the status of the submission */;
        status?:
          | ResolverInputTypes["SubmissionStatus"]
          | undefined
          | null /** Filter by the submitter of the submission */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["StaffSubmission"],
    ];
    studios?: [
      {
        /** Filter by the studio id */
        id?: number | undefined | null /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the studio id */;
        id_not?: number | undefined | null /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StudioSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Studio"],
    ];
    threadComments?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["ThreadComment"],
    ];
    threads?: [
      {
        /** Filter by thread category id */
        categoryId?: number | undefined | null /** Filter by the thread id */;
        id?: number | undefined | null /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?: number | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadSort"] | undefined | null>
          | undefined
          | null /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Thread"],
    ];
    userBlockSearch?: [
      {
        /** Filter by search query */ search?: string | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    users?: [
      {
        /** Filter by the user id */
        id?: number | undefined | null /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null /** Filter by the name of the user */;
        name?: string | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** User list activity (anime & manga updates) */
  ListActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ResolverInputTypes["User"];
    /** The associated media to the activity update */
    media?: ResolverInputTypes["Media"];
    /** The list progress made */
    progress?: boolean | `@${string}`;
    /** The written replies to the activity */
    replies?: ResolverInputTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The list item's textual status */
    status?: boolean | `@${string}`;
    /** The type of activity */
    type?: boolean | `@${string}`;
    /** The owner of the activity */
    user?: ResolverInputTypes["User"];
    /** The user id of the activity's creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  ListActivityOption: AliasType<{
    disabled?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User's list score statistics */
  ListScoreStats: AliasType<{
    meanScore?: boolean | `@${string}`;
    standardDeviation?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Anime or Manga */
  Media: AliasType<{
    airingSchedule?: [
      {
        /** Filter to episodes that have not yet aired */
        notYetAired?: boolean | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["AiringScheduleConnection"],
    ];
    /** If the media should have forum thread automatically created for it on airing episode release */
    autoCreateForumThread?: boolean | `@${string}`;
    /** A weighted average score of all the user's scores of the media */
    averageScore?: boolean | `@${string}`;
    /** The banner image of the media */
    bannerImage?: boolean | `@${string}`;
    /** The amount of chapters the manga has when complete */
    chapters?: boolean | `@${string}`;
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        role?: ResolverInputTypes["CharacterRole"] | undefined | null;
        sort?:
          | Array<ResolverInputTypes["CharacterSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["CharacterConnection"],
    ];
    /** Where the media was created. (ISO 3166-1 alpha-2) */
    countryOfOrigin?: boolean | `@${string}`;
    /** The cover images of the media */
    coverImage?: ResolverInputTypes["MediaCoverImage"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The general length of each anime episode in minutes */
    duration?: boolean | `@${string}`;
    /** The last official release date of the media */
    endDate?: ResolverInputTypes["FuzzyDate"];
    /** The amount of episodes the anime has when complete */
    episodes?: boolean | `@${string}`;
    /** External links to another site related to the media */
    externalLinks?: ResolverInputTypes["MediaExternalLink"];
    /** The amount of user's who have favourited the media */
    favourites?: boolean | `@${string}`;
    /** The format the media was released in */
    format?: boolean | `@${string}`;
    /** The genres of the media */
    genres?: boolean | `@${string}`;
    /** Official Twitter hashtags for the media */
    hashtag?: boolean | `@${string}`;
    /** The id of the media */
    id?: boolean | `@${string}`;
    /** The mal id of the media */
    idMal?: boolean | `@${string}`;
    /** If the media is intended only for 18+ adult audiences */
    isAdult?: boolean | `@${string}`;
    /** If the media is marked as favourite by the current authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the media is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    /** If the media is officially licensed or a self-published doujin release */
    isLicensed?: boolean | `@${string}`;
    /** Locked media may not be added to lists our favorited. This may be due to the entry pending for deletion or other reasons. */
    isLocked?: boolean | `@${string}`;
    /** If the media is blocked from being recommended to/from */
    isRecommendationBlocked?: boolean | `@${string}`;
    /** If the media is blocked from being reviewed */
    isReviewBlocked?: boolean | `@${string}`;
    /** Mean score of all the user's scores of the media */
    meanScore?: boolean | `@${string}`;
    /** The authenticated user's media list entry for the media */
    mediaListEntry?: ResolverInputTypes["MediaList"];
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The media's next episode airing schedule */
    nextAiringEpisode?: ResolverInputTypes["AiringSchedule"];
    /** The number of users with the media on their list */
    popularity?: boolean | `@${string}`;
    /** The ranking of the media in a particular time span and format compared to other media */
    rankings?: ResolverInputTypes["MediaRank"];
    recommendations?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["RecommendationConnection"],
    ];
    /** Other media in the same or connecting franchise */
    relations?: ResolverInputTypes["MediaConnection"];
    reviews?: [
      {
        limit?: number | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["ReviewSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["ReviewConnection"],
    ];
    /** The season the media was initially released in */
    season?: boolean | `@${string}`;
    /** The year & season the media was initially released in */
    seasonInt?: boolean | `@${string}`;
    /** The season year the media was initially released in */
    seasonYear?: boolean | `@${string}`;
    /** The url for the media page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    source?: [
      {
        /** Provide 2 or 3 to use new version 2 or 3 of sources enum */
        version?: number | undefined | null;
      },
      boolean | `@${string}`,
    ];
    staff?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["StaffConnection"],
    ];
    /** The first official release date of the media */
    startDate?: ResolverInputTypes["FuzzyDate"];
    stats?: ResolverInputTypes["MediaStats"];
    status?: [
      {
        /** Provide 2 to use new version 2 of sources enum */
        version?: number | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** Data and links to legal streaming episodes on external sites */
    streamingEpisodes?: ResolverInputTypes["MediaStreamingEpisode"];
    studios?: [
      {
        isMain?: boolean | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StudioSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["StudioConnection"],
    ];
    /** Alternative titles of the media */
    synonyms?: boolean | `@${string}`;
    /** List of tags that describes elements and themes of the media */
    tags?: ResolverInputTypes["MediaTag"];
    /** The official titles of the media in various languages */
    title?: ResolverInputTypes["MediaTitle"];
    /** Media trailer or advertisement */
    trailer?: ResolverInputTypes["MediaTrailer"];
    /** The amount of related activity in the past hour */
    trending?: boolean | `@${string}`;
    trends?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?:
          | number
          | undefined
          | null /** Filter to stats recorded while the media was releasing */;
        releasing?: boolean | undefined | null;
        sort?:
          | Array<ResolverInputTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["MediaTrendConnection"],
    ];
    /** The type of the media; anime or manga */
    type?: boolean | `@${string}`;
    /** When the media's data was last updated */
    updatedAt?: boolean | `@${string}`;
    /** The amount of volumes the manga has when complete */
    volumes?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Internal - Media characters separated */
  MediaCharacter: AliasType<{
    /** The characters in the media voiced by the parent actor */
    character?: ResolverInputTypes["Character"];
    /** Media specific character name */
    characterName?: boolean | `@${string}`;
    dubGroup?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** The characters role in the media */
    role?: boolean | `@${string}`;
    roleNotes?: boolean | `@${string}`;
    /** The voice actor of the character */
    voiceActor?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaConnection: AliasType<{
    edges?: ResolverInputTypes["MediaEdge"];
    nodes?: ResolverInputTypes["Media"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaCoverImage: AliasType<{
    /** Average #hex color of cover image */
    color?: boolean | `@${string}`;
    /** The cover image url of the media at its largest size. If this size isn't available, large will be provided instead. */
    extraLarge?: boolean | `@${string}`;
    /** The cover image url of the media at a large size */
    large?: boolean | `@${string}`;
    /** The cover image url of the media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a media entry's data was changed in a significant way impacting users' list tracking */
  MediaDataChangeNotification: AliasType<{
    /** The reason for the media data change */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The media that received data changes */
    media?: ResolverInputTypes["Media"];
    /** The id of the media that received data changes */
    mediaId?: boolean | `@${string}`;
    /** The reason for the media data change */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a media tracked in a user's list is deleted from the site */
  MediaDeletionNotification: AliasType<{
    /** The reason for the media deletion */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The title of the deleted media */
    deletedMediaTitle?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The reason for the media deletion */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media connection edge */
  MediaEdge: AliasType<{
    /** Media specific character name */
    characterName?: boolean | `@${string}`;
    /** The characters role in the media */
    characterRole?: boolean | `@${string}`;
    /** The characters in the media voiced by the parent actor */
    characters?: ResolverInputTypes["Character"];
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: boolean | `@${string}`;
    /** The order the media should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** If the studio is the main animation studio of the media (For Studio->MediaConnection field only) */
    isMainStudio?: boolean | `@${string}`;
    node?: ResolverInputTypes["Media"];
    relationType?: [
      {
        /** Provide 2 to use new version 2 of relation enum */
        version?: number | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** Notes regarding the VA's role for the character */
    roleNotes?: boolean | `@${string}`;
    /** The role of the staff member in the production of the media */
    staffRole?: boolean | `@${string}`;
    voiceActorRoles?: [
      {
        language?: ResolverInputTypes["StaffLanguage"] | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["StaffRoleType"],
    ];
    voiceActors?: [
      {
        language?: ResolverInputTypes["StaffLanguage"] | undefined | null;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Staff"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** An external link to another site related to the media or staff member */
  MediaExternalLink: AliasType<{
    color?: boolean | `@${string}`;
    /** The icon image url of the site. Not available for all links. Transparent PNG 64x64 */
    icon?: boolean | `@${string}`;
    /** The id of the external link */
    id?: boolean | `@${string}`;
    isDisabled?: boolean | `@${string}`;
    /** Language the site content is in. See Staff language field for values. */
    language?: boolean | `@${string}`;
    notes?: boolean | `@${string}`;
    /** The links website site name */
    site?: boolean | `@${string}`;
    /** The links website site id */
    siteId?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    /** The url of the external link or base url of link source */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** List of anime or manga */
  MediaList: AliasType<{
    /** Map of advanced scores with name keys */
    advancedScores?: boolean | `@${string}`;
    /** When the entry was completed by the user */
    completedAt?: ResolverInputTypes["FuzzyDate"];
    /** When the entry data was created */
    createdAt?: boolean | `@${string}`;
    customLists?: [
      {
        /** Change return structure to an array of objects */
        asArray?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** If the entry shown be hidden from non-custom lists */
    hiddenFromStatusLists?: boolean | `@${string}`;
    /** The id of the list entry */
    id?: boolean | `@${string}`;
    media?: ResolverInputTypes["Media"];
    /** The id of the media */
    mediaId?: boolean | `@${string}`;
    /** Text notes */
    notes?: boolean | `@${string}`;
    /** Priority of planning */
    priority?: boolean | `@${string}`;
    /** If the entry should only be visible to authenticated user */
    private?: boolean | `@${string}`;
    /** The amount of episodes/chapters consumed by the user */
    progress?: boolean | `@${string}`;
    /** The amount of volumes read by the user */
    progressVolumes?: boolean | `@${string}`;
    /** The amount of times the user has rewatched/read the media */
    repeat?: boolean | `@${string}`;
    score?: [
      {
        /** Force the score to be returned in the provided format type. */
        format?: ResolverInputTypes["ScoreFormat"] | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** When the entry was started by the user */
    startedAt?: ResolverInputTypes["FuzzyDate"];
    /** The watching/reading status */
    status?: boolean | `@${string}`;
    /** When the entry data was last updated */
    updatedAt?: boolean | `@${string}`;
    user?: ResolverInputTypes["User"];
    /** The id of the user owner of the list entry */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** List of anime or manga */
  MediaListCollection: AliasType<{
    customLists?: [
      { asArray?: boolean | undefined | null },
      ResolverInputTypes["MediaList"],
    ];
    /** If there is another chunk */
    hasNextChunk?: boolean | `@${string}`;
    /** Grouped media list entries */
    lists?: ResolverInputTypes["MediaListGroup"];
    statusLists?: [
      { asArray?: boolean | undefined | null },
      ResolverInputTypes["MediaList"],
    ];
    /** The owner of the list */
    user?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** List group of anime or manga entries */
  MediaListGroup: AliasType<{
    /** Media list entries */
    entries?: ResolverInputTypes["MediaList"];
    isCustomList?: boolean | `@${string}`;
    isSplitCompletedList?: boolean | `@${string}`;
    name?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's list options */
  MediaListOptions: AliasType<{
    /** The user's anime list options */
    animeList?: ResolverInputTypes["MediaListTypeOptions"];
    /** The user's manga list options */
    mangaList?: ResolverInputTypes["MediaListTypeOptions"];
    /** The default order list rows should be displayed in */
    rowOrder?: boolean | `@${string}`;
    /** The score format the user is using for media lists */
    scoreFormat?: boolean | `@${string}`;
    /** The list theme options for both lists */
    sharedTheme?: boolean | `@${string}`;
    /** If the shared theme should be used instead of the individual list themes */
    sharedThemeEnabled?: boolean | `@${string}`;
    useLegacyLists?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's list options for anime or manga lists */
  MediaListTypeOptions: AliasType<{
    /** The names of the user's advanced scoring sections */
    advancedScoring?: boolean | `@${string}`;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | `@${string}`;
    /** The names of the user's custom lists */
    customLists?: boolean | `@${string}`;
    /** The order each list should be displayed in */
    sectionOrder?: boolean | `@${string}`;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | `@${string}`;
    /** The list theme options */
    theme?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a media entry is merged into another for a user who had it on their list */
  MediaMergeNotification: AliasType<{
    /** The reason for the media data change */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The title of the deleted media */
    deletedMediaTitles?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The media that was merged into */
    media?: ResolverInputTypes["Media"];
    /** The id of the media that was merged into */
    mediaId?: boolean | `@${string}`;
    /** The reason for the media merge */
    reason?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The ranking of a media in a particular time span and format compared to other media */
  MediaRank: AliasType<{
    /** If the ranking is based on all time instead of a season/year */
    allTime?: boolean | `@${string}`;
    /** String that gives context to the ranking type and time span */
    context?: boolean | `@${string}`;
    /** The format the media is ranked within */
    format?: boolean | `@${string}`;
    /** The id of the rank */
    id?: boolean | `@${string}`;
    /** The numerical rank of the media */
    rank?: boolean | `@${string}`;
    /** The season the media is ranked within */
    season?: boolean | `@${string}`;
    /** The type of ranking */
    type?: boolean | `@${string}`;
    /** The year the media is ranked within */
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A media's statistics */
  MediaStats: AliasType<{
    airingProgression?: ResolverInputTypes["AiringProgression"];
    scoreDistribution?: ResolverInputTypes["ScoreDistribution"];
    statusDistribution?: ResolverInputTypes["StatusDistribution"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Data and links to legal streaming episodes on external sites */
  MediaStreamingEpisode: AliasType<{
    /** The site location of the streaming episodes */
    site?: boolean | `@${string}`;
    /** Url of episode image thumbnail */
    thumbnail?: boolean | `@${string}`;
    /** Title of the episode */
    title?: boolean | `@${string}`;
    /** The url of the episode */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media submission */
  MediaSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ResolverInputTypes["User"];
    changes?: boolean | `@${string}`;
    characters?: ResolverInputTypes["MediaSubmissionComparison"];
    createdAt?: boolean | `@${string}`;
    externalLinks?: ResolverInputTypes["MediaSubmissionComparison"];
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    media?: ResolverInputTypes["Media"];
    notes?: boolean | `@${string}`;
    relations?: ResolverInputTypes["MediaEdge"];
    source?: boolean | `@${string}`;
    staff?: ResolverInputTypes["MediaSubmissionComparison"];
    /** Status of the submission */
    status?: boolean | `@${string}`;
    studios?: ResolverInputTypes["MediaSubmissionComparison"];
    submission?: ResolverInputTypes["Media"];
    /** User submitter of the submission */
    submitter?: ResolverInputTypes["User"];
    submitterStats?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media submission with comparison to current data */
  MediaSubmissionComparison: AliasType<{
    character?: ResolverInputTypes["MediaCharacter"];
    externalLink?: ResolverInputTypes["MediaExternalLink"];
    staff?: ResolverInputTypes["StaffEdge"];
    studio?: ResolverInputTypes["StudioEdge"];
    submission?: ResolverInputTypes["MediaSubmissionEdge"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaSubmissionEdge: AliasType<{
    character?: ResolverInputTypes["Character"];
    characterName?: boolean | `@${string}`;
    characterRole?: boolean | `@${string}`;
    characterSubmission?: ResolverInputTypes["Character"];
    dubGroup?: boolean | `@${string}`;
    externalLink?: ResolverInputTypes["MediaExternalLink"];
    /** The id of the direct submission */
    id?: boolean | `@${string}`;
    isMain?: boolean | `@${string}`;
    media?: ResolverInputTypes["Media"];
    roleNotes?: boolean | `@${string}`;
    staff?: ResolverInputTypes["Staff"];
    staffRole?: boolean | `@${string}`;
    staffSubmission?: ResolverInputTypes["Staff"];
    studio?: ResolverInputTypes["Studio"];
    voiceActor?: ResolverInputTypes["Staff"];
    voiceActorSubmission?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A tag that describes a theme or element of the media */
  MediaTag: AliasType<{
    /** The categories of tags this tag belongs to */
    category?: boolean | `@${string}`;
    /** A general description of the tag */
    description?: boolean | `@${string}`;
    /** The id of the tag */
    id?: boolean | `@${string}`;
    /** If the tag is only for adult 18+ media */
    isAdult?: boolean | `@${string}`;
    /** If the tag could be a spoiler for any media */
    isGeneralSpoiler?: boolean | `@${string}`;
    /** If the tag is a spoiler for this media */
    isMediaSpoiler?: boolean | `@${string}`;
    /** The name of the tag */
    name?: boolean | `@${string}`;
    /** The relevance ranking of the tag out of the 100 for this media */
    rank?: boolean | `@${string}`;
    /** The user who submitted the tag */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The official titles of the media in various languages */
  MediaTitle: AliasType<{
    english?: [
      { stylised?: boolean | undefined | null },
      boolean | `@${string}`,
    ];
    native?: [
      { stylised?: boolean | undefined | null },
      boolean | `@${string}`,
    ];
    romaji?: [
      { stylised?: boolean | undefined | null },
      boolean | `@${string}`,
    ];
    /** The currently authenticated users preferred title language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media trailer or advertisement */
  MediaTrailer: AliasType<{
    /** The trailer video id */
    id?: boolean | `@${string}`;
    /** The site the video is hosted by (Currently either youtube or dailymotion) */
    site?: boolean | `@${string}`;
    /** The url for the thumbnail image of the video */
    thumbnail?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Daily media statistics */
  MediaTrend: AliasType<{
    /** A weighted average score of all the user's scores of the media */
    averageScore?: boolean | `@${string}`;
    /** The day the data was recorded (timestamp) */
    date?: boolean | `@${string}`;
    /** The episode number of the anime released on this day */
    episode?: boolean | `@${string}`;
    /** The number of users with watching/reading the media */
    inProgress?: boolean | `@${string}`;
    /** The related media */
    media?: ResolverInputTypes["Media"];
    /** The id of the tag */
    mediaId?: boolean | `@${string}`;
    /** The number of users with the media on their list */
    popularity?: boolean | `@${string}`;
    /** If the media was being released at this time */
    releasing?: boolean | `@${string}`;
    /** The amount of media activity on the day */
    trending?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  MediaTrendConnection: AliasType<{
    edges?: ResolverInputTypes["MediaTrendEdge"];
    nodes?: ResolverInputTypes["MediaTrend"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Media trend connection edge */
  MediaTrendEdge: AliasType<{
    node?: ResolverInputTypes["MediaTrend"];
    __typename?: boolean | `@${string}`;
  }>;
  /** User message activity */
  MessageActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the message is private and only viewable to the sender and recipients */
    isPrivate?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ResolverInputTypes["User"];
    message?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The user who sent the activity message */
    messenger?: ResolverInputTypes["User"];
    /** The user id of the activity's sender */
    messengerId?: boolean | `@${string}`;
    /** The user who the activity message was sent to */
    recipient?: ResolverInputTypes["User"];
    /** The user id of the activity's recipient */
    recipientId?: boolean | `@${string}`;
    /** The written replies to the activity */
    replies?: ResolverInputTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The type of the activity */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  ModAction: AliasType<{
    createdAt?: boolean | `@${string}`;
    data?: boolean | `@${string}`;
    /** The id of the action */
    id?: boolean | `@${string}`;
    mod?: ResolverInputTypes["User"];
    objectId?: boolean | `@${string}`;
    objectType?: boolean | `@${string}`;
    type?: boolean | `@${string}`;
    user?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  Mutation: AliasType<{
    DeleteActivity?: [
      {
        /** The id of the activity to delete */ id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteActivityReply?: [
      {
        /** The id of the reply to delete */ id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteCustomList?: [
      {
        /** The name of the custom list to delete */
        customList?:
          | string
          | undefined
          | null /** The media list type of the custom list */;
        type?: ResolverInputTypes["MediaType"] | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteMediaListEntry?: [
      {
        /** The id of the media list entry to delete */
        id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteReview?: [
      {
        /** The id of the review to delete */ id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteThread?: [
      {
        /** The id of the thread to delete */ id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    DeleteThreadComment?: [
      {
        /** The id of the thread comment to delete */
        id?: number | undefined | null;
      },
      ResolverInputTypes["Deleted"],
    ];
    RateReview?: [
      {
        /** The rating to apply to the review */
        rating?:
          | ResolverInputTypes["ReviewRating"]
          | undefined
          | null /** The id of the review to rate */;
        reviewId?: number | undefined | null;
      },
      ResolverInputTypes["Review"],
    ];
    SaveActivityReply?: [
      {
        /** The id of the parent activity being replied to */
        activityId?:
          | number
          | undefined
          | null /** If the reply should be sent from the Moderator account (Mod Only) */;
        asMod?:
          | boolean
          | undefined
          | null /** The activity reply id, required for updating */;
        id?: number | undefined | null /** The reply text */;
        text?: string | undefined | null;
      },
      ResolverInputTypes["ActivityReply"],
    ];
    SaveListActivity?: [
      {
        /** The activity's id, required for updating */
        id?:
          | number
          | undefined
          | null /** If the activity should be locked. (Mod Only) */;
        locked?: boolean | undefined | null;
      },
      ResolverInputTypes["ListActivity"],
    ];
    SaveMediaListEntry?: [
      {
        /** Array of advanced scores */
        advancedScores?:
          | Array<number | undefined | null>
          | undefined
          | null /** When the entry was completed by the user */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInput"]
          | undefined
          | null /** Array of custom list names which should be enabled for this entry */;
        customLists?:
          | Array<string | undefined | null>
          | undefined
          | null /** If the entry shown be hidden from non-custom lists */;
        hiddenFromStatusLists?:
          | boolean
          | undefined
          | null /** The list entry id, required for updating */;
        id?:
          | number
          | undefined
          | null /** The id of the media the entry is of */;
        mediaId?: number | undefined | null /** Text notes */;
        notes?: string | undefined | null /** Priority of planning */;
        priority?:
          | number
          | undefined
          | null /** If the entry should only be visible to authenticated user */;
        private?:
          | boolean
          | undefined
          | null /** The amount of episodes/chapters consumed by the user */;
        progress?:
          | number
          | undefined
          | null /** The amount of volumes read by the user */;
        progressVolumes?:
          | number
          | undefined
          | null /** The amount of times the user has rewatched/read the media */;
        repeat?:
          | number
          | undefined
          | null /** The score of the media in the user's chosen scoring method */;
        score?:
          | number
          | undefined
          | null /** The score of the media in 100 point */;
        scoreRaw?:
          | number
          | undefined
          | null /** When the entry was started by the user */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInput"]
          | undefined
          | null /** The watching/reading status */;
        status?: ResolverInputTypes["MediaListStatus"] | undefined | null;
      },
      ResolverInputTypes["MediaList"],
    ];
    SaveMessageActivity?: [
      {
        /** If the message should be sent from the Moderator account (Mod Only) */
        asMod?:
          | boolean
          | undefined
          | null /** The activity id, required for updating */;
        id?:
          | number
          | undefined
          | null /** If the activity should be locked. (Mod Only) */;
        locked?: boolean | undefined | null /** The activity message text */;
        message?:
          | string
          | undefined
          | null /** If the activity should be private */;
        private?:
          | boolean
          | undefined
          | null /** The id of the user the message is being sent to */;
        recipientId?: number | undefined | null;
      },
      ResolverInputTypes["MessageActivity"],
    ];
    SaveRecommendation?: [
      {
        /** The id of the base media */
        mediaId?:
          | number
          | undefined
          | null /** The id of the media to recommend */;
        mediaRecommendationId?:
          | number
          | undefined
          | null /** The rating to give the recommendation */;
        rating?: ResolverInputTypes["RecommendationRating"] | undefined | null;
      },
      ResolverInputTypes["Recommendation"],
    ];
    SaveReview?: [
      {
        /** The main review text. Min:2200 characters */
        body?:
          | string
          | undefined
          | null /** The review id, required for updating */;
        id?:
          | number
          | undefined
          | null /** The id of the media the review is of */;
        mediaId?:
          | number
          | undefined
          | null /** If the review should only be visible to its creator */;
        private?:
          | boolean
          | undefined
          | null /** A short summary/preview of the review. Min:20, Max:120 characters */;
        score?:
          | number
          | undefined
          | null /** A short summary/preview of the review. Min:20, Max:120 characters */;
        summary?: string | undefined | null;
      },
      ResolverInputTypes["Review"],
    ];
    SaveTextActivity?: [
      {
        /** The activity's id, required for updating */
        id?:
          | number
          | undefined
          | null /** If the activity should be locked. (Mod Only) */;
        locked?: boolean | undefined | null /** The activity text */;
        text?: string | undefined | null;
      },
      ResolverInputTypes["TextActivity"],
    ];
    SaveThread?: [
      {
        /** The main text body of the thread */
        body?:
          | string
          | undefined
          | null /** Forum categories the thread should be within */;
        categories?:
          | Array<number | undefined | null>
          | undefined
          | null /** The thread id, required for updating */;
        id?:
          | number
          | undefined
          | null /** If the thread should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null /** Media related to the contents of the thread */;
        mediaCategories?:
          | Array<number | undefined | null>
          | undefined
          | null /** If the thread should be stickied. (Mod Only) */;
        sticky?: boolean | undefined | null /** The title of the thread */;
        title?: string | undefined | null;
      },
      ResolverInputTypes["Thread"],
    ];
    SaveThreadComment?: [
      {
        /** The comment markdown text */
        comment?:
          | string
          | undefined
          | null /** The comment id, required for updating */;
        id?:
          | number
          | undefined
          | null /** If the comment tree should be locked. (Mod Only) */;
        locked?:
          | boolean
          | undefined
          | null /** The id of thread comment to reply to */;
        parentCommentId?:
          | number
          | undefined
          | null /** The id of thread the comment belongs to */;
        threadId?: number | undefined | null;
      },
      ResolverInputTypes["ThreadComment"],
    ];
    ToggleActivityPin?: [
      {
        /** Toggle activity id to be pinned */
        id?:
          | number
          | undefined
          | null /** If the activity should be pinned or unpinned */;
        pinned?: boolean | undefined | null;
      },
      ResolverInputTypes["ActivityUnion"],
    ];
    ToggleActivitySubscription?: [
      {
        /** The id of the activity to un/subscribe */
        activityId?:
          | number
          | undefined
          | null /** Whether to subscribe or unsubscribe from the activity */;
        subscribe?: boolean | undefined | null;
      },
      ResolverInputTypes["ActivityUnion"],
    ];
    ToggleFavourite?: [
      {
        /** The id of the anime to un/favourite */
        animeId?:
          | number
          | undefined
          | null /** The id of the character to un/favourite */;
        characterId?:
          | number
          | undefined
          | null /** The id of the manga to un/favourite */;
        mangaId?:
          | number
          | undefined
          | null /** The id of the staff to un/favourite */;
        staffId?:
          | number
          | undefined
          | null /** The id of the studio to un/favourite */;
        studioId?: number | undefined | null;
      },
      ResolverInputTypes["Favourites"],
    ];
    ToggleFollow?: [
      {
        /** The id of the user to un/follow */
        userId?: number | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    ToggleLike?: [
      {
        /** The id of the likeable type */
        id?: number | undefined | null /** The type of model to be un/liked */;
        type?: ResolverInputTypes["LikeableType"] | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    ToggleLikeV2?: [
      {
        /** The id of the likeable type */
        id?: number | undefined | null /** The type of model to be un/liked */;
        type?: ResolverInputTypes["LikeableType"] | undefined | null;
      },
      ResolverInputTypes["LikeableUnion"],
    ];
    ToggleThreadSubscription?: [
      {
        /** Whether to subscribe or unsubscribe from the forum thread */
        subscribe?:
          | boolean
          | undefined
          | null /** The id of the forum thread to un/subscribe */;
        threadId?: number | undefined | null;
      },
      ResolverInputTypes["Thread"],
    ];
    UpdateAniChartHighlights?: [
      {
        highlights?:
          | Array<
              ResolverInputTypes["AniChartHighlightInput"] | undefined | null
            >
          | undefined
          | null;
      },
      boolean | `@${string}`,
    ];
    UpdateAniChartSettings?: [
      {
        outgoingLinkProvider?: string | undefined | null;
        sort?: string | undefined | null;
        theme?: string | undefined | null;
        titleLanguage?: string | undefined | null;
      },
      boolean | `@${string}`,
    ];
    UpdateFavouriteOrder?: [
      {
        /** The id of the anime to un/favourite */
        animeIds?:
          | Array<number | undefined | null>
          | undefined
          | null /** List of integers which the anime should be ordered by (Asc) */;
        animeOrder?:
          | Array<number | undefined | null>
          | undefined
          | null /** The id of the character to un/favourite */;
        characterIds?:
          | Array<number | undefined | null>
          | undefined
          | null /** List of integers which the character should be ordered by (Asc) */;
        characterOrder?:
          | Array<number | undefined | null>
          | undefined
          | null /** The id of the manga to un/favourite */;
        mangaIds?:
          | Array<number | undefined | null>
          | undefined
          | null /** List of integers which the manga should be ordered by (Asc) */;
        mangaOrder?:
          | Array<number | undefined | null>
          | undefined
          | null /** The id of the staff to un/favourite */;
        staffIds?:
          | Array<number | undefined | null>
          | undefined
          | null /** List of integers which the staff should be ordered by (Asc) */;
        staffOrder?:
          | Array<number | undefined | null>
          | undefined
          | null /** The id of the studio to un/favourite */;
        studioIds?:
          | Array<number | undefined | null>
          | undefined
          | null /** List of integers which the studio should be ordered by (Asc) */;
        studioOrder?: Array<number | undefined | null> | undefined | null;
      },
      ResolverInputTypes["Favourites"],
    ];
    UpdateMediaListEntries?: [
      {
        /** Array of advanced scores */
        advancedScores?:
          | Array<number | undefined | null>
          | undefined
          | null /** When the entry was completed by the user */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInput"]
          | undefined
          | null /** If the entry shown be hidden from non-custom lists */;
        hiddenFromStatusLists?:
          | boolean
          | undefined
          | null /** The list entries ids to update */;
        ids?:
          | Array<number | undefined | null>
          | undefined
          | null /** Text notes */;
        notes?: string | undefined | null /** Priority of planning */;
        priority?:
          | number
          | undefined
          | null /** If the entry should only be visible to authenticated user */;
        private?:
          | boolean
          | undefined
          | null /** The amount of episodes/chapters consumed by the user */;
        progress?:
          | number
          | undefined
          | null /** The amount of volumes read by the user */;
        progressVolumes?:
          | number
          | undefined
          | null /** The amount of times the user has rewatched/read the media */;
        repeat?:
          | number
          | undefined
          | null /** The score of the media in the user's chosen scoring method */;
        score?:
          | number
          | undefined
          | null /** The score of the media in 100 point */;
        scoreRaw?:
          | number
          | undefined
          | null /** When the entry was started by the user */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInput"]
          | undefined
          | null /** The watching/reading status */;
        status?: ResolverInputTypes["MediaListStatus"] | undefined | null;
      },
      ResolverInputTypes["MediaList"],
    ];
    UpdateUser?: [
      {
        /** User's about/bio text */
        about?:
          | string
          | undefined
          | null /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */;
        activityMergeTime?:
          | number
          | undefined
          | null /** If the user should get notifications when a show they are watching aires */;
        airingNotifications?:
          | boolean
          | undefined
          | null /** The user's anime list options */;
        animeListOptions?:
          | ResolverInputTypes["MediaListOptionsInput"]
          | undefined
          | null;
        disabledListActivity?:
          | Array<
              ResolverInputTypes["ListActivityOptionInput"] | undefined | null
            >
          | undefined
          | null /** If the user should see media marked as adult-only */;
        displayAdultContent?:
          | boolean
          | undefined
          | null /** Profile highlight color */;
        donatorBadge?:
          | string
          | undefined
          | null /** The user's anime list options */;
        mangaListOptions?:
          | ResolverInputTypes["MediaListOptionsInput"]
          | undefined
          | null /** Notification options */;
        notificationOptions?:
          | Array<
              ResolverInputTypes["NotificationOptionInput"] | undefined | null
            >
          | undefined
          | null /** Profile highlight color */;
        profileColor?:
          | string
          | undefined
          | null /** Only allow messages from other users the user follows */;
        restrictMessagesToFollowing?:
          | boolean
          | undefined
          | null /** The user's default list order */;
        rowOrder?:
          | string
          | undefined
          | null /** The user's list scoring system */;
        scoreFormat?:
          | ResolverInputTypes["ScoreFormat"]
          | undefined
          | null /** The language the user wants to see staff and character names in */;
        staffNameLanguage?:
          | ResolverInputTypes["UserStaffNameLanguage"]
          | undefined
          | null /** Timezone offset format: -?HH:MM */;
        timezone?: string | undefined | null /** User's title language */;
        titleLanguage?:
          | ResolverInputTypes["UserTitleLanguage"]
          | undefined
          | null;
      },
      ResolverInputTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification option */
  NotificationOption: AliasType<{
    /** Whether this type of notification is enabled */
    enabled?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Page of data */
  Page: AliasType<{
    activities?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null /** Filter by the activity id */;
        id?: number | undefined | null /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the activity id */;
        id_not?: number | undefined | null /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ActivitySort"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type_not?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_not_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId?: number | undefined | null /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null /** Filter by the owner user id */;
        userId_not_in?: Array<number | undefined | null> | undefined | null;
      },
      ResolverInputTypes["ActivityUnion"],
    ];
    activityReplies?: [
      {
        /** Filter by the parent id */
        activityId?: number | undefined | null /** Filter by the reply id */;
        id?: number | undefined | null;
      },
      ResolverInputTypes["ActivityReply"],
    ];
    airingSchedules?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["AiringSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["AiringSchedule"],
    ];
    characters?: [
      {
        /** Filter by character id */
        id?: number | undefined | null /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character id */;
        id_not?: number | undefined | null /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["CharacterSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Character"],
    ];
    followers?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    likes?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null /** The type of model the id applies to */;
        type?: ResolverInputTypes["LikeableType"] | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ResolverInputTypes["CountryCode"]
          | undefined
          | null /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null /** Filter by the end date of the media */;
        endDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null /** Filter by the media's format */;
        format?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's format */;
        format_not?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_not_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre?: string | undefined | null /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_not?: number | undefined | null /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** Filter by the season the media was released in */;
        season?:
          | ResolverInputTypes["MediaSeason"]
          | undefined
          | null /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null /** Filter by the source type of the media */;
        source?:
          | ResolverInputTypes["MediaSource"]
          | undefined
          | null /** Filter by the source type of the media */;
        source_in?:
          | Array<ResolverInputTypes["MediaSource"] | undefined | null>
          | undefined
          | null /** Filter by the start date of the media */;
        startDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null /** Filter by the media's current release status */;
        status?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's current release status */;
        status_not?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null;
      },
      ResolverInputTypes["Media"],
    ];
    mediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by note words and #tags */;
        notes?: string | undefined | null /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaListSort"] | undefined | null>
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null /** Filter by the watching/reading status */;
        status?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the list entries media type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by a user's id */;
        userId?: number | undefined | null /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by a user's name */;
        userName?: string | undefined | null;
      },
      ResolverInputTypes["MediaList"],
    ];
    mediaTrends?: [
      {
        /** Filter by score */
        averageScore?: number | undefined | null /** Filter by score */;
        averageScore_greater?: number | undefined | null /** Filter by score */;
        averageScore_lesser?: number | undefined | null /** Filter by score */;
        averageScore_not?: number | undefined | null /** Filter by date */;
        date?: number | undefined | null /** Filter by date */;
        date_greater?: number | undefined | null /** Filter by date */;
        date_lesser?: number | undefined | null /** Filter by episode number */;
        episode?: number | undefined | null /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_not?: number | undefined | null /** Filter by the media id */;
        mediaId?: number | undefined | null /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        mediaId_not?: number | undefined | null /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by popularity */;
        popularity?: number | undefined | null /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null /** Filter by trending amount */;
        trending?: number | undefined | null /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_not?: number | undefined | null;
      },
      ResolverInputTypes["MediaTrend"],
    ];
    notifications?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null /** Filter by the type of notifications */;
        type?:
          | ResolverInputTypes["NotificationType"]
          | undefined
          | null /** Filter by the type of notifications */;
        type_in?:
          | Array<ResolverInputTypes["NotificationType"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["NotificationUnion"],
    ];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    recommendations?: [
      {
        /** Filter by recommendation id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null /** Filter by user who created the recommendation */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Recommendation"],
    ];
    reviews?: [
      {
        /** Filter by Review id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?: number | undefined | null /** Filter by media type */;
        mediaType?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ReviewSort"] | undefined | null>
          | undefined
          | null /** Filter by user id */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Review"],
    ];
    staff?: [
      {
        /** Filter by the staff id */
        id?: number | undefined | null /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the staff id */;
        id_not?: number | undefined | null /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by staff by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Staff"],
    ];
    studios?: [
      {
        /** Filter by the studio id */
        id?: number | undefined | null /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the studio id */;
        id_not?: number | undefined | null /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StudioSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Studio"],
    ];
    threadComments?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["ThreadComment"],
    ];
    threads?: [
      {
        /** Filter by thread category id */
        categoryId?: number | undefined | null /** Filter by the thread id */;
        id?: number | undefined | null /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?: number | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadSort"] | undefined | null>
          | undefined
          | null /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Thread"],
    ];
    users?: [
      {
        /** Filter by the user id */
        id?: number | undefined | null /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null /** Filter by the name of the user */;
        name?: string | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["User"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  PageInfo: AliasType<{
    /** The current page */
    currentPage?: boolean | `@${string}`;
    /** If there is another page */
    hasNextPage?: boolean | `@${string}`;
    /** The last page */
    lastPage?: boolean | `@${string}`;
    /** The count on a page */
    perPage?: boolean | `@${string}`;
    /** The total number of items. Note: This value is not guaranteed to be accurate, do not rely on this for logic */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Provides the parsed markdown as html */
  ParsedMarkdown: AliasType<{
    /** The parsed markdown as html */
    html?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  Query: AliasType<{
    Activity?: [
      {
        /** Filter by the time the activity was created */
        createdAt?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_greater?:
          | number
          | undefined
          | null /** Filter by the time the activity was created */;
        createdAt_lesser?:
          | number
          | undefined
          | null /** Filter activity to only activity with replies */;
        hasReplies?:
          | boolean
          | undefined
          | null /** Filter activity to only activity with replies or is of type text */;
        hasRepliesOrTypeText?:
          | boolean
          | undefined
          | null /** Filter by the activity id */;
        id?: number | undefined | null /** Filter by the activity id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the activity id */;
        id_not?: number | undefined | null /** Filter by the activity id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter activity to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the associated media id of the activity */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not?:
          | number
          | undefined
          | null /** Filter by the id of the user who sent a message */;
        messengerId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ActivitySort"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the type of activity */;
        type_not?:
          | ResolverInputTypes["ActivityType"]
          | undefined
          | null /** Filter by the type of activity */;
        type_not_in?:
          | Array<ResolverInputTypes["ActivityType"] | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId?: number | undefined | null /** Filter by the owner user id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the owner user id */;
        userId_not?:
          | number
          | undefined
          | null /** Filter by the owner user id */;
        userId_not_in?: Array<number | undefined | null> | undefined | null;
      },
      ResolverInputTypes["ActivityUnion"],
    ];
    ActivityReply?: [
      {
        /** Filter by the parent id */
        activityId?: number | undefined | null /** Filter by the reply id */;
        id?: number | undefined | null;
      },
      ResolverInputTypes["ActivityReply"],
    ];
    AiringSchedule?: [
      {
        /** Filter by the time of airing */
        airingAt?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_greater?:
          | number
          | undefined
          | null /** Filter by the time of airing */;
        airingAt_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the airing episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not?:
          | number
          | undefined
          | null /** Filter by the airing episode number */;
        episode_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not?:
          | number
          | undefined
          | null /** Filter by the id of the airing schedule item */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not?:
          | number
          | undefined
          | null /** Filter by the id of associated media */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter to episodes that haven't yet aired */;
        notYetAired?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["AiringSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["AiringSchedule"],
    ];
    AniChartUser?: ResolverInputTypes["AniChartUser"];
    Character?: [
      {
        /** Filter by character id */
        id?: number | undefined | null /** Filter by character id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character id */;
        id_not?: number | undefined | null /** Filter by character id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by character by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["CharacterSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Character"],
    ];
    ExternalLinkSourceCollection?: [
      {
        /** Filter by the link id */ id?: number | undefined | null;
        mediaType?:
          | ResolverInputTypes["ExternalLinkMediaType"]
          | undefined
          | null;
        type?: ResolverInputTypes["ExternalLinkType"] | undefined | null;
      },
      ResolverInputTypes["MediaExternalLink"],
    ];
    Follower?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    Following?: [
      {
        /** The order the results will be returned in */
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null /** User id of the follower/followed */;
        userId: number;
      },
      ResolverInputTypes["User"],
    ];
    /** Collection of all the possible media genres */
    GenreCollection?: boolean | `@${string}`;
    Like?: [
      {
        /** The id of the likeable type */
        likeableId?:
          | number
          | undefined
          | null /** The type of model the id applies to */;
        type?: ResolverInputTypes["LikeableType"] | undefined | null;
      },
      ResolverInputTypes["User"],
    ];
    Markdown?: [
      {
        /** The markdown to be parsed to html */ markdown: string;
      },
      ResolverInputTypes["ParsedMarkdown"],
    ];
    Media?: [
      {
        /** Filter by the media's average score */
        averageScore?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_greater?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_lesser?:
          | number
          | undefined
          | null /** Filter by the media's average score */;
        averageScore_not?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_greater?:
          | number
          | undefined
          | null /** Filter by the media's chapter count */;
        chapters_lesser?:
          | number
          | undefined
          | null /** Filter by the media's country of origin */;
        countryOfOrigin?:
          | ResolverInputTypes["CountryCode"]
          | undefined
          | null /** Filter by the media's episode length */;
        duration?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_greater?:
          | number
          | undefined
          | null /** Filter by the media's episode length */;
        duration_lesser?:
          | number
          | undefined
          | null /** Filter by the end date of the media */;
        endDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the end date of the media */;
        endDate_like?:
          | string
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_greater?:
          | number
          | undefined
          | null /** Filter by amount of episodes the media has */;
        episodes_lesser?:
          | number
          | undefined
          | null /** Filter by the media's format */;
        format?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's format */;
        format_not?:
          | ResolverInputTypes["MediaFormat"]
          | undefined
          | null /** Filter by the media's format */;
        format_not_in?:
          | Array<ResolverInputTypes["MediaFormat"] | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre?: string | undefined | null /** Filter by the media's genres */;
        genre_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's genres */;
        genre_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not?:
          | number
          | undefined
          | null /** Filter by the media's MyAnimeList id */;
        idMal_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        id_not?: number | undefined | null /** Filter by the media id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by if the media's intended for 18+ adult audiences */;
        isAdult?:
          | boolean
          | undefined
          | null /** If the media is officially licensed or a self-published doujin release */;
        isLicensed?:
          | boolean
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy?:
          | string
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById?:
          | number
          | undefined
          | null /** Filter media by sites id with a online streaming or reading license */;
        licensedById_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter media by sites name with a online streaming or reading license */;
        licensedBy_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Only apply the tags filter argument to tags above this rank. Default: 18 */;
        minimumTagRank?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by the number of users with this media on their list */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** Filter by the season the media was released in */;
        season?:
          | ResolverInputTypes["MediaSeason"]
          | undefined
          | null /** The year of the season (Winter 2017 would also include December 2016 releases). Requires season argument */;
        seasonYear?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null /** Filter by the source type of the media */;
        source?:
          | ResolverInputTypes["MediaSource"]
          | undefined
          | null /** Filter by the source type of the media */;
        source_in?:
          | Array<ResolverInputTypes["MediaSource"] | undefined | null>
          | undefined
          | null /** Filter by the start date of the media */;
        startDate?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the start date of the media */;
        startDate_like?:
          | string
          | undefined
          | null /** Filter by the media's current release status */;
        status?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's current release status */;
        status_not?:
          | ResolverInputTypes["MediaStatus"]
          | undefined
          | null /** Filter by the media's current release status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaStatus"] | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory?:
          | string
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags with in a tag category */;
        tagCategory_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's tags */;
        tag_not_in?:
          | Array<string | undefined | null>
          | undefined
          | null /** Filter by the media's type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by the media's volume count */;
        volumes?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_greater?:
          | number
          | undefined
          | null /** Filter by the media's volume count */;
        volumes_lesser?: number | undefined | null;
      },
      ResolverInputTypes["Media"],
    ];
    MediaList?: [
      {
        /** Limit to only entries also on the auth user's list. Requires user id or name arguments. */
        compareWithAuthList?:
          | boolean
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null /** Filter by a list entry's id */;
        id?:
          | number
          | undefined
          | null /** Filter list entries to users who are being followed by the authenticated user */;
        isFollowing?:
          | boolean
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id of the list entry */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by note words and #tags */;
        notes?: string | undefined | null /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaListSort"] | undefined | null>
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null /** Filter by the watching/reading status */;
        status?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the list entries media type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by a user's id */;
        userId?: number | undefined | null /** Filter by a user's id */;
        userId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by a user's name */;
        userName?: string | undefined | null;
      },
      ResolverInputTypes["MediaList"],
    ];
    MediaListCollection?: [
      {
        /** Which chunk of list entries to load */
        chunk?:
          | number
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user completed the media */;
        completedAt_like?:
          | string
          | undefined
          | null /** Always return completed list entries in one group, overriding the user's split completed option. */;
        forceSingleCompletedList?:
          | boolean
          | undefined
          | null /** Filter by note words and #tags */;
        notes?: string | undefined | null /** Filter by note words and #tags */;
        notes_like?:
          | string
          | undefined
          | null /** The amount of entries per chunk, max 500 */;
        perChunk?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaListSort"] | undefined | null>
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_greater?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_lesser?:
          | ResolverInputTypes["FuzzyDateInt"]
          | undefined
          | null /** Filter by the date the user started the media */;
        startedAt_like?:
          | string
          | undefined
          | null /** Filter by the watching/reading status */;
        status?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not?:
          | ResolverInputTypes["MediaListStatus"]
          | undefined
          | null /** Filter by the watching/reading status */;
        status_not_in?:
          | Array<ResolverInputTypes["MediaListStatus"] | undefined | null>
          | undefined
          | null /** Filter by the list entries media type */;
        type?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** Filter by a user's id */;
        userId?: number | undefined | null /** Filter by a user's name */;
        userName?: string | undefined | null;
      },
      ResolverInputTypes["MediaListCollection"],
    ];
    MediaTagCollection?: [
      {
        /** Mod Only */ status?: number | undefined | null;
      },
      ResolverInputTypes["MediaTag"],
    ];
    MediaTrend?: [
      {
        /** Filter by score */
        averageScore?: number | undefined | null /** Filter by score */;
        averageScore_greater?: number | undefined | null /** Filter by score */;
        averageScore_lesser?: number | undefined | null /** Filter by score */;
        averageScore_not?: number | undefined | null /** Filter by date */;
        date?: number | undefined | null /** Filter by date */;
        date_greater?: number | undefined | null /** Filter by date */;
        date_lesser?: number | undefined | null /** Filter by episode number */;
        episode?: number | undefined | null /** Filter by episode number */;
        episode_greater?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_lesser?:
          | number
          | undefined
          | null /** Filter by episode number */;
        episode_not?: number | undefined | null /** Filter by the media id */;
        mediaId?: number | undefined | null /** Filter by the media id */;
        mediaId_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the media id */;
        mediaId_not?: number | undefined | null /** Filter by the media id */;
        mediaId_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by popularity */;
        popularity?: number | undefined | null /** Filter by popularity */;
        popularity_greater?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_lesser?:
          | number
          | undefined
          | null /** Filter by popularity */;
        popularity_not?:
          | number
          | undefined
          | null /** Filter to stats recorded while the media was releasing */;
        releasing?:
          | boolean
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaTrendSort"] | undefined | null>
          | undefined
          | null /** Filter by trending amount */;
        trending?: number | undefined | null /** Filter by trending amount */;
        trending_greater?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_lesser?:
          | number
          | undefined
          | null /** Filter by trending amount */;
        trending_not?: number | undefined | null;
      },
      ResolverInputTypes["MediaTrend"],
    ];
    Notification?: [
      {
        /** Reset the unread notification count to 0 on load */
        resetNotificationCount?:
          | boolean
          | undefined
          | null /** Filter by the type of notifications */;
        type?:
          | ResolverInputTypes["NotificationType"]
          | undefined
          | null /** Filter by the type of notifications */;
        type_in?:
          | Array<ResolverInputTypes["NotificationType"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["NotificationUnion"],
    ];
    Page?: [
      {
        /** The page number */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 50 */;
        perPage?: number | undefined | null;
      },
      ResolverInputTypes["Page"],
    ];
    Recommendation?: [
      {
        /** Filter by recommendation id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?:
          | number
          | undefined
          | null /** Filter by media recommendation id */;
        mediaRecommendationId?:
          | number
          | undefined
          | null /** Filter by the media on the authenticated user's lists */;
        onList?:
          | boolean
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_greater?:
          | number
          | undefined
          | null /** Filter by total rating of the recommendation */;
        rating_lesser?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["RecommendationSort"] | undefined | null>
          | undefined
          | null /** Filter by user who created the recommendation */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Recommendation"],
    ];
    Review?: [
      {
        /** Filter by Review id */
        id?: number | undefined | null /** Filter by media id */;
        mediaId?: number | undefined | null /** Filter by media type */;
        mediaType?:
          | ResolverInputTypes["MediaType"]
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ReviewSort"] | undefined | null>
          | undefined
          | null /** Filter by user id */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Review"],
    ];
    /** Site statistics query */
    SiteStatistics?: ResolverInputTypes["SiteStatistics"];
    Staff?: [
      {
        /** Filter by the staff id */
        id?: number | undefined | null /** Filter by the staff id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the staff id */;
        id_not?: number | undefined | null /** Filter by the staff id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by staff by if its their birthday today */;
        isBirthday?: boolean | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StaffSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Staff"],
    ];
    Studio?: [
      {
        /** Filter by the studio id */
        id?: number | undefined | null /** Filter by the studio id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by the studio id */;
        id_not?: number | undefined | null /** Filter by the studio id */;
        id_not_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["StudioSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["Studio"],
    ];
    Thread?: [
      {
        /** Filter by thread category id */
        categoryId?: number | undefined | null /** Filter by the thread id */;
        id?: number | undefined | null /** Filter by the thread id */;
        id_in?:
          | Array<number | undefined | null>
          | undefined
          | null /** Filter by thread media id category */;
        mediaCategoryId?:
          | number
          | undefined
          | null /** Filter by the user id of the last user to comment on the thread */;
        replyUserId?: number | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadSort"] | undefined | null>
          | undefined
          | null /** Filter by if the currently authenticated user's subscribed threads */;
        subscribed?:
          | boolean
          | undefined
          | null /** Filter by the user id of the thread's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["Thread"],
    ];
    ThreadComment?: [
      {
        /** Filter by the comment id */
        id?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["ThreadCommentSort"] | undefined | null>
          | undefined
          | null /** Filter by the thread id */;
        threadId?:
          | number
          | undefined
          | null /** Filter by the user id of the comment's creator */;
        userId?: number | undefined | null;
      },
      ResolverInputTypes["ThreadComment"],
    ];
    User?: [
      {
        /** Filter by the user id */
        id?: number | undefined | null /** Filter to moderators only if true */;
        isModerator?:
          | boolean
          | undefined
          | null /** Filter by the name of the user */;
        name?: string | undefined | null /** Filter by search query */;
        search?:
          | string
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["UserSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["User"],
    ];
    /** Get the currently authenticated user */
    Viewer?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Media recommendation */
  Recommendation: AliasType<{
    /** The id of the recommendation */
    id?: boolean | `@${string}`;
    /** The media the recommendation is from */
    media?: ResolverInputTypes["Media"];
    /** The recommended media */
    mediaRecommendation?: ResolverInputTypes["Media"];
    /** Users rating of the recommendation */
    rating?: boolean | `@${string}`;
    /** The user that first created the recommendation */
    user?: ResolverInputTypes["User"];
    /** The rating of the recommendation by currently authenticated user */
    userRating?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  RecommendationConnection: AliasType<{
    edges?: ResolverInputTypes["RecommendationEdge"];
    nodes?: ResolverInputTypes["Recommendation"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Recommendation connection edge */
  RecommendationEdge: AliasType<{
    node?: ResolverInputTypes["Recommendation"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when new media is added to the site */
  RelatedMediaAdditionNotification: AliasType<{
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The associated media of the airing schedule */
    media?: ResolverInputTypes["Media"];
    /** The id of the new media */
    mediaId?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  Report: AliasType<{
    cleared?: boolean | `@${string}`;
    /** When the entry data was created */
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    reason?: boolean | `@${string}`;
    reported?: ResolverInputTypes["User"];
    reporter?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A Review that features in an anime or manga */
  Review: AliasType<{
    body?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The time of the thread creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the review */
    id?: boolean | `@${string}`;
    /** The media the review is of */
    media?: ResolverInputTypes["Media"];
    /** The id of the review's media */
    mediaId?: boolean | `@${string}`;
    /** For which type of media the review is for */
    mediaType?: boolean | `@${string}`;
    /** If the review is not yet publicly published and is only viewable by creator */
    private?: boolean | `@${string}`;
    /** The total user rating of the review */
    rating?: boolean | `@${string}`;
    /** The amount of user ratings of the review */
    ratingAmount?: boolean | `@${string}`;
    /** The review score of the media */
    score?: boolean | `@${string}`;
    /** The url for the review page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** A short summary of the review */
    summary?: boolean | `@${string}`;
    /** The time of the thread last update */
    updatedAt?: boolean | `@${string}`;
    /** The creator of the review */
    user?: ResolverInputTypes["User"];
    /** The id of the review's creator */
    userId?: boolean | `@${string}`;
    /** The rating of the review by currently authenticated user */
    userRating?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  ReviewConnection: AliasType<{
    edges?: ResolverInputTypes["ReviewEdge"];
    nodes?: ResolverInputTypes["Review"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Review connection edge */
  ReviewEdge: AliasType<{
    node?: ResolverInputTypes["Review"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Feed of mod edit activity */
  RevisionHistory: AliasType<{
    /** The action taken on the objects */
    action?: boolean | `@${string}`;
    /** A JSON object of the fields that changed */
    changes?: boolean | `@${string}`;
    /** The character the mod feed entry references */
    character?: ResolverInputTypes["Character"];
    /** When the mod feed entry was created */
    createdAt?: boolean | `@${string}`;
    /** The external link source the mod feed entry references */
    externalLink?: ResolverInputTypes["MediaExternalLink"];
    /** The id of the media */
    id?: boolean | `@${string}`;
    /** The media the mod feed entry references */
    media?: ResolverInputTypes["Media"];
    /** The staff member the mod feed entry references */
    staff?: ResolverInputTypes["Staff"];
    /** The studio the mod feed entry references */
    studio?: ResolverInputTypes["Studio"];
    /** The user who made the edit to the object */
    user?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's list score distribution. */
  ScoreDistribution: AliasType<{
    /** The amount of list entries with this score */
    amount?: boolean | `@${string}`;
    score?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  SiteStatistics: AliasType<{
    anime?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    manga?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    reviews?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    staff?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    studios?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    users?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["SiteTrendSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["SiteTrendConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Daily site statistics */
  SiteTrend: AliasType<{
    /** The change from yesterday */
    change?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    /** The day the data was recorded (timestamp) */
    date?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  SiteTrendConnection: AliasType<{
    edges?: ResolverInputTypes["SiteTrendEdge"];
    nodes?: ResolverInputTypes["SiteTrend"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Site trend connection edge */
  SiteTrendEdge: AliasType<{
    node?: ResolverInputTypes["SiteTrend"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Voice actors or production staff */
  Staff: AliasType<{
    /** The person's age in years */
    age?: boolean | `@${string}`;
    /** The persons blood type */
    bloodType?: boolean | `@${string}`;
    characterMedia?: [
      {
        onList?: boolean | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    characters?: [
      {
        /** The page */
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["CharacterSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["CharacterConnection"],
    ];
    dateOfBirth?: ResolverInputTypes["FuzzyDate"];
    dateOfDeath?: ResolverInputTypes["FuzzyDate"];
    description?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The amount of user's who have favourited the staff member */
    favourites?: boolean | `@${string}`;
    /** The staff's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: boolean | `@${string}`;
    /** The persons birthplace or hometown */
    homeTown?: boolean | `@${string}`;
    /** The id of the staff member */
    id?: boolean | `@${string}`;
    /** The staff images */
    image?: ResolverInputTypes["StaffImage"];
    /** If the staff member is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    /** If the staff member is blocked from being added to favourites */
    isFavouriteBlocked?: boolean | `@${string}`;
    /** The primary language the staff member dub's in */
    language?: boolean | `@${string}`;
    /** The primary language of the staff member. Current values: Japanese, English, Korean, Italian, Spanish, Portuguese, French, German, Hebrew, Hungarian, Chinese, Arabic, Filipino, Catalan, Finnish, Turkish, Dutch, Swedish, Thai, Tagalog, Malaysian, Indonesian, Vietnamese, Nepali, Hindi, Urdu */
    languageV2?: boolean | `@${string}`;
    /** Notes for site moderators */
    modNotes?: boolean | `@${string}`;
    /** The names of the staff member */
    name?: ResolverInputTypes["StaffName"];
    /** The person's primary occupations */
    primaryOccupations?: boolean | `@${string}`;
    /** The url for the staff page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** Staff member that the submission is referencing */
    staff?: ResolverInputTypes["Staff"];
    staffMedia?: [
      {
        onList?: boolean | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null;
        type?: ResolverInputTypes["MediaType"] | undefined | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    /** Inner details of submission status */
    submissionNotes?: boolean | `@${string}`;
    /** Status of the submission */
    submissionStatus?: boolean | `@${string}`;
    /** Submitter for the submission */
    submitter?: ResolverInputTypes["User"];
    updatedAt?: boolean | `@${string}`;
    /** [startYear, endYear] (If the 2nd value is not present staff is still active) */
    yearsActive?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  StaffConnection: AliasType<{
    edges?: ResolverInputTypes["StaffEdge"];
    nodes?: ResolverInputTypes["Staff"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Staff connection edge */
  StaffEdge: AliasType<{
    /** The order the staff should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    node?: ResolverInputTypes["Staff"];
    /** The role of the staff member in the production of the media */
    role?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  StaffImage: AliasType<{
    /** The person's image of media at its largest size */
    large?: boolean | `@${string}`;
    /** The person's image of media at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The names of the staff member */
  StaffName: AliasType<{
    /** Other names the staff member might be referred to as (pen names) */
    alternative?: boolean | `@${string}`;
    /** The person's given name */
    first?: boolean | `@${string}`;
    /** The person's first and last name */
    full?: boolean | `@${string}`;
    /** The person's surname */
    last?: boolean | `@${string}`;
    /** The person's middle name */
    middle?: boolean | `@${string}`;
    /** The person's full name in their native language */
    native?: boolean | `@${string}`;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Voice actor role for a character */
  StaffRoleType: AliasType<{
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: boolean | `@${string}`;
    /** Notes regarding the VA's role for the character */
    roleNotes?: boolean | `@${string}`;
    /** The voice actors of the character */
    voiceActor?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  /** User's staff statistics */
  StaffStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    staff?: ResolverInputTypes["Staff"];
    /** The amount of time in minutes the staff member has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A submission for a staff that features in an anime or manga */
  StaffSubmission: AliasType<{
    /** Data Mod assigned to handle the submission */
    assignee?: ResolverInputTypes["User"];
    createdAt?: boolean | `@${string}`;
    /** The id of the submission */
    id?: boolean | `@${string}`;
    /** Whether the submission is locked */
    locked?: boolean | `@${string}`;
    /** Inner details of submission status */
    notes?: boolean | `@${string}`;
    source?: boolean | `@${string}`;
    /** Staff that the submission is referencing */
    staff?: ResolverInputTypes["Staff"];
    /** Status of the submission */
    status?: boolean | `@${string}`;
    /** The staff submission changes */
    submission?: ResolverInputTypes["Staff"];
    /** Submitter for the submission */
    submitter?: ResolverInputTypes["User"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The distribution of the watching/reading status of media or a user's list */
  StatusDistribution: AliasType<{
    /** The amount of entries with this status */
    amount?: boolean | `@${string}`;
    /** The day the activity took place (Unix timestamp) */
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Animation or production company */
  Studio: AliasType<{
    /** The amount of user's who have favourited the studio */
    favourites?: boolean | `@${string}`;
    /** The id of the studio */
    id?: boolean | `@${string}`;
    /** If the studio is an animation studio or a different kind of company */
    isAnimationStudio?: boolean | `@${string}`;
    /** If the studio is marked as favourite by the currently authenticated user */
    isFavourite?: boolean | `@${string}`;
    media?: [
      {
        /** If the studio was the primary animation studio of the media */
        isMain?: boolean | undefined | null;
        onList?: boolean | undefined | null /** The page */;
        page?:
          | number
          | undefined
          | null /** The amount of entries per page, max 25 */;
        perPage?:
          | number
          | undefined
          | null /** The order the results will be returned in */;
        sort?:
          | Array<ResolverInputTypes["MediaSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    /** The name of the studio */
    name?: boolean | `@${string}`;
    /** The url for the studio page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  StudioConnection: AliasType<{
    edges?: ResolverInputTypes["StudioEdge"];
    nodes?: ResolverInputTypes["Studio"];
    /** The pagination information */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Studio connection edge */
  StudioEdge: AliasType<{
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: boolean | `@${string}`;
    /** The id of the connection */
    id?: boolean | `@${string}`;
    /** If the studio is the main animation studio of the anime */
    isMain?: boolean | `@${string}`;
    node?: ResolverInputTypes["Studio"];
    __typename?: boolean | `@${string}`;
  }>;
  /** User's studio statistics */
  StudioStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    studio?: ResolverInputTypes["Studio"];
    /** The amount of time in minutes the studio's works have been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User's tag statistics */
  TagStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    tag?: ResolverInputTypes["MediaTag"];
    /** The amount of time in minutes the tag has been watched by the user */
    timeWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User text activity */
  TextActivity: AliasType<{
    /** The time the activity was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the activity */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | `@${string}`;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | `@${string}`;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the activity has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the activity */
    likes?: ResolverInputTypes["User"];
    /** The written replies to the activity */
    replies?: ResolverInputTypes["ActivityReply"];
    /** The number of activity replies */
    replyCount?: boolean | `@${string}`;
    /** The url for the activity page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    text?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The type of activity */
    type?: boolean | `@${string}`;
    /** The user who created the activity */
    user?: ResolverInputTypes["User"];
    /** The user id of the activity's creator */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Forum Thread */
  Thread: AliasType<{
    body?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The categories of the thread */
    categories?: ResolverInputTypes["ThreadCategory"];
    /** The time of the thread creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the thread */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the thread */
    isLiked?: boolean | `@${string}`;
    /** If the thread is locked and can receive comments */
    isLocked?: boolean | `@${string}`;
    /** If the thread is stickied and should be displayed at the top of the page */
    isSticky?: boolean | `@${string}`;
    /** If the currently authenticated user is subscribed to the thread */
    isSubscribed?: boolean | `@${string}`;
    /** The amount of likes the thread has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the thread */
    likes?: ResolverInputTypes["User"];
    /** The media categories of the thread */
    mediaCategories?: ResolverInputTypes["Media"];
    /** The time of the last reply */
    repliedAt?: boolean | `@${string}`;
    /** The id of the most recent comment on the thread */
    replyCommentId?: boolean | `@${string}`;
    /** The number of comments on the thread */
    replyCount?: boolean | `@${string}`;
    /** The user to last reply to the thread */
    replyUser?: ResolverInputTypes["User"];
    /** The id of the user who most recently commented on the thread */
    replyUserId?: boolean | `@${string}`;
    /** The url for the thread page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The title of the thread */
    title?: boolean | `@${string}`;
    /** The time of the thread last update */
    updatedAt?: boolean | `@${string}`;
    /** The owner of the thread */
    user?: ResolverInputTypes["User"];
    /** The id of the thread owner user */
    userId?: boolean | `@${string}`;
    /** The number of times users have viewed the thread */
    viewCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A forum thread category */
  ThreadCategory: AliasType<{
    /** The id of the category */
    id?: boolean | `@${string}`;
    /** The name of the category */
    name?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Forum Thread Comment */
  ThreadComment: AliasType<{
    /** The comment's child reply comments */
    childComments?: boolean | `@${string}`;
    comment?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The time of the comments creation */
    createdAt?: boolean | `@${string}`;
    /** The id of the comment */
    id?: boolean | `@${string}`;
    /** If the currently authenticated user liked the comment */
    isLiked?: boolean | `@${string}`;
    /** If the comment tree is locked and may not receive replies or edits */
    isLocked?: boolean | `@${string}`;
    /** The amount of likes the comment has */
    likeCount?: boolean | `@${string}`;
    /** The users who liked the comment */
    likes?: ResolverInputTypes["User"];
    /** The url for the comment page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The thread the comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The id of thread the comment belongs to */
    threadId?: boolean | `@${string}`;
    /** The time of the comments last update */
    updatedAt?: boolean | `@${string}`;
    /** The user who created the comment */
    user?: ResolverInputTypes["User"];
    /** The user id of the comment's owner */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a thread comment is liked */
  ThreadCommentLikeNotification: AliasType<{
    /** The thread comment that was liked */
    comment?: ResolverInputTypes["ThreadComment"];
    /** The id of the activity which was liked */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when authenticated user is @ mentioned in a forum thread comment */
  ThreadCommentMentionNotification: AliasType<{
    /** The thread comment that included the @ mention */
    comment?: ResolverInputTypes["ThreadComment"];
    /** The id of the comment where mentioned */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who mentioned the authenticated user */
    user?: ResolverInputTypes["User"];
    /** The id of the user who mentioned the authenticated user */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a user replies to your forum thread comment */
  ThreadCommentReplyNotification: AliasType<{
    /** The reply thread comment */
    comment?: ResolverInputTypes["ThreadComment"];
    /** The id of the reply comment */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who create the comment reply */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a user replies to a subscribed forum thread */
  ThreadCommentSubscribedNotification: AliasType<{
    /** The reply thread comment */
    comment?: ResolverInputTypes["ThreadComment"];
    /** The id of the new comment in the subscribed thread */
    commentId?: boolean | `@${string}`;
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who replied to the subscribed thread */
    user?: ResolverInputTypes["User"];
    /** The id of the user who commented on the thread */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Notification for when a thread is liked */
  ThreadLikeNotification: AliasType<{
    /** The liked thread comment */
    comment?: ResolverInputTypes["ThreadComment"];
    /** The notification context text */
    context?: boolean | `@${string}`;
    /** The time the notification was created at */
    createdAt?: boolean | `@${string}`;
    /** The id of the Notification */
    id?: boolean | `@${string}`;
    /** The thread that the relevant comment belongs to */
    thread?: ResolverInputTypes["Thread"];
    /** The id of the thread which was liked */
    threadId?: boolean | `@${string}`;
    /** The type of notification */
    type?: boolean | `@${string}`;
    /** The user who liked the activity */
    user?: ResolverInputTypes["User"];
    /** The id of the user who liked to the activity */
    userId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user */
  User: AliasType<{
    about?: [
      {
        /** Return the string in pre-parsed html instead of markdown */
        asHtml?: boolean | undefined | null;
      },
      boolean | `@${string}`,
    ];
    /** The user's avatar images */
    avatar?: ResolverInputTypes["UserAvatar"];
    /** The user's banner images */
    bannerImage?: boolean | `@${string}`;
    bans?: boolean | `@${string}`;
    /** When the user's account was created. (Does not exist for accounts created before 2020) */
    createdAt?: boolean | `@${string}`;
    /** Custom donation badge text */
    donatorBadge?: boolean | `@${string}`;
    /** The donation tier of the user */
    donatorTier?: boolean | `@${string}`;
    favourites?: [
      {
        /** Deprecated. Use page arguments on each favourite field instead. */
        page?: number | undefined | null;
      },
      ResolverInputTypes["Favourites"],
    ];
    /** The id of the user */
    id?: boolean | `@${string}`;
    /** If the user is blocked by the authenticated user */
    isBlocked?: boolean | `@${string}`;
    /** If this user if following the authenticated user */
    isFollower?: boolean | `@${string}`;
    /** If the authenticated user if following this user */
    isFollowing?: boolean | `@${string}`;
    /** The user's media list options */
    mediaListOptions?: ResolverInputTypes["MediaListOptions"];
    /** The user's moderator roles if they are a site moderator */
    moderatorRoles?: boolean | `@${string}`;
    /** If the user is a moderator or data moderator */
    moderatorStatus?: boolean | `@${string}`;
    /** The name of the user */
    name?: boolean | `@${string}`;
    /** The user's general options */
    options?: ResolverInputTypes["UserOptions"];
    /** The user's previously used names. */
    previousNames?: ResolverInputTypes["UserPreviousName"];
    /** The url for the user page on the AniList website */
    siteUrl?: boolean | `@${string}`;
    /** The users anime & manga list statistics */
    statistics?: ResolverInputTypes["UserStatisticTypes"];
    /** The user's statistics */
    stats?: ResolverInputTypes["UserStats"];
    /** The number of unread notifications the user has */
    unreadNotificationCount?: boolean | `@${string}`;
    /** When the user's data was last updated */
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's activity history stats. */
  UserActivityHistory: AliasType<{
    /** The amount of activity on the day */
    amount?: boolean | `@${string}`;
    /** The day the activity took place (Unix timestamp) */
    date?: boolean | `@${string}`;
    /** The level of activity represented on a 1-10 scale */
    level?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's avatars */
  UserAvatar: AliasType<{
    /** The avatar of user at its largest size */
    large?: boolean | `@${string}`;
    /** The avatar of user at medium size */
    medium?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserCountryStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    country?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserFormatStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    format?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserGenreStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    genre?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserLengthStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    length?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** User data for moderators */
  UserModData: AliasType<{
    alts?: ResolverInputTypes["User"];
    bans?: boolean | `@${string}`;
    counts?: boolean | `@${string}`;
    email?: boolean | `@${string}`;
    ip?: boolean | `@${string}`;
    privacy?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's general options */
  UserOptions: AliasType<{
    /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */
    activityMergeTime?: boolean | `@${string}`;
    /** Whether the user receives notifications when a show they are watching aires */
    airingNotifications?: boolean | `@${string}`;
    /** The list activity types the user has disabled from being created from list updates */
    disabledListActivity?: ResolverInputTypes["ListActivityOption"];
    /** Whether the user has enabled viewing of 18+ content */
    displayAdultContent?: boolean | `@${string}`;
    /** Notification options */
    notificationOptions?: ResolverInputTypes["NotificationOption"];
    /** Profile highlight color (blue, purple, pink, orange, red, green, gray) */
    profileColor?: boolean | `@${string}`;
    /** Whether the user only allow messages from users they follow */
    restrictMessagesToFollowing?: boolean | `@${string}`;
    /** The language the user wants to see staff and character names in */
    staffNameLanguage?: boolean | `@${string}`;
    /** The user's timezone offset (Auth user only) */
    timezone?: boolean | `@${string}`;
    /** The language the user wants to see media titles in */
    titleLanguage?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's previous name */
  UserPreviousName: AliasType<{
    /** When the user first changed from this name. */
    createdAt?: boolean | `@${string}`;
    /** A previous name of the user. */
    name?: boolean | `@${string}`;
    /** When the user most recently changed from this name. */
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserReleaseYearStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    releaseYear?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserScoreStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    score?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserStaffStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    staff?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  UserStartYearStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    startYear?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserStatisticTypes: AliasType<{
    anime?: ResolverInputTypes["UserStatistics"];
    manga?: ResolverInputTypes["UserStatistics"];
    __typename?: boolean | `@${string}`;
  }>;
  UserStatistics: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    countries?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserCountryStatistic"],
    ];
    episodesWatched?: boolean | `@${string}`;
    formats?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserFormatStatistic"],
    ];
    genres?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserGenreStatistic"],
    ];
    lengths?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserLengthStatistic"],
    ];
    meanScore?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    releaseYears?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserReleaseYearStatistic"],
    ];
    scores?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserScoreStatistic"],
    ];
    staff?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserStaffStatistic"],
    ];
    standardDeviation?: boolean | `@${string}`;
    startYears?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserStartYearStatistic"],
    ];
    statuses?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserStatusStatistic"],
    ];
    studios?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserStudioStatistic"],
    ];
    tags?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserTagStatistic"],
    ];
    voiceActors?: [
      {
        limit?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["UserStatisticsSort"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["UserVoiceActorStatistic"],
    ];
    volumesRead?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user's statistics */
  UserStats: AliasType<{
    activityHistory?: ResolverInputTypes["UserActivityHistory"];
    animeListScores?: ResolverInputTypes["ListScoreStats"];
    animeScoreDistribution?: ResolverInputTypes["ScoreDistribution"];
    animeStatusDistribution?: ResolverInputTypes["StatusDistribution"];
    /** The amount of manga chapters the user has read */
    chaptersRead?: boolean | `@${string}`;
    favouredActors?: ResolverInputTypes["StaffStats"];
    favouredFormats?: ResolverInputTypes["FormatStats"];
    favouredGenres?: ResolverInputTypes["GenreStats"];
    favouredGenresOverview?: ResolverInputTypes["GenreStats"];
    favouredStaff?: ResolverInputTypes["StaffStats"];
    favouredStudios?: ResolverInputTypes["StudioStats"];
    favouredTags?: ResolverInputTypes["TagStats"];
    favouredYears?: ResolverInputTypes["YearStats"];
    mangaListScores?: ResolverInputTypes["ListScoreStats"];
    mangaScoreDistribution?: ResolverInputTypes["ScoreDistribution"];
    mangaStatusDistribution?: ResolverInputTypes["StatusDistribution"];
    /** The amount of anime the user has watched in minutes */
    watchedTime?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserStatusStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  UserStudioStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    studio?: ResolverInputTypes["Studio"];
    __typename?: boolean | `@${string}`;
  }>;
  UserTagStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    tag?: ResolverInputTypes["MediaTag"];
    __typename?: boolean | `@${string}`;
  }>;
  UserVoiceActorStatistic: AliasType<{
    chaptersRead?: boolean | `@${string}`;
    characterIds?: boolean | `@${string}`;
    count?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    mediaIds?: boolean | `@${string}`;
    minutesWatched?: boolean | `@${string}`;
    voiceActor?: ResolverInputTypes["Staff"];
    __typename?: boolean | `@${string}`;
  }>;
  /** User's year statistics */
  YearStats: AliasType<{
    amount?: boolean | `@${string}`;
    meanScore?: boolean | `@${string}`;
    year?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Activity sort enums */
  ActivitySort: ActivitySort;
  /** Activity type enum. */
  ActivityType: ActivityType;
  /** Airing schedule sort enums */
  AiringSort: AiringSort;
  /** The role the character plays in the media */
  CharacterRole: CharacterRole;
  /** Character sort enums */
  CharacterSort: CharacterSort;
  ExternalLinkMediaType: ExternalLinkMediaType;
  ExternalLinkType: ExternalLinkType;
  /** Types that can be liked */
  LikeableType: LikeableType;
  /** The format the media was released in */
  MediaFormat: MediaFormat;
  /** Media list sort enums */
  MediaListSort: MediaListSort;
  /** Media list watching/reading status enum. */
  MediaListStatus: MediaListStatus;
  /** The type of ranking */
  MediaRankType: MediaRankType;
  /** Type of relation media has to its parent. */
  MediaRelation: MediaRelation;
  MediaSeason: MediaSeason;
  /** Media sort enums */
  MediaSort: MediaSort;
  /** Source type the media was adapted from */
  MediaSource: MediaSource;
  /** The current releasing status of the media */
  MediaStatus: MediaStatus;
  /** Media trend sort enums */
  MediaTrendSort: MediaTrendSort;
  /** Media type enum, anime or manga. */
  MediaType: MediaType;
  ModActionType: ModActionType;
  /** Mod role enums */
  ModRole: ModRole;
  /** Notification type enum */
  NotificationType: NotificationType;
  /** Recommendation rating enums */
  RecommendationRating: RecommendationRating;
  /** Recommendation sort enums */
  RecommendationSort: RecommendationSort;
  /** Review rating enums */
  ReviewRating: ReviewRating;
  /** Review sort enums */
  ReviewSort: ReviewSort;
  /** Revision history actions */
  RevisionHistoryAction: RevisionHistoryAction;
  /** Media list scoring type */
  ScoreFormat: ScoreFormat;
  /** Site trend sort enums */
  SiteTrendSort: SiteTrendSort;
  /** The primary language of the voice actor */
  StaffLanguage: StaffLanguage;
  /** Staff sort enums */
  StaffSort: StaffSort;
  /** Studio sort enums */
  StudioSort: StudioSort;
  /** Submission sort enums */
  SubmissionSort: SubmissionSort;
  /** Submission status */
  SubmissionStatus: SubmissionStatus;
  /** Thread comments sort enums */
  ThreadCommentSort: ThreadCommentSort;
  /** Thread sort enums */
  ThreadSort: ThreadSort;
  /** User sort enums */
  UserSort: UserSort;
  /** The language the user wants to see staff and character names in */
  UserStaffNameLanguage: UserStaffNameLanguage;
  /** User statistics sort enum */
  UserStatisticsSort: UserStatisticsSort;
  /** The language the user wants to see media titles in */
  UserTitleLanguage: UserTitleLanguage;
  /** ISO 3166-1 alpha-2 country code */
  CountryCode: unknown;
  /** 8 digit long date integer (YYYYMMDD). Unknown dates represented by 0. E.g. 2016: 20160000, May 1976: 19760500 */
  FuzzyDateInt: unknown;
  Json: unknown;
  AiringScheduleInput: {
    airingAt?: number | undefined | null;
    episode?: number | undefined | null;
    timeUntilAiring?: number | undefined | null;
  };
  AniChartHighlightInput: {
    highlight?: string | undefined | null;
    mediaId?: number | undefined | null;
  };
  /** The names of the character */
  CharacterNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: Array<string | undefined | null> | undefined | null;
    /** The character's given name */
    first?: string | undefined | null;
    /** The character's surname */
    last?: string | undefined | null;
    /** The character's middle name */
    middle?: string | undefined | null;
    /** The character's full name in their native language */
    native?: string | undefined | null;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDateInput: {
    /** Numeric Day (24) */
    day?: number | undefined | null;
    /** Numeric Month (3) */
    month?: number | undefined | null;
    /** Numeric Year (2017) */
    year?: number | undefined | null;
  };
  ListActivityOptionInput: {
    disabled?: boolean | undefined | null;
    type?: ResolverInputTypes["MediaListStatus"] | undefined | null;
  };
  /** An external link to another site related to the media */
  MediaExternalLinkInput: {
    /** The id of the external link */
    id: number;
    /** The site location of the external link */
    site: string;
    /** The url of the external link */
    url: string;
  };
  /** A user's list options for anime or manga lists */
  MediaListOptionsInput: {
    /** The names of the user's advanced scoring sections */
    advancedScoring?: Array<string | undefined | null> | undefined | null;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null;
    /** The names of the user's custom lists */
    customLists?: Array<string | undefined | null> | undefined | null;
    /** The order each list should be displayed in */
    sectionOrder?: Array<string | undefined | null> | undefined | null;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | undefined | null;
    /** list theme */
    theme?: string | undefined | null;
  };
  /** The official titles of the media in various languages */
  MediaTitleInput: {
    /** The official english title */
    english?: string | undefined | null;
    /** Official title in it's native language */
    native?: string | undefined | null;
    /** The romanization of the native language title */
    romaji?: string | undefined | null;
  };
  /** Notification option input */
  NotificationOptionInput: {
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null;
    /** The type of notification */
    type?: ResolverInputTypes["NotificationType"] | undefined | null;
  };
  /** The names of the staff member */
  StaffNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** The person's given name */
    first?: string | undefined | null;
    /** The person's surname */
    last?: string | undefined | null;
    /** The person's middle name */
    middle?: string | undefined | null;
    /** The person's full name in their native language */
    native?: string | undefined | null;
  };
  ID: unknown;
};

export type ModelTypes = {
  schema: {
    query?: ModelTypes["Query"] | undefined | null;
    mutation?: ModelTypes["Mutation"] | undefined | null;
  };
  /** Activity union type */
  ActivityUnion:
    | ModelTypes["ListActivity"]
    | ModelTypes["MessageActivity"]
    | ModelTypes["TextActivity"];
  /** Likeable union type */
  LikeableUnion:
    | ModelTypes["ActivityReply"]
    | ModelTypes["ListActivity"]
    | ModelTypes["MessageActivity"]
    | ModelTypes["TextActivity"]
    | ModelTypes["Thread"]
    | ModelTypes["ThreadComment"];
  /** Notification union type */
  NotificationUnion:
    | ModelTypes["ActivityLikeNotification"]
    | ModelTypes["ActivityMentionNotification"]
    | ModelTypes["ActivityMessageNotification"]
    | ModelTypes["ActivityReplyLikeNotification"]
    | ModelTypes["ActivityReplyNotification"]
    | ModelTypes["ActivityReplySubscribedNotification"]
    | ModelTypes["AiringNotification"]
    | ModelTypes["FollowingNotification"]
    | ModelTypes["MediaDataChangeNotification"]
    | ModelTypes["MediaDeletionNotification"]
    | ModelTypes["MediaMergeNotification"]
    | ModelTypes["RelatedMediaAdditionNotification"]
    | ModelTypes["ThreadCommentLikeNotification"]
    | ModelTypes["ThreadCommentMentionNotification"]
    | ModelTypes["ThreadCommentReplyNotification"]
    | ModelTypes["ThreadCommentSubscribedNotification"]
    | ModelTypes["ThreadLikeNotification"];
  /** Notification for when a activity is liked */
  ActivityLikeNotification: {
    /** The liked activity */
    activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was liked */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
  };
  /** Notification for when authenticated user is @ mentioned in activity or reply */
  ActivityMentionNotification: {
    /** The liked activity */
    activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity where mentioned */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who mentioned the authenticated user */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who mentioned the authenticated user */
    userId: number;
  };
  /** Notification for when a user is send an activity message */
  ActivityMessageNotification: {
    /** The id of the activity message */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The message activity */
    message?: ModelTypes["MessageActivity"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who sent the message */
    user?: ModelTypes["User"] | undefined | null;
    /** The if of the user who send the message */
    userId: number;
  };
  /** Replay to an activity item */
  ActivityReply: {
    /** The id of the parent activity */
    activityId?: number | undefined | null;
    /** The time the reply was created at */
    createdAt: number;
    /** The id of the reply */
    id: number;
    /** If the currently authenticated user liked the reply */
    isLiked?: boolean | undefined | null;
    /** The amount of likes the reply has */
    likeCount: number;
    /** The users who liked the reply */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The reply text */
    text?: string | undefined | null;
    /** The user who created reply */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the replies creator */
    userId?: number | undefined | null;
  };
  /** Notification for when a activity reply is liked */
  ActivityReplyLikeNotification: {
    /** The liked activity */
    activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity where the reply which was liked */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity reply */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity reply */
    userId: number;
  };
  /** Notification for when a user replies to the authenticated users activity */
  ActivityReplyNotification: {
    /** The liked activity */
    activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was replied too */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who replied to the activity */
    userId: number;
  };
  /** Notification for when a user replies to activity the authenticated user has replied to */
  ActivityReplySubscribedNotification: {
    /** The liked activity */
    activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was replied too */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who replied to the activity */
    userId: number;
  };
  /** Notification for when an episode of anime airs */
  AiringNotification: {
    /** The id of the aired anime */
    animeId: number;
    /** The notification context text */
    contexts?: Array<string | undefined | null> | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The episode number that just aired */
    episode: number;
    /** The id of the Notification */
    id: number;
    /** The associated media of the airing schedule */
    media?: ModelTypes["Media"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** Score & Watcher stats for airing anime by episode and mid-week */
  AiringProgression: {
    /** The episode the stats were recorded at. .5 is the mid point between 2 episodes airing dates. */
    episode?: number | undefined | null;
    /** The average score for the media */
    score?: number | undefined | null;
    /** The amount of users watching the anime */
    watching?: number | undefined | null;
  };
  /** Media Airing Schedule. NOTE: We only aim to guarantee that FUTURE airing data is present and accurate. */
  AiringSchedule: {
    /** The time the episode airs at */
    airingAt: number;
    /** The airing episode number */
    episode: number;
    /** The id of the airing schedule item */
    id: number;
    /** The associate media of the airing episode */
    media?: ModelTypes["Media"] | undefined | null;
    /** The associate media id of the airing episode */
    mediaId: number;
    /** Seconds until episode starts airing */
    timeUntilAiring: number;
  };
  AiringScheduleConnection: {
    edges?:
      | Array<ModelTypes["AiringScheduleEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** AiringSchedule connection edge */
  AiringScheduleEdge: {
    /** The id of the connection */
    id?: number | undefined | null;
    node?: ModelTypes["AiringSchedule"] | undefined | null;
  };
  AniChartUser: {
    highlights?: ModelTypes["Json"] | undefined | null;
    settings?: ModelTypes["Json"] | undefined | null;
    user?: ModelTypes["User"] | undefined | null;
  };
  /** A character that features in an anime or manga */
  Character: {
    /** The character's age. Note this is a string, not an int, it may contain further text and additional ages. */
    age?: string | undefined | null;
    /** The characters blood type */
    bloodType?: string | undefined | null;
    /** The character's birth date */
    dateOfBirth?: ModelTypes["FuzzyDate"] | undefined | null;
    /** A general description of the character */
    description?: string | undefined | null;
    /** The amount of user's who have favourited the character */
    favourites?: number | undefined | null;
    /** The character's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: string | undefined | null;
    /** The id of the character */
    id: number;
    /** Character images */
    image?: ModelTypes["CharacterImage"] | undefined | null;
    /** If the character is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** If the character is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** Media that includes the character */
    media?: ModelTypes["MediaConnection"] | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The names of the character */
    name?: ModelTypes["CharacterName"] | undefined | null;
    /** The url for the character page on the AniList website */
    siteUrl?: string | undefined | null;
    updatedAt?: number | undefined | null;
  };
  CharacterConnection: {
    edges?:
      | Array<ModelTypes["CharacterEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["Character"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Character connection edge */
  CharacterEdge: {
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** The media the character is in */
    media?: Array<ModelTypes["Media"] | undefined | null> | undefined | null;
    /** Media specific character name */
    name?: string | undefined | null;
    node?: ModelTypes["Character"] | undefined | null;
    /** The characters role in the media */
    role?: ModelTypes["CharacterRole"] | undefined | null;
    /** The voice actors of the character with role date */
    voiceActorRoles?:
      | Array<ModelTypes["StaffRoleType"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<ModelTypes["Staff"] | undefined | null>
      | undefined
      | null;
  };
  CharacterImage: {
    /** The character's image of media at its largest size */
    large?: string | undefined | null;
    /** The character's image of media at medium size */
    medium?: string | undefined | null;
  };
  /** The names of the character */
  CharacterName: {
    /** Other names the character might be referred to as */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: Array<string | undefined | null> | undefined | null;
    /** The character's given name */
    first?: string | undefined | null;
    /** The character's first and last name */
    full?: string | undefined | null;
    /** The character's surname */
    last?: string | undefined | null;
    /** The character's middle name */
    middle?: string | undefined | null;
    /** The character's full name in their native language */
    native?: string | undefined | null;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
  };
  /** A submission for a character that features in an anime or manga */
  CharacterSubmission: {
    /** Data Mod assigned to handle the submission */
    assignee?: ModelTypes["User"] | undefined | null;
    /** Character that the submission is referencing */
    character?: ModelTypes["Character"] | undefined | null;
    createdAt?: number | undefined | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    /** Inner details of submission status */
    notes?: string | undefined | null;
    source?: string | undefined | null;
    /** Status of the submission */
    status?: ModelTypes["SubmissionStatus"] | undefined | null;
    /** The character submission changes */
    submission?: ModelTypes["Character"] | undefined | null;
    /** Submitter for the submission */
    submitter?: ModelTypes["User"] | undefined | null;
  };
  CharacterSubmissionConnection: {
    edges?:
      | Array<ModelTypes["CharacterSubmissionEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["CharacterSubmission"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** CharacterSubmission connection edge */
  CharacterSubmissionEdge: {
    node?: ModelTypes["CharacterSubmission"] | undefined | null;
    /** The characters role in the media */
    role?: ModelTypes["CharacterRole"] | undefined | null;
    /** The submitted voice actors of the character */
    submittedVoiceActors?:
      | Array<ModelTypes["StaffSubmission"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<ModelTypes["Staff"] | undefined | null>
      | undefined
      | null;
  };
  /** Deleted data type */
  Deleted: {
    /** If an item has been successfully deleted */
    deleted?: boolean | undefined | null;
  };
  /** User's favourite anime, manga, characters, staff & studios */
  Favourites: {
    /** Favourite anime */
    anime?: ModelTypes["MediaConnection"] | undefined | null;
    /** Favourite characters */
    characters?: ModelTypes["CharacterConnection"] | undefined | null;
    /** Favourite manga */
    manga?: ModelTypes["MediaConnection"] | undefined | null;
    /** Favourite staff */
    staff?: ModelTypes["StaffConnection"] | undefined | null;
    /** Favourite studios */
    studios?: ModelTypes["StudioConnection"] | undefined | null;
  };
  /** Notification for when the authenticated user is followed by another user */
  FollowingNotification: {
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The liked activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who followed the authenticated user */
    userId: number;
  };
  /** User's format statistics */
  FormatStats: {
    amount?: number | undefined | null;
    format?: ModelTypes["MediaFormat"] | undefined | null;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDate: {
    /** Numeric Day (24) */
    day?: number | undefined | null;
    /** Numeric Month (3) */
    month?: number | undefined | null;
    /** Numeric Year (2017) */
    year?: number | undefined | null;
  };
  /** User's genre statistics */
  GenreStats: {
    amount?: number | undefined | null;
    genre?: string | undefined | null;
    meanScore?: number | undefined | null;
    /** The amount of time in minutes the genre has been watched by the user */
    timeWatched?: number | undefined | null;
  };
  /** Page of data (Used for internal use only) */
  InternalPage: {
    activities?:
      | Array<ModelTypes["ActivityUnion"] | undefined | null>
      | undefined
      | null;
    activityReplies?:
      | Array<ModelTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    airingSchedules?:
      | Array<ModelTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    characterSubmissions?:
      | Array<ModelTypes["CharacterSubmission"] | undefined | null>
      | undefined
      | null;
    characters?:
      | Array<ModelTypes["Character"] | undefined | null>
      | undefined
      | null;
    followers?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    following?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    media?: Array<ModelTypes["Media"] | undefined | null> | undefined | null;
    mediaList?:
      | Array<ModelTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    mediaSubmissions?:
      | Array<ModelTypes["MediaSubmission"] | undefined | null>
      | undefined
      | null;
    mediaTrends?:
      | Array<ModelTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    modActions?:
      | Array<ModelTypes["ModAction"] | undefined | null>
      | undefined
      | null;
    notifications?:
      | Array<ModelTypes["NotificationUnion"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
    recommendations?:
      | Array<ModelTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    reports?: Array<ModelTypes["Report"] | undefined | null> | undefined | null;
    reviews?: Array<ModelTypes["Review"] | undefined | null> | undefined | null;
    revisionHistory?:
      | Array<ModelTypes["RevisionHistory"] | undefined | null>
      | undefined
      | null;
    staff?: Array<ModelTypes["Staff"] | undefined | null> | undefined | null;
    staffSubmissions?:
      | Array<ModelTypes["StaffSubmission"] | undefined | null>
      | undefined
      | null;
    studios?: Array<ModelTypes["Studio"] | undefined | null> | undefined | null;
    threadComments?:
      | Array<ModelTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    threads?: Array<ModelTypes["Thread"] | undefined | null> | undefined | null;
    userBlockSearch?:
      | Array<ModelTypes["User"] | undefined | null>
      | undefined
      | null;
    users?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
  };
  /** User list activity (anime & manga updates) */
  ListActivity: {
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The associated media to the activity update */
    media?: ModelTypes["Media"] | undefined | null;
    /** The list progress made */
    progress?: string | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<ModelTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The list item's textual status */
    status?: string | undefined | null;
    /** The type of activity */
    type?: ModelTypes["ActivityType"] | undefined | null;
    /** The owner of the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The user id of the activity's creator */
    userId?: number | undefined | null;
  };
  ListActivityOption: {
    disabled?: boolean | undefined | null;
    type?: ModelTypes["MediaListStatus"] | undefined | null;
  };
  /** User's list score statistics */
  ListScoreStats: {
    meanScore?: number | undefined | null;
    standardDeviation?: number | undefined | null;
  };
  /** Anime or Manga */
  Media: {
    /** The media's entire airing schedule */
    airingSchedule?: ModelTypes["AiringScheduleConnection"] | undefined | null;
    /** If the media should have forum thread automatically created for it on airing episode release */
    autoCreateForumThread?: boolean | undefined | null;
    /** A weighted average score of all the user's scores of the media */
    averageScore?: number | undefined | null;
    /** The banner image of the media */
    bannerImage?: string | undefined | null;
    /** The amount of chapters the manga has when complete */
    chapters?: number | undefined | null;
    /** The characters in the media */
    characters?: ModelTypes["CharacterConnection"] | undefined | null;
    /** Where the media was created. (ISO 3166-1 alpha-2) */
    countryOfOrigin?: ModelTypes["CountryCode"] | undefined | null;
    /** The cover images of the media */
    coverImage?: ModelTypes["MediaCoverImage"] | undefined | null;
    /** Short description of the media's story and characters */
    description?: string | undefined | null;
    /** The general length of each anime episode in minutes */
    duration?: number | undefined | null;
    /** The last official release date of the media */
    endDate?: ModelTypes["FuzzyDate"] | undefined | null;
    /** The amount of episodes the anime has when complete */
    episodes?: number | undefined | null;
    /** External links to another site related to the media */
    externalLinks?:
      | Array<ModelTypes["MediaExternalLink"] | undefined | null>
      | undefined
      | null;
    /** The amount of user's who have favourited the media */
    favourites?: number | undefined | null;
    /** The format the media was released in */
    format?: ModelTypes["MediaFormat"] | undefined | null;
    /** The genres of the media */
    genres?: Array<string | undefined | null> | undefined | null;
    /** Official Twitter hashtags for the media */
    hashtag?: string | undefined | null;
    /** The id of the media */
    id: number;
    /** The mal id of the media */
    idMal?: number | undefined | null;
    /** If the media is intended only for 18+ adult audiences */
    isAdult?: boolean | undefined | null;
    /** If the media is marked as favourite by the current authenticated user */
    isFavourite: boolean;
    /** If the media is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** If the media is officially licensed or a self-published doujin release */
    isLicensed?: boolean | undefined | null;
    /** Locked media may not be added to lists our favorited. This may be due to the entry pending for deletion or other reasons. */
    isLocked?: boolean | undefined | null;
    /** If the media is blocked from being recommended to/from */
    isRecommendationBlocked?: boolean | undefined | null;
    /** If the media is blocked from being reviewed */
    isReviewBlocked?: boolean | undefined | null;
    /** Mean score of all the user's scores of the media */
    meanScore?: number | undefined | null;
    /** The authenticated user's media list entry for the media */
    mediaListEntry?: ModelTypes["MediaList"] | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The media's next episode airing schedule */
    nextAiringEpisode?: ModelTypes["AiringSchedule"] | undefined | null;
    /** The number of users with the media on their list */
    popularity?: number | undefined | null;
    /** The ranking of the media in a particular time span and format compared to other media */
    rankings?:
      | Array<ModelTypes["MediaRank"] | undefined | null>
      | undefined
      | null;
    /** User recommendations for similar media */
    recommendations?: ModelTypes["RecommendationConnection"] | undefined | null;
    /** Other media in the same or connecting franchise */
    relations?: ModelTypes["MediaConnection"] | undefined | null;
    /** User reviews of the media */
    reviews?: ModelTypes["ReviewConnection"] | undefined | null;
    /** The season the media was initially released in */
    season?: ModelTypes["MediaSeason"] | undefined | null;
    /** The year & season the media was initially released in */
    seasonInt?: number | undefined | null;
    /** The season year the media was initially released in */
    seasonYear?: number | undefined | null;
    /** The url for the media page on the AniList website */
    siteUrl?: string | undefined | null;
    /** Source type the media was adapted from. */
    source?: ModelTypes["MediaSource"] | undefined | null;
    /** The staff who produced the media */
    staff?: ModelTypes["StaffConnection"] | undefined | null;
    /** The first official release date of the media */
    startDate?: ModelTypes["FuzzyDate"] | undefined | null;
    stats?: ModelTypes["MediaStats"] | undefined | null;
    /** The current releasing status of the media */
    status?: ModelTypes["MediaStatus"] | undefined | null;
    /** Data and links to legal streaming episodes on external sites */
    streamingEpisodes?:
      | Array<ModelTypes["MediaStreamingEpisode"] | undefined | null>
      | undefined
      | null;
    /** The companies who produced the media */
    studios?: ModelTypes["StudioConnection"] | undefined | null;
    /** Alternative titles of the media */
    synonyms?: Array<string | undefined | null> | undefined | null;
    /** List of tags that describes elements and themes of the media */
    tags?: Array<ModelTypes["MediaTag"] | undefined | null> | undefined | null;
    /** The official titles of the media in various languages */
    title?: ModelTypes["MediaTitle"] | undefined | null;
    /** Media trailer or advertisement */
    trailer?: ModelTypes["MediaTrailer"] | undefined | null;
    /** The amount of related activity in the past hour */
    trending?: number | undefined | null;
    /** The media's daily trend stats */
    trends?: ModelTypes["MediaTrendConnection"] | undefined | null;
    /** The type of the media; anime or manga */
    type?: ModelTypes["MediaType"] | undefined | null;
    /** When the media's data was last updated */
    updatedAt?: number | undefined | null;
    /** The amount of volumes the manga has when complete */
    volumes?: number | undefined | null;
  };
  /** Internal - Media characters separated */
  MediaCharacter: {
    /** The characters in the media voiced by the parent actor */
    character?: ModelTypes["Character"] | undefined | null;
    /** Media specific character name */
    characterName?: string | undefined | null;
    dubGroup?: string | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** The characters role in the media */
    role?: ModelTypes["CharacterRole"] | undefined | null;
    roleNotes?: string | undefined | null;
    /** The voice actor of the character */
    voiceActor?: ModelTypes["Staff"] | undefined | null;
  };
  MediaConnection: {
    edges?:
      | Array<ModelTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<ModelTypes["Media"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  MediaCoverImage: {
    /** Average #hex color of cover image */
    color?: string | undefined | null;
    /** The cover image url of the media at its largest size. If this size isn't available, large will be provided instead. */
    extraLarge?: string | undefined | null;
    /** The cover image url of the media at a large size */
    large?: string | undefined | null;
    /** The cover image url of the media at medium size */
    medium?: string | undefined | null;
  };
  /** Notification for when a media entry's data was changed in a significant way impacting users' list tracking */
  MediaDataChangeNotification: {
    /** The reason for the media data change */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The media that received data changes */
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the media that received data changes */
    mediaId: number;
    /** The reason for the media data change */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** Notification for when a media tracked in a user's list is deleted from the site */
  MediaDeletionNotification: {
    /** The reason for the media deletion */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The title of the deleted media */
    deletedMediaTitle?: string | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The reason for the media deletion */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** Media connection edge */
  MediaEdge: {
    /** Media specific character name */
    characterName?: string | undefined | null;
    /** The characters role in the media */
    characterRole?: ModelTypes["CharacterRole"] | undefined | null;
    /** The characters in the media voiced by the parent actor */
    characters?:
      | Array<ModelTypes["Character"] | undefined | null>
      | undefined
      | null;
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: string | undefined | null;
    /** The order the media should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** If the studio is the main animation studio of the media (For Studio->MediaConnection field only) */
    isMainStudio: boolean;
    node?: ModelTypes["Media"] | undefined | null;
    /** The type of relation to the parent model */
    relationType?: ModelTypes["MediaRelation"] | undefined | null;
    /** Notes regarding the VA's role for the character */
    roleNotes?: string | undefined | null;
    /** The role of the staff member in the production of the media */
    staffRole?: string | undefined | null;
    /** The voice actors of the character with role date */
    voiceActorRoles?:
      | Array<ModelTypes["StaffRoleType"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<ModelTypes["Staff"] | undefined | null>
      | undefined
      | null;
  };
  /** An external link to another site related to the media or staff member */
  MediaExternalLink: {
    color?: string | undefined | null;
    /** The icon image url of the site. Not available for all links. Transparent PNG 64x64 */
    icon?: string | undefined | null;
    /** The id of the external link */
    id: number;
    isDisabled?: boolean | undefined | null;
    /** Language the site content is in. See Staff language field for values. */
    language?: string | undefined | null;
    notes?: string | undefined | null;
    /** The links website site name */
    site: string;
    /** The links website site id */
    siteId?: number | undefined | null;
    type?: ModelTypes["ExternalLinkType"] | undefined | null;
    /** The url of the external link or base url of link source */
    url?: string | undefined | null;
  };
  /** List of anime or manga */
  MediaList: {
    /** Map of advanced scores with name keys */
    advancedScores?: ModelTypes["Json"] | undefined | null;
    /** When the entry was completed by the user */
    completedAt?: ModelTypes["FuzzyDate"] | undefined | null;
    /** When the entry data was created */
    createdAt?: number | undefined | null;
    /** Map of booleans for which custom lists the entry are in */
    customLists?: ModelTypes["Json"] | undefined | null;
    /** If the entry shown be hidden from non-custom lists */
    hiddenFromStatusLists?: boolean | undefined | null;
    /** The id of the list entry */
    id: number;
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the media */
    mediaId: number;
    /** Text notes */
    notes?: string | undefined | null;
    /** Priority of planning */
    priority?: number | undefined | null;
    /** If the entry should only be visible to authenticated user */
    private?: boolean | undefined | null;
    /** The amount of episodes/chapters consumed by the user */
    progress?: number | undefined | null;
    /** The amount of volumes read by the user */
    progressVolumes?: number | undefined | null;
    /** The amount of times the user has rewatched/read the media */
    repeat?: number | undefined | null;
    /** The score of the entry */
    score?: number | undefined | null;
    /** When the entry was started by the user */
    startedAt?: ModelTypes["FuzzyDate"] | undefined | null;
    /** The watching/reading status */
    status?: ModelTypes["MediaListStatus"] | undefined | null;
    /** When the entry data was last updated */
    updatedAt?: number | undefined | null;
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user owner of the list entry */
    userId: number;
  };
  /** List of anime or manga */
  MediaListCollection: {
    /** A map of media list entry arrays grouped by custom lists */
    customLists?:
      | Array<
          Array<ModelTypes["MediaList"] | undefined | null> | undefined | null
        >
      | undefined
      | null;
    /** If there is another chunk */
    hasNextChunk?: boolean | undefined | null;
    /** Grouped media list entries */
    lists?:
      | Array<ModelTypes["MediaListGroup"] | undefined | null>
      | undefined
      | null;
    /** A map of media list entry arrays grouped by status */
    statusLists?:
      | Array<
          Array<ModelTypes["MediaList"] | undefined | null> | undefined | null
        >
      | undefined
      | null;
    /** The owner of the list */
    user?: ModelTypes["User"] | undefined | null;
  };
  /** List group of anime or manga entries */
  MediaListGroup: {
    /** Media list entries */
    entries?:
      | Array<ModelTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    isCustomList?: boolean | undefined | null;
    isSplitCompletedList?: boolean | undefined | null;
    name?: string | undefined | null;
    status?: ModelTypes["MediaListStatus"] | undefined | null;
  };
  /** A user's list options */
  MediaListOptions: {
    /** The user's anime list options */
    animeList?: ModelTypes["MediaListTypeOptions"] | undefined | null;
    /** The user's manga list options */
    mangaList?: ModelTypes["MediaListTypeOptions"] | undefined | null;
    /** The default order list rows should be displayed in */
    rowOrder?: string | undefined | null;
    /** The score format the user is using for media lists */
    scoreFormat?: ModelTypes["ScoreFormat"] | undefined | null;
    /** The list theme options for both lists */
    sharedTheme?: ModelTypes["Json"] | undefined | null;
    /** If the shared theme should be used instead of the individual list themes */
    sharedThemeEnabled?: boolean | undefined | null;
    useLegacyLists?: boolean | undefined | null;
  };
  /** A user's list options for anime or manga lists */
  MediaListTypeOptions: {
    /** The names of the user's advanced scoring sections */
    advancedScoring?: Array<string | undefined | null> | undefined | null;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null;
    /** The names of the user's custom lists */
    customLists?: Array<string | undefined | null> | undefined | null;
    /** The order each list should be displayed in */
    sectionOrder?: Array<string | undefined | null> | undefined | null;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | undefined | null;
    /** The list theme options */
    theme?: ModelTypes["Json"] | undefined | null;
  };
  /** Notification for when a media entry is merged into another for a user who had it on their list */
  MediaMergeNotification: {
    /** The reason for the media data change */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The title of the deleted media */
    deletedMediaTitles?: Array<string | undefined | null> | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The media that was merged into */
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the media that was merged into */
    mediaId: number;
    /** The reason for the media merge */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** The ranking of a media in a particular time span and format compared to other media */
  MediaRank: {
    /** If the ranking is based on all time instead of a season/year */
    allTime?: boolean | undefined | null;
    /** String that gives context to the ranking type and time span */
    context: string;
    /** The format the media is ranked within */
    format: ModelTypes["MediaFormat"];
    /** The id of the rank */
    id: number;
    /** The numerical rank of the media */
    rank: number;
    /** The season the media is ranked within */
    season?: ModelTypes["MediaSeason"] | undefined | null;
    /** The type of ranking */
    type: ModelTypes["MediaRankType"];
    /** The year the media is ranked within */
    year?: number | undefined | null;
  };
  /** A media's statistics */
  MediaStats: {
    airingProgression?:
      | Array<ModelTypes["AiringProgression"] | undefined | null>
      | undefined
      | null;
    scoreDistribution?:
      | Array<ModelTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    statusDistribution?:
      | Array<ModelTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
  };
  /** Data and links to legal streaming episodes on external sites */
  MediaStreamingEpisode: {
    /** The site location of the streaming episodes */
    site?: string | undefined | null;
    /** Url of episode image thumbnail */
    thumbnail?: string | undefined | null;
    /** Title of the episode */
    title?: string | undefined | null;
    /** The url of the episode */
    url?: string | undefined | null;
  };
  /** Media submission */
  MediaSubmission: {
    /** Data Mod assigned to handle the submission */
    assignee?: ModelTypes["User"] | undefined | null;
    changes?: Array<string | undefined | null> | undefined | null;
    characters?:
      | Array<ModelTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    createdAt?: number | undefined | null;
    externalLinks?:
      | Array<ModelTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    media?: ModelTypes["Media"] | undefined | null;
    notes?: string | undefined | null;
    relations?:
      | Array<ModelTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    source?: string | undefined | null;
    staff?:
      | Array<ModelTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    /** Status of the submission */
    status?: ModelTypes["SubmissionStatus"] | undefined | null;
    studios?:
      | Array<ModelTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    submission?: ModelTypes["Media"] | undefined | null;
    /** User submitter of the submission */
    submitter?: ModelTypes["User"] | undefined | null;
    submitterStats?: ModelTypes["Json"] | undefined | null;
  };
  /** Media submission with comparison to current data */
  MediaSubmissionComparison: {
    character?: ModelTypes["MediaCharacter"] | undefined | null;
    externalLink?: ModelTypes["MediaExternalLink"] | undefined | null;
    staff?: ModelTypes["StaffEdge"] | undefined | null;
    studio?: ModelTypes["StudioEdge"] | undefined | null;
    submission?: ModelTypes["MediaSubmissionEdge"] | undefined | null;
  };
  MediaSubmissionEdge: {
    character?: ModelTypes["Character"] | undefined | null;
    characterName?: string | undefined | null;
    characterRole?: ModelTypes["CharacterRole"] | undefined | null;
    characterSubmission?: ModelTypes["Character"] | undefined | null;
    dubGroup?: string | undefined | null;
    externalLink?: ModelTypes["MediaExternalLink"] | undefined | null;
    /** The id of the direct submission */
    id?: number | undefined | null;
    isMain?: boolean | undefined | null;
    media?: ModelTypes["Media"] | undefined | null;
    roleNotes?: string | undefined | null;
    staff?: ModelTypes["Staff"] | undefined | null;
    staffRole?: string | undefined | null;
    staffSubmission?: ModelTypes["Staff"] | undefined | null;
    studio?: ModelTypes["Studio"] | undefined | null;
    voiceActor?: ModelTypes["Staff"] | undefined | null;
    voiceActorSubmission?: ModelTypes["Staff"] | undefined | null;
  };
  /** A tag that describes a theme or element of the media */
  MediaTag: {
    /** The categories of tags this tag belongs to */
    category?: string | undefined | null;
    /** A general description of the tag */
    description?: string | undefined | null;
    /** The id of the tag */
    id: number;
    /** If the tag is only for adult 18+ media */
    isAdult?: boolean | undefined | null;
    /** If the tag could be a spoiler for any media */
    isGeneralSpoiler?: boolean | undefined | null;
    /** If the tag is a spoiler for this media */
    isMediaSpoiler?: boolean | undefined | null;
    /** The name of the tag */
    name: string;
    /** The relevance ranking of the tag out of the 100 for this media */
    rank?: number | undefined | null;
    /** The user who submitted the tag */
    userId?: number | undefined | null;
  };
  /** The official titles of the media in various languages */
  MediaTitle: {
    /** The official english title */
    english?: string | undefined | null;
    /** Official title in it's native language */
    native?: string | undefined | null;
    /** The romanization of the native language title */
    romaji?: string | undefined | null;
    /** The currently authenticated users preferred title language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
  };
  /** Media trailer or advertisement */
  MediaTrailer: {
    /** The trailer video id */
    id?: string | undefined | null;
    /** The site the video is hosted by (Currently either youtube or dailymotion) */
    site?: string | undefined | null;
    /** The url for the thumbnail image of the video */
    thumbnail?: string | undefined | null;
  };
  /** Daily media statistics */
  MediaTrend: {
    /** A weighted average score of all the user's scores of the media */
    averageScore?: number | undefined | null;
    /** The day the data was recorded (timestamp) */
    date: number;
    /** The episode number of the anime released on this day */
    episode?: number | undefined | null;
    /** The number of users with watching/reading the media */
    inProgress?: number | undefined | null;
    /** The related media */
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the tag */
    mediaId: number;
    /** The number of users with the media on their list */
    popularity?: number | undefined | null;
    /** If the media was being released at this time */
    releasing: boolean;
    /** The amount of media activity on the day */
    trending: number;
  };
  MediaTrendConnection: {
    edges?:
      | Array<ModelTypes["MediaTrendEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Media trend connection edge */
  MediaTrendEdge: {
    node?: ModelTypes["MediaTrend"] | undefined | null;
  };
  /** User message activity */
  MessageActivity: {
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the message is private and only viewable to the sender and recipients */
    isPrivate?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The message text (Markdown) */
    message?: string | undefined | null;
    /** The user who sent the activity message */
    messenger?: ModelTypes["User"] | undefined | null;
    /** The user id of the activity's sender */
    messengerId?: number | undefined | null;
    /** The user who the activity message was sent to */
    recipient?: ModelTypes["User"] | undefined | null;
    /** The user id of the activity's recipient */
    recipientId?: number | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<ModelTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The type of the activity */
    type?: ModelTypes["ActivityType"] | undefined | null;
  };
  ModAction: {
    createdAt: number;
    data?: string | undefined | null;
    /** The id of the action */
    id: number;
    mod?: ModelTypes["User"] | undefined | null;
    objectId?: number | undefined | null;
    objectType?: string | undefined | null;
    type?: ModelTypes["ModActionType"] | undefined | null;
    user?: ModelTypes["User"] | undefined | null;
  };
  Mutation: {
    /** Delete an activity item of the authenticated users */
    DeleteActivity?: ModelTypes["Deleted"] | undefined | null;
    /** Delete an activity reply of the authenticated users */
    DeleteActivityReply?: ModelTypes["Deleted"] | undefined | null;
    /** Delete a custom list and remove the list entries from it */
    DeleteCustomList?: ModelTypes["Deleted"] | undefined | null;
    /** Delete a media list entry */
    DeleteMediaListEntry?: ModelTypes["Deleted"] | undefined | null;
    /** Delete a review */
    DeleteReview?: ModelTypes["Deleted"] | undefined | null;
    /** Delete a thread */
    DeleteThread?: ModelTypes["Deleted"] | undefined | null;
    /** Delete a thread comment */
    DeleteThreadComment?: ModelTypes["Deleted"] | undefined | null;
    /** Rate a review */
    RateReview?: ModelTypes["Review"] | undefined | null;
    /** Create or update an activity reply */
    SaveActivityReply?: ModelTypes["ActivityReply"] | undefined | null;
    /** Update list activity (Mod Only) */
    SaveListActivity?: ModelTypes["ListActivity"] | undefined | null;
    /** Create or update a media list entry */
    SaveMediaListEntry?: ModelTypes["MediaList"] | undefined | null;
    /** Create or update message activity for the currently authenticated user */
    SaveMessageActivity?: ModelTypes["MessageActivity"] | undefined | null;
    /** Recommendation a media */
    SaveRecommendation?: ModelTypes["Recommendation"] | undefined | null;
    /** Create or update a review */
    SaveReview?: ModelTypes["Review"] | undefined | null;
    /** Create or update text activity for the currently authenticated user */
    SaveTextActivity?: ModelTypes["TextActivity"] | undefined | null;
    /** Create or update a forum thread */
    SaveThread?: ModelTypes["Thread"] | undefined | null;
    /** Create or update a thread comment */
    SaveThreadComment?: ModelTypes["ThreadComment"] | undefined | null;
    /** Toggle activity to be pinned to the top of the user's activity feed */
    ToggleActivityPin?: ModelTypes["ActivityUnion"] | undefined | null;
    /** Toggle the subscription of an activity item */
    ToggleActivitySubscription?: ModelTypes["ActivityUnion"] | undefined | null;
    /** Favourite or unfavourite an anime, manga, character, staff member, or studio */
    ToggleFavourite?: ModelTypes["Favourites"] | undefined | null;
    /** Toggle the un/following of a user */
    ToggleFollow?: ModelTypes["User"] | undefined | null;
    /** Add or remove a like from a likeable type.
Returns all the users who liked the same model */
    ToggleLike?:
      | Array<ModelTypes["User"] | undefined | null>
      | undefined
      | null;
    /** Add or remove a like from a likeable type. */
    ToggleLikeV2?: ModelTypes["LikeableUnion"] | undefined | null;
    /** Toggle the subscription of a forum thread */
    ToggleThreadSubscription?: ModelTypes["Thread"] | undefined | null;
    UpdateAniChartHighlights?: ModelTypes["Json"] | undefined | null;
    UpdateAniChartSettings?: ModelTypes["Json"] | undefined | null;
    /** Update the order favourites are displayed in */
    UpdateFavouriteOrder?: ModelTypes["Favourites"] | undefined | null;
    /** Update multiple media list entries to the same values */
    UpdateMediaListEntries?:
      | Array<ModelTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    UpdateUser?: ModelTypes["User"] | undefined | null;
  };
  /** Notification option */
  NotificationOption: {
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** Page of data */
  Page: {
    activities?:
      | Array<ModelTypes["ActivityUnion"] | undefined | null>
      | undefined
      | null;
    activityReplies?:
      | Array<ModelTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    airingSchedules?:
      | Array<ModelTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    characters?:
      | Array<ModelTypes["Character"] | undefined | null>
      | undefined
      | null;
    followers?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    following?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    media?: Array<ModelTypes["Media"] | undefined | null> | undefined | null;
    mediaList?:
      | Array<ModelTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    mediaTrends?:
      | Array<ModelTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    notifications?:
      | Array<ModelTypes["NotificationUnion"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
    recommendations?:
      | Array<ModelTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    reviews?: Array<ModelTypes["Review"] | undefined | null> | undefined | null;
    staff?: Array<ModelTypes["Staff"] | undefined | null> | undefined | null;
    studios?: Array<ModelTypes["Studio"] | undefined | null> | undefined | null;
    threadComments?:
      | Array<ModelTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    threads?: Array<ModelTypes["Thread"] | undefined | null> | undefined | null;
    users?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
  };
  PageInfo: {
    /** The current page */
    currentPage?: number | undefined | null;
    /** If there is another page */
    hasNextPage?: boolean | undefined | null;
    /** The last page */
    lastPage?: number | undefined | null;
    /** The count on a page */
    perPage?: number | undefined | null;
    /** The total number of items. Note: This value is not guaranteed to be accurate, do not rely on this for logic */
    total?: number | undefined | null;
  };
  /** Provides the parsed markdown as html */
  ParsedMarkdown: {
    /** The parsed markdown as html */
    html?: string | undefined | null;
  };
  Query: {
    /** Activity query */
    Activity?: ModelTypes["ActivityUnion"] | undefined | null;
    /** Activity reply query */
    ActivityReply?: ModelTypes["ActivityReply"] | undefined | null;
    /** Airing schedule query */
    AiringSchedule?: ModelTypes["AiringSchedule"] | undefined | null;
    AniChartUser?: ModelTypes["AniChartUser"] | undefined | null;
    /** Character query */
    Character?: ModelTypes["Character"] | undefined | null;
    /** ExternalLinkSource collection query */
    ExternalLinkSourceCollection?:
      | Array<ModelTypes["MediaExternalLink"] | undefined | null>
      | undefined
      | null;
    /** Follow query */
    Follower?: ModelTypes["User"] | undefined | null;
    /** Follow query */
    Following?: ModelTypes["User"] | undefined | null;
    /** Collection of all the possible media genres */
    GenreCollection?: Array<string | undefined | null> | undefined | null;
    /** Like query */
    Like?: ModelTypes["User"] | undefined | null;
    /** Provide AniList markdown to be converted to html (Requires auth) */
    Markdown?: ModelTypes["ParsedMarkdown"] | undefined | null;
    /** Media query */
    Media?: ModelTypes["Media"] | undefined | null;
    /** Media list query */
    MediaList?: ModelTypes["MediaList"] | undefined | null;
    /** Media list collection query, provides list pre-grouped by status & custom lists. User ID and Media Type arguments required. */
    MediaListCollection?: ModelTypes["MediaListCollection"] | undefined | null;
    /** Collection of all the possible media tags */
    MediaTagCollection?:
      | Array<ModelTypes["MediaTag"] | undefined | null>
      | undefined
      | null;
    /** Media Trend query */
    MediaTrend?: ModelTypes["MediaTrend"] | undefined | null;
    /** Notification query */
    Notification?: ModelTypes["NotificationUnion"] | undefined | null;
    Page?: ModelTypes["Page"] | undefined | null;
    /** Recommendation query */
    Recommendation?: ModelTypes["Recommendation"] | undefined | null;
    /** Review query */
    Review?: ModelTypes["Review"] | undefined | null;
    /** Site statistics query */
    SiteStatistics?: ModelTypes["SiteStatistics"] | undefined | null;
    /** Staff query */
    Staff?: ModelTypes["Staff"] | undefined | null;
    /** Studio query */
    Studio?: ModelTypes["Studio"] | undefined | null;
    /** Thread query */
    Thread?: ModelTypes["Thread"] | undefined | null;
    /** Comment query */
    ThreadComment?:
      | Array<ModelTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    /** User query */
    User?: ModelTypes["User"] | undefined | null;
    /** Get the currently authenticated user */
    Viewer?: ModelTypes["User"] | undefined | null;
  };
  /** Media recommendation */
  Recommendation: {
    /** The id of the recommendation */
    id: number;
    /** The media the recommendation is from */
    media?: ModelTypes["Media"] | undefined | null;
    /** The recommended media */
    mediaRecommendation?: ModelTypes["Media"] | undefined | null;
    /** Users rating of the recommendation */
    rating?: number | undefined | null;
    /** The user that first created the recommendation */
    user?: ModelTypes["User"] | undefined | null;
    /** The rating of the recommendation by currently authenticated user */
    userRating?: ModelTypes["RecommendationRating"] | undefined | null;
  };
  RecommendationConnection: {
    edges?:
      | Array<ModelTypes["RecommendationEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Recommendation connection edge */
  RecommendationEdge: {
    node?: ModelTypes["Recommendation"] | undefined | null;
  };
  /** Notification for when new media is added to the site */
  RelatedMediaAdditionNotification: {
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The associated media of the airing schedule */
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the new media */
    mediaId: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  Report: {
    cleared?: boolean | undefined | null;
    /** When the entry data was created */
    createdAt?: number | undefined | null;
    id: number;
    reason?: string | undefined | null;
    reported?: ModelTypes["User"] | undefined | null;
    reporter?: ModelTypes["User"] | undefined | null;
  };
  /** A Review that features in an anime or manga */
  Review: {
    /** The main review body text */
    body?: string | undefined | null;
    /** The time of the thread creation */
    createdAt: number;
    /** The id of the review */
    id: number;
    /** The media the review is of */
    media?: ModelTypes["Media"] | undefined | null;
    /** The id of the review's media */
    mediaId: number;
    /** For which type of media the review is for */
    mediaType?: ModelTypes["MediaType"] | undefined | null;
    /** If the review is not yet publicly published and is only viewable by creator */
    private?: boolean | undefined | null;
    /** The total user rating of the review */
    rating?: number | undefined | null;
    /** The amount of user ratings of the review */
    ratingAmount?: number | undefined | null;
    /** The review score of the media */
    score?: number | undefined | null;
    /** The url for the review page on the AniList website */
    siteUrl?: string | undefined | null;
    /** A short summary of the review */
    summary?: string | undefined | null;
    /** The time of the thread last update */
    updatedAt: number;
    /** The creator of the review */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the review's creator */
    userId: number;
    /** The rating of the review by currently authenticated user */
    userRating?: ModelTypes["ReviewRating"] | undefined | null;
  };
  ReviewConnection: {
    edges?:
      | Array<ModelTypes["ReviewEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<ModelTypes["Review"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Review connection edge */
  ReviewEdge: {
    node?: ModelTypes["Review"] | undefined | null;
  };
  /** Feed of mod edit activity */
  RevisionHistory: {
    /** The action taken on the objects */
    action?: ModelTypes["RevisionHistoryAction"] | undefined | null;
    /** A JSON object of the fields that changed */
    changes?: ModelTypes["Json"] | undefined | null;
    /** The character the mod feed entry references */
    character?: ModelTypes["Character"] | undefined | null;
    /** When the mod feed entry was created */
    createdAt?: number | undefined | null;
    /** The external link source the mod feed entry references */
    externalLink?: ModelTypes["MediaExternalLink"] | undefined | null;
    /** The id of the media */
    id: number;
    /** The media the mod feed entry references */
    media?: ModelTypes["Media"] | undefined | null;
    /** The staff member the mod feed entry references */
    staff?: ModelTypes["Staff"] | undefined | null;
    /** The studio the mod feed entry references */
    studio?: ModelTypes["Studio"] | undefined | null;
    /** The user who made the edit to the object */
    user?: ModelTypes["User"] | undefined | null;
  };
  /** A user's list score distribution. */
  ScoreDistribution: {
    /** The amount of list entries with this score */
    amount?: number | undefined | null;
    score?: number | undefined | null;
  };
  SiteStatistics: {
    anime?: ModelTypes["SiteTrendConnection"] | undefined | null;
    characters?: ModelTypes["SiteTrendConnection"] | undefined | null;
    manga?: ModelTypes["SiteTrendConnection"] | undefined | null;
    reviews?: ModelTypes["SiteTrendConnection"] | undefined | null;
    staff?: ModelTypes["SiteTrendConnection"] | undefined | null;
    studios?: ModelTypes["SiteTrendConnection"] | undefined | null;
    users?: ModelTypes["SiteTrendConnection"] | undefined | null;
  };
  /** Daily site statistics */
  SiteTrend: {
    /** The change from yesterday */
    change: number;
    count: number;
    /** The day the data was recorded (timestamp) */
    date: number;
  };
  SiteTrendConnection: {
    edges?:
      | Array<ModelTypes["SiteTrendEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<ModelTypes["SiteTrend"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Site trend connection edge */
  SiteTrendEdge: {
    node?: ModelTypes["SiteTrend"] | undefined | null;
  };
  /** Voice actors or production staff */
  Staff: {
    /** The person's age in years */
    age?: number | undefined | null;
    /** The persons blood type */
    bloodType?: string | undefined | null;
    /** Media the actor voiced characters in. (Same data as characters with media as node instead of characters) */
    characterMedia?: ModelTypes["MediaConnection"] | undefined | null;
    /** Characters voiced by the actor */
    characters?: ModelTypes["CharacterConnection"] | undefined | null;
    dateOfBirth?: ModelTypes["FuzzyDate"] | undefined | null;
    dateOfDeath?: ModelTypes["FuzzyDate"] | undefined | null;
    /** A general description of the staff member */
    description?: string | undefined | null;
    /** The amount of user's who have favourited the staff member */
    favourites?: number | undefined | null;
    /** The staff's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: string | undefined | null;
    /** The persons birthplace or hometown */
    homeTown?: string | undefined | null;
    /** The id of the staff member */
    id: number;
    /** The staff images */
    image?: ModelTypes["StaffImage"] | undefined | null;
    /** If the staff member is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** If the staff member is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** The primary language the staff member dub's in */
    language?: ModelTypes["StaffLanguage"] | undefined | null;
    /** The primary language of the staff member. Current values: Japanese, English, Korean, Italian, Spanish, Portuguese, French, German, Hebrew, Hungarian, Chinese, Arabic, Filipino, Catalan, Finnish, Turkish, Dutch, Swedish, Thai, Tagalog, Malaysian, Indonesian, Vietnamese, Nepali, Hindi, Urdu */
    languageV2?: string | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The names of the staff member */
    name?: ModelTypes["StaffName"] | undefined | null;
    /** The person's primary occupations */
    primaryOccupations?: Array<string | undefined | null> | undefined | null;
    /** The url for the staff page on the AniList website */
    siteUrl?: string | undefined | null;
    /** Staff member that the submission is referencing */
    staff?: ModelTypes["Staff"] | undefined | null;
    /** Media where the staff member has a production role */
    staffMedia?: ModelTypes["MediaConnection"] | undefined | null;
    /** Inner details of submission status */
    submissionNotes?: string | undefined | null;
    /** Status of the submission */
    submissionStatus?: number | undefined | null;
    /** Submitter for the submission */
    submitter?: ModelTypes["User"] | undefined | null;
    updatedAt?: number | undefined | null;
    /** [startYear, endYear] (If the 2nd value is not present staff is still active) */
    yearsActive?: Array<number | undefined | null> | undefined | null;
  };
  StaffConnection: {
    edges?:
      | Array<ModelTypes["StaffEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<ModelTypes["Staff"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Staff connection edge */
  StaffEdge: {
    /** The order the staff should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    node?: ModelTypes["Staff"] | undefined | null;
    /** The role of the staff member in the production of the media */
    role?: string | undefined | null;
  };
  StaffImage: {
    /** The person's image of media at its largest size */
    large?: string | undefined | null;
    /** The person's image of media at medium size */
    medium?: string | undefined | null;
  };
  /** The names of the staff member */
  StaffName: {
    /** Other names the staff member might be referred to as (pen names) */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** The person's given name */
    first?: string | undefined | null;
    /** The person's first and last name */
    full?: string | undefined | null;
    /** The person's surname */
    last?: string | undefined | null;
    /** The person's middle name */
    middle?: string | undefined | null;
    /** The person's full name in their native language */
    native?: string | undefined | null;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
  };
  /** Voice actor role for a character */
  StaffRoleType: {
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: string | undefined | null;
    /** Notes regarding the VA's role for the character */
    roleNotes?: string | undefined | null;
    /** The voice actors of the character */
    voiceActor?: ModelTypes["Staff"] | undefined | null;
  };
  /** User's staff statistics */
  StaffStats: {
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    staff?: ModelTypes["Staff"] | undefined | null;
    /** The amount of time in minutes the staff member has been watched by the user */
    timeWatched?: number | undefined | null;
  };
  /** A submission for a staff that features in an anime or manga */
  StaffSubmission: {
    /** Data Mod assigned to handle the submission */
    assignee?: ModelTypes["User"] | undefined | null;
    createdAt?: number | undefined | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    /** Inner details of submission status */
    notes?: string | undefined | null;
    source?: string | undefined | null;
    /** Staff that the submission is referencing */
    staff?: ModelTypes["Staff"] | undefined | null;
    /** Status of the submission */
    status?: ModelTypes["SubmissionStatus"] | undefined | null;
    /** The staff submission changes */
    submission?: ModelTypes["Staff"] | undefined | null;
    /** Submitter for the submission */
    submitter?: ModelTypes["User"] | undefined | null;
  };
  /** The distribution of the watching/reading status of media or a user's list */
  StatusDistribution: {
    /** The amount of entries with this status */
    amount?: number | undefined | null;
    /** The day the activity took place (Unix timestamp) */
    status?: ModelTypes["MediaListStatus"] | undefined | null;
  };
  /** Animation or production company */
  Studio: {
    /** The amount of user's who have favourited the studio */
    favourites?: number | undefined | null;
    /** The id of the studio */
    id: number;
    /** If the studio is an animation studio or a different kind of company */
    isAnimationStudio: boolean;
    /** If the studio is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** The media the studio has worked on */
    media?: ModelTypes["MediaConnection"] | undefined | null;
    /** The name of the studio */
    name: string;
    /** The url for the studio page on the AniList website */
    siteUrl?: string | undefined | null;
  };
  StudioConnection: {
    edges?:
      | Array<ModelTypes["StudioEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<ModelTypes["Studio"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: ModelTypes["PageInfo"] | undefined | null;
  };
  /** Studio connection edge */
  StudioEdge: {
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** If the studio is the main animation studio of the anime */
    isMain: boolean;
    node?: ModelTypes["Studio"] | undefined | null;
  };
  /** User's studio statistics */
  StudioStats: {
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    studio?: ModelTypes["Studio"] | undefined | null;
    /** The amount of time in minutes the studio's works have been watched by the user */
    timeWatched?: number | undefined | null;
  };
  /** User's tag statistics */
  TagStats: {
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    tag?: ModelTypes["MediaTag"] | undefined | null;
    /** The amount of time in minutes the tag has been watched by the user */
    timeWatched?: number | undefined | null;
  };
  /** User text activity */
  TextActivity: {
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<ModelTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The status text (Markdown) */
    text?: string | undefined | null;
    /** The type of activity */
    type?: ModelTypes["ActivityType"] | undefined | null;
    /** The user who created the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The user id of the activity's creator */
    userId?: number | undefined | null;
  };
  /** Forum Thread */
  Thread: {
    /** The text body of the thread (Markdown) */
    body?: string | undefined | null;
    /** The categories of the thread */
    categories?:
      | Array<ModelTypes["ThreadCategory"] | undefined | null>
      | undefined
      | null;
    /** The time of the thread creation */
    createdAt: number;
    /** The id of the thread */
    id: number;
    /** If the currently authenticated user liked the thread */
    isLiked?: boolean | undefined | null;
    /** If the thread is locked and can receive comments */
    isLocked?: boolean | undefined | null;
    /** If the thread is stickied and should be displayed at the top of the page */
    isSticky?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the thread */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the thread has */
    likeCount: number;
    /** The users who liked the thread */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The media categories of the thread */
    mediaCategories?:
      | Array<ModelTypes["Media"] | undefined | null>
      | undefined
      | null;
    /** The time of the last reply */
    repliedAt?: number | undefined | null;
    /** The id of the most recent comment on the thread */
    replyCommentId?: number | undefined | null;
    /** The number of comments on the thread */
    replyCount?: number | undefined | null;
    /** The user to last reply to the thread */
    replyUser?: ModelTypes["User"] | undefined | null;
    /** The id of the user who most recently commented on the thread */
    replyUserId?: number | undefined | null;
    /** The url for the thread page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The title of the thread */
    title?: string | undefined | null;
    /** The time of the thread last update */
    updatedAt: number;
    /** The owner of the thread */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the thread owner user */
    userId: number;
    /** The number of times users have viewed the thread */
    viewCount?: number | undefined | null;
  };
  /** A forum thread category */
  ThreadCategory: {
    /** The id of the category */
    id: number;
    /** The name of the category */
    name: string;
  };
  /** Forum Thread Comment */
  ThreadComment: {
    /** The comment's child reply comments */
    childComments?: ModelTypes["Json"] | undefined | null;
    /** The text content of the comment (Markdown) */
    comment?: string | undefined | null;
    /** The time of the comments creation */
    createdAt: number;
    /** The id of the comment */
    id: number;
    /** If the currently authenticated user liked the comment */
    isLiked?: boolean | undefined | null;
    /** If the comment tree is locked and may not receive replies or edits */
    isLocked?: boolean | undefined | null;
    /** The amount of likes the comment has */
    likeCount: number;
    /** The users who liked the comment */
    likes?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    /** The url for the comment page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The thread the comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The id of thread the comment belongs to */
    threadId?: number | undefined | null;
    /** The time of the comments last update */
    updatedAt: number;
    /** The user who created the comment */
    user?: ModelTypes["User"] | undefined | null;
    /** The user id of the comment's owner */
    userId?: number | undefined | null;
  };
  /** Notification for when a thread comment is liked */
  ThreadCommentLikeNotification: {
    /** The thread comment that was liked */
    comment?: ModelTypes["ThreadComment"] | undefined | null;
    /** The id of the activity which was liked */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
  };
  /** Notification for when authenticated user is @ mentioned in a forum thread comment */
  ThreadCommentMentionNotification: {
    /** The thread comment that included the @ mention */
    comment?: ModelTypes["ThreadComment"] | undefined | null;
    /** The id of the comment where mentioned */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who mentioned the authenticated user */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who mentioned the authenticated user */
    userId: number;
  };
  /** Notification for when a user replies to your forum thread comment */
  ThreadCommentReplyNotification: {
    /** The reply thread comment */
    comment?: ModelTypes["ThreadComment"] | undefined | null;
    /** The id of the reply comment */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who create the comment reply */
    userId: number;
  };
  /** Notification for when a user replies to a subscribed forum thread */
  ThreadCommentSubscribedNotification: {
    /** The reply thread comment */
    comment?: ModelTypes["ThreadComment"] | undefined | null;
    /** The id of the new comment in the subscribed thread */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who replied to the subscribed thread */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who commented on the thread */
    userId: number;
  };
  /** Notification for when a thread is liked */
  ThreadLikeNotification: {
    /** The liked thread comment */
    comment?: ModelTypes["ThreadComment"] | undefined | null;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: ModelTypes["Thread"] | undefined | null;
    /** The id of the thread which was liked */
    threadId: number;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: ModelTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
  };
  /** A user */
  User: {
    /** The bio written by user (Markdown) */
    about?: string | undefined | null;
    /** The user's avatar images */
    avatar?: ModelTypes["UserAvatar"] | undefined | null;
    /** The user's banner images */
    bannerImage?: string | undefined | null;
    bans?: ModelTypes["Json"] | undefined | null;
    /** When the user's account was created. (Does not exist for accounts created before 2020) */
    createdAt?: number | undefined | null;
    /** Custom donation badge text */
    donatorBadge?: string | undefined | null;
    /** The donation tier of the user */
    donatorTier?: number | undefined | null;
    /** The users favourites */
    favourites?: ModelTypes["Favourites"] | undefined | null;
    /** The id of the user */
    id: number;
    /** If the user is blocked by the authenticated user */
    isBlocked?: boolean | undefined | null;
    /** If this user if following the authenticated user */
    isFollower?: boolean | undefined | null;
    /** If the authenticated user if following this user */
    isFollowing?: boolean | undefined | null;
    /** The user's media list options */
    mediaListOptions?: ModelTypes["MediaListOptions"] | undefined | null;
    /** The user's moderator roles if they are a site moderator */
    moderatorRoles?:
      | Array<ModelTypes["ModRole"] | undefined | null>
      | undefined
      | null;
    /** If the user is a moderator or data moderator */
    moderatorStatus?: string | undefined | null;
    /** The name of the user */
    name: string;
    /** The user's general options */
    options?: ModelTypes["UserOptions"] | undefined | null;
    /** The user's previously used names. */
    previousNames?:
      | Array<ModelTypes["UserPreviousName"] | undefined | null>
      | undefined
      | null;
    /** The url for the user page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The users anime & manga list statistics */
    statistics?: ModelTypes["UserStatisticTypes"] | undefined | null;
    /** The user's statistics */
    stats?: ModelTypes["UserStats"] | undefined | null;
    /** The number of unread notifications the user has */
    unreadNotificationCount?: number | undefined | null;
    /** When the user's data was last updated */
    updatedAt?: number | undefined | null;
  };
  /** A user's activity history stats. */
  UserActivityHistory: {
    /** The amount of activity on the day */
    amount?: number | undefined | null;
    /** The day the activity took place (Unix timestamp) */
    date?: number | undefined | null;
    /** The level of activity represented on a 1-10 scale */
    level?: number | undefined | null;
  };
  /** A user's avatars */
  UserAvatar: {
    /** The avatar of user at its largest size */
    large?: string | undefined | null;
    /** The avatar of user at medium size */
    medium?: string | undefined | null;
  };
  UserCountryStatistic: {
    chaptersRead: number;
    count: number;
    country?: ModelTypes["CountryCode"] | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
  };
  UserFormatStatistic: {
    chaptersRead: number;
    count: number;
    format?: ModelTypes["MediaFormat"] | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
  };
  UserGenreStatistic: {
    chaptersRead: number;
    count: number;
    genre?: string | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
  };
  UserLengthStatistic: {
    chaptersRead: number;
    count: number;
    length?: string | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
  };
  /** User data for moderators */
  UserModData: {
    alts?: Array<ModelTypes["User"] | undefined | null> | undefined | null;
    bans?: ModelTypes["Json"] | undefined | null;
    counts?: ModelTypes["Json"] | undefined | null;
    email?: string | undefined | null;
    ip?: ModelTypes["Json"] | undefined | null;
    privacy?: number | undefined | null;
  };
  /** A user's general options */
  UserOptions: {
    /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */
    activityMergeTime?: number | undefined | null;
    /** Whether the user receives notifications when a show they are watching aires */
    airingNotifications?: boolean | undefined | null;
    /** The list activity types the user has disabled from being created from list updates */
    disabledListActivity?:
      | Array<ModelTypes["ListActivityOption"] | undefined | null>
      | undefined
      | null;
    /** Whether the user has enabled viewing of 18+ content */
    displayAdultContent?: boolean | undefined | null;
    /** Notification options */
    notificationOptions?:
      | Array<ModelTypes["NotificationOption"] | undefined | null>
      | undefined
      | null;
    /** Profile highlight color (blue, purple, pink, orange, red, green, gray) */
    profileColor?: string | undefined | null;
    /** Whether the user only allow messages from users they follow */
    restrictMessagesToFollowing?: boolean | undefined | null;
    /** The language the user wants to see staff and character names in */
    staffNameLanguage?: ModelTypes["UserStaffNameLanguage"] | undefined | null;
    /** The user's timezone offset (Auth user only) */
    timezone?: string | undefined | null;
    /** The language the user wants to see media titles in */
    titleLanguage?: ModelTypes["UserTitleLanguage"] | undefined | null;
  };
  /** A user's previous name */
  UserPreviousName: {
    /** When the user first changed from this name. */
    createdAt?: number | undefined | null;
    /** A previous name of the user. */
    name?: string | undefined | null;
    /** When the user most recently changed from this name. */
    updatedAt?: number | undefined | null;
  };
  UserReleaseYearStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    releaseYear?: number | undefined | null;
  };
  UserScoreStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    score?: number | undefined | null;
  };
  UserStaffStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    staff?: ModelTypes["Staff"] | undefined | null;
  };
  UserStartYearStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    startYear?: number | undefined | null;
  };
  UserStatisticTypes: {
    anime?: ModelTypes["UserStatistics"] | undefined | null;
    manga?: ModelTypes["UserStatistics"] | undefined | null;
  };
  UserStatistics: {
    chaptersRead: number;
    count: number;
    countries?:
      | Array<ModelTypes["UserCountryStatistic"] | undefined | null>
      | undefined
      | null;
    episodesWatched: number;
    formats?:
      | Array<ModelTypes["UserFormatStatistic"] | undefined | null>
      | undefined
      | null;
    genres?:
      | Array<ModelTypes["UserGenreStatistic"] | undefined | null>
      | undefined
      | null;
    lengths?:
      | Array<ModelTypes["UserLengthStatistic"] | undefined | null>
      | undefined
      | null;
    meanScore: number;
    minutesWatched: number;
    releaseYears?:
      | Array<ModelTypes["UserReleaseYearStatistic"] | undefined | null>
      | undefined
      | null;
    scores?:
      | Array<ModelTypes["UserScoreStatistic"] | undefined | null>
      | undefined
      | null;
    staff?:
      | Array<ModelTypes["UserStaffStatistic"] | undefined | null>
      | undefined
      | null;
    standardDeviation: number;
    startYears?:
      | Array<ModelTypes["UserStartYearStatistic"] | undefined | null>
      | undefined
      | null;
    statuses?:
      | Array<ModelTypes["UserStatusStatistic"] | undefined | null>
      | undefined
      | null;
    studios?:
      | Array<ModelTypes["UserStudioStatistic"] | undefined | null>
      | undefined
      | null;
    tags?:
      | Array<ModelTypes["UserTagStatistic"] | undefined | null>
      | undefined
      | null;
    voiceActors?:
      | Array<ModelTypes["UserVoiceActorStatistic"] | undefined | null>
      | undefined
      | null;
    volumesRead: number;
  };
  /** A user's statistics */
  UserStats: {
    activityHistory?:
      | Array<ModelTypes["UserActivityHistory"] | undefined | null>
      | undefined
      | null;
    animeListScores?: ModelTypes["ListScoreStats"] | undefined | null;
    animeScoreDistribution?:
      | Array<ModelTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    animeStatusDistribution?:
      | Array<ModelTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
    /** The amount of manga chapters the user has read */
    chaptersRead?: number | undefined | null;
    favouredActors?:
      | Array<ModelTypes["StaffStats"] | undefined | null>
      | undefined
      | null;
    favouredFormats?:
      | Array<ModelTypes["FormatStats"] | undefined | null>
      | undefined
      | null;
    favouredGenres?:
      | Array<ModelTypes["GenreStats"] | undefined | null>
      | undefined
      | null;
    favouredGenresOverview?:
      | Array<ModelTypes["GenreStats"] | undefined | null>
      | undefined
      | null;
    favouredStaff?:
      | Array<ModelTypes["StaffStats"] | undefined | null>
      | undefined
      | null;
    favouredStudios?:
      | Array<ModelTypes["StudioStats"] | undefined | null>
      | undefined
      | null;
    favouredTags?:
      | Array<ModelTypes["TagStats"] | undefined | null>
      | undefined
      | null;
    favouredYears?:
      | Array<ModelTypes["YearStats"] | undefined | null>
      | undefined
      | null;
    mangaListScores?: ModelTypes["ListScoreStats"] | undefined | null;
    mangaScoreDistribution?:
      | Array<ModelTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    mangaStatusDistribution?:
      | Array<ModelTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
    /** The amount of anime the user has watched in minutes */
    watchedTime?: number | undefined | null;
  };
  UserStatusStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    status?: ModelTypes["MediaListStatus"] | undefined | null;
  };
  UserStudioStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    studio?: ModelTypes["Studio"] | undefined | null;
  };
  UserTagStatistic: {
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    tag?: ModelTypes["MediaTag"] | undefined | null;
  };
  UserVoiceActorStatistic: {
    chaptersRead: number;
    characterIds: Array<number | undefined | null>;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    voiceActor?: ModelTypes["Staff"] | undefined | null;
  };
  /** User's year statistics */
  YearStats: {
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    year?: number | undefined | null;
  };
  ActivitySort: ActivitySort;
  ActivityType: ActivityType;
  AiringSort: AiringSort;
  CharacterRole: CharacterRole;
  CharacterSort: CharacterSort;
  ExternalLinkMediaType: ExternalLinkMediaType;
  ExternalLinkType: ExternalLinkType;
  LikeableType: LikeableType;
  MediaFormat: MediaFormat;
  MediaListSort: MediaListSort;
  MediaListStatus: MediaListStatus;
  MediaRankType: MediaRankType;
  MediaRelation: MediaRelation;
  MediaSeason: MediaSeason;
  MediaSort: MediaSort;
  MediaSource: MediaSource;
  MediaStatus: MediaStatus;
  MediaTrendSort: MediaTrendSort;
  MediaType: MediaType;
  ModActionType: ModActionType;
  ModRole: ModRole;
  NotificationType: NotificationType;
  RecommendationRating: RecommendationRating;
  RecommendationSort: RecommendationSort;
  ReviewRating: ReviewRating;
  ReviewSort: ReviewSort;
  RevisionHistoryAction: RevisionHistoryAction;
  ScoreFormat: ScoreFormat;
  SiteTrendSort: SiteTrendSort;
  StaffLanguage: StaffLanguage;
  StaffSort: StaffSort;
  StudioSort: StudioSort;
  SubmissionSort: SubmissionSort;
  SubmissionStatus: SubmissionStatus;
  ThreadCommentSort: ThreadCommentSort;
  ThreadSort: ThreadSort;
  UserSort: UserSort;
  UserStaffNameLanguage: UserStaffNameLanguage;
  UserStatisticsSort: UserStatisticsSort;
  UserTitleLanguage: UserTitleLanguage;
  /** ISO 3166-1 alpha-2 country code */
  CountryCode: any;
  /** 8 digit long date integer (YYYYMMDD). Unknown dates represented by 0. E.g. 2016: 20160000, May 1976: 19760500 */
  FuzzyDateInt: any;
  Json: any;
  AiringScheduleInput: {
    airingAt?: number | undefined | null;
    episode?: number | undefined | null;
    timeUntilAiring?: number | undefined | null;
  };
  AniChartHighlightInput: {
    highlight?: string | undefined | null;
    mediaId?: number | undefined | null;
  };
  /** The names of the character */
  CharacterNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: Array<string | undefined | null> | undefined | null;
    /** The character's given name */
    first?: string | undefined | null;
    /** The character's surname */
    last?: string | undefined | null;
    /** The character's middle name */
    middle?: string | undefined | null;
    /** The character's full name in their native language */
    native?: string | undefined | null;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDateInput: {
    /** Numeric Day (24) */
    day?: number | undefined | null;
    /** Numeric Month (3) */
    month?: number | undefined | null;
    /** Numeric Year (2017) */
    year?: number | undefined | null;
  };
  ListActivityOptionInput: {
    disabled?: boolean | undefined | null;
    type?: ModelTypes["MediaListStatus"] | undefined | null;
  };
  /** An external link to another site related to the media */
  MediaExternalLinkInput: {
    /** The id of the external link */
    id: number;
    /** The site location of the external link */
    site: string;
    /** The url of the external link */
    url: string;
  };
  /** A user's list options for anime or manga lists */
  MediaListOptionsInput: {
    /** The names of the user's advanced scoring sections */
    advancedScoring?: Array<string | undefined | null> | undefined | null;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null;
    /** The names of the user's custom lists */
    customLists?: Array<string | undefined | null> | undefined | null;
    /** The order each list should be displayed in */
    sectionOrder?: Array<string | undefined | null> | undefined | null;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | undefined | null;
    /** list theme */
    theme?: string | undefined | null;
  };
  /** The official titles of the media in various languages */
  MediaTitleInput: {
    /** The official english title */
    english?: string | undefined | null;
    /** Official title in it's native language */
    native?: string | undefined | null;
    /** The romanization of the native language title */
    romaji?: string | undefined | null;
  };
  /** Notification option input */
  NotificationOptionInput: {
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null;
    /** The type of notification */
    type?: ModelTypes["NotificationType"] | undefined | null;
  };
  /** The names of the staff member */
  StaffNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** The person's given name */
    first?: string | undefined | null;
    /** The person's surname */
    last?: string | undefined | null;
    /** The person's middle name */
    middle?: string | undefined | null;
    /** The person's full name in their native language */
    native?: string | undefined | null;
  };
  ID: any;
};

export type GraphQLTypes = {
  // This file was generated. Do not edit manually.;
  /** Activity union type */
  ActivityUnion: {
    __typename: "ListActivity" | "MessageActivity" | "TextActivity";
    "...on ListActivity": "__union" & GraphQLTypes["ListActivity"];
    "...on MessageActivity": "__union" & GraphQLTypes["MessageActivity"];
    "...on TextActivity": "__union" & GraphQLTypes["TextActivity"];
  };
  /** Likeable union type */
  LikeableUnion: {
    __typename:
      | "ActivityReply"
      | "ListActivity"
      | "MessageActivity"
      | "TextActivity"
      | "Thread"
      | "ThreadComment";
    "...on ActivityReply": "__union" & GraphQLTypes["ActivityReply"];
    "...on ListActivity": "__union" & GraphQLTypes["ListActivity"];
    "...on MessageActivity": "__union" & GraphQLTypes["MessageActivity"];
    "...on TextActivity": "__union" & GraphQLTypes["TextActivity"];
    "...on Thread": "__union" & GraphQLTypes["Thread"];
    "...on ThreadComment": "__union" & GraphQLTypes["ThreadComment"];
  };
  /** Notification union type */
  NotificationUnion: {
    __typename:
      | "ActivityLikeNotification"
      | "ActivityMentionNotification"
      | "ActivityMessageNotification"
      | "ActivityReplyLikeNotification"
      | "ActivityReplyNotification"
      | "ActivityReplySubscribedNotification"
      | "AiringNotification"
      | "FollowingNotification"
      | "MediaDataChangeNotification"
      | "MediaDeletionNotification"
      | "MediaMergeNotification"
      | "RelatedMediaAdditionNotification"
      | "ThreadCommentLikeNotification"
      | "ThreadCommentMentionNotification"
      | "ThreadCommentReplyNotification"
      | "ThreadCommentSubscribedNotification"
      | "ThreadLikeNotification";
    "...on ActivityLikeNotification": "__union" &
      GraphQLTypes["ActivityLikeNotification"];
    "...on ActivityMentionNotification": "__union" &
      GraphQLTypes["ActivityMentionNotification"];
    "...on ActivityMessageNotification": "__union" &
      GraphQLTypes["ActivityMessageNotification"];
    "...on ActivityReplyLikeNotification": "__union" &
      GraphQLTypes["ActivityReplyLikeNotification"];
    "...on ActivityReplyNotification": "__union" &
      GraphQLTypes["ActivityReplyNotification"];
    "...on ActivityReplySubscribedNotification": "__union" &
      GraphQLTypes["ActivityReplySubscribedNotification"];
    "...on AiringNotification": "__union" & GraphQLTypes["AiringNotification"];
    "...on FollowingNotification": "__union" &
      GraphQLTypes["FollowingNotification"];
    "...on MediaDataChangeNotification": "__union" &
      GraphQLTypes["MediaDataChangeNotification"];
    "...on MediaDeletionNotification": "__union" &
      GraphQLTypes["MediaDeletionNotification"];
    "...on MediaMergeNotification": "__union" &
      GraphQLTypes["MediaMergeNotification"];
    "...on RelatedMediaAdditionNotification": "__union" &
      GraphQLTypes["RelatedMediaAdditionNotification"];
    "...on ThreadCommentLikeNotification": "__union" &
      GraphQLTypes["ThreadCommentLikeNotification"];
    "...on ThreadCommentMentionNotification": "__union" &
      GraphQLTypes["ThreadCommentMentionNotification"];
    "...on ThreadCommentReplyNotification": "__union" &
      GraphQLTypes["ThreadCommentReplyNotification"];
    "...on ThreadCommentSubscribedNotification": "__union" &
      GraphQLTypes["ThreadCommentSubscribedNotification"];
    "...on ThreadLikeNotification": "__union" &
      GraphQLTypes["ThreadLikeNotification"];
  };
  /** Notification for when a activity is liked */
  ActivityLikeNotification: {
    __typename: "ActivityLikeNotification";
    /** The liked activity */
    activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was liked */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
    "...on ActivityLikeNotification": Omit<
      GraphQLTypes["ActivityLikeNotification"],
      "...on ActivityLikeNotification"
    >;
  };
  /** Notification for when authenticated user is @ mentioned in activity or reply */
  ActivityMentionNotification: {
    __typename: "ActivityMentionNotification";
    /** The liked activity */
    activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity where mentioned */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who mentioned the authenticated user */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who mentioned the authenticated user */
    userId: number;
    "...on ActivityMentionNotification": Omit<
      GraphQLTypes["ActivityMentionNotification"],
      "...on ActivityMentionNotification"
    >;
  };
  /** Notification for when a user is send an activity message */
  ActivityMessageNotification: {
    __typename: "ActivityMessageNotification";
    /** The id of the activity message */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The message activity */
    message?: GraphQLTypes["MessageActivity"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who sent the message */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The if of the user who send the message */
    userId: number;
    "...on ActivityMessageNotification": Omit<
      GraphQLTypes["ActivityMessageNotification"],
      "...on ActivityMessageNotification"
    >;
  };
  /** Replay to an activity item */
  ActivityReply: {
    __typename: "ActivityReply";
    /** The id of the parent activity */
    activityId?: number | undefined | null;
    /** The time the reply was created at */
    createdAt: number;
    /** The id of the reply */
    id: number;
    /** If the currently authenticated user liked the reply */
    isLiked?: boolean | undefined | null;
    /** The amount of likes the reply has */
    likeCount: number;
    /** The users who liked the reply */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The reply text */
    text?: string | undefined | null;
    /** The user who created reply */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the replies creator */
    userId?: number | undefined | null;
    "...on ActivityReply": Omit<
      GraphQLTypes["ActivityReply"],
      "...on ActivityReply"
    >;
  };
  /** Notification for when a activity reply is liked */
  ActivityReplyLikeNotification: {
    __typename: "ActivityReplyLikeNotification";
    /** The liked activity */
    activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity where the reply which was liked */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity reply */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity reply */
    userId: number;
    "...on ActivityReplyLikeNotification": Omit<
      GraphQLTypes["ActivityReplyLikeNotification"],
      "...on ActivityReplyLikeNotification"
    >;
  };
  /** Notification for when a user replies to the authenticated users activity */
  ActivityReplyNotification: {
    __typename: "ActivityReplyNotification";
    /** The liked activity */
    activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was replied too */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who replied to the activity */
    userId: number;
    "...on ActivityReplyNotification": Omit<
      GraphQLTypes["ActivityReplyNotification"],
      "...on ActivityReplyNotification"
    >;
  };
  /** Notification for when a user replies to activity the authenticated user has replied to */
  ActivityReplySubscribedNotification: {
    __typename: "ActivityReplySubscribedNotification";
    /** The liked activity */
    activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** The id of the activity which was replied too */
    activityId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who replied to the activity */
    userId: number;
    "...on ActivityReplySubscribedNotification": Omit<
      GraphQLTypes["ActivityReplySubscribedNotification"],
      "...on ActivityReplySubscribedNotification"
    >;
  };
  /** Notification for when an episode of anime airs */
  AiringNotification: {
    __typename: "AiringNotification";
    /** The id of the aired anime */
    animeId: number;
    /** The notification context text */
    contexts?: Array<string | undefined | null> | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The episode number that just aired */
    episode: number;
    /** The id of the Notification */
    id: number;
    /** The associated media of the airing schedule */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on AiringNotification": Omit<
      GraphQLTypes["AiringNotification"],
      "...on AiringNotification"
    >;
  };
  /** Score & Watcher stats for airing anime by episode and mid-week */
  AiringProgression: {
    __typename: "AiringProgression";
    /** The episode the stats were recorded at. .5 is the mid point between 2 episodes airing dates. */
    episode?: number | undefined | null;
    /** The average score for the media */
    score?: number | undefined | null;
    /** The amount of users watching the anime */
    watching?: number | undefined | null;
    "...on AiringProgression": Omit<
      GraphQLTypes["AiringProgression"],
      "...on AiringProgression"
    >;
  };
  /** Media Airing Schedule. NOTE: We only aim to guarantee that FUTURE airing data is present and accurate. */
  AiringSchedule: {
    __typename: "AiringSchedule";
    /** The time the episode airs at */
    airingAt: number;
    /** The airing episode number */
    episode: number;
    /** The id of the airing schedule item */
    id: number;
    /** The associate media of the airing episode */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The associate media id of the airing episode */
    mediaId: number;
    /** Seconds until episode starts airing */
    timeUntilAiring: number;
    "...on AiringSchedule": Omit<
      GraphQLTypes["AiringSchedule"],
      "...on AiringSchedule"
    >;
  };
  AiringScheduleConnection: {
    __typename: "AiringScheduleConnection";
    edges?:
      | Array<GraphQLTypes["AiringScheduleEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on AiringScheduleConnection": Omit<
      GraphQLTypes["AiringScheduleConnection"],
      "...on AiringScheduleConnection"
    >;
  };
  /** AiringSchedule connection edge */
  AiringScheduleEdge: {
    __typename: "AiringScheduleEdge";
    /** The id of the connection */
    id?: number | undefined | null;
    node?: GraphQLTypes["AiringSchedule"] | undefined | null;
    "...on AiringScheduleEdge": Omit<
      GraphQLTypes["AiringScheduleEdge"],
      "...on AiringScheduleEdge"
    >;
  };
  AniChartUser: {
    __typename: "AniChartUser";
    highlights?: GraphQLTypes["Json"] | undefined | null;
    settings?: GraphQLTypes["Json"] | undefined | null;
    user?: GraphQLTypes["User"] | undefined | null;
    "...on AniChartUser": Omit<
      GraphQLTypes["AniChartUser"],
      "...on AniChartUser"
    >;
  };
  /** A character that features in an anime or manga */
  Character: {
    __typename: "Character";
    /** The character's age. Note this is a string, not an int, it may contain further text and additional ages. */
    age?: string | undefined | null;
    /** The characters blood type */
    bloodType?: string | undefined | null;
    /** The character's birth date */
    dateOfBirth?: GraphQLTypes["FuzzyDate"] | undefined | null;
    /** A general description of the character */
    description?: string | undefined | null;
    /** The amount of user's who have favourited the character */
    favourites?: number | undefined | null;
    /** The character's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: string | undefined | null;
    /** The id of the character */
    id: number;
    /** Character images */
    image?: GraphQLTypes["CharacterImage"] | undefined | null;
    /** If the character is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** If the character is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** Media that includes the character */
    media?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The names of the character */
    name?: GraphQLTypes["CharacterName"] | undefined | null;
    /** The url for the character page on the AniList website */
    siteUrl?: string | undefined | null;
    updatedAt?: number | undefined | null;
    "...on Character": Omit<GraphQLTypes["Character"], "...on Character">;
  };
  CharacterConnection: {
    __typename: "CharacterConnection";
    edges?:
      | Array<GraphQLTypes["CharacterEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["Character"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on CharacterConnection": Omit<
      GraphQLTypes["CharacterConnection"],
      "...on CharacterConnection"
    >;
  };
  /** Character connection edge */
  CharacterEdge: {
    __typename: "CharacterEdge";
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** The media the character is in */
    media?: Array<GraphQLTypes["Media"] | undefined | null> | undefined | null;
    /** Media specific character name */
    name?: string | undefined | null;
    node?: GraphQLTypes["Character"] | undefined | null;
    /** The characters role in the media */
    role?: GraphQLTypes["CharacterRole"] | undefined | null;
    /** The voice actors of the character with role date */
    voiceActorRoles?:
      | Array<GraphQLTypes["StaffRoleType"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<GraphQLTypes["Staff"] | undefined | null>
      | undefined
      | null;
    "...on CharacterEdge": Omit<
      GraphQLTypes["CharacterEdge"],
      "...on CharacterEdge"
    >;
  };
  CharacterImage: {
    __typename: "CharacterImage";
    /** The character's image of media at its largest size */
    large?: string | undefined | null;
    /** The character's image of media at medium size */
    medium?: string | undefined | null;
    "...on CharacterImage": Omit<
      GraphQLTypes["CharacterImage"],
      "...on CharacterImage"
    >;
  };
  /** The names of the character */
  CharacterName: {
    __typename: "CharacterName";
    /** Other names the character might be referred to as */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: Array<string | undefined | null> | undefined | null;
    /** The character's given name */
    first?: string | undefined | null;
    /** The character's first and last name */
    full?: string | undefined | null;
    /** The character's surname */
    last?: string | undefined | null;
    /** The character's middle name */
    middle?: string | undefined | null;
    /** The character's full name in their native language */
    native?: string | undefined | null;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
    "...on CharacterName": Omit<
      GraphQLTypes["CharacterName"],
      "...on CharacterName"
    >;
  };
  /** A submission for a character that features in an anime or manga */
  CharacterSubmission: {
    __typename: "CharacterSubmission";
    /** Data Mod assigned to handle the submission */
    assignee?: GraphQLTypes["User"] | undefined | null;
    /** Character that the submission is referencing */
    character?: GraphQLTypes["Character"] | undefined | null;
    createdAt?: number | undefined | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    /** Inner details of submission status */
    notes?: string | undefined | null;
    source?: string | undefined | null;
    /** Status of the submission */
    status?: GraphQLTypes["SubmissionStatus"] | undefined | null;
    /** The character submission changes */
    submission?: GraphQLTypes["Character"] | undefined | null;
    /** Submitter for the submission */
    submitter?: GraphQLTypes["User"] | undefined | null;
    "...on CharacterSubmission": Omit<
      GraphQLTypes["CharacterSubmission"],
      "...on CharacterSubmission"
    >;
  };
  CharacterSubmissionConnection: {
    __typename: "CharacterSubmissionConnection";
    edges?:
      | Array<GraphQLTypes["CharacterSubmissionEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["CharacterSubmission"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on CharacterSubmissionConnection": Omit<
      GraphQLTypes["CharacterSubmissionConnection"],
      "...on CharacterSubmissionConnection"
    >;
  };
  /** CharacterSubmission connection edge */
  CharacterSubmissionEdge: {
    __typename: "CharacterSubmissionEdge";
    node?: GraphQLTypes["CharacterSubmission"] | undefined | null;
    /** The characters role in the media */
    role?: GraphQLTypes["CharacterRole"] | undefined | null;
    /** The submitted voice actors of the character */
    submittedVoiceActors?:
      | Array<GraphQLTypes["StaffSubmission"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<GraphQLTypes["Staff"] | undefined | null>
      | undefined
      | null;
    "...on CharacterSubmissionEdge": Omit<
      GraphQLTypes["CharacterSubmissionEdge"],
      "...on CharacterSubmissionEdge"
    >;
  };
  /** Deleted data type */
  Deleted: {
    __typename: "Deleted";
    /** If an item has been successfully deleted */
    deleted?: boolean | undefined | null;
    "...on Deleted": Omit<GraphQLTypes["Deleted"], "...on Deleted">;
  };
  /** User's favourite anime, manga, characters, staff & studios */
  Favourites: {
    __typename: "Favourites";
    /** Favourite anime */
    anime?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** Favourite characters */
    characters?: GraphQLTypes["CharacterConnection"] | undefined | null;
    /** Favourite manga */
    manga?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** Favourite staff */
    staff?: GraphQLTypes["StaffConnection"] | undefined | null;
    /** Favourite studios */
    studios?: GraphQLTypes["StudioConnection"] | undefined | null;
    "...on Favourites": Omit<GraphQLTypes["Favourites"], "...on Favourites">;
  };
  /** Notification for when the authenticated user is followed by another user */
  FollowingNotification: {
    __typename: "FollowingNotification";
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The liked activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who followed the authenticated user */
    userId: number;
    "...on FollowingNotification": Omit<
      GraphQLTypes["FollowingNotification"],
      "...on FollowingNotification"
    >;
  };
  /** User's format statistics */
  FormatStats: {
    __typename: "FormatStats";
    amount?: number | undefined | null;
    format?: GraphQLTypes["MediaFormat"] | undefined | null;
    "...on FormatStats": Omit<GraphQLTypes["FormatStats"], "...on FormatStats">;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDate: {
    __typename: "FuzzyDate";
    /** Numeric Day (24) */
    day?: number | undefined | null;
    /** Numeric Month (3) */
    month?: number | undefined | null;
    /** Numeric Year (2017) */
    year?: number | undefined | null;
    "...on FuzzyDate": Omit<GraphQLTypes["FuzzyDate"], "...on FuzzyDate">;
  };
  /** User's genre statistics */
  GenreStats: {
    __typename: "GenreStats";
    amount?: number | undefined | null;
    genre?: string | undefined | null;
    meanScore?: number | undefined | null;
    /** The amount of time in minutes the genre has been watched by the user */
    timeWatched?: number | undefined | null;
    "...on GenreStats": Omit<GraphQLTypes["GenreStats"], "...on GenreStats">;
  };
  /** Page of data (Used for internal use only) */
  InternalPage: {
    __typename: "InternalPage";
    activities?:
      | Array<GraphQLTypes["ActivityUnion"] | undefined | null>
      | undefined
      | null;
    activityReplies?:
      | Array<GraphQLTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    airingSchedules?:
      | Array<GraphQLTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    characterSubmissions?:
      | Array<GraphQLTypes["CharacterSubmission"] | undefined | null>
      | undefined
      | null;
    characters?:
      | Array<GraphQLTypes["Character"] | undefined | null>
      | undefined
      | null;
    followers?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    following?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    media?: Array<GraphQLTypes["Media"] | undefined | null> | undefined | null;
    mediaList?:
      | Array<GraphQLTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    mediaSubmissions?:
      | Array<GraphQLTypes["MediaSubmission"] | undefined | null>
      | undefined
      | null;
    mediaTrends?:
      | Array<GraphQLTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    modActions?:
      | Array<GraphQLTypes["ModAction"] | undefined | null>
      | undefined
      | null;
    notifications?:
      | Array<GraphQLTypes["NotificationUnion"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    recommendations?:
      | Array<GraphQLTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    reports?:
      | Array<GraphQLTypes["Report"] | undefined | null>
      | undefined
      | null;
    reviews?:
      | Array<GraphQLTypes["Review"] | undefined | null>
      | undefined
      | null;
    revisionHistory?:
      | Array<GraphQLTypes["RevisionHistory"] | undefined | null>
      | undefined
      | null;
    staff?: Array<GraphQLTypes["Staff"] | undefined | null> | undefined | null;
    staffSubmissions?:
      | Array<GraphQLTypes["StaffSubmission"] | undefined | null>
      | undefined
      | null;
    studios?:
      | Array<GraphQLTypes["Studio"] | undefined | null>
      | undefined
      | null;
    threadComments?:
      | Array<GraphQLTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    threads?:
      | Array<GraphQLTypes["Thread"] | undefined | null>
      | undefined
      | null;
    userBlockSearch?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    users?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    "...on InternalPage": Omit<
      GraphQLTypes["InternalPage"],
      "...on InternalPage"
    >;
  };
  /** User list activity (anime & manga updates) */
  ListActivity: {
    __typename: "ListActivity";
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The associated media to the activity update */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The list progress made */
    progress?: string | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<GraphQLTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The list item's textual status */
    status?: string | undefined | null;
    /** The type of activity */
    type?: GraphQLTypes["ActivityType"] | undefined | null;
    /** The owner of the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The user id of the activity's creator */
    userId?: number | undefined | null;
    "...on ListActivity": Omit<
      GraphQLTypes["ListActivity"],
      "...on ListActivity"
    >;
  };
  ListActivityOption: {
    __typename: "ListActivityOption";
    disabled?: boolean | undefined | null;
    type?: GraphQLTypes["MediaListStatus"] | undefined | null;
    "...on ListActivityOption": Omit<
      GraphQLTypes["ListActivityOption"],
      "...on ListActivityOption"
    >;
  };
  /** User's list score statistics */
  ListScoreStats: {
    __typename: "ListScoreStats";
    meanScore?: number | undefined | null;
    standardDeviation?: number | undefined | null;
    "...on ListScoreStats": Omit<
      GraphQLTypes["ListScoreStats"],
      "...on ListScoreStats"
    >;
  };
  /** Anime or Manga */
  Media: {
    __typename: "Media";
    /** The media's entire airing schedule */
    airingSchedule?:
      | GraphQLTypes["AiringScheduleConnection"]
      | undefined
      | null;
    /** If the media should have forum thread automatically created for it on airing episode release */
    autoCreateForumThread?: boolean | undefined | null;
    /** A weighted average score of all the user's scores of the media */
    averageScore?: number | undefined | null;
    /** The banner image of the media */
    bannerImage?: string | undefined | null;
    /** The amount of chapters the manga has when complete */
    chapters?: number | undefined | null;
    /** The characters in the media */
    characters?: GraphQLTypes["CharacterConnection"] | undefined | null;
    /** Where the media was created. (ISO 3166-1 alpha-2) */
    countryOfOrigin?: GraphQLTypes["CountryCode"] | undefined | null;
    /** The cover images of the media */
    coverImage?: GraphQLTypes["MediaCoverImage"] | undefined | null;
    /** Short description of the media's story and characters */
    description?: string | undefined | null;
    /** The general length of each anime episode in minutes */
    duration?: number | undefined | null;
    /** The last official release date of the media */
    endDate?: GraphQLTypes["FuzzyDate"] | undefined | null;
    /** The amount of episodes the anime has when complete */
    episodes?: number | undefined | null;
    /** External links to another site related to the media */
    externalLinks?:
      | Array<GraphQLTypes["MediaExternalLink"] | undefined | null>
      | undefined
      | null;
    /** The amount of user's who have favourited the media */
    favourites?: number | undefined | null;
    /** The format the media was released in */
    format?: GraphQLTypes["MediaFormat"] | undefined | null;
    /** The genres of the media */
    genres?: Array<string | undefined | null> | undefined | null;
    /** Official Twitter hashtags for the media */
    hashtag?: string | undefined | null;
    /** The id of the media */
    id: number;
    /** The mal id of the media */
    idMal?: number | undefined | null;
    /** If the media is intended only for 18+ adult audiences */
    isAdult?: boolean | undefined | null;
    /** If the media is marked as favourite by the current authenticated user */
    isFavourite: boolean;
    /** If the media is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** If the media is officially licensed or a self-published doujin release */
    isLicensed?: boolean | undefined | null;
    /** Locked media may not be added to lists our favorited. This may be due to the entry pending for deletion or other reasons. */
    isLocked?: boolean | undefined | null;
    /** If the media is blocked from being recommended to/from */
    isRecommendationBlocked?: boolean | undefined | null;
    /** If the media is blocked from being reviewed */
    isReviewBlocked?: boolean | undefined | null;
    /** Mean score of all the user's scores of the media */
    meanScore?: number | undefined | null;
    /** The authenticated user's media list entry for the media */
    mediaListEntry?: GraphQLTypes["MediaList"] | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The media's next episode airing schedule */
    nextAiringEpisode?: GraphQLTypes["AiringSchedule"] | undefined | null;
    /** The number of users with the media on their list */
    popularity?: number | undefined | null;
    /** The ranking of the media in a particular time span and format compared to other media */
    rankings?:
      | Array<GraphQLTypes["MediaRank"] | undefined | null>
      | undefined
      | null;
    /** User recommendations for similar media */
    recommendations?:
      | GraphQLTypes["RecommendationConnection"]
      | undefined
      | null;
    /** Other media in the same or connecting franchise */
    relations?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** User reviews of the media */
    reviews?: GraphQLTypes["ReviewConnection"] | undefined | null;
    /** The season the media was initially released in */
    season?: GraphQLTypes["MediaSeason"] | undefined | null;
    /** The year & season the media was initially released in */
    seasonInt?: number | undefined | null;
    /** The season year the media was initially released in */
    seasonYear?: number | undefined | null;
    /** The url for the media page on the AniList website */
    siteUrl?: string | undefined | null;
    /** Source type the media was adapted from. */
    source?: GraphQLTypes["MediaSource"] | undefined | null;
    /** The staff who produced the media */
    staff?: GraphQLTypes["StaffConnection"] | undefined | null;
    /** The first official release date of the media */
    startDate?: GraphQLTypes["FuzzyDate"] | undefined | null;
    stats?: GraphQLTypes["MediaStats"] | undefined | null;
    /** The current releasing status of the media */
    status?: GraphQLTypes["MediaStatus"] | undefined | null;
    /** Data and links to legal streaming episodes on external sites */
    streamingEpisodes?:
      | Array<GraphQLTypes["MediaStreamingEpisode"] | undefined | null>
      | undefined
      | null;
    /** The companies who produced the media */
    studios?: GraphQLTypes["StudioConnection"] | undefined | null;
    /** Alternative titles of the media */
    synonyms?: Array<string | undefined | null> | undefined | null;
    /** List of tags that describes elements and themes of the media */
    tags?:
      | Array<GraphQLTypes["MediaTag"] | undefined | null>
      | undefined
      | null;
    /** The official titles of the media in various languages */
    title?: GraphQLTypes["MediaTitle"] | undefined | null;
    /** Media trailer or advertisement */
    trailer?: GraphQLTypes["MediaTrailer"] | undefined | null;
    /** The amount of related activity in the past hour */
    trending?: number | undefined | null;
    /** The media's daily trend stats */
    trends?: GraphQLTypes["MediaTrendConnection"] | undefined | null;
    /** The type of the media; anime or manga */
    type?: GraphQLTypes["MediaType"] | undefined | null;
    /** When the media's data was last updated */
    updatedAt?: number | undefined | null;
    /** The amount of volumes the manga has when complete */
    volumes?: number | undefined | null;
    "...on Media": Omit<GraphQLTypes["Media"], "...on Media">;
  };
  /** Internal - Media characters separated */
  MediaCharacter: {
    __typename: "MediaCharacter";
    /** The characters in the media voiced by the parent actor */
    character?: GraphQLTypes["Character"] | undefined | null;
    /** Media specific character name */
    characterName?: string | undefined | null;
    dubGroup?: string | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** The characters role in the media */
    role?: GraphQLTypes["CharacterRole"] | undefined | null;
    roleNotes?: string | undefined | null;
    /** The voice actor of the character */
    voiceActor?: GraphQLTypes["Staff"] | undefined | null;
    "...on MediaCharacter": Omit<
      GraphQLTypes["MediaCharacter"],
      "...on MediaCharacter"
    >;
  };
  MediaConnection: {
    __typename: "MediaConnection";
    edges?:
      | Array<GraphQLTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<GraphQLTypes["Media"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on MediaConnection": Omit<
      GraphQLTypes["MediaConnection"],
      "...on MediaConnection"
    >;
  };
  MediaCoverImage: {
    __typename: "MediaCoverImage";
    /** Average #hex color of cover image */
    color?: string | undefined | null;
    /** The cover image url of the media at its largest size. If this size isn't available, large will be provided instead. */
    extraLarge?: string | undefined | null;
    /** The cover image url of the media at a large size */
    large?: string | undefined | null;
    /** The cover image url of the media at medium size */
    medium?: string | undefined | null;
    "...on MediaCoverImage": Omit<
      GraphQLTypes["MediaCoverImage"],
      "...on MediaCoverImage"
    >;
  };
  /** Notification for when a media entry's data was changed in a significant way impacting users' list tracking */
  MediaDataChangeNotification: {
    __typename: "MediaDataChangeNotification";
    /** The reason for the media data change */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The media that received data changes */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the media that received data changes */
    mediaId: number;
    /** The reason for the media data change */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on MediaDataChangeNotification": Omit<
      GraphQLTypes["MediaDataChangeNotification"],
      "...on MediaDataChangeNotification"
    >;
  };
  /** Notification for when a media tracked in a user's list is deleted from the site */
  MediaDeletionNotification: {
    __typename: "MediaDeletionNotification";
    /** The reason for the media deletion */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The title of the deleted media */
    deletedMediaTitle?: string | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The reason for the media deletion */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on MediaDeletionNotification": Omit<
      GraphQLTypes["MediaDeletionNotification"],
      "...on MediaDeletionNotification"
    >;
  };
  /** Media connection edge */
  MediaEdge: {
    __typename: "MediaEdge";
    /** Media specific character name */
    characterName?: string | undefined | null;
    /** The characters role in the media */
    characterRole?: GraphQLTypes["CharacterRole"] | undefined | null;
    /** The characters in the media voiced by the parent actor */
    characters?:
      | Array<GraphQLTypes["Character"] | undefined | null>
      | undefined
      | null;
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: string | undefined | null;
    /** The order the media should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** If the studio is the main animation studio of the media (For Studio->MediaConnection field only) */
    isMainStudio: boolean;
    node?: GraphQLTypes["Media"] | undefined | null;
    /** The type of relation to the parent model */
    relationType?: GraphQLTypes["MediaRelation"] | undefined | null;
    /** Notes regarding the VA's role for the character */
    roleNotes?: string | undefined | null;
    /** The role of the staff member in the production of the media */
    staffRole?: string | undefined | null;
    /** The voice actors of the character with role date */
    voiceActorRoles?:
      | Array<GraphQLTypes["StaffRoleType"] | undefined | null>
      | undefined
      | null;
    /** The voice actors of the character */
    voiceActors?:
      | Array<GraphQLTypes["Staff"] | undefined | null>
      | undefined
      | null;
    "...on MediaEdge": Omit<GraphQLTypes["MediaEdge"], "...on MediaEdge">;
  };
  /** An external link to another site related to the media or staff member */
  MediaExternalLink: {
    __typename: "MediaExternalLink";
    color?: string | undefined | null;
    /** The icon image url of the site. Not available for all links. Transparent PNG 64x64 */
    icon?: string | undefined | null;
    /** The id of the external link */
    id: number;
    isDisabled?: boolean | undefined | null;
    /** Language the site content is in. See Staff language field for values. */
    language?: string | undefined | null;
    notes?: string | undefined | null;
    /** The links website site name */
    site: string;
    /** The links website site id */
    siteId?: number | undefined | null;
    type?: GraphQLTypes["ExternalLinkType"] | undefined | null;
    /** The url of the external link or base url of link source */
    url?: string | undefined | null;
    "...on MediaExternalLink": Omit<
      GraphQLTypes["MediaExternalLink"],
      "...on MediaExternalLink"
    >;
  };
  /** List of anime or manga */
  MediaList: {
    __typename: "MediaList";
    /** Map of advanced scores with name keys */
    advancedScores?: GraphQLTypes["Json"] | undefined | null;
    /** When the entry was completed by the user */
    completedAt?: GraphQLTypes["FuzzyDate"] | undefined | null;
    /** When the entry data was created */
    createdAt?: number | undefined | null;
    /** Map of booleans for which custom lists the entry are in */
    customLists?: GraphQLTypes["Json"] | undefined | null;
    /** If the entry shown be hidden from non-custom lists */
    hiddenFromStatusLists?: boolean | undefined | null;
    /** The id of the list entry */
    id: number;
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the media */
    mediaId: number;
    /** Text notes */
    notes?: string | undefined | null;
    /** Priority of planning */
    priority?: number | undefined | null;
    /** If the entry should only be visible to authenticated user */
    private?: boolean | undefined | null;
    /** The amount of episodes/chapters consumed by the user */
    progress?: number | undefined | null;
    /** The amount of volumes read by the user */
    progressVolumes?: number | undefined | null;
    /** The amount of times the user has rewatched/read the media */
    repeat?: number | undefined | null;
    /** The score of the entry */
    score?: number | undefined | null;
    /** When the entry was started by the user */
    startedAt?: GraphQLTypes["FuzzyDate"] | undefined | null;
    /** The watching/reading status */
    status?: GraphQLTypes["MediaListStatus"] | undefined | null;
    /** When the entry data was last updated */
    updatedAt?: number | undefined | null;
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user owner of the list entry */
    userId: number;
    "...on MediaList": Omit<GraphQLTypes["MediaList"], "...on MediaList">;
  };
  /** List of anime or manga */
  MediaListCollection: {
    __typename: "MediaListCollection";
    /** A map of media list entry arrays grouped by custom lists */
    customLists?:
      | Array<
          Array<GraphQLTypes["MediaList"] | undefined | null> | undefined | null
        >
      | undefined
      | null;
    /** If there is another chunk */
    hasNextChunk?: boolean | undefined | null;
    /** Grouped media list entries */
    lists?:
      | Array<GraphQLTypes["MediaListGroup"] | undefined | null>
      | undefined
      | null;
    /** A map of media list entry arrays grouped by status */
    statusLists?:
      | Array<
          Array<GraphQLTypes["MediaList"] | undefined | null> | undefined | null
        >
      | undefined
      | null;
    /** The owner of the list */
    user?: GraphQLTypes["User"] | undefined | null;
    "...on MediaListCollection": Omit<
      GraphQLTypes["MediaListCollection"],
      "...on MediaListCollection"
    >;
  };
  /** List group of anime or manga entries */
  MediaListGroup: {
    __typename: "MediaListGroup";
    /** Media list entries */
    entries?:
      | Array<GraphQLTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    isCustomList?: boolean | undefined | null;
    isSplitCompletedList?: boolean | undefined | null;
    name?: string | undefined | null;
    status?: GraphQLTypes["MediaListStatus"] | undefined | null;
    "...on MediaListGroup": Omit<
      GraphQLTypes["MediaListGroup"],
      "...on MediaListGroup"
    >;
  };
  /** A user's list options */
  MediaListOptions: {
    __typename: "MediaListOptions";
    /** The user's anime list options */
    animeList?: GraphQLTypes["MediaListTypeOptions"] | undefined | null;
    /** The user's manga list options */
    mangaList?: GraphQLTypes["MediaListTypeOptions"] | undefined | null;
    /** The default order list rows should be displayed in */
    rowOrder?: string | undefined | null;
    /** The score format the user is using for media lists */
    scoreFormat?: GraphQLTypes["ScoreFormat"] | undefined | null;
    /** The list theme options for both lists */
    sharedTheme?: GraphQLTypes["Json"] | undefined | null;
    /** If the shared theme should be used instead of the individual list themes */
    sharedThemeEnabled?: boolean | undefined | null;
    useLegacyLists?: boolean | undefined | null;
    "...on MediaListOptions": Omit<
      GraphQLTypes["MediaListOptions"],
      "...on MediaListOptions"
    >;
  };
  /** A user's list options for anime or manga lists */
  MediaListTypeOptions: {
    __typename: "MediaListTypeOptions";
    /** The names of the user's advanced scoring sections */
    advancedScoring?: Array<string | undefined | null> | undefined | null;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null;
    /** The names of the user's custom lists */
    customLists?: Array<string | undefined | null> | undefined | null;
    /** The order each list should be displayed in */
    sectionOrder?: Array<string | undefined | null> | undefined | null;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | undefined | null;
    /** The list theme options */
    theme?: GraphQLTypes["Json"] | undefined | null;
    "...on MediaListTypeOptions": Omit<
      GraphQLTypes["MediaListTypeOptions"],
      "...on MediaListTypeOptions"
    >;
  };
  /** Notification for when a media entry is merged into another for a user who had it on their list */
  MediaMergeNotification: {
    __typename: "MediaMergeNotification";
    /** The reason for the media data change */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The title of the deleted media */
    deletedMediaTitles?: Array<string | undefined | null> | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The media that was merged into */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the media that was merged into */
    mediaId: number;
    /** The reason for the media merge */
    reason?: string | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on MediaMergeNotification": Omit<
      GraphQLTypes["MediaMergeNotification"],
      "...on MediaMergeNotification"
    >;
  };
  /** The ranking of a media in a particular time span and format compared to other media */
  MediaRank: {
    __typename: "MediaRank";
    /** If the ranking is based on all time instead of a season/year */
    allTime?: boolean | undefined | null;
    /** String that gives context to the ranking type and time span */
    context: string;
    /** The format the media is ranked within */
    format: GraphQLTypes["MediaFormat"];
    /** The id of the rank */
    id: number;
    /** The numerical rank of the media */
    rank: number;
    /** The season the media is ranked within */
    season?: GraphQLTypes["MediaSeason"] | undefined | null;
    /** The type of ranking */
    type: GraphQLTypes["MediaRankType"];
    /** The year the media is ranked within */
    year?: number | undefined | null;
    "...on MediaRank": Omit<GraphQLTypes["MediaRank"], "...on MediaRank">;
  };
  /** A media's statistics */
  MediaStats: {
    __typename: "MediaStats";
    airingProgression?:
      | Array<GraphQLTypes["AiringProgression"] | undefined | null>
      | undefined
      | null;
    scoreDistribution?:
      | Array<GraphQLTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    statusDistribution?:
      | Array<GraphQLTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
    "...on MediaStats": Omit<GraphQLTypes["MediaStats"], "...on MediaStats">;
  };
  /** Data and links to legal streaming episodes on external sites */
  MediaStreamingEpisode: {
    __typename: "MediaStreamingEpisode";
    /** The site location of the streaming episodes */
    site?: string | undefined | null;
    /** Url of episode image thumbnail */
    thumbnail?: string | undefined | null;
    /** Title of the episode */
    title?: string | undefined | null;
    /** The url of the episode */
    url?: string | undefined | null;
    "...on MediaStreamingEpisode": Omit<
      GraphQLTypes["MediaStreamingEpisode"],
      "...on MediaStreamingEpisode"
    >;
  };
  /** Media submission */
  MediaSubmission: {
    __typename: "MediaSubmission";
    /** Data Mod assigned to handle the submission */
    assignee?: GraphQLTypes["User"] | undefined | null;
    changes?: Array<string | undefined | null> | undefined | null;
    characters?:
      | Array<GraphQLTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    createdAt?: number | undefined | null;
    externalLinks?:
      | Array<GraphQLTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    media?: GraphQLTypes["Media"] | undefined | null;
    notes?: string | undefined | null;
    relations?:
      | Array<GraphQLTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    source?: string | undefined | null;
    staff?:
      | Array<GraphQLTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    /** Status of the submission */
    status?: GraphQLTypes["SubmissionStatus"] | undefined | null;
    studios?:
      | Array<GraphQLTypes["MediaSubmissionComparison"] | undefined | null>
      | undefined
      | null;
    submission?: GraphQLTypes["Media"] | undefined | null;
    /** User submitter of the submission */
    submitter?: GraphQLTypes["User"] | undefined | null;
    submitterStats?: GraphQLTypes["Json"] | undefined | null;
    "...on MediaSubmission": Omit<
      GraphQLTypes["MediaSubmission"],
      "...on MediaSubmission"
    >;
  };
  /** Media submission with comparison to current data */
  MediaSubmissionComparison: {
    __typename: "MediaSubmissionComparison";
    character?: GraphQLTypes["MediaCharacter"] | undefined | null;
    externalLink?: GraphQLTypes["MediaExternalLink"] | undefined | null;
    staff?: GraphQLTypes["StaffEdge"] | undefined | null;
    studio?: GraphQLTypes["StudioEdge"] | undefined | null;
    submission?: GraphQLTypes["MediaSubmissionEdge"] | undefined | null;
    "...on MediaSubmissionComparison": Omit<
      GraphQLTypes["MediaSubmissionComparison"],
      "...on MediaSubmissionComparison"
    >;
  };
  MediaSubmissionEdge: {
    __typename: "MediaSubmissionEdge";
    character?: GraphQLTypes["Character"] | undefined | null;
    characterName?: string | undefined | null;
    characterRole?: GraphQLTypes["CharacterRole"] | undefined | null;
    characterSubmission?: GraphQLTypes["Character"] | undefined | null;
    dubGroup?: string | undefined | null;
    externalLink?: GraphQLTypes["MediaExternalLink"] | undefined | null;
    /** The id of the direct submission */
    id?: number | undefined | null;
    isMain?: boolean | undefined | null;
    media?: GraphQLTypes["Media"] | undefined | null;
    roleNotes?: string | undefined | null;
    staff?: GraphQLTypes["Staff"] | undefined | null;
    staffRole?: string | undefined | null;
    staffSubmission?: GraphQLTypes["Staff"] | undefined | null;
    studio?: GraphQLTypes["Studio"] | undefined | null;
    voiceActor?: GraphQLTypes["Staff"] | undefined | null;
    voiceActorSubmission?: GraphQLTypes["Staff"] | undefined | null;
    "...on MediaSubmissionEdge": Omit<
      GraphQLTypes["MediaSubmissionEdge"],
      "...on MediaSubmissionEdge"
    >;
  };
  /** A tag that describes a theme or element of the media */
  MediaTag: {
    __typename: "MediaTag";
    /** The categories of tags this tag belongs to */
    category?: string | undefined | null;
    /** A general description of the tag */
    description?: string | undefined | null;
    /** The id of the tag */
    id: number;
    /** If the tag is only for adult 18+ media */
    isAdult?: boolean | undefined | null;
    /** If the tag could be a spoiler for any media */
    isGeneralSpoiler?: boolean | undefined | null;
    /** If the tag is a spoiler for this media */
    isMediaSpoiler?: boolean | undefined | null;
    /** The name of the tag */
    name: string;
    /** The relevance ranking of the tag out of the 100 for this media */
    rank?: number | undefined | null;
    /** The user who submitted the tag */
    userId?: number | undefined | null;
    "...on MediaTag": Omit<GraphQLTypes["MediaTag"], "...on MediaTag">;
  };
  /** The official titles of the media in various languages */
  MediaTitle: {
    __typename: "MediaTitle";
    /** The official english title */
    english?: string | undefined | null;
    /** Official title in it's native language */
    native?: string | undefined | null;
    /** The romanization of the native language title */
    romaji?: string | undefined | null;
    /** The currently authenticated users preferred title language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
    "...on MediaTitle": Omit<GraphQLTypes["MediaTitle"], "...on MediaTitle">;
  };
  /** Media trailer or advertisement */
  MediaTrailer: {
    __typename: "MediaTrailer";
    /** The trailer video id */
    id?: string | undefined | null;
    /** The site the video is hosted by (Currently either youtube or dailymotion) */
    site?: string | undefined | null;
    /** The url for the thumbnail image of the video */
    thumbnail?: string | undefined | null;
    "...on MediaTrailer": Omit<
      GraphQLTypes["MediaTrailer"],
      "...on MediaTrailer"
    >;
  };
  /** Daily media statistics */
  MediaTrend: {
    __typename: "MediaTrend";
    /** A weighted average score of all the user's scores of the media */
    averageScore?: number | undefined | null;
    /** The day the data was recorded (timestamp) */
    date: number;
    /** The episode number of the anime released on this day */
    episode?: number | undefined | null;
    /** The number of users with watching/reading the media */
    inProgress?: number | undefined | null;
    /** The related media */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the tag */
    mediaId: number;
    /** The number of users with the media on their list */
    popularity?: number | undefined | null;
    /** If the media was being released at this time */
    releasing: boolean;
    /** The amount of media activity on the day */
    trending: number;
    "...on MediaTrend": Omit<GraphQLTypes["MediaTrend"], "...on MediaTrend">;
  };
  MediaTrendConnection: {
    __typename: "MediaTrendConnection";
    edges?:
      | Array<GraphQLTypes["MediaTrendEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on MediaTrendConnection": Omit<
      GraphQLTypes["MediaTrendConnection"],
      "...on MediaTrendConnection"
    >;
  };
  /** Media trend connection edge */
  MediaTrendEdge: {
    __typename: "MediaTrendEdge";
    node?: GraphQLTypes["MediaTrend"] | undefined | null;
    "...on MediaTrendEdge": Omit<
      GraphQLTypes["MediaTrendEdge"],
      "...on MediaTrendEdge"
    >;
  };
  /** User message activity */
  MessageActivity: {
    __typename: "MessageActivity";
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the message is private and only viewable to the sender and recipients */
    isPrivate?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The message text (Markdown) */
    message?: string | undefined | null;
    /** The user who sent the activity message */
    messenger?: GraphQLTypes["User"] | undefined | null;
    /** The user id of the activity's sender */
    messengerId?: number | undefined | null;
    /** The user who the activity message was sent to */
    recipient?: GraphQLTypes["User"] | undefined | null;
    /** The user id of the activity's recipient */
    recipientId?: number | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<GraphQLTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The type of the activity */
    type?: GraphQLTypes["ActivityType"] | undefined | null;
    "...on MessageActivity": Omit<
      GraphQLTypes["MessageActivity"],
      "...on MessageActivity"
    >;
  };
  ModAction: {
    __typename: "ModAction";
    createdAt: number;
    data?: string | undefined | null;
    /** The id of the action */
    id: number;
    mod?: GraphQLTypes["User"] | undefined | null;
    objectId?: number | undefined | null;
    objectType?: string | undefined | null;
    type?: GraphQLTypes["ModActionType"] | undefined | null;
    user?: GraphQLTypes["User"] | undefined | null;
    "...on ModAction": Omit<GraphQLTypes["ModAction"], "...on ModAction">;
  };
  Mutation: {
    __typename: "Mutation";
    /** Delete an activity item of the authenticated users */
    DeleteActivity?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete an activity reply of the authenticated users */
    DeleteActivityReply?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete a custom list and remove the list entries from it */
    DeleteCustomList?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete a media list entry */
    DeleteMediaListEntry?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete a review */
    DeleteReview?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete a thread */
    DeleteThread?: GraphQLTypes["Deleted"] | undefined | null;
    /** Delete a thread comment */
    DeleteThreadComment?: GraphQLTypes["Deleted"] | undefined | null;
    /** Rate a review */
    RateReview?: GraphQLTypes["Review"] | undefined | null;
    /** Create or update an activity reply */
    SaveActivityReply?: GraphQLTypes["ActivityReply"] | undefined | null;
    /** Update list activity (Mod Only) */
    SaveListActivity?: GraphQLTypes["ListActivity"] | undefined | null;
    /** Create or update a media list entry */
    SaveMediaListEntry?: GraphQLTypes["MediaList"] | undefined | null;
    /** Create or update message activity for the currently authenticated user */
    SaveMessageActivity?: GraphQLTypes["MessageActivity"] | undefined | null;
    /** Recommendation a media */
    SaveRecommendation?: GraphQLTypes["Recommendation"] | undefined | null;
    /** Create or update a review */
    SaveReview?: GraphQLTypes["Review"] | undefined | null;
    /** Create or update text activity for the currently authenticated user */
    SaveTextActivity?: GraphQLTypes["TextActivity"] | undefined | null;
    /** Create or update a forum thread */
    SaveThread?: GraphQLTypes["Thread"] | undefined | null;
    /** Create or update a thread comment */
    SaveThreadComment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** Toggle activity to be pinned to the top of the user's activity feed */
    ToggleActivityPin?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** Toggle the subscription of an activity item */
    ToggleActivitySubscription?:
      | GraphQLTypes["ActivityUnion"]
      | undefined
      | null;
    /** Favourite or unfavourite an anime, manga, character, staff member, or studio */
    ToggleFavourite?: GraphQLTypes["Favourites"] | undefined | null;
    /** Toggle the un/following of a user */
    ToggleFollow?: GraphQLTypes["User"] | undefined | null;
    /** Add or remove a like from a likeable type.
Returns all the users who liked the same model */
    ToggleLike?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    /** Add or remove a like from a likeable type. */
    ToggleLikeV2?: GraphQLTypes["LikeableUnion"] | undefined | null;
    /** Toggle the subscription of a forum thread */
    ToggleThreadSubscription?: GraphQLTypes["Thread"] | undefined | null;
    UpdateAniChartHighlights?: GraphQLTypes["Json"] | undefined | null;
    UpdateAniChartSettings?: GraphQLTypes["Json"] | undefined | null;
    /** Update the order favourites are displayed in */
    UpdateFavouriteOrder?: GraphQLTypes["Favourites"] | undefined | null;
    /** Update multiple media list entries to the same values */
    UpdateMediaListEntries?:
      | Array<GraphQLTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    UpdateUser?: GraphQLTypes["User"] | undefined | null;
    "...on Mutation": Omit<GraphQLTypes["Mutation"], "...on Mutation">;
  };
  /** Notification option */
  NotificationOption: {
    __typename: "NotificationOption";
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on NotificationOption": Omit<
      GraphQLTypes["NotificationOption"],
      "...on NotificationOption"
    >;
  };
  /** Page of data */
  Page: {
    __typename: "Page";
    activities?:
      | Array<GraphQLTypes["ActivityUnion"] | undefined | null>
      | undefined
      | null;
    activityReplies?:
      | Array<GraphQLTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    airingSchedules?:
      | Array<GraphQLTypes["AiringSchedule"] | undefined | null>
      | undefined
      | null;
    characters?:
      | Array<GraphQLTypes["Character"] | undefined | null>
      | undefined
      | null;
    followers?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    following?:
      | Array<GraphQLTypes["User"] | undefined | null>
      | undefined
      | null;
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    media?: Array<GraphQLTypes["Media"] | undefined | null> | undefined | null;
    mediaList?:
      | Array<GraphQLTypes["MediaList"] | undefined | null>
      | undefined
      | null;
    mediaTrends?:
      | Array<GraphQLTypes["MediaTrend"] | undefined | null>
      | undefined
      | null;
    notifications?:
      | Array<GraphQLTypes["NotificationUnion"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    recommendations?:
      | Array<GraphQLTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    reviews?:
      | Array<GraphQLTypes["Review"] | undefined | null>
      | undefined
      | null;
    staff?: Array<GraphQLTypes["Staff"] | undefined | null> | undefined | null;
    studios?:
      | Array<GraphQLTypes["Studio"] | undefined | null>
      | undefined
      | null;
    threadComments?:
      | Array<GraphQLTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    threads?:
      | Array<GraphQLTypes["Thread"] | undefined | null>
      | undefined
      | null;
    users?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    "...on Page": Omit<GraphQLTypes["Page"], "...on Page">;
  };
  PageInfo: {
    __typename: "PageInfo";
    /** The current page */
    currentPage?: number | undefined | null;
    /** If there is another page */
    hasNextPage?: boolean | undefined | null;
    /** The last page */
    lastPage?: number | undefined | null;
    /** The count on a page */
    perPage?: number | undefined | null;
    /** The total number of items. Note: This value is not guaranteed to be accurate, do not rely on this for logic */
    total?: number | undefined | null;
    "...on PageInfo": Omit<GraphQLTypes["PageInfo"], "...on PageInfo">;
  };
  /** Provides the parsed markdown as html */
  ParsedMarkdown: {
    __typename: "ParsedMarkdown";
    /** The parsed markdown as html */
    html?: string | undefined | null;
    "...on ParsedMarkdown": Omit<
      GraphQLTypes["ParsedMarkdown"],
      "...on ParsedMarkdown"
    >;
  };
  Query: {
    __typename: "Query";
    /** Activity query */
    Activity?: GraphQLTypes["ActivityUnion"] | undefined | null;
    /** Activity reply query */
    ActivityReply?: GraphQLTypes["ActivityReply"] | undefined | null;
    /** Airing schedule query */
    AiringSchedule?: GraphQLTypes["AiringSchedule"] | undefined | null;
    AniChartUser?: GraphQLTypes["AniChartUser"] | undefined | null;
    /** Character query */
    Character?: GraphQLTypes["Character"] | undefined | null;
    /** ExternalLinkSource collection query */
    ExternalLinkSourceCollection?:
      | Array<GraphQLTypes["MediaExternalLink"] | undefined | null>
      | undefined
      | null;
    /** Follow query */
    Follower?: GraphQLTypes["User"] | undefined | null;
    /** Follow query */
    Following?: GraphQLTypes["User"] | undefined | null;
    /** Collection of all the possible media genres */
    GenreCollection?: Array<string | undefined | null> | undefined | null;
    /** Like query */
    Like?: GraphQLTypes["User"] | undefined | null;
    /** Provide AniList markdown to be converted to html (Requires auth) */
    Markdown?: GraphQLTypes["ParsedMarkdown"] | undefined | null;
    /** Media query */
    Media?: GraphQLTypes["Media"] | undefined | null;
    /** Media list query */
    MediaList?: GraphQLTypes["MediaList"] | undefined | null;
    /** Media list collection query, provides list pre-grouped by status & custom lists. User ID and Media Type arguments required. */
    MediaListCollection?:
      | GraphQLTypes["MediaListCollection"]
      | undefined
      | null;
    /** Collection of all the possible media tags */
    MediaTagCollection?:
      | Array<GraphQLTypes["MediaTag"] | undefined | null>
      | undefined
      | null;
    /** Media Trend query */
    MediaTrend?: GraphQLTypes["MediaTrend"] | undefined | null;
    /** Notification query */
    Notification?: GraphQLTypes["NotificationUnion"] | undefined | null;
    Page?: GraphQLTypes["Page"] | undefined | null;
    /** Recommendation query */
    Recommendation?: GraphQLTypes["Recommendation"] | undefined | null;
    /** Review query */
    Review?: GraphQLTypes["Review"] | undefined | null;
    /** Site statistics query */
    SiteStatistics?: GraphQLTypes["SiteStatistics"] | undefined | null;
    /** Staff query */
    Staff?: GraphQLTypes["Staff"] | undefined | null;
    /** Studio query */
    Studio?: GraphQLTypes["Studio"] | undefined | null;
    /** Thread query */
    Thread?: GraphQLTypes["Thread"] | undefined | null;
    /** Comment query */
    ThreadComment?:
      | Array<GraphQLTypes["ThreadComment"] | undefined | null>
      | undefined
      | null;
    /** User query */
    User?: GraphQLTypes["User"] | undefined | null;
    /** Get the currently authenticated user */
    Viewer?: GraphQLTypes["User"] | undefined | null;
    "...on Query": Omit<GraphQLTypes["Query"], "...on Query">;
  };
  /** Media recommendation */
  Recommendation: {
    __typename: "Recommendation";
    /** The id of the recommendation */
    id: number;
    /** The media the recommendation is from */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The recommended media */
    mediaRecommendation?: GraphQLTypes["Media"] | undefined | null;
    /** Users rating of the recommendation */
    rating?: number | undefined | null;
    /** The user that first created the recommendation */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The rating of the recommendation by currently authenticated user */
    userRating?: GraphQLTypes["RecommendationRating"] | undefined | null;
    "...on Recommendation": Omit<
      GraphQLTypes["Recommendation"],
      "...on Recommendation"
    >;
  };
  RecommendationConnection: {
    __typename: "RecommendationConnection";
    edges?:
      | Array<GraphQLTypes["RecommendationEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["Recommendation"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on RecommendationConnection": Omit<
      GraphQLTypes["RecommendationConnection"],
      "...on RecommendationConnection"
    >;
  };
  /** Recommendation connection edge */
  RecommendationEdge: {
    __typename: "RecommendationEdge";
    node?: GraphQLTypes["Recommendation"] | undefined | null;
    "...on RecommendationEdge": Omit<
      GraphQLTypes["RecommendationEdge"],
      "...on RecommendationEdge"
    >;
  };
  /** Notification for when new media is added to the site */
  RelatedMediaAdditionNotification: {
    __typename: "RelatedMediaAdditionNotification";
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The associated media of the airing schedule */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the new media */
    mediaId: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    "...on RelatedMediaAdditionNotification": Omit<
      GraphQLTypes["RelatedMediaAdditionNotification"],
      "...on RelatedMediaAdditionNotification"
    >;
  };
  Report: {
    __typename: "Report";
    cleared?: boolean | undefined | null;
    /** When the entry data was created */
    createdAt?: number | undefined | null;
    id: number;
    reason?: string | undefined | null;
    reported?: GraphQLTypes["User"] | undefined | null;
    reporter?: GraphQLTypes["User"] | undefined | null;
    "...on Report": Omit<GraphQLTypes["Report"], "...on Report">;
  };
  /** A Review that features in an anime or manga */
  Review: {
    __typename: "Review";
    /** The main review body text */
    body?: string | undefined | null;
    /** The time of the thread creation */
    createdAt: number;
    /** The id of the review */
    id: number;
    /** The media the review is of */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The id of the review's media */
    mediaId: number;
    /** For which type of media the review is for */
    mediaType?: GraphQLTypes["MediaType"] | undefined | null;
    /** If the review is not yet publicly published and is only viewable by creator */
    private?: boolean | undefined | null;
    /** The total user rating of the review */
    rating?: number | undefined | null;
    /** The amount of user ratings of the review */
    ratingAmount?: number | undefined | null;
    /** The review score of the media */
    score?: number | undefined | null;
    /** The url for the review page on the AniList website */
    siteUrl?: string | undefined | null;
    /** A short summary of the review */
    summary?: string | undefined | null;
    /** The time of the thread last update */
    updatedAt: number;
    /** The creator of the review */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the review's creator */
    userId: number;
    /** The rating of the review by currently authenticated user */
    userRating?: GraphQLTypes["ReviewRating"] | undefined | null;
    "...on Review": Omit<GraphQLTypes["Review"], "...on Review">;
  };
  ReviewConnection: {
    __typename: "ReviewConnection";
    edges?:
      | Array<GraphQLTypes["ReviewEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<GraphQLTypes["Review"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on ReviewConnection": Omit<
      GraphQLTypes["ReviewConnection"],
      "...on ReviewConnection"
    >;
  };
  /** Review connection edge */
  ReviewEdge: {
    __typename: "ReviewEdge";
    node?: GraphQLTypes["Review"] | undefined | null;
    "...on ReviewEdge": Omit<GraphQLTypes["ReviewEdge"], "...on ReviewEdge">;
  };
  /** Feed of mod edit activity */
  RevisionHistory: {
    __typename: "RevisionHistory";
    /** The action taken on the objects */
    action?: GraphQLTypes["RevisionHistoryAction"] | undefined | null;
    /** A JSON object of the fields that changed */
    changes?: GraphQLTypes["Json"] | undefined | null;
    /** The character the mod feed entry references */
    character?: GraphQLTypes["Character"] | undefined | null;
    /** When the mod feed entry was created */
    createdAt?: number | undefined | null;
    /** The external link source the mod feed entry references */
    externalLink?: GraphQLTypes["MediaExternalLink"] | undefined | null;
    /** The id of the media */
    id: number;
    /** The media the mod feed entry references */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The staff member the mod feed entry references */
    staff?: GraphQLTypes["Staff"] | undefined | null;
    /** The studio the mod feed entry references */
    studio?: GraphQLTypes["Studio"] | undefined | null;
    /** The user who made the edit to the object */
    user?: GraphQLTypes["User"] | undefined | null;
    "...on RevisionHistory": Omit<
      GraphQLTypes["RevisionHistory"],
      "...on RevisionHistory"
    >;
  };
  /** A user's list score distribution. */
  ScoreDistribution: {
    __typename: "ScoreDistribution";
    /** The amount of list entries with this score */
    amount?: number | undefined | null;
    score?: number | undefined | null;
    "...on ScoreDistribution": Omit<
      GraphQLTypes["ScoreDistribution"],
      "...on ScoreDistribution"
    >;
  };
  SiteStatistics: {
    __typename: "SiteStatistics";
    anime?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    characters?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    manga?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    reviews?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    staff?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    studios?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    users?: GraphQLTypes["SiteTrendConnection"] | undefined | null;
    "...on SiteStatistics": Omit<
      GraphQLTypes["SiteStatistics"],
      "...on SiteStatistics"
    >;
  };
  /** Daily site statistics */
  SiteTrend: {
    __typename: "SiteTrend";
    /** The change from yesterday */
    change: number;
    count: number;
    /** The day the data was recorded (timestamp) */
    date: number;
    "...on SiteTrend": Omit<GraphQLTypes["SiteTrend"], "...on SiteTrend">;
  };
  SiteTrendConnection: {
    __typename: "SiteTrendConnection";
    edges?:
      | Array<GraphQLTypes["SiteTrendEdge"] | undefined | null>
      | undefined
      | null;
    nodes?:
      | Array<GraphQLTypes["SiteTrend"] | undefined | null>
      | undefined
      | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on SiteTrendConnection": Omit<
      GraphQLTypes["SiteTrendConnection"],
      "...on SiteTrendConnection"
    >;
  };
  /** Site trend connection edge */
  SiteTrendEdge: {
    __typename: "SiteTrendEdge";
    node?: GraphQLTypes["SiteTrend"] | undefined | null;
    "...on SiteTrendEdge": Omit<
      GraphQLTypes["SiteTrendEdge"],
      "...on SiteTrendEdge"
    >;
  };
  /** Voice actors or production staff */
  Staff: {
    __typename: "Staff";
    /** The person's age in years */
    age?: number | undefined | null;
    /** The persons blood type */
    bloodType?: string | undefined | null;
    /** Media the actor voiced characters in. (Same data as characters with media as node instead of characters) */
    characterMedia?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** Characters voiced by the actor */
    characters?: GraphQLTypes["CharacterConnection"] | undefined | null;
    dateOfBirth?: GraphQLTypes["FuzzyDate"] | undefined | null;
    dateOfDeath?: GraphQLTypes["FuzzyDate"] | undefined | null;
    /** A general description of the staff member */
    description?: string | undefined | null;
    /** The amount of user's who have favourited the staff member */
    favourites?: number | undefined | null;
    /** The staff's gender. Usually Male, Female, or Non-binary but can be any string. */
    gender?: string | undefined | null;
    /** The persons birthplace or hometown */
    homeTown?: string | undefined | null;
    /** The id of the staff member */
    id: number;
    /** The staff images */
    image?: GraphQLTypes["StaffImage"] | undefined | null;
    /** If the staff member is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** If the staff member is blocked from being added to favourites */
    isFavouriteBlocked: boolean;
    /** The primary language the staff member dub's in */
    language?: GraphQLTypes["StaffLanguage"] | undefined | null;
    /** The primary language of the staff member. Current values: Japanese, English, Korean, Italian, Spanish, Portuguese, French, German, Hebrew, Hungarian, Chinese, Arabic, Filipino, Catalan, Finnish, Turkish, Dutch, Swedish, Thai, Tagalog, Malaysian, Indonesian, Vietnamese, Nepali, Hindi, Urdu */
    languageV2?: string | undefined | null;
    /** Notes for site moderators */
    modNotes?: string | undefined | null;
    /** The names of the staff member */
    name?: GraphQLTypes["StaffName"] | undefined | null;
    /** The person's primary occupations */
    primaryOccupations?: Array<string | undefined | null> | undefined | null;
    /** The url for the staff page on the AniList website */
    siteUrl?: string | undefined | null;
    /** Staff member that the submission is referencing */
    staff?: GraphQLTypes["Staff"] | undefined | null;
    /** Media where the staff member has a production role */
    staffMedia?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** Inner details of submission status */
    submissionNotes?: string | undefined | null;
    /** Status of the submission */
    submissionStatus?: number | undefined | null;
    /** Submitter for the submission */
    submitter?: GraphQLTypes["User"] | undefined | null;
    updatedAt?: number | undefined | null;
    /** [startYear, endYear] (If the 2nd value is not present staff is still active) */
    yearsActive?: Array<number | undefined | null> | undefined | null;
    "...on Staff": Omit<GraphQLTypes["Staff"], "...on Staff">;
  };
  StaffConnection: {
    __typename: "StaffConnection";
    edges?:
      | Array<GraphQLTypes["StaffEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<GraphQLTypes["Staff"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on StaffConnection": Omit<
      GraphQLTypes["StaffConnection"],
      "...on StaffConnection"
    >;
  };
  /** Staff connection edge */
  StaffEdge: {
    __typename: "StaffEdge";
    /** The order the staff should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    node?: GraphQLTypes["Staff"] | undefined | null;
    /** The role of the staff member in the production of the media */
    role?: string | undefined | null;
    "...on StaffEdge": Omit<GraphQLTypes["StaffEdge"], "...on StaffEdge">;
  };
  StaffImage: {
    __typename: "StaffImage";
    /** The person's image of media at its largest size */
    large?: string | undefined | null;
    /** The person's image of media at medium size */
    medium?: string | undefined | null;
    "...on StaffImage": Omit<GraphQLTypes["StaffImage"], "...on StaffImage">;
  };
  /** The names of the staff member */
  StaffName: {
    __typename: "StaffName";
    /** Other names the staff member might be referred to as (pen names) */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** The person's given name */
    first?: string | undefined | null;
    /** The person's first and last name */
    full?: string | undefined | null;
    /** The person's surname */
    last?: string | undefined | null;
    /** The person's middle name */
    middle?: string | undefined | null;
    /** The person's full name in their native language */
    native?: string | undefined | null;
    /** The currently authenticated users preferred name language. Default romaji for non-authenticated */
    userPreferred?: string | undefined | null;
    "...on StaffName": Omit<GraphQLTypes["StaffName"], "...on StaffName">;
  };
  /** Voice actor role for a character */
  StaffRoleType: {
    __typename: "StaffRoleType";
    /** Used for grouping roles where multiple dubs exist for the same language. Either dubbing company name or language variant. */
    dubGroup?: string | undefined | null;
    /** Notes regarding the VA's role for the character */
    roleNotes?: string | undefined | null;
    /** The voice actors of the character */
    voiceActor?: GraphQLTypes["Staff"] | undefined | null;
    "...on StaffRoleType": Omit<
      GraphQLTypes["StaffRoleType"],
      "...on StaffRoleType"
    >;
  };
  /** User's staff statistics */
  StaffStats: {
    __typename: "StaffStats";
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    staff?: GraphQLTypes["Staff"] | undefined | null;
    /** The amount of time in minutes the staff member has been watched by the user */
    timeWatched?: number | undefined | null;
    "...on StaffStats": Omit<GraphQLTypes["StaffStats"], "...on StaffStats">;
  };
  /** A submission for a staff that features in an anime or manga */
  StaffSubmission: {
    __typename: "StaffSubmission";
    /** Data Mod assigned to handle the submission */
    assignee?: GraphQLTypes["User"] | undefined | null;
    createdAt?: number | undefined | null;
    /** The id of the submission */
    id: number;
    /** Whether the submission is locked */
    locked?: boolean | undefined | null;
    /** Inner details of submission status */
    notes?: string | undefined | null;
    source?: string | undefined | null;
    /** Staff that the submission is referencing */
    staff?: GraphQLTypes["Staff"] | undefined | null;
    /** Status of the submission */
    status?: GraphQLTypes["SubmissionStatus"] | undefined | null;
    /** The staff submission changes */
    submission?: GraphQLTypes["Staff"] | undefined | null;
    /** Submitter for the submission */
    submitter?: GraphQLTypes["User"] | undefined | null;
    "...on StaffSubmission": Omit<
      GraphQLTypes["StaffSubmission"],
      "...on StaffSubmission"
    >;
  };
  /** The distribution of the watching/reading status of media or a user's list */
  StatusDistribution: {
    __typename: "StatusDistribution";
    /** The amount of entries with this status */
    amount?: number | undefined | null;
    /** The day the activity took place (Unix timestamp) */
    status?: GraphQLTypes["MediaListStatus"] | undefined | null;
    "...on StatusDistribution": Omit<
      GraphQLTypes["StatusDistribution"],
      "...on StatusDistribution"
    >;
  };
  /** Animation or production company */
  Studio: {
    __typename: "Studio";
    /** The amount of user's who have favourited the studio */
    favourites?: number | undefined | null;
    /** The id of the studio */
    id: number;
    /** If the studio is an animation studio or a different kind of company */
    isAnimationStudio: boolean;
    /** If the studio is marked as favourite by the currently authenticated user */
    isFavourite: boolean;
    /** The media the studio has worked on */
    media?: GraphQLTypes["MediaConnection"] | undefined | null;
    /** The name of the studio */
    name: string;
    /** The url for the studio page on the AniList website */
    siteUrl?: string | undefined | null;
    "...on Studio": Omit<GraphQLTypes["Studio"], "...on Studio">;
  };
  StudioConnection: {
    __typename: "StudioConnection";
    edges?:
      | Array<GraphQLTypes["StudioEdge"] | undefined | null>
      | undefined
      | null;
    nodes?: Array<GraphQLTypes["Studio"] | undefined | null> | undefined | null;
    /** The pagination information */
    pageInfo?: GraphQLTypes["PageInfo"] | undefined | null;
    "...on StudioConnection": Omit<
      GraphQLTypes["StudioConnection"],
      "...on StudioConnection"
    >;
  };
  /** Studio connection edge */
  StudioEdge: {
    __typename: "StudioEdge";
    /** The order the character should be displayed from the users favourites */
    favouriteOrder?: number | undefined | null;
    /** The id of the connection */
    id?: number | undefined | null;
    /** If the studio is the main animation studio of the anime */
    isMain: boolean;
    node?: GraphQLTypes["Studio"] | undefined | null;
    "...on StudioEdge": Omit<GraphQLTypes["StudioEdge"], "...on StudioEdge">;
  };
  /** User's studio statistics */
  StudioStats: {
    __typename: "StudioStats";
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    studio?: GraphQLTypes["Studio"] | undefined | null;
    /** The amount of time in minutes the studio's works have been watched by the user */
    timeWatched?: number | undefined | null;
    "...on StudioStats": Omit<GraphQLTypes["StudioStats"], "...on StudioStats">;
  };
  /** User's tag statistics */
  TagStats: {
    __typename: "TagStats";
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    tag?: GraphQLTypes["MediaTag"] | undefined | null;
    /** The amount of time in minutes the tag has been watched by the user */
    timeWatched?: number | undefined | null;
    "...on TagStats": Omit<GraphQLTypes["TagStats"], "...on TagStats">;
  };
  /** User text activity */
  TextActivity: {
    __typename: "TextActivity";
    /** The time the activity was created at */
    createdAt: number;
    /** The id of the activity */
    id: number;
    /** If the currently authenticated user liked the activity */
    isLiked?: boolean | undefined | null;
    /** If the activity is locked and can receive replies */
    isLocked?: boolean | undefined | null;
    /** If the activity is pinned to the top of the users activity feed */
    isPinned?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the activity */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the activity has */
    likeCount: number;
    /** The users who liked the activity */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The written replies to the activity */
    replies?:
      | Array<GraphQLTypes["ActivityReply"] | undefined | null>
      | undefined
      | null;
    /** The number of activity replies */
    replyCount: number;
    /** The url for the activity page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The status text (Markdown) */
    text?: string | undefined | null;
    /** The type of activity */
    type?: GraphQLTypes["ActivityType"] | undefined | null;
    /** The user who created the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The user id of the activity's creator */
    userId?: number | undefined | null;
    "...on TextActivity": Omit<
      GraphQLTypes["TextActivity"],
      "...on TextActivity"
    >;
  };
  /** Forum Thread */
  Thread: {
    __typename: "Thread";
    /** The text body of the thread (Markdown) */
    body?: string | undefined | null;
    /** The categories of the thread */
    categories?:
      | Array<GraphQLTypes["ThreadCategory"] | undefined | null>
      | undefined
      | null;
    /** The time of the thread creation */
    createdAt: number;
    /** The id of the thread */
    id: number;
    /** If the currently authenticated user liked the thread */
    isLiked?: boolean | undefined | null;
    /** If the thread is locked and can receive comments */
    isLocked?: boolean | undefined | null;
    /** If the thread is stickied and should be displayed at the top of the page */
    isSticky?: boolean | undefined | null;
    /** If the currently authenticated user is subscribed to the thread */
    isSubscribed?: boolean | undefined | null;
    /** The amount of likes the thread has */
    likeCount: number;
    /** The users who liked the thread */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The media categories of the thread */
    mediaCategories?:
      | Array<GraphQLTypes["Media"] | undefined | null>
      | undefined
      | null;
    /** The time of the last reply */
    repliedAt?: number | undefined | null;
    /** The id of the most recent comment on the thread */
    replyCommentId?: number | undefined | null;
    /** The number of comments on the thread */
    replyCount?: number | undefined | null;
    /** The user to last reply to the thread */
    replyUser?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who most recently commented on the thread */
    replyUserId?: number | undefined | null;
    /** The url for the thread page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The title of the thread */
    title?: string | undefined | null;
    /** The time of the thread last update */
    updatedAt: number;
    /** The owner of the thread */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the thread owner user */
    userId: number;
    /** The number of times users have viewed the thread */
    viewCount?: number | undefined | null;
    "...on Thread": Omit<GraphQLTypes["Thread"], "...on Thread">;
  };
  /** A forum thread category */
  ThreadCategory: {
    __typename: "ThreadCategory";
    /** The id of the category */
    id: number;
    /** The name of the category */
    name: string;
    "...on ThreadCategory": Omit<
      GraphQLTypes["ThreadCategory"],
      "...on ThreadCategory"
    >;
  };
  /** Forum Thread Comment */
  ThreadComment: {
    __typename: "ThreadComment";
    /** The comment's child reply comments */
    childComments?: GraphQLTypes["Json"] | undefined | null;
    /** The text content of the comment (Markdown) */
    comment?: string | undefined | null;
    /** The time of the comments creation */
    createdAt: number;
    /** The id of the comment */
    id: number;
    /** If the currently authenticated user liked the comment */
    isLiked?: boolean | undefined | null;
    /** If the comment tree is locked and may not receive replies or edits */
    isLocked?: boolean | undefined | null;
    /** The amount of likes the comment has */
    likeCount: number;
    /** The users who liked the comment */
    likes?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    /** The url for the comment page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The thread the comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The id of thread the comment belongs to */
    threadId?: number | undefined | null;
    /** The time of the comments last update */
    updatedAt: number;
    /** The user who created the comment */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The user id of the comment's owner */
    userId?: number | undefined | null;
    "...on ThreadComment": Omit<
      GraphQLTypes["ThreadComment"],
      "...on ThreadComment"
    >;
  };
  /** Notification for when a thread comment is liked */
  ThreadCommentLikeNotification: {
    __typename: "ThreadCommentLikeNotification";
    /** The thread comment that was liked */
    comment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** The id of the activity which was liked */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
    "...on ThreadCommentLikeNotification": Omit<
      GraphQLTypes["ThreadCommentLikeNotification"],
      "...on ThreadCommentLikeNotification"
    >;
  };
  /** Notification for when authenticated user is @ mentioned in a forum thread comment */
  ThreadCommentMentionNotification: {
    __typename: "ThreadCommentMentionNotification";
    /** The thread comment that included the @ mention */
    comment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** The id of the comment where mentioned */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who mentioned the authenticated user */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who mentioned the authenticated user */
    userId: number;
    "...on ThreadCommentMentionNotification": Omit<
      GraphQLTypes["ThreadCommentMentionNotification"],
      "...on ThreadCommentMentionNotification"
    >;
  };
  /** Notification for when a user replies to your forum thread comment */
  ThreadCommentReplyNotification: {
    __typename: "ThreadCommentReplyNotification";
    /** The reply thread comment */
    comment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** The id of the reply comment */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who replied to the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who create the comment reply */
    userId: number;
    "...on ThreadCommentReplyNotification": Omit<
      GraphQLTypes["ThreadCommentReplyNotification"],
      "...on ThreadCommentReplyNotification"
    >;
  };
  /** Notification for when a user replies to a subscribed forum thread */
  ThreadCommentSubscribedNotification: {
    __typename: "ThreadCommentSubscribedNotification";
    /** The reply thread comment */
    comment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** The id of the new comment in the subscribed thread */
    commentId: number;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who replied to the subscribed thread */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who commented on the thread */
    userId: number;
    "...on ThreadCommentSubscribedNotification": Omit<
      GraphQLTypes["ThreadCommentSubscribedNotification"],
      "...on ThreadCommentSubscribedNotification"
    >;
  };
  /** Notification for when a thread is liked */
  ThreadLikeNotification: {
    __typename: "ThreadLikeNotification";
    /** The liked thread comment */
    comment?: GraphQLTypes["ThreadComment"] | undefined | null;
    /** The notification context text */
    context?: string | undefined | null;
    /** The time the notification was created at */
    createdAt?: number | undefined | null;
    /** The id of the Notification */
    id: number;
    /** The thread that the relevant comment belongs to */
    thread?: GraphQLTypes["Thread"] | undefined | null;
    /** The id of the thread which was liked */
    threadId: number;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
    /** The user who liked the activity */
    user?: GraphQLTypes["User"] | undefined | null;
    /** The id of the user who liked to the activity */
    userId: number;
    "...on ThreadLikeNotification": Omit<
      GraphQLTypes["ThreadLikeNotification"],
      "...on ThreadLikeNotification"
    >;
  };
  /** A user */
  User: {
    __typename: "User";
    /** The bio written by user (Markdown) */
    about?: string | undefined | null;
    /** The user's avatar images */
    avatar?: GraphQLTypes["UserAvatar"] | undefined | null;
    /** The user's banner images */
    bannerImage?: string | undefined | null;
    bans?: GraphQLTypes["Json"] | undefined | null;
    /** When the user's account was created. (Does not exist for accounts created before 2020) */
    createdAt?: number | undefined | null;
    /** Custom donation badge text */
    donatorBadge?: string | undefined | null;
    /** The donation tier of the user */
    donatorTier?: number | undefined | null;
    /** The users favourites */
    favourites?: GraphQLTypes["Favourites"] | undefined | null;
    /** The id of the user */
    id: number;
    /** If the user is blocked by the authenticated user */
    isBlocked?: boolean | undefined | null;
    /** If this user if following the authenticated user */
    isFollower?: boolean | undefined | null;
    /** If the authenticated user if following this user */
    isFollowing?: boolean | undefined | null;
    /** The user's media list options */
    mediaListOptions?: GraphQLTypes["MediaListOptions"] | undefined | null;
    /** The user's moderator roles if they are a site moderator */
    moderatorRoles?:
      | Array<GraphQLTypes["ModRole"] | undefined | null>
      | undefined
      | null;
    /** If the user is a moderator or data moderator */
    moderatorStatus?: string | undefined | null;
    /** The name of the user */
    name: string;
    /** The user's general options */
    options?: GraphQLTypes["UserOptions"] | undefined | null;
    /** The user's previously used names. */
    previousNames?:
      | Array<GraphQLTypes["UserPreviousName"] | undefined | null>
      | undefined
      | null;
    /** The url for the user page on the AniList website */
    siteUrl?: string | undefined | null;
    /** The users anime & manga list statistics */
    statistics?: GraphQLTypes["UserStatisticTypes"] | undefined | null;
    /** The user's statistics */
    stats?: GraphQLTypes["UserStats"] | undefined | null;
    /** The number of unread notifications the user has */
    unreadNotificationCount?: number | undefined | null;
    /** When the user's data was last updated */
    updatedAt?: number | undefined | null;
    "...on User": Omit<GraphQLTypes["User"], "...on User">;
  };
  /** A user's activity history stats. */
  UserActivityHistory: {
    __typename: "UserActivityHistory";
    /** The amount of activity on the day */
    amount?: number | undefined | null;
    /** The day the activity took place (Unix timestamp) */
    date?: number | undefined | null;
    /** The level of activity represented on a 1-10 scale */
    level?: number | undefined | null;
    "...on UserActivityHistory": Omit<
      GraphQLTypes["UserActivityHistory"],
      "...on UserActivityHistory"
    >;
  };
  /** A user's avatars */
  UserAvatar: {
    __typename: "UserAvatar";
    /** The avatar of user at its largest size */
    large?: string | undefined | null;
    /** The avatar of user at medium size */
    medium?: string | undefined | null;
    "...on UserAvatar": Omit<GraphQLTypes["UserAvatar"], "...on UserAvatar">;
  };
  UserCountryStatistic: {
    __typename: "UserCountryStatistic";
    chaptersRead: number;
    count: number;
    country?: GraphQLTypes["CountryCode"] | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    "...on UserCountryStatistic": Omit<
      GraphQLTypes["UserCountryStatistic"],
      "...on UserCountryStatistic"
    >;
  };
  UserFormatStatistic: {
    __typename: "UserFormatStatistic";
    chaptersRead: number;
    count: number;
    format?: GraphQLTypes["MediaFormat"] | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    "...on UserFormatStatistic": Omit<
      GraphQLTypes["UserFormatStatistic"],
      "...on UserFormatStatistic"
    >;
  };
  UserGenreStatistic: {
    __typename: "UserGenreStatistic";
    chaptersRead: number;
    count: number;
    genre?: string | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    "...on UserGenreStatistic": Omit<
      GraphQLTypes["UserGenreStatistic"],
      "...on UserGenreStatistic"
    >;
  };
  UserLengthStatistic: {
    __typename: "UserLengthStatistic";
    chaptersRead: number;
    count: number;
    length?: string | undefined | null;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    "...on UserLengthStatistic": Omit<
      GraphQLTypes["UserLengthStatistic"],
      "...on UserLengthStatistic"
    >;
  };
  /** User data for moderators */
  UserModData: {
    __typename: "UserModData";
    alts?: Array<GraphQLTypes["User"] | undefined | null> | undefined | null;
    bans?: GraphQLTypes["Json"] | undefined | null;
    counts?: GraphQLTypes["Json"] | undefined | null;
    email?: string | undefined | null;
    ip?: GraphQLTypes["Json"] | undefined | null;
    privacy?: number | undefined | null;
    "...on UserModData": Omit<GraphQLTypes["UserModData"], "...on UserModData">;
  };
  /** A user's general options */
  UserOptions: {
    __typename: "UserOptions";
    /** Minutes between activity for them to be merged together. 0 is Never, Above 2 weeks (20160 mins) is Always. */
    activityMergeTime?: number | undefined | null;
    /** Whether the user receives notifications when a show they are watching aires */
    airingNotifications?: boolean | undefined | null;
    /** The list activity types the user has disabled from being created from list updates */
    disabledListActivity?:
      | Array<GraphQLTypes["ListActivityOption"] | undefined | null>
      | undefined
      | null;
    /** Whether the user has enabled viewing of 18+ content */
    displayAdultContent?: boolean | undefined | null;
    /** Notification options */
    notificationOptions?:
      | Array<GraphQLTypes["NotificationOption"] | undefined | null>
      | undefined
      | null;
    /** Profile highlight color (blue, purple, pink, orange, red, green, gray) */
    profileColor?: string | undefined | null;
    /** Whether the user only allow messages from users they follow */
    restrictMessagesToFollowing?: boolean | undefined | null;
    /** The language the user wants to see staff and character names in */
    staffNameLanguage?:
      | GraphQLTypes["UserStaffNameLanguage"]
      | undefined
      | null;
    /** The user's timezone offset (Auth user only) */
    timezone?: string | undefined | null;
    /** The language the user wants to see media titles in */
    titleLanguage?: GraphQLTypes["UserTitleLanguage"] | undefined | null;
    "...on UserOptions": Omit<GraphQLTypes["UserOptions"], "...on UserOptions">;
  };
  /** A user's previous name */
  UserPreviousName: {
    __typename: "UserPreviousName";
    /** When the user first changed from this name. */
    createdAt?: number | undefined | null;
    /** A previous name of the user. */
    name?: string | undefined | null;
    /** When the user most recently changed from this name. */
    updatedAt?: number | undefined | null;
    "...on UserPreviousName": Omit<
      GraphQLTypes["UserPreviousName"],
      "...on UserPreviousName"
    >;
  };
  UserReleaseYearStatistic: {
    __typename: "UserReleaseYearStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    releaseYear?: number | undefined | null;
    "...on UserReleaseYearStatistic": Omit<
      GraphQLTypes["UserReleaseYearStatistic"],
      "...on UserReleaseYearStatistic"
    >;
  };
  UserScoreStatistic: {
    __typename: "UserScoreStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    score?: number | undefined | null;
    "...on UserScoreStatistic": Omit<
      GraphQLTypes["UserScoreStatistic"],
      "...on UserScoreStatistic"
    >;
  };
  UserStaffStatistic: {
    __typename: "UserStaffStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    staff?: GraphQLTypes["Staff"] | undefined | null;
    "...on UserStaffStatistic": Omit<
      GraphQLTypes["UserStaffStatistic"],
      "...on UserStaffStatistic"
    >;
  };
  UserStartYearStatistic: {
    __typename: "UserStartYearStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    startYear?: number | undefined | null;
    "...on UserStartYearStatistic": Omit<
      GraphQLTypes["UserStartYearStatistic"],
      "...on UserStartYearStatistic"
    >;
  };
  UserStatisticTypes: {
    __typename: "UserStatisticTypes";
    anime?: GraphQLTypes["UserStatistics"] | undefined | null;
    manga?: GraphQLTypes["UserStatistics"] | undefined | null;
    "...on UserStatisticTypes": Omit<
      GraphQLTypes["UserStatisticTypes"],
      "...on UserStatisticTypes"
    >;
  };
  UserStatistics: {
    __typename: "UserStatistics";
    chaptersRead: number;
    count: number;
    countries?:
      | Array<GraphQLTypes["UserCountryStatistic"] | undefined | null>
      | undefined
      | null;
    episodesWatched: number;
    formats?:
      | Array<GraphQLTypes["UserFormatStatistic"] | undefined | null>
      | undefined
      | null;
    genres?:
      | Array<GraphQLTypes["UserGenreStatistic"] | undefined | null>
      | undefined
      | null;
    lengths?:
      | Array<GraphQLTypes["UserLengthStatistic"] | undefined | null>
      | undefined
      | null;
    meanScore: number;
    minutesWatched: number;
    releaseYears?:
      | Array<GraphQLTypes["UserReleaseYearStatistic"] | undefined | null>
      | undefined
      | null;
    scores?:
      | Array<GraphQLTypes["UserScoreStatistic"] | undefined | null>
      | undefined
      | null;
    staff?:
      | Array<GraphQLTypes["UserStaffStatistic"] | undefined | null>
      | undefined
      | null;
    standardDeviation: number;
    startYears?:
      | Array<GraphQLTypes["UserStartYearStatistic"] | undefined | null>
      | undefined
      | null;
    statuses?:
      | Array<GraphQLTypes["UserStatusStatistic"] | undefined | null>
      | undefined
      | null;
    studios?:
      | Array<GraphQLTypes["UserStudioStatistic"] | undefined | null>
      | undefined
      | null;
    tags?:
      | Array<GraphQLTypes["UserTagStatistic"] | undefined | null>
      | undefined
      | null;
    voiceActors?:
      | Array<GraphQLTypes["UserVoiceActorStatistic"] | undefined | null>
      | undefined
      | null;
    volumesRead: number;
    "...on UserStatistics": Omit<
      GraphQLTypes["UserStatistics"],
      "...on UserStatistics"
    >;
  };
  /** A user's statistics */
  UserStats: {
    __typename: "UserStats";
    activityHistory?:
      | Array<GraphQLTypes["UserActivityHistory"] | undefined | null>
      | undefined
      | null;
    animeListScores?: GraphQLTypes["ListScoreStats"] | undefined | null;
    animeScoreDistribution?:
      | Array<GraphQLTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    animeStatusDistribution?:
      | Array<GraphQLTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
    /** The amount of manga chapters the user has read */
    chaptersRead?: number | undefined | null;
    favouredActors?:
      | Array<GraphQLTypes["StaffStats"] | undefined | null>
      | undefined
      | null;
    favouredFormats?:
      | Array<GraphQLTypes["FormatStats"] | undefined | null>
      | undefined
      | null;
    favouredGenres?:
      | Array<GraphQLTypes["GenreStats"] | undefined | null>
      | undefined
      | null;
    favouredGenresOverview?:
      | Array<GraphQLTypes["GenreStats"] | undefined | null>
      | undefined
      | null;
    favouredStaff?:
      | Array<GraphQLTypes["StaffStats"] | undefined | null>
      | undefined
      | null;
    favouredStudios?:
      | Array<GraphQLTypes["StudioStats"] | undefined | null>
      | undefined
      | null;
    favouredTags?:
      | Array<GraphQLTypes["TagStats"] | undefined | null>
      | undefined
      | null;
    favouredYears?:
      | Array<GraphQLTypes["YearStats"] | undefined | null>
      | undefined
      | null;
    mangaListScores?: GraphQLTypes["ListScoreStats"] | undefined | null;
    mangaScoreDistribution?:
      | Array<GraphQLTypes["ScoreDistribution"] | undefined | null>
      | undefined
      | null;
    mangaStatusDistribution?:
      | Array<GraphQLTypes["StatusDistribution"] | undefined | null>
      | undefined
      | null;
    /** The amount of anime the user has watched in minutes */
    watchedTime?: number | undefined | null;
    "...on UserStats": Omit<GraphQLTypes["UserStats"], "...on UserStats">;
  };
  UserStatusStatistic: {
    __typename: "UserStatusStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    status?: GraphQLTypes["MediaListStatus"] | undefined | null;
    "...on UserStatusStatistic": Omit<
      GraphQLTypes["UserStatusStatistic"],
      "...on UserStatusStatistic"
    >;
  };
  UserStudioStatistic: {
    __typename: "UserStudioStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    studio?: GraphQLTypes["Studio"] | undefined | null;
    "...on UserStudioStatistic": Omit<
      GraphQLTypes["UserStudioStatistic"],
      "...on UserStudioStatistic"
    >;
  };
  UserTagStatistic: {
    __typename: "UserTagStatistic";
    chaptersRead: number;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    tag?: GraphQLTypes["MediaTag"] | undefined | null;
    "...on UserTagStatistic": Omit<
      GraphQLTypes["UserTagStatistic"],
      "...on UserTagStatistic"
    >;
  };
  UserVoiceActorStatistic: {
    __typename: "UserVoiceActorStatistic";
    chaptersRead: number;
    characterIds: Array<number | undefined | null>;
    count: number;
    meanScore: number;
    mediaIds: Array<number | undefined | null>;
    minutesWatched: number;
    voiceActor?: GraphQLTypes["Staff"] | undefined | null;
    "...on UserVoiceActorStatistic": Omit<
      GraphQLTypes["UserVoiceActorStatistic"],
      "...on UserVoiceActorStatistic"
    >;
  };
  /** User's year statistics */
  YearStats: {
    __typename: "YearStats";
    amount?: number | undefined | null;
    meanScore?: number | undefined | null;
    year?: number | undefined | null;
    "...on YearStats": Omit<GraphQLTypes["YearStats"], "...on YearStats">;
  };
  /** Activity sort enums */
  ActivitySort: ActivitySort;
  /** Activity type enum. */
  ActivityType: ActivityType;
  /** Airing schedule sort enums */
  AiringSort: AiringSort;
  /** The role the character plays in the media */
  CharacterRole: CharacterRole;
  /** Character sort enums */
  CharacterSort: CharacterSort;
  ExternalLinkMediaType: ExternalLinkMediaType;
  ExternalLinkType: ExternalLinkType;
  /** Types that can be liked */
  LikeableType: LikeableType;
  /** The format the media was released in */
  MediaFormat: MediaFormat;
  /** Media list sort enums */
  MediaListSort: MediaListSort;
  /** Media list watching/reading status enum. */
  MediaListStatus: MediaListStatus;
  /** The type of ranking */
  MediaRankType: MediaRankType;
  /** Type of relation media has to its parent. */
  MediaRelation: MediaRelation;
  MediaSeason: MediaSeason;
  /** Media sort enums */
  MediaSort: MediaSort;
  /** Source type the media was adapted from */
  MediaSource: MediaSource;
  /** The current releasing status of the media */
  MediaStatus: MediaStatus;
  /** Media trend sort enums */
  MediaTrendSort: MediaTrendSort;
  /** Media type enum, anime or manga. */
  MediaType: MediaType;
  ModActionType: ModActionType;
  /** Mod role enums */
  ModRole: ModRole;
  /** Notification type enum */
  NotificationType: NotificationType;
  /** Recommendation rating enums */
  RecommendationRating: RecommendationRating;
  /** Recommendation sort enums */
  RecommendationSort: RecommendationSort;
  /** Review rating enums */
  ReviewRating: ReviewRating;
  /** Review sort enums */
  ReviewSort: ReviewSort;
  /** Revision history actions */
  RevisionHistoryAction: RevisionHistoryAction;
  /** Media list scoring type */
  ScoreFormat: ScoreFormat;
  /** Site trend sort enums */
  SiteTrendSort: SiteTrendSort;
  /** The primary language of the voice actor */
  StaffLanguage: StaffLanguage;
  /** Staff sort enums */
  StaffSort: StaffSort;
  /** Studio sort enums */
  StudioSort: StudioSort;
  /** Submission sort enums */
  SubmissionSort: SubmissionSort;
  /** Submission status */
  SubmissionStatus: SubmissionStatus;
  /** Thread comments sort enums */
  ThreadCommentSort: ThreadCommentSort;
  /** Thread sort enums */
  ThreadSort: ThreadSort;
  /** User sort enums */
  UserSort: UserSort;
  /** The language the user wants to see staff and character names in */
  UserStaffNameLanguage: UserStaffNameLanguage;
  /** User statistics sort enum */
  UserStatisticsSort: UserStatisticsSort;
  /** The language the user wants to see media titles in */
  UserTitleLanguage: UserTitleLanguage;
  /** ISO 3166-1 alpha-2 country code */
  CountryCode: "scalar" & { name: "CountryCode" };
  /** 8 digit long date integer (YYYYMMDD). Unknown dates represented by 0. E.g. 2016: 20160000, May 1976: 19760500 */
  FuzzyDateInt: "scalar" & { name: "FuzzyDateInt" };
  Json: "scalar" & { name: "Json" };
  AiringScheduleInput: {
    airingAt?: number | undefined | null;
    episode?: number | undefined | null;
    timeUntilAiring?: number | undefined | null;
  };
  AniChartHighlightInput: {
    highlight?: string | undefined | null;
    mediaId?: number | undefined | null;
  };
  /** The names of the character */
  CharacterNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** Other names the character might be referred to as but are spoilers */
    alternativeSpoiler?: Array<string | undefined | null> | undefined | null;
    /** The character's given name */
    first?: string | undefined | null;
    /** The character's surname */
    last?: string | undefined | null;
    /** The character's middle name */
    middle?: string | undefined | null;
    /** The character's full name in their native language */
    native?: string | undefined | null;
  };
  /** Date object that allows for incomplete date values (fuzzy) */
  FuzzyDateInput: {
    /** Numeric Day (24) */
    day?: number | undefined | null;
    /** Numeric Month (3) */
    month?: number | undefined | null;
    /** Numeric Year (2017) */
    year?: number | undefined | null;
  };
  ListActivityOptionInput: {
    disabled?: boolean | undefined | null;
    type?: GraphQLTypes["MediaListStatus"] | undefined | null;
  };
  /** An external link to another site related to the media */
  MediaExternalLinkInput: {
    /** The id of the external link */
    id: number;
    /** The site location of the external link */
    site: string;
    /** The url of the external link */
    url: string;
  };
  /** A user's list options for anime or manga lists */
  MediaListOptionsInput: {
    /** The names of the user's advanced scoring sections */
    advancedScoring?: Array<string | undefined | null> | undefined | null;
    /** If advanced scoring is enabled */
    advancedScoringEnabled?: boolean | undefined | null;
    /** The names of the user's custom lists */
    customLists?: Array<string | undefined | null> | undefined | null;
    /** The order each list should be displayed in */
    sectionOrder?: Array<string | undefined | null> | undefined | null;
    /** If the completed sections of the list should be separated by format */
    splitCompletedSectionByFormat?: boolean | undefined | null;
    /** list theme */
    theme?: string | undefined | null;
  };
  /** The official titles of the media in various languages */
  MediaTitleInput: {
    /** The official english title */
    english?: string | undefined | null;
    /** Official title in it's native language */
    native?: string | undefined | null;
    /** The romanization of the native language title */
    romaji?: string | undefined | null;
  };
  /** Notification option input */
  NotificationOptionInput: {
    /** Whether this type of notification is enabled */
    enabled?: boolean | undefined | null;
    /** The type of notification */
    type?: GraphQLTypes["NotificationType"] | undefined | null;
  };
  /** The names of the staff member */
  StaffNameInput: {
    /** Other names the character might be referred by */
    alternative?: Array<string | undefined | null> | undefined | null;
    /** The person's given name */
    first?: string | undefined | null;
    /** The person's surname */
    last?: string | undefined | null;
    /** The person's middle name */
    middle?: string | undefined | null;
    /** The person's full name in their native language */
    native?: string | undefined | null;
  };
  ID: "scalar" & { name: "ID" };
};
/** Activity sort enums */
export enum ActivitySort {
  ID = "ID",
  ID_DESC = "ID_DESC",
  PINNED = "PINNED",
}
/** Activity type enum. */
export enum ActivityType {
  ANIME_LIST = "ANIME_LIST",
  MANGA_LIST = "MANGA_LIST",
  MEDIA_LIST = "MEDIA_LIST",
  MESSAGE = "MESSAGE",
  TEXT = "TEXT",
}
/** Airing schedule sort enums */
export enum AiringSort {
  EPISODE = "EPISODE",
  EPISODE_DESC = "EPISODE_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  MEDIA_ID = "MEDIA_ID",
  MEDIA_ID_DESC = "MEDIA_ID_DESC",
  TIME = "TIME",
  TIME_DESC = "TIME_DESC",
}
/** The role the character plays in the media */
export enum CharacterRole {
  BACKGROUND = "BACKGROUND",
  MAIN = "MAIN",
  SUPPORTING = "SUPPORTING",
}
/** Character sort enums */
export enum CharacterSort {
  FAVOURITES = "FAVOURITES",
  FAVOURITES_DESC = "FAVOURITES_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  RELEVANCE = "RELEVANCE",
  ROLE = "ROLE",
  ROLE_DESC = "ROLE_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
}
export enum ExternalLinkMediaType {
  ANIME = "ANIME",
  MANGA = "MANGA",
  STAFF = "STAFF",
}
export enum ExternalLinkType {
  INFO = "INFO",
  SOCIAL = "SOCIAL",
  STREAMING = "STREAMING",
}
/** Types that can be liked */
export enum LikeableType {
  ACTIVITY = "ACTIVITY",
  ACTIVITY_REPLY = "ACTIVITY_REPLY",
  THREAD = "THREAD",
  THREAD_COMMENT = "THREAD_COMMENT",
}
/** The format the media was released in */
export enum MediaFormat {
  MANGA = "MANGA",
  MOVIE = "MOVIE",
  MUSIC = "MUSIC",
  NOVEL = "NOVEL",
  ONA = "ONA",
  ONE_SHOT = "ONE_SHOT",
  OVA = "OVA",
  SPECIAL = "SPECIAL",
  TV = "TV",
  TV_SHORT = "TV_SHORT",
}
/** Media list sort enums */
export enum MediaListSort {
  ADDED_TIME = "ADDED_TIME",
  ADDED_TIME_DESC = "ADDED_TIME_DESC",
  FINISHED_ON = "FINISHED_ON",
  FINISHED_ON_DESC = "FINISHED_ON_DESC",
  MEDIA_ID = "MEDIA_ID",
  MEDIA_ID_DESC = "MEDIA_ID_DESC",
  MEDIA_POPULARITY = "MEDIA_POPULARITY",
  MEDIA_POPULARITY_DESC = "MEDIA_POPULARITY_DESC",
  MEDIA_TITLE_ENGLISH = "MEDIA_TITLE_ENGLISH",
  MEDIA_TITLE_ENGLISH_DESC = "MEDIA_TITLE_ENGLISH_DESC",
  MEDIA_TITLE_NATIVE = "MEDIA_TITLE_NATIVE",
  MEDIA_TITLE_NATIVE_DESC = "MEDIA_TITLE_NATIVE_DESC",
  MEDIA_TITLE_ROMAJI = "MEDIA_TITLE_ROMAJI",
  MEDIA_TITLE_ROMAJI_DESC = "MEDIA_TITLE_ROMAJI_DESC",
  PRIORITY = "PRIORITY",
  PRIORITY_DESC = "PRIORITY_DESC",
  PROGRESS = "PROGRESS",
  PROGRESS_DESC = "PROGRESS_DESC",
  PROGRESS_VOLUMES = "PROGRESS_VOLUMES",
  PROGRESS_VOLUMES_DESC = "PROGRESS_VOLUMES_DESC",
  REPEAT = "REPEAT",
  REPEAT_DESC = "REPEAT_DESC",
  SCORE = "SCORE",
  SCORE_DESC = "SCORE_DESC",
  STARTED_ON = "STARTED_ON",
  STARTED_ON_DESC = "STARTED_ON_DESC",
  STATUS = "STATUS",
  STATUS_DESC = "STATUS_DESC",
  UPDATED_TIME = "UPDATED_TIME",
  UPDATED_TIME_DESC = "UPDATED_TIME_DESC",
}
/** Media list watching/reading status enum. */
export enum MediaListStatus {
  COMPLETED = "COMPLETED",
  CURRENT = "CURRENT",
  DROPPED = "DROPPED",
  PAUSED = "PAUSED",
  PLANNING = "PLANNING",
  REPEATING = "REPEATING",
}
/** The type of ranking */
export enum MediaRankType {
  POPULAR = "POPULAR",
  RATED = "RATED",
}
/** Type of relation media has to its parent. */
export enum MediaRelation {
  ADAPTATION = "ADAPTATION",
  ALTERNATIVE = "ALTERNATIVE",
  CHARACTER = "CHARACTER",
  COMPILATION = "COMPILATION",
  CONTAINS = "CONTAINS",
  OTHER = "OTHER",
  PARENT = "PARENT",
  PREQUEL = "PREQUEL",
  SEQUEL = "SEQUEL",
  SIDE_STORY = "SIDE_STORY",
  SOURCE = "SOURCE",
  SPIN_OFF = "SPIN_OFF",
  SUMMARY = "SUMMARY",
}
export enum MediaSeason {
  FALL = "FALL",
  SPRING = "SPRING",
  SUMMER = "SUMMER",
  WINTER = "WINTER",
}
/** Media sort enums */
export enum MediaSort {
  CHAPTERS = "CHAPTERS",
  CHAPTERS_DESC = "CHAPTERS_DESC",
  DURATION = "DURATION",
  DURATION_DESC = "DURATION_DESC",
  END_DATE = "END_DATE",
  END_DATE_DESC = "END_DATE_DESC",
  EPISODES = "EPISODES",
  EPISODES_DESC = "EPISODES_DESC",
  FAVOURITES = "FAVOURITES",
  FAVOURITES_DESC = "FAVOURITES_DESC",
  FORMAT = "FORMAT",
  FORMAT_DESC = "FORMAT_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  POPULARITY = "POPULARITY",
  POPULARITY_DESC = "POPULARITY_DESC",
  SCORE = "SCORE",
  SCORE_DESC = "SCORE_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
  START_DATE = "START_DATE",
  START_DATE_DESC = "START_DATE_DESC",
  STATUS = "STATUS",
  STATUS_DESC = "STATUS_DESC",
  TITLE_ENGLISH = "TITLE_ENGLISH",
  TITLE_ENGLISH_DESC = "TITLE_ENGLISH_DESC",
  TITLE_NATIVE = "TITLE_NATIVE",
  TITLE_NATIVE_DESC = "TITLE_NATIVE_DESC",
  TITLE_ROMAJI = "TITLE_ROMAJI",
  TITLE_ROMAJI_DESC = "TITLE_ROMAJI_DESC",
  TRENDING = "TRENDING",
  TRENDING_DESC = "TRENDING_DESC",
  TYPE = "TYPE",
  TYPE_DESC = "TYPE_DESC",
  UPDATED_AT = "UPDATED_AT",
  UPDATED_AT_DESC = "UPDATED_AT_DESC",
  VOLUMES = "VOLUMES",
  VOLUMES_DESC = "VOLUMES_DESC",
}
/** Source type the media was adapted from */
export enum MediaSource {
  ANIME = "ANIME",
  COMIC = "COMIC",
  DOUJINSHI = "DOUJINSHI",
  GAME = "GAME",
  LIGHT_NOVEL = "LIGHT_NOVEL",
  LIVE_ACTION = "LIVE_ACTION",
  MANGA = "MANGA",
  MULTIMEDIA_PROJECT = "MULTIMEDIA_PROJECT",
  NOVEL = "NOVEL",
  ORIGINAL = "ORIGINAL",
  OTHER = "OTHER",
  PICTURE_BOOK = "PICTURE_BOOK",
  VIDEO_GAME = "VIDEO_GAME",
  VISUAL_NOVEL = "VISUAL_NOVEL",
  WEB_NOVEL = "WEB_NOVEL",
}
/** The current releasing status of the media */
export enum MediaStatus {
  CANCELLED = "CANCELLED",
  FINISHED = "FINISHED",
  HIATUS = "HIATUS",
  NOT_YET_RELEASED = "NOT_YET_RELEASED",
  RELEASING = "RELEASING",
}
/** Media trend sort enums */
export enum MediaTrendSort {
  DATE = "DATE",
  DATE_DESC = "DATE_DESC",
  EPISODE = "EPISODE",
  EPISODE_DESC = "EPISODE_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  MEDIA_ID = "MEDIA_ID",
  MEDIA_ID_DESC = "MEDIA_ID_DESC",
  POPULARITY = "POPULARITY",
  POPULARITY_DESC = "POPULARITY_DESC",
  SCORE = "SCORE",
  SCORE_DESC = "SCORE_DESC",
  TRENDING = "TRENDING",
  TRENDING_DESC = "TRENDING_DESC",
}
/** Media type enum, anime or manga. */
export enum MediaType {
  ANIME = "ANIME",
  MANGA = "MANGA",
}
export enum ModActionType {
  ANON = "ANON",
  BAN = "BAN",
  DELETE = "DELETE",
  EDIT = "EDIT",
  EXPIRE = "EXPIRE",
  NOTE = "NOTE",
  REPORT = "REPORT",
  RESET = "RESET",
}
/** Mod role enums */
export enum ModRole {
  ADMIN = "ADMIN",
  ANIME_DATA = "ANIME_DATA",
  CHARACTER_DATA = "CHARACTER_DATA",
  COMMUNITY = "COMMUNITY",
  DEVELOPER = "DEVELOPER",
  DISCORD_COMMUNITY = "DISCORD_COMMUNITY",
  LEAD_ANIME_DATA = "LEAD_ANIME_DATA",
  LEAD_COMMUNITY = "LEAD_COMMUNITY",
  LEAD_DEVELOPER = "LEAD_DEVELOPER",
  LEAD_MANGA_DATA = "LEAD_MANGA_DATA",
  LEAD_SOCIAL_MEDIA = "LEAD_SOCIAL_MEDIA",
  MANGA_DATA = "MANGA_DATA",
  RETIRED = "RETIRED",
  SOCIAL_MEDIA = "SOCIAL_MEDIA",
  STAFF_DATA = "STAFF_DATA",
}
/** Notification type enum */
export enum NotificationType {
  ACTIVITY_LIKE = "ACTIVITY_LIKE",
  ACTIVITY_MENTION = "ACTIVITY_MENTION",
  ACTIVITY_MESSAGE = "ACTIVITY_MESSAGE",
  ACTIVITY_REPLY = "ACTIVITY_REPLY",
  ACTIVITY_REPLY_LIKE = "ACTIVITY_REPLY_LIKE",
  ACTIVITY_REPLY_SUBSCRIBED = "ACTIVITY_REPLY_SUBSCRIBED",
  AIRING = "AIRING",
  FOLLOWING = "FOLLOWING",
  MEDIA_DATA_CHANGE = "MEDIA_DATA_CHANGE",
  MEDIA_DELETION = "MEDIA_DELETION",
  MEDIA_MERGE = "MEDIA_MERGE",
  RELATED_MEDIA_ADDITION = "RELATED_MEDIA_ADDITION",
  THREAD_COMMENT_LIKE = "THREAD_COMMENT_LIKE",
  THREAD_COMMENT_MENTION = "THREAD_COMMENT_MENTION",
  THREAD_COMMENT_REPLY = "THREAD_COMMENT_REPLY",
  THREAD_LIKE = "THREAD_LIKE",
  THREAD_SUBSCRIBED = "THREAD_SUBSCRIBED",
}
/** Recommendation rating enums */
export enum RecommendationRating {
  NO_RATING = "NO_RATING",
  RATE_DOWN = "RATE_DOWN",
  RATE_UP = "RATE_UP",
}
/** Recommendation sort enums */
export enum RecommendationSort {
  ID = "ID",
  ID_DESC = "ID_DESC",
  RATING = "RATING",
  RATING_DESC = "RATING_DESC",
}
/** Review rating enums */
export enum ReviewRating {
  DOWN_VOTE = "DOWN_VOTE",
  NO_VOTE = "NO_VOTE",
  UP_VOTE = "UP_VOTE",
}
/** Review sort enums */
export enum ReviewSort {
  CREATED_AT = "CREATED_AT",
  CREATED_AT_DESC = "CREATED_AT_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  RATING = "RATING",
  RATING_DESC = "RATING_DESC",
  SCORE = "SCORE",
  SCORE_DESC = "SCORE_DESC",
  UPDATED_AT = "UPDATED_AT",
  UPDATED_AT_DESC = "UPDATED_AT_DESC",
}
/** Revision history actions */
export enum RevisionHistoryAction {
  CREATE = "CREATE",
  EDIT = "EDIT",
}
/** Media list scoring type */
export enum ScoreFormat {
  POINT_10 = "POINT_10",
  POINT_100 = "POINT_100",
  POINT_10_DECIMAL = "POINT_10_DECIMAL",
  POINT_3 = "POINT_3",
  POINT_5 = "POINT_5",
}
/** Site trend sort enums */
export enum SiteTrendSort {
  CHANGE = "CHANGE",
  CHANGE_DESC = "CHANGE_DESC",
  COUNT = "COUNT",
  COUNT_DESC = "COUNT_DESC",
  DATE = "DATE",
  DATE_DESC = "DATE_DESC",
}
/** The primary language of the voice actor */
export enum StaffLanguage {
  ENGLISH = "ENGLISH",
  FRENCH = "FRENCH",
  GERMAN = "GERMAN",
  HEBREW = "HEBREW",
  HUNGARIAN = "HUNGARIAN",
  ITALIAN = "ITALIAN",
  JAPANESE = "JAPANESE",
  KOREAN = "KOREAN",
  PORTUGUESE = "PORTUGUESE",
  SPANISH = "SPANISH",
}
/** Staff sort enums */
export enum StaffSort {
  FAVOURITES = "FAVOURITES",
  FAVOURITES_DESC = "FAVOURITES_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  LANGUAGE = "LANGUAGE",
  LANGUAGE_DESC = "LANGUAGE_DESC",
  RELEVANCE = "RELEVANCE",
  ROLE = "ROLE",
  ROLE_DESC = "ROLE_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
}
/** Studio sort enums */
export enum StudioSort {
  FAVOURITES = "FAVOURITES",
  FAVOURITES_DESC = "FAVOURITES_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  NAME = "NAME",
  NAME_DESC = "NAME_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
}
/** Submission sort enums */
export enum SubmissionSort {
  ID = "ID",
  ID_DESC = "ID_DESC",
}
/** Submission status */
export enum SubmissionStatus {
  ACCEPTED = "ACCEPTED",
  PARTIALLY_ACCEPTED = "PARTIALLY_ACCEPTED",
  PENDING = "PENDING",
  REJECTED = "REJECTED",
}
/** Thread comments sort enums */
export enum ThreadCommentSort {
  ID = "ID",
  ID_DESC = "ID_DESC",
}
/** Thread sort enums */
export enum ThreadSort {
  CREATED_AT = "CREATED_AT",
  CREATED_AT_DESC = "CREATED_AT_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  IS_STICKY = "IS_STICKY",
  REPLIED_AT = "REPLIED_AT",
  REPLIED_AT_DESC = "REPLIED_AT_DESC",
  REPLY_COUNT = "REPLY_COUNT",
  REPLY_COUNT_DESC = "REPLY_COUNT_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
  TITLE = "TITLE",
  TITLE_DESC = "TITLE_DESC",
  UPDATED_AT = "UPDATED_AT",
  UPDATED_AT_DESC = "UPDATED_AT_DESC",
  VIEW_COUNT = "VIEW_COUNT",
  VIEW_COUNT_DESC = "VIEW_COUNT_DESC",
}
/** User sort enums */
export enum UserSort {
  CHAPTERS_READ = "CHAPTERS_READ",
  CHAPTERS_READ_DESC = "CHAPTERS_READ_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  SEARCH_MATCH = "SEARCH_MATCH",
  USERNAME = "USERNAME",
  USERNAME_DESC = "USERNAME_DESC",
  WATCHED_TIME = "WATCHED_TIME",
  WATCHED_TIME_DESC = "WATCHED_TIME_DESC",
}
/** The language the user wants to see staff and character names in */
export enum UserStaffNameLanguage {
  NATIVE = "NATIVE",
  ROMAJI = "ROMAJI",
  ROMAJI_WESTERN = "ROMAJI_WESTERN",
}
/** User statistics sort enum */
export enum UserStatisticsSort {
  COUNT = "COUNT",
  COUNT_DESC = "COUNT_DESC",
  ID = "ID",
  ID_DESC = "ID_DESC",
  MEAN_SCORE = "MEAN_SCORE",
  MEAN_SCORE_DESC = "MEAN_SCORE_DESC",
  PROGRESS = "PROGRESS",
  PROGRESS_DESC = "PROGRESS_DESC",
}
/** The language the user wants to see media titles in */
export enum UserTitleLanguage {
  ENGLISH = "ENGLISH",
  ENGLISH_STYLISED = "ENGLISH_STYLISED",
  NATIVE = "NATIVE",
  NATIVE_STYLISED = "NATIVE_STYLISED",
  ROMAJI = "ROMAJI",
  ROMAJI_STYLISED = "ROMAJI_STYLISED",
}

type ZEUS_VARIABLES = {
  ActivitySort: ValueTypes["ActivitySort"];
  ActivityType: ValueTypes["ActivityType"];
  AiringSort: ValueTypes["AiringSort"];
  CharacterRole: ValueTypes["CharacterRole"];
  CharacterSort: ValueTypes["CharacterSort"];
  ExternalLinkMediaType: ValueTypes["ExternalLinkMediaType"];
  ExternalLinkType: ValueTypes["ExternalLinkType"];
  LikeableType: ValueTypes["LikeableType"];
  MediaFormat: ValueTypes["MediaFormat"];
  MediaListSort: ValueTypes["MediaListSort"];
  MediaListStatus: ValueTypes["MediaListStatus"];
  MediaRankType: ValueTypes["MediaRankType"];
  MediaRelation: ValueTypes["MediaRelation"];
  MediaSeason: ValueTypes["MediaSeason"];
  MediaSort: ValueTypes["MediaSort"];
  MediaSource: ValueTypes["MediaSource"];
  MediaStatus: ValueTypes["MediaStatus"];
  MediaTrendSort: ValueTypes["MediaTrendSort"];
  MediaType: ValueTypes["MediaType"];
  ModActionType: ValueTypes["ModActionType"];
  ModRole: ValueTypes["ModRole"];
  NotificationType: ValueTypes["NotificationType"];
  RecommendationRating: ValueTypes["RecommendationRating"];
  RecommendationSort: ValueTypes["RecommendationSort"];
  ReviewRating: ValueTypes["ReviewRating"];
  ReviewSort: ValueTypes["ReviewSort"];
  RevisionHistoryAction: ValueTypes["RevisionHistoryAction"];
  ScoreFormat: ValueTypes["ScoreFormat"];
  SiteTrendSort: ValueTypes["SiteTrendSort"];
  StaffLanguage: ValueTypes["StaffLanguage"];
  StaffSort: ValueTypes["StaffSort"];
  StudioSort: ValueTypes["StudioSort"];
  SubmissionSort: ValueTypes["SubmissionSort"];
  SubmissionStatus: ValueTypes["SubmissionStatus"];
  ThreadCommentSort: ValueTypes["ThreadCommentSort"];
  ThreadSort: ValueTypes["ThreadSort"];
  UserSort: ValueTypes["UserSort"];
  UserStaffNameLanguage: ValueTypes["UserStaffNameLanguage"];
  UserStatisticsSort: ValueTypes["UserStatisticsSort"];
  UserTitleLanguage: ValueTypes["UserTitleLanguage"];
  CountryCode: ValueTypes["CountryCode"];
  FuzzyDateInt: ValueTypes["FuzzyDateInt"];
  Json: ValueTypes["Json"];
  AiringScheduleInput: ValueTypes["AiringScheduleInput"];
  AniChartHighlightInput: ValueTypes["AniChartHighlightInput"];
  CharacterNameInput: ValueTypes["CharacterNameInput"];
  FuzzyDateInput: ValueTypes["FuzzyDateInput"];
  ListActivityOptionInput: ValueTypes["ListActivityOptionInput"];
  MediaExternalLinkInput: ValueTypes["MediaExternalLinkInput"];
  MediaListOptionsInput: ValueTypes["MediaListOptionsInput"];
  MediaTitleInput: ValueTypes["MediaTitleInput"];
  NotificationOptionInput: ValueTypes["NotificationOptionInput"];
  StaffNameInput: ValueTypes["StaffNameInput"];
  ID: ValueTypes["ID"];
};
