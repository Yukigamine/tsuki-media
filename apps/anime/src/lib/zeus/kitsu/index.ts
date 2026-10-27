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
type ZEUS_INTERFACES =
  | GraphQLTypes["AmountConsumed"]
  | GraphQLTypes["CategoryBreakdown"]
  | GraphQLTypes["Episodic"]
  | GraphQLTypes["Error"]
  | GraphQLTypes["Media"]
  | GraphQLTypes["Streamable"]
  | GraphQLTypes["Unit"]
  | GraphQLTypes["WithTimestamps"];
export type ScalarCoders = {
  Date?: ScalarResolver;
  ISO8601Date?: ScalarResolver;
  ISO8601DateTime?: ScalarResolver;
  JSON?: ScalarResolver;
  Map?: ScalarResolver;
  Upload?: ScalarResolver;
  ID?: ScalarResolver;
};
type ZEUS_UNIONS =
  | GraphQLTypes["AccountChangePasswordErrorsUnion"]
  | GraphQLTypes["AccountCreateErrorsUnion"]
  | GraphQLTypes["AccountUpdateErrorsUnion"]
  | GraphQLTypes["BlockCreateErrorsUnion"]
  | GraphQLTypes["BlockDeleteErrorsUnion"]
  | GraphQLTypes["FavoriteCreateErrorsUnion"]
  | GraphQLTypes["FavoriteDeleteErrorsUnion"]
  | GraphQLTypes["FavoriteItemUnion"]
  | GraphQLTypes["MappingItemUnion"]
  | GraphQLTypes["MediaReactionCreateErrorsUnion"]
  | GraphQLTypes["MediaReactionDeleteErrorsUnion"]
  | GraphQLTypes["MediaReactionLikeErrorsUnion"]
  | GraphQLTypes["MediaReactionUnlikeErrorsUnion"]
  | GraphQLTypes["ProfileLinkCreateErrorsUnion"]
  | GraphQLTypes["ProfileLinkDeleteErrorsUnion"]
  | GraphQLTypes["ProfileLinkUpdateErrorsUnion"]
  | GraphQLTypes["ProfileUpdateErrorsUnion"]
  | GraphQLTypes["ReportItemUnion"];

export type ValueTypes = {
  /** Generic Amount Consumed based on Media */
  AmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    "...on AnimeAmountConsumed"?: Omit<
      ValueTypes["AnimeAmountConsumed"],
      keyof ValueTypes["AmountConsumed"]
    >;
    "...on MangaAmountConsumed"?: Omit<
      ValueTypes["MangaAmountConsumed"],
      keyof ValueTypes["AmountConsumed"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** Generic Category Breakdown based on Media */
  CategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    "...on AnimeCategoryBreakdown"?: Omit<
      ValueTypes["AnimeCategoryBreakdown"],
      keyof ValueTypes["CategoryBreakdown"]
    >;
    "...on MangaCategoryBreakdown"?: Omit<
      ValueTypes["MangaCategoryBreakdown"],
      keyof ValueTypes["CategoryBreakdown"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** An episodic media in the Kitsu database */
  Episodic: AliasType<{
    /** The number of episodes in this series */
    episodeCount?: boolean | `@${string}`;
    /** The general length (in seconds) of each episode */
    episodeLength?: boolean | `@${string}`;
    episodes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["EpisodeSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["EpisodeConnection"],
    ];
    /** The total length (in seconds) of the entire series */
    totalLength?: boolean | `@${string}`;
    "...on Anime"?: Omit<ValueTypes["Anime"], keyof ValueTypes["Episodic"]>;
    __typename?: boolean | `@${string}`;
  }>;
  /** Generic error fields used by all errors. */
  Error: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    "...on GenericError"?: Omit<
      ValueTypes["GenericError"],
      keyof ValueTypes["Error"]
    >;
    "...on NotAuthenticatedError"?: Omit<
      ValueTypes["NotAuthenticatedError"],
      keyof ValueTypes["Error"]
    >;
    "...on NotAuthorizedError"?: Omit<
      ValueTypes["NotAuthorizedError"],
      keyof ValueTypes["Error"]
    >;
    "...on NotFoundError"?: Omit<
      ValueTypes["NotFoundError"],
      keyof ValueTypes["Error"]
    >;
    "...on ValidationError"?: Omit<
      ValueTypes["ValidationError"],
      keyof ValueTypes["Error"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** A media in the Kitsu database */
  Media: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ValueTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCategorySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CategoryConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCharacterSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaCharacterConnection"],
    ];
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ValueTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ValueTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["PostSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaReactionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaRelationshipConnection"],
    ];
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ValueTypes["TitlesList"];
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    "...on Anime"?: Omit<ValueTypes["Anime"], keyof ValueTypes["Media"]>;
    "...on Manga"?: Omit<ValueTypes["Manga"], keyof ValueTypes["Media"]>;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media that is streamable. */
  Streamable: AliasType<{
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ValueTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    "...on StreamingLink"?: Omit<
      ValueTypes["StreamingLink"],
      keyof ValueTypes["Streamable"]
    >;
    "...on Video"?: Omit<ValueTypes["Video"], keyof ValueTypes["Streamable"]>;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media units such as episodes or chapters */
  Unit: AliasType<{
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ValueTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ValueTypes["TitlesList"];
    "...on Chapter"?: Omit<ValueTypes["Chapter"], keyof ValueTypes["Unit"]>;
    "...on Episode"?: Omit<ValueTypes["Episode"], keyof ValueTypes["Unit"]>;
    "...on Volume"?: Omit<ValueTypes["Volume"], keyof ValueTypes["Unit"]>;
    __typename?: boolean | `@${string}`;
  }>;
  WithTimestamps: AliasType<{
    createdAt?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    "...on Account"?: Omit<
      ValueTypes["Account"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Anime"?: Omit<
      ValueTypes["Anime"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Block"?: Omit<
      ValueTypes["Block"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Category"?: Omit<
      ValueTypes["Category"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Chapter"?: Omit<
      ValueTypes["Chapter"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Character"?: Omit<
      ValueTypes["Character"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on CharacterVoice"?: Omit<
      ValueTypes["CharacterVoice"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Comment"?: Omit<
      ValueTypes["Comment"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Episode"?: Omit<
      ValueTypes["Episode"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Favorite"?: Omit<
      ValueTypes["Favorite"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Franchise"?: Omit<
      ValueTypes["Franchise"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Installment"?: Omit<
      ValueTypes["Installment"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on LibraryEntry"?: Omit<
      ValueTypes["LibraryEntry"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on LibraryEvent"?: Omit<
      ValueTypes["LibraryEvent"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Manga"?: Omit<
      ValueTypes["Manga"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Mapping"?: Omit<
      ValueTypes["Mapping"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on MediaCharacter"?: Omit<
      ValueTypes["MediaCharacter"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on MediaProduction"?: Omit<
      ValueTypes["MediaProduction"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on MediaReaction"?: Omit<
      ValueTypes["MediaReaction"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on MediaRelationship"?: Omit<
      ValueTypes["MediaRelationship"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on MediaStaff"?: Omit<
      ValueTypes["MediaStaff"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Person"?: Omit<
      ValueTypes["Person"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Post"?: Omit<ValueTypes["Post"], keyof ValueTypes["WithTimestamps"]>;
    "...on ProSubscription"?: Omit<
      ValueTypes["ProSubscription"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Producer"?: Omit<
      ValueTypes["Producer"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Profile"?: Omit<
      ValueTypes["Profile"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on ProfileLinkSite"?: Omit<
      ValueTypes["ProfileLinkSite"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Quote"?: Omit<
      ValueTypes["Quote"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on QuoteLine"?: Omit<
      ValueTypes["QuoteLine"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Report"?: Omit<
      ValueTypes["Report"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Review"?: Omit<
      ValueTypes["Review"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on SiteLink"?: Omit<
      ValueTypes["SiteLink"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Streamer"?: Omit<
      ValueTypes["Streamer"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on StreamingLink"?: Omit<
      ValueTypes["StreamingLink"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Video"?: Omit<
      ValueTypes["Video"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on Volume"?: Omit<
      ValueTypes["Volume"],
      keyof ValueTypes["WithTimestamps"]
    >;
    "...on WikiSubmission"?: Omit<
      ValueTypes["WikiSubmission"],
      keyof ValueTypes["WithTimestamps"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  AccountChangePasswordErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on ValidationError"?: ValueTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  AccountCreateErrorsUnion: AliasType<{
    "...on ValidationError"?: ValueTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  AccountUpdateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  BlockCreateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  BlockDeleteErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  FavoriteCreateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  FavoriteDeleteErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Favoritable */
  FavoriteItemUnion: AliasType<{
    "...on Anime"?: ValueTypes["Anime"];
    "...on Character"?: ValueTypes["Character"];
    "...on Manga"?: ValueTypes["Manga"];
    "...on Person"?: ValueTypes["Person"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Mappable */
  MappingItemUnion: AliasType<{
    "...on Anime"?: ValueTypes["Anime"];
    "...on Category"?: ValueTypes["Category"];
    "...on Character"?: ValueTypes["Character"];
    "...on Episode"?: ValueTypes["Episode"];
    "...on Manga"?: ValueTypes["Manga"];
    "...on Person"?: ValueTypes["Person"];
    "...on Producer"?: ValueTypes["Producer"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionCreateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    "...on ValidationError"?: ValueTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionDeleteErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionLikeErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionUnlikeErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkCreateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    "...on ValidationError"?: ValueTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkDeleteErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkUpdateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    "...on ValidationError"?: ValueTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileUpdateErrorsUnion: AliasType<{
    "...on NotAuthenticatedError"?: ValueTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError"?: ValueTypes["NotAuthorizedError"];
    "...on NotFoundError"?: ValueTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Reportable */
  ReportItemUnion: AliasType<{
    "...on Comment"?: ValueTypes["Comment"];
    "...on MediaReaction"?: ValueTypes["MediaReaction"];
    "...on Post"?: ValueTypes["Post"];
    "...on Review"?: ValueTypes["Review"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A user account on Kitsu */
  Account: AliasType<{
    /** The country this user resides in */
    country?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The email addresses associated with this account */
    email?: boolean | `@${string}`;
    /** The features this user has access to */
    enabledFeatures?: boolean | `@${string}`;
    /** Facebook account linked to the account */
    facebookId?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Primary language for the account */
    language?: boolean | `@${string}`;
    /** Longest period an account has had a PRO subscription for in seconds */
    maxProStreak?: boolean | `@${string}`;
    /** The PRO subscription for this account */
    proSubscription?: ValueTypes["ProSubscription"];
    /** The profile for this account */
    profile?: ValueTypes["Profile"];
    /** Media rating system used for the account */
    ratingSystem?: boolean | `@${string}`;
    /** Whether Not Safe For Work content is accessible */
    sfwFilter?: boolean | `@${string}`;
    /** The level of the SFW Filter */
    sfwFilterPreference?: boolean | `@${string}`;
    /** The site-wide permissions this user has access to */
    sitePermissions?: boolean | `@${string}`;
    /** Time zone of the account */
    timeZone?: boolean | `@${string}`;
    /** Preferred language for media titles */
    titleLanguagePreference?: boolean | `@${string}`;
    /** Twitter account linked to the account */
    twitterId?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Account"?: Omit<ValueTypes["Account"], "...on Account">;
  }>;
  /** Autogenerated return type of AccountChangePassword. */
  AccountChangePasswordPayload: AliasType<{
    errors?: ValueTypes["AccountChangePasswordErrorsUnion"];
    result?: ValueTypes["Account"];
    __typename?: boolean | `@${string}`;
    "...on AccountChangePasswordPayload"?: Omit<
      ValueTypes["AccountChangePasswordPayload"],
      "...on AccountChangePasswordPayload"
    >;
  }>;
  /** Autogenerated return type of AccountCreate. */
  AccountCreatePayload: AliasType<{
    errors?: ValueTypes["AccountCreateErrorsUnion"];
    result?: ValueTypes["Account"];
    __typename?: boolean | `@${string}`;
    "...on AccountCreatePayload"?: Omit<
      ValueTypes["AccountCreatePayload"],
      "...on AccountCreatePayload"
    >;
  }>;
  AccountMutations: AliasType<{
    changePassword?: [
      {
        input: ValueTypes["AccountChangePasswordInput"] | Variable<any, string>;
      },
      ValueTypes["AccountChangePasswordPayload"],
    ];
    sendPasswordReset?: [
      {
        /** The email address to reset the password for */
        email: string | Variable<any, string>;
      },
      ValueTypes["AccountSendPasswordResetPayload"],
    ];
    update?: [
      { input: ValueTypes["AccountUpdateInput"] | Variable<any, string> },
      ValueTypes["AccountUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on AccountMutations"?: Omit<
      ValueTypes["AccountMutations"],
      "...on AccountMutations"
    >;
  }>;
  /** Autogenerated return type of AccountSendPasswordReset. */
  AccountSendPasswordResetPayload: AliasType<{
    email?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AccountSendPasswordResetPayload"?: Omit<
      ValueTypes["AccountSendPasswordResetPayload"],
      "...on AccountSendPasswordResetPayload"
    >;
  }>;
  /** Autogenerated return type of AccountUpdate. */
  AccountUpdatePayload: AliasType<{
    errors?: ValueTypes["AccountUpdateErrorsUnion"];
    result?: ValueTypes["Account"];
    __typename?: boolean | `@${string}`;
    "...on AccountUpdatePayload"?: Omit<
      ValueTypes["AccountUpdatePayload"],
      "...on AccountUpdatePayload"
    >;
  }>;
  Anime: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ValueTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCategorySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CategoryConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCharacterSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaCharacterConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of episodes in this series */
    episodeCount?: boolean | `@${string}`;
    /** The general length (in seconds) of each episode */
    episodeLength?: boolean | `@${string}`;
    episodes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["EpisodeSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["EpisodeConnection"],
    ];
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ValueTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ValueTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["PostSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaReactionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaRelationshipConnection"],
    ];
    /** The season this was released in */
    season?: boolean | `@${string}`;
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    streamingLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["StreamingLinkConnection"],
    ];
    /** A secondary type for categorizing Anime. */
    subtype?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ValueTypes["TitlesList"];
    /** The total length (in seconds) of the entire series */
    totalLength?: boolean | `@${string}`;
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    /** Video id for a trailer on YouTube */
    youtubeTrailerVideoId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Anime"?: Omit<ValueTypes["Anime"], "...on Anime">;
  }>;
  AnimeAmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total time spent in minutes. */
    time?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AnimeAmountConsumed"?: Omit<
      ValueTypes["AnimeAmountConsumed"],
      "...on AnimeAmountConsumed"
    >;
  }>;
  AnimeCategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AnimeCategoryBreakdown"?: Omit<
      ValueTypes["AnimeCategoryBreakdown"],
      "...on AnimeCategoryBreakdown"
    >;
  }>;
  /** The connection type for Anime. */
  AnimeConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["AnimeEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Anime"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on AnimeConnection"?: Omit<
      ValueTypes["AnimeConnection"],
      "...on AnimeConnection"
    >;
  }>;
  /** Autogenerated return type of AnimeCreate. */
  AnimeCreatePayload: AliasType<{
    anime?: ValueTypes["Anime"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on AnimeCreatePayload"?: Omit<
      ValueTypes["AnimeCreatePayload"],
      "...on AnimeCreatePayload"
    >;
  }>;
  /** Autogenerated return type of AnimeDelete. */
  AnimeDeletePayload: AliasType<{
    anime?: ValueTypes["GenericDelete"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on AnimeDeletePayload"?: Omit<
      ValueTypes["AnimeDeletePayload"],
      "...on AnimeDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  AnimeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Anime"];
    __typename?: boolean | `@${string}`;
    "...on AnimeEdge"?: Omit<ValueTypes["AnimeEdge"], "...on AnimeEdge">;
  }>;
  AnimeMutations: AliasType<{
    create?: [
      {
        /** Create an Anime. */
        input: ValueTypes["AnimeCreateInput"] | Variable<any, string>;
      },
      ValueTypes["AnimeCreatePayload"],
    ];
    delete?: [
      {
        /** Delete an Anime. */
        input: ValueTypes["GenericDeleteInput"] | Variable<any, string>;
      },
      ValueTypes["AnimeDeletePayload"],
    ];
    update?: [
      {
        /** Update an Anime. */
        input: ValueTypes["AnimeUpdateInput"] | Variable<any, string>;
      },
      ValueTypes["AnimeUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on AnimeMutations"?: Omit<
      ValueTypes["AnimeMutations"],
      "...on AnimeMutations"
    >;
  }>;
  /** Autogenerated return type of AnimeUpdate. */
  AnimeUpdatePayload: AliasType<{
    anime?: ValueTypes["Anime"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on AnimeUpdatePayload"?: Omit<
      ValueTypes["AnimeUpdatePayload"],
      "...on AnimeUpdatePayload"
    >;
  }>;
  /** A blocked user entry of an Account. */
  Block: AliasType<{
    /** User who got blocked. */
    blockedUser?: ValueTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** User who blocked. */
    user?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on Block"?: Omit<ValueTypes["Block"], "...on Block">;
  }>;
  /** The connection type for Block. */
  BlockConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["BlockEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Block"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on BlockConnection"?: Omit<
      ValueTypes["BlockConnection"],
      "...on BlockConnection"
    >;
  }>;
  /** Autogenerated return type of BlockCreate. */
  BlockCreatePayload: AliasType<{
    errors?: ValueTypes["BlockCreateErrorsUnion"];
    result?: ValueTypes["Block"];
    __typename?: boolean | `@${string}`;
    "...on BlockCreatePayload"?: Omit<
      ValueTypes["BlockCreatePayload"],
      "...on BlockCreatePayload"
    >;
  }>;
  /** Autogenerated return type of BlockDelete. */
  BlockDeletePayload: AliasType<{
    errors?: ValueTypes["BlockDeleteErrorsUnion"];
    result?: ValueTypes["Block"];
    __typename?: boolean | `@${string}`;
    "...on BlockDeletePayload"?: Omit<
      ValueTypes["BlockDeletePayload"],
      "...on BlockDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  BlockEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Block"];
    __typename?: boolean | `@${string}`;
    "...on BlockEdge"?: Omit<ValueTypes["BlockEdge"], "...on BlockEdge">;
  }>;
  BlockMutations: AliasType<{
    create?: [
      { input: ValueTypes["BlockCreateInput"] | Variable<any, string> },
      ValueTypes["BlockCreatePayload"],
    ];
    delete?: [
      { input: ValueTypes["BlockDeleteInput"] | Variable<any, string> },
      ValueTypes["BlockDeletePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on BlockMutations"?: Omit<
      ValueTypes["BlockMutations"],
      "...on BlockMutations"
    >;
  }>;
  /** Information about a specific Category */
  Category: AliasType<{
    children?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CategoryConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** Whether the category is Not-Safe-for-Work. */
    isNsfw?: boolean | `@${string}`;
    /** The parent category. Each category can have one parent. */
    parent?: ValueTypes["Category"];
    /** The top-level ancestor category */
    root?: ValueTypes["Category"];
    /** The URL-friendly identifier of this Category. */
    slug?: boolean | `@${string}`;
    title?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Category"?: Omit<ValueTypes["Category"], "...on Category">;
  }>;
  /** The connection type for Category. */
  CategoryConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["CategoryEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Category"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CategoryConnection"?: Omit<
      ValueTypes["CategoryConnection"],
      "...on CategoryConnection"
    >;
  }>;
  /** An edge in a connection. */
  CategoryEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Category"];
    __typename?: boolean | `@${string}`;
    "...on CategoryEdge"?: Omit<
      ValueTypes["CategoryEdge"],
      "...on CategoryEdge"
    >;
  }>;
  /** A single chapter of a manga */
  Chapter: AliasType<{
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** Number of pages in chapter. */
    length?: boolean | `@${string}`;
    /** The manga this chapter is in. */
    manga?: ValueTypes["Manga"];
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** When this chapter was released */
    releasedAt?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ValueTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ValueTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    /** The volume this chapter is in. */
    volume?: ValueTypes["Volume"];
    __typename?: boolean | `@${string}`;
    "...on Chapter"?: Omit<ValueTypes["Chapter"], "...on Chapter">;
  }>;
  /** The connection type for Chapter. */
  ChapterConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["ChapterEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Chapter"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ChapterConnection"?: Omit<
      ValueTypes["ChapterConnection"],
      "...on ChapterConnection"
    >;
  }>;
  /** An edge in a connection. */
  ChapterEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Chapter"];
    __typename?: boolean | `@${string}`;
    "...on ChapterEdge"?: Omit<ValueTypes["ChapterEdge"], "...on ChapterEdge">;
  }>;
  /** Information about a Character in the Kitsu database */
  Character: AliasType<{
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** An image of the character */
    image?: ValueTypes["Image"];
    media?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaCharacterConnection"],
    ];
    /** The name for this character in various locales */
    names?: ValueTypes["TitlesList"];
    /** The original media this character showed up in */
    primaryMedia?: ValueTypes["Media"];
    /** The URL-friendly identifier of this character */
    slug?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Character"?: Omit<ValueTypes["Character"], "...on Character">;
  }>;
  /** Information about a VA (Person) voicing a Character in a Media */
  CharacterVoice: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The company who hired this voice actor to play this role */
    licensor?: ValueTypes["Producer"];
    /** The BCP47 locale tag for the voice acting role */
    locale?: boolean | `@${string}`;
    /** The MediaCharacter node */
    mediaCharacter?: ValueTypes["MediaCharacter"];
    /** The person who voice acted this role */
    person?: ValueTypes["Person"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CharacterVoice"?: Omit<
      ValueTypes["CharacterVoice"],
      "...on CharacterVoice"
    >;
  }>;
  /** The connection type for CharacterVoice. */
  CharacterVoiceConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["CharacterVoiceEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["CharacterVoice"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CharacterVoiceConnection"?: Omit<
      ValueTypes["CharacterVoiceConnection"],
      "...on CharacterVoiceConnection"
    >;
  }>;
  /** An edge in a connection. */
  CharacterVoiceEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["CharacterVoice"];
    __typename?: boolean | `@${string}`;
    "...on CharacterVoiceEdge"?: Omit<
      ValueTypes["CharacterVoiceEdge"],
      "...on CharacterVoiceEdge"
    >;
  }>;
  /** A comment on a post */
  Comment: AliasType<{
    /** The user who created this comment for the parent post. */
    author?: ValueTypes["Profile"];
    /** Unmodified content. */
    content?: boolean | `@${string}`;
    /** Html formatted content. */
    contentFormatted?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CommentLikeSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** The parent comment if this comment was a reply to another. */
    parent?: ValueTypes["Comment"];
    /** The post that this comment is attached to. */
    post?: ValueTypes["Post"];
    replies?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CommentSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CommentConnection"],
    ];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Comment"?: Omit<ValueTypes["Comment"], "...on Comment">;
  }>;
  /** The connection type for Comment. */
  CommentConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["CommentEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Comment"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on CommentConnection"?: Omit<
      ValueTypes["CommentConnection"],
      "...on CommentConnection"
    >;
  }>;
  /** An edge in a connection. */
  CommentEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Comment"];
    __typename?: boolean | `@${string}`;
    "...on CommentEdge"?: Omit<ValueTypes["CommentEdge"], "...on CommentEdge">;
  }>;
  /** An Episode of a Media */
  Episode: AliasType<{
    /** The anime this episode is in */
    anime?: ValueTypes["Anime"];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The length of the episode in seconds */
    length?: boolean | `@${string}`;
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** When this episode aired */
    releasedAt?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ValueTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ValueTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Episode"?: Omit<ValueTypes["Episode"], "...on Episode">;
  }>;
  /** The connection type for Episode. */
  EpisodeConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["EpisodeEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Episode"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on EpisodeConnection"?: Omit<
      ValueTypes["EpisodeConnection"],
      "...on EpisodeConnection"
    >;
  }>;
  /** Autogenerated return type of EpisodeCreate. */
  EpisodeCreatePayload: AliasType<{
    episode?: ValueTypes["Episode"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on EpisodeCreatePayload"?: Omit<
      ValueTypes["EpisodeCreatePayload"],
      "...on EpisodeCreatePayload"
    >;
  }>;
  /** Autogenerated return type of EpisodeDelete. */
  EpisodeDeletePayload: AliasType<{
    episode?: ValueTypes["GenericDelete"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on EpisodeDeletePayload"?: Omit<
      ValueTypes["EpisodeDeletePayload"],
      "...on EpisodeDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  EpisodeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Episode"];
    __typename?: boolean | `@${string}`;
    "...on EpisodeEdge"?: Omit<ValueTypes["EpisodeEdge"], "...on EpisodeEdge">;
  }>;
  EpisodeMutations: AliasType<{
    create?: [
      {
        /** Create an Episode */
        input: ValueTypes["EpisodeCreateInput"] | Variable<any, string>;
      },
      ValueTypes["EpisodeCreatePayload"],
    ];
    delete?: [
      {
        /** Delete an Episode */
        input: ValueTypes["GenericDeleteInput"] | Variable<any, string>;
      },
      ValueTypes["EpisodeDeletePayload"],
    ];
    update?: [
      {
        /** Update an Episode */
        input: ValueTypes["EpisodeUpdateInput"] | Variable<any, string>;
      },
      ValueTypes["EpisodeUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on EpisodeMutations"?: Omit<
      ValueTypes["EpisodeMutations"],
      "...on EpisodeMutations"
    >;
  }>;
  /** Autogenerated return type of EpisodeUpdate. */
  EpisodeUpdatePayload: AliasType<{
    episode?: ValueTypes["Episode"];
    errors?: ValueTypes["Error"];
    __typename?: boolean | `@${string}`;
    "...on EpisodeUpdatePayload"?: Omit<
      ValueTypes["EpisodeUpdatePayload"],
      "...on EpisodeUpdatePayload"
    >;
  }>;
  /** Favorite media, characters, and people for a user */
  Favorite: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The kitsu object that is mapped */
    item?: ValueTypes["FavoriteItemUnion"];
    updatedAt?: boolean | `@${string}`;
    /** The user who favorited this item */
    user?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on Favorite"?: Omit<ValueTypes["Favorite"], "...on Favorite">;
  }>;
  /** The connection type for Favorite. */
  FavoriteConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["FavoriteEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Favorite"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on FavoriteConnection"?: Omit<
      ValueTypes["FavoriteConnection"],
      "...on FavoriteConnection"
    >;
  }>;
  /** Autogenerated return type of FavoriteCreate. */
  FavoriteCreatePayload: AliasType<{
    errors?: ValueTypes["FavoriteCreateErrorsUnion"];
    result?: ValueTypes["Favorite"];
    __typename?: boolean | `@${string}`;
    "...on FavoriteCreatePayload"?: Omit<
      ValueTypes["FavoriteCreatePayload"],
      "...on FavoriteCreatePayload"
    >;
  }>;
  /** Autogenerated return type of FavoriteDelete. */
  FavoriteDeletePayload: AliasType<{
    errors?: ValueTypes["FavoriteDeleteErrorsUnion"];
    result?: ValueTypes["Favorite"];
    __typename?: boolean | `@${string}`;
    "...on FavoriteDeletePayload"?: Omit<
      ValueTypes["FavoriteDeletePayload"],
      "...on FavoriteDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  FavoriteEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Favorite"];
    __typename?: boolean | `@${string}`;
    "...on FavoriteEdge"?: Omit<
      ValueTypes["FavoriteEdge"],
      "...on FavoriteEdge"
    >;
  }>;
  FavoriteMutations: AliasType<{
    create?: [
      { input: ValueTypes["FavoriteCreateInput"] | Variable<any, string> },
      ValueTypes["FavoriteCreatePayload"],
    ];
    delete?: [
      { input: ValueTypes["FavoriteDeleteInput"] | Variable<any, string> },
      ValueTypes["FavoriteDeletePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on FavoriteMutations"?: Omit<
      ValueTypes["FavoriteMutations"],
      "...on FavoriteMutations"
    >;
  }>;
  /** Related media grouped together */
  Franchise: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    installments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["InstallmentSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["InstallmentConnection"],
    ];
    /** The name of this franchise in various languages */
    titles?: ValueTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Franchise"?: Omit<ValueTypes["Franchise"], "...on Franchise">;
  }>;
  /** The connection type for Franchise. */
  FranchiseConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["FranchiseEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Franchise"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on FranchiseConnection"?: Omit<
      ValueTypes["FranchiseConnection"],
      "...on FranchiseConnection"
    >;
  }>;
  /** An edge in a connection. */
  FranchiseEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Franchise"];
    __typename?: boolean | `@${string}`;
    "...on FranchiseEdge"?: Omit<
      ValueTypes["FranchiseEdge"],
      "...on FranchiseEdge"
    >;
  }>;
  GenericDelete: AliasType<{
    id?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on GenericDelete"?: Omit<
      ValueTypes["GenericDelete"],
      "...on GenericDelete"
    >;
  }>;
  GenericError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on GenericError"?: Omit<
      ValueTypes["GenericError"],
      "...on GenericError"
    >;
  }>;
  Image: AliasType<{
    /** A blurhash-encoded version of this image */
    blurhash?: boolean | `@${string}`;
    /** The original image */
    original?: ValueTypes["ImageView"];
    views?: [
      { names?: Array<string> | undefined | null | Variable<any, string> },
      ValueTypes["ImageView"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Image"?: Omit<ValueTypes["Image"], "...on Image">;
  }>;
  ImageView: AliasType<{
    /** The height of the image */
    height?: boolean | `@${string}`;
    /** The name of this view of the image */
    name?: boolean | `@${string}`;
    /** The URL of this view of the image */
    url?: boolean | `@${string}`;
    /** The width of the image */
    width?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ImageView"?: Omit<ValueTypes["ImageView"], "...on ImageView">;
  }>;
  /** Individual media that belongs to a franchise */
  Installment: AliasType<{
    /** Order based chronologically */
    alternativeOrder?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The franchise related to this installment */
    franchise?: ValueTypes["Franchise"];
    id?: boolean | `@${string}`;
    /** The media related to this installment */
    media?: ValueTypes["Media"];
    /** Order based by date released */
    releaseOrder?: boolean | `@${string}`;
    /** Further explains the media relationship corresponding to a franchise */
    tag?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Installment"?: Omit<ValueTypes["Installment"], "...on Installment">;
  }>;
  /** The connection type for Installment. */
  InstallmentConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["InstallmentEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Installment"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on InstallmentConnection"?: Omit<
      ValueTypes["InstallmentConnection"],
      "...on InstallmentConnection"
    >;
  }>;
  /** An edge in a connection. */
  InstallmentEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Installment"];
    __typename?: boolean | `@${string}`;
    "...on InstallmentEdge"?: Omit<
      ValueTypes["InstallmentEdge"],
      "...on InstallmentEdge"
    >;
  }>;
  /** The user library */
  Library: AliasType<{
    all?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
        status?:
          | Array<ValueTypes["LibraryEntryStatusEnum"]>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    completed?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    current?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    dropped?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    onHold?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    planned?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEntrySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    randomMedia?: [
      {
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
        status:
          | Array<ValueTypes["LibraryEntryStatusEnum"]>
          | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Library"?: Omit<ValueTypes["Library"], "...on Library">;
  }>;
  /** Information about a specific media entry for a user */
  LibraryEntry: AliasType<{
    createdAt?: boolean | `@${string}`;
    events?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaTypes?:
          | Array<ValueTypes["MediaTypeEnum"]>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEventConnection"],
    ];
    /** When the user finished this media. */
    finishedAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The last unit consumed */
    lastUnit?: ValueTypes["Unit"];
    /** The media related to this library entry. */
    media?: ValueTypes["Media"];
    /** The next unit to be consumed */
    nextUnit?: ValueTypes["Unit"];
    /** Notes left by the profile related to this library entry. */
    notes?: boolean | `@${string}`;
    /** If the media related to the library entry is Not-Safe-for-Work. */
    nsfw?: boolean | `@${string}`;
    /** If this library entry is publicly visibile from their profile, or hidden. */
    private?: boolean | `@${string}`;
    /** The number of episodes/chapters this user has watched/read */
    progress?: boolean | `@${string}`;
    /** When the user last watched an episode or read a chapter of this media. */
    progressedAt?: boolean | `@${string}`;
    /** How much you enjoyed this media (lower meaning not liking). */
    rating?: boolean | `@${string}`;
    /** The reaction based on the media of this library entry. */
    reaction?: ValueTypes["MediaReaction"];
    /** Amount of times this media has been rewatched. */
    reconsumeCount?: boolean | `@${string}`;
    /** If the profile is currently rewatching this media. */
    reconsuming?: boolean | `@${string}`;
    /** When the user started this media. */
    startedAt?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The user who created this library entry. */
    user?: ValueTypes["Profile"];
    /** Volumes that the profile owns (physically or digital). */
    volumesOwned?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on LibraryEntry"?: Omit<
      ValueTypes["LibraryEntry"],
      "...on LibraryEntry"
    >;
  }>;
  /** The connection type for LibraryEntry. */
  LibraryEntryConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["LibraryEntryEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["LibraryEntry"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryConnection"?: Omit<
      ValueTypes["LibraryEntryConnection"],
      "...on LibraryEntryConnection"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryCreate. */
  LibraryEntryCreatePayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryCreatePayload"?: Omit<
      ValueTypes["LibraryEntryCreatePayload"],
      "...on LibraryEntryCreatePayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryDelete. */
  LibraryEntryDeletePayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["GenericDelete"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryDeletePayload"?: Omit<
      ValueTypes["LibraryEntryDeletePayload"],
      "...on LibraryEntryDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  LibraryEntryEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryEdge"?: Omit<
      ValueTypes["LibraryEntryEdge"],
      "...on LibraryEntryEdge"
    >;
  }>;
  LibraryEntryMutations: AliasType<{
    create?: [
      {
        /** Create a Library Entry */
        input: ValueTypes["LibraryEntryCreateInput"] | Variable<any, string>;
      },
      ValueTypes["LibraryEntryCreatePayload"],
    ];
    delete?: [
      {
        /** Delete Library Entry */
        input: ValueTypes["GenericDeleteInput"] | Variable<any, string>;
      },
      ValueTypes["LibraryEntryDeletePayload"],
    ];
    update?: [
      {
        /** Update Library Entry */
        input: ValueTypes["LibraryEntryUpdateInput"] | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdatePayload"],
    ];
    updateProgressById?: [
      {
        /** Update library entry progress by id */
        input:
          | ValueTypes["LibraryEntryUpdateProgressByIdInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateProgressByIdPayload"],
    ];
    updateProgressByMedia?: [
      {
        /** Update library entry progress by media */
        input:
          | ValueTypes["LibraryEntryUpdateProgressByMediaInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateProgressByMediaPayload"],
    ];
    updateRatingById?: [
      {
        /** Update library entry rating by id */
        input:
          | ValueTypes["LibraryEntryUpdateRatingByIdInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateRatingByIdPayload"],
    ];
    updateRatingByMedia?: [
      {
        /** Update library entry rating by media */
        input:
          | ValueTypes["LibraryEntryUpdateRatingByMediaInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateRatingByMediaPayload"],
    ];
    updateStatusById?: [
      {
        /** Update library entry status by id */
        input:
          | ValueTypes["LibraryEntryUpdateStatusByIdInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateStatusByIdPayload"],
    ];
    updateStatusByMedia?: [
      {
        /** Update library entry status by media */
        input:
          | ValueTypes["LibraryEntryUpdateStatusByMediaInput"]
          | Variable<any, string>;
      },
      ValueTypes["LibraryEntryUpdateStatusByMediaPayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryMutations"?: Omit<
      ValueTypes["LibraryEntryMutations"],
      "...on LibraryEntryMutations"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdate. */
  LibraryEntryUpdatePayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdatePayload"?: Omit<
      ValueTypes["LibraryEntryUpdatePayload"],
      "...on LibraryEntryUpdatePayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateProgressById. */
  LibraryEntryUpdateProgressByIdPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateProgressByIdPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateProgressByIdPayload"],
      "...on LibraryEntryUpdateProgressByIdPayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateProgressByMedia. */
  LibraryEntryUpdateProgressByMediaPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateProgressByMediaPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateProgressByMediaPayload"],
      "...on LibraryEntryUpdateProgressByMediaPayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateRatingById. */
  LibraryEntryUpdateRatingByIdPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateRatingByIdPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateRatingByIdPayload"],
      "...on LibraryEntryUpdateRatingByIdPayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateRatingByMedia. */
  LibraryEntryUpdateRatingByMediaPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateRatingByMediaPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateRatingByMediaPayload"],
      "...on LibraryEntryUpdateRatingByMediaPayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateStatusById. */
  LibraryEntryUpdateStatusByIdPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateStatusByIdPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateStatusByIdPayload"],
      "...on LibraryEntryUpdateStatusByIdPayload"
    >;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateStatusByMedia. */
  LibraryEntryUpdateStatusByMediaPayload: AliasType<{
    errors?: ValueTypes["Error"];
    libraryEntry?: ValueTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEntryUpdateStatusByMediaPayload"?: Omit<
      ValueTypes["LibraryEntryUpdateStatusByMediaPayload"],
      "...on LibraryEntryUpdateStatusByMediaPayload"
    >;
  }>;
  /** History of user actions for a library entry. */
  LibraryEvent: AliasType<{
    /** The data that was changed for this library event. */
    changedData?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The type of library event. */
    kind?: boolean | `@${string}`;
    /** The library entry related to this library event. */
    libraryEntry?: ValueTypes["LibraryEntry"];
    /** The media related to this library event. */
    media?: ValueTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    /** The user who created this library event */
    user?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEvent"?: Omit<
      ValueTypes["LibraryEvent"],
      "...on LibraryEvent"
    >;
  }>;
  /** The connection type for LibraryEvent. */
  LibraryEventConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["LibraryEventEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["LibraryEvent"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on LibraryEventConnection"?: Omit<
      ValueTypes["LibraryEventConnection"],
      "...on LibraryEventConnection"
    >;
  }>;
  /** An edge in a connection. */
  LibraryEventEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["LibraryEvent"];
    __typename?: boolean | `@${string}`;
    "...on LibraryEventEdge"?: Omit<
      ValueTypes["LibraryEventEdge"],
      "...on LibraryEventEdge"
    >;
  }>;
  Manga: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ValueTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCategorySortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CategoryConnection"],
    ];
    chapter?: [
      { number: number | Variable<any, string> },
      ValueTypes["Chapter"],
    ];
    /** The number of chapters in this manga. */
    chapterCount?: boolean | `@${string}`;
    /** The estimated number of chapters in this manga. */
    chapterCountGuess?: boolean | `@${string}`;
    chapters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["ChapterSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ChapterConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaCharacterSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaCharacterConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ValueTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ValueTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["PostSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaReactionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaRelationshipConnection"],
    ];
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    /** A secondary type for categorizing Manga. */
    subtype?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ValueTypes["TitlesList"];
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    /** The number of volumes in this manga. */
    volumeCount?: boolean | `@${string}`;
    volumes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["VolumeSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["VolumeConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Manga"?: Omit<ValueTypes["Manga"], "...on Manga">;
  }>;
  MangaAmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MangaAmountConsumed"?: Omit<
      ValueTypes["MangaAmountConsumed"],
      "...on MangaAmountConsumed"
    >;
  }>;
  MangaCategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ValueTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MangaCategoryBreakdown"?: Omit<
      ValueTypes["MangaCategoryBreakdown"],
      "...on MangaCategoryBreakdown"
    >;
  }>;
  /** The connection type for Manga. */
  MangaConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MangaEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Manga"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MangaConnection"?: Omit<
      ValueTypes["MangaConnection"],
      "...on MangaConnection"
    >;
  }>;
  /** An edge in a connection. */
  MangaEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Manga"];
    __typename?: boolean | `@${string}`;
    "...on MangaEdge"?: Omit<ValueTypes["MangaEdge"], "...on MangaEdge">;
  }>;
  /** Media Mappings from External Sites (MAL, Anilist, etc..) to Kitsu. */
  Mapping: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** The ID of the media from the external site. */
    externalId?: boolean | `@${string}`;
    /** The name of the site which kitsu media is being linked from. */
    externalSite?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The kitsu object that is mapped. */
    item?: ValueTypes["MappingItemUnion"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Mapping"?: Omit<ValueTypes["Mapping"], "...on Mapping">;
  }>;
  /** The connection type for Mapping. */
  MappingConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MappingEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Mapping"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MappingConnection"?: Omit<
      ValueTypes["MappingConnection"],
      "...on MappingConnection"
    >;
  }>;
  /** Autogenerated return type of MappingCreate. */
  MappingCreatePayload: AliasType<{
    errors?: ValueTypes["Error"];
    mapping?: ValueTypes["Mapping"];
    __typename?: boolean | `@${string}`;
    "...on MappingCreatePayload"?: Omit<
      ValueTypes["MappingCreatePayload"],
      "...on MappingCreatePayload"
    >;
  }>;
  /** Autogenerated return type of MappingDelete. */
  MappingDeletePayload: AliasType<{
    errors?: ValueTypes["Error"];
    mapping?: ValueTypes["GenericDelete"];
    __typename?: boolean | `@${string}`;
    "...on MappingDeletePayload"?: Omit<
      ValueTypes["MappingDeletePayload"],
      "...on MappingDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  MappingEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Mapping"];
    __typename?: boolean | `@${string}`;
    "...on MappingEdge"?: Omit<ValueTypes["MappingEdge"], "...on MappingEdge">;
  }>;
  MappingMutations: AliasType<{
    create?: [
      {
        /** Create a Mapping */
        input: ValueTypes["MappingCreateInput"] | Variable<any, string>;
      },
      ValueTypes["MappingCreatePayload"],
    ];
    delete?: [
      {
        /** Delete a Mapping */
        input: ValueTypes["GenericDeleteInput"] | Variable<any, string>;
      },
      ValueTypes["MappingDeletePayload"],
    ];
    update?: [
      {
        /** Update a Mapping */
        input: ValueTypes["MappingUpdateInput"] | Variable<any, string>;
      },
      ValueTypes["MappingUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on MappingMutations"?: Omit<
      ValueTypes["MappingMutations"],
      "...on MappingMutations"
    >;
  }>;
  /** Autogenerated return type of MappingUpdate. */
  MappingUpdatePayload: AliasType<{
    errors?: ValueTypes["Error"];
    mapping?: ValueTypes["Mapping"];
    __typename?: boolean | `@${string}`;
    "...on MappingUpdatePayload"?: Omit<
      ValueTypes["MappingUpdatePayload"],
      "...on MappingUpdatePayload"
    >;
  }>;
  /** Information about a Character starring in a Media */
  MediaCharacter: AliasType<{
    /** The character */
    character?: ValueTypes["Character"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ValueTypes["Media"];
    /** The role this character had in the media */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    voices?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        locale?: Array<string> | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CharacterVoiceSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CharacterVoiceConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on MediaCharacter"?: Omit<
      ValueTypes["MediaCharacter"],
      "...on MediaCharacter"
    >;
  }>;
  /** The connection type for MediaCharacter. */
  MediaCharacterConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaCharacterEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["MediaCharacter"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaCharacterConnection"?: Omit<
      ValueTypes["MediaCharacterConnection"],
      "...on MediaCharacterConnection"
    >;
  }>;
  /** An edge in a connection. */
  MediaCharacterEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["MediaCharacter"];
    __typename?: boolean | `@${string}`;
    "...on MediaCharacterEdge"?: Omit<
      ValueTypes["MediaCharacterEdge"],
      "...on MediaCharacterEdge"
    >;
  }>;
  /** The connection type for Media. */
  MediaConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Media"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
    "...on MediaConnection"?: Omit<
      ValueTypes["MediaConnection"],
      "...on MediaConnection"
    >;
  }>;
  /** An edge in a connection. */
  MediaEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Media"];
    __typename?: boolean | `@${string}`;
    "...on MediaEdge"?: Omit<ValueTypes["MediaEdge"], "...on MediaEdge">;
  }>;
  /** The role a company played in the creation or localization of a media */
  MediaProduction: AliasType<{
    /** The production company */
    company?: ValueTypes["Producer"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ValueTypes["Media"];
    /** The role this company played */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaProduction"?: Omit<
      ValueTypes["MediaProduction"],
      "...on MediaProduction"
    >;
  }>;
  /** The connection type for MediaProduction. */
  MediaProductionConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaProductionEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["MediaProduction"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaProductionConnection"?: Omit<
      ValueTypes["MediaProductionConnection"],
      "...on MediaProductionConnection"
    >;
  }>;
  /** An edge in a connection. */
  MediaProductionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["MediaProduction"];
    __typename?: boolean | `@${string}`;
    "...on MediaProductionEdge"?: Omit<
      ValueTypes["MediaProductionEdge"],
      "...on MediaProductionEdge"
    >;
  }>;
  /** A simple review that is 140 characters long expressing how you felt about a media */
  MediaReaction: AliasType<{
    /** The author who wrote this reaction. */
    author?: ValueTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    /** Whether you have liked this media reaction */
    hasLiked?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The library entry related to this reaction. */
    libraryEntry?: ValueTypes["LibraryEntry"];
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaReactionVoteSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** The media related to this reaction. */
    media?: ValueTypes["Media"];
    /** When this media reaction was written based on media progress. */
    progress?: boolean | `@${string}`;
    /** The reaction text related to a media. */
    reaction?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaReaction"?: Omit<
      ValueTypes["MediaReaction"],
      "...on MediaReaction"
    >;
  }>;
  /** The connection type for MediaReaction. */
  MediaReactionConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaReactionEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["MediaReaction"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaReactionConnection"?: Omit<
      ValueTypes["MediaReactionConnection"],
      "...on MediaReactionConnection"
    >;
  }>;
  /** Autogenerated return type of MediaReactionCreate. */
  MediaReactionCreatePayload: AliasType<{
    errors?: ValueTypes["MediaReactionCreateErrorsUnion"];
    result?: ValueTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionCreatePayload"?: Omit<
      ValueTypes["MediaReactionCreatePayload"],
      "...on MediaReactionCreatePayload"
    >;
  }>;
  /** Autogenerated return type of MediaReactionDelete. */
  MediaReactionDeletePayload: AliasType<{
    errors?: ValueTypes["MediaReactionDeleteErrorsUnion"];
    result?: ValueTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionDeletePayload"?: Omit<
      ValueTypes["MediaReactionDeletePayload"],
      "...on MediaReactionDeletePayload"
    >;
  }>;
  /** An edge in a connection. */
  MediaReactionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionEdge"?: Omit<
      ValueTypes["MediaReactionEdge"],
      "...on MediaReactionEdge"
    >;
  }>;
  /** Autogenerated return type of MediaReactionLike. */
  MediaReactionLikePayload: AliasType<{
    errors?: ValueTypes["MediaReactionLikeErrorsUnion"];
    result?: ValueTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionLikePayload"?: Omit<
      ValueTypes["MediaReactionLikePayload"],
      "...on MediaReactionLikePayload"
    >;
  }>;
  MediaReactionMutations: AliasType<{
    create?: [
      { input: ValueTypes["MediaReactionCreateInput"] | Variable<any, string> },
      ValueTypes["MediaReactionCreatePayload"],
    ];
    delete?: [
      { input: ValueTypes["MediaReactionDeleteInput"] | Variable<any, string> },
      ValueTypes["MediaReactionDeletePayload"],
    ];
    like?: [
      { input: ValueTypes["MediaReactionLikeInput"] | Variable<any, string> },
      ValueTypes["MediaReactionLikePayload"],
    ];
    unlike?: [
      { input: ValueTypes["MediaReactionUnlikeInput"] | Variable<any, string> },
      ValueTypes["MediaReactionUnlikePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionMutations"?: Omit<
      ValueTypes["MediaReactionMutations"],
      "...on MediaReactionMutations"
    >;
  }>;
  /** Autogenerated return type of MediaReactionUnlike. */
  MediaReactionUnlikePayload: AliasType<{
    errors?: ValueTypes["MediaReactionUnlikeErrorsUnion"];
    result?: ValueTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
    "...on MediaReactionUnlikePayload"?: Omit<
      ValueTypes["MediaReactionUnlikePayload"],
      "...on MediaReactionUnlikePayload"
    >;
  }>;
  /** A relationship from one media to another */
  MediaRelationship: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** The destination media */
    destination?: ValueTypes["Media"];
    /** The kind of relationship */
    kind?: boolean | `@${string}`;
    /** The source media */
    source?: ValueTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaRelationship"?: Omit<
      ValueTypes["MediaRelationship"],
      "...on MediaRelationship"
    >;
  }>;
  /** The connection type for MediaRelationship. */
  MediaRelationshipConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaRelationshipEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["MediaRelationship"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaRelationshipConnection"?: Omit<
      ValueTypes["MediaRelationshipConnection"],
      "...on MediaRelationshipConnection"
    >;
  }>;
  /** An edge in a connection. */
  MediaRelationshipEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["MediaRelationship"];
    __typename?: boolean | `@${string}`;
    "...on MediaRelationshipEdge"?: Omit<
      ValueTypes["MediaRelationshipEdge"],
      "...on MediaRelationshipEdge"
    >;
  }>;
  /** Information about a person working on an anime */
  MediaStaff: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ValueTypes["Media"];
    /** The person */
    person?: ValueTypes["Person"];
    /** The role this person had in the creation of this media */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaStaff"?: Omit<ValueTypes["MediaStaff"], "...on MediaStaff">;
  }>;
  /** The connection type for MediaStaff. */
  MediaStaffConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["MediaStaffEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["MediaStaff"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on MediaStaffConnection"?: Omit<
      ValueTypes["MediaStaffConnection"],
      "...on MediaStaffConnection"
    >;
  }>;
  /** An edge in a connection. */
  MediaStaffEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["MediaStaff"];
    __typename?: boolean | `@${string}`;
    "...on MediaStaffEdge"?: Omit<
      ValueTypes["MediaStaffEdge"],
      "...on MediaStaffEdge"
    >;
  }>;
  Mutation: AliasType<{
    account?: ValueTypes["AccountMutations"];
    accountCreate?: [
      { input: ValueTypes["AccountCreateInput"] | Variable<any, string> },
      ValueTypes["AccountCreatePayload"],
    ];
    anime?: ValueTypes["AnimeMutations"];
    block?: ValueTypes["BlockMutations"];
    episode?: ValueTypes["EpisodeMutations"];
    favorite?: ValueTypes["FavoriteMutations"];
    libraryEntry?: ValueTypes["LibraryEntryMutations"];
    mapping?: ValueTypes["MappingMutations"];
    mediaReaction?: ValueTypes["MediaReactionMutations"];
    post?: ValueTypes["PostMutations"];
    pro?: ValueTypes["ProMutations"];
    profile?: ValueTypes["ProfileMutations"];
    profileLink?: ValueTypes["ProfileLinkMutations"];
    wikiSubmission?: ValueTypes["WikiSubmissionMutations"];
    __typename?: boolean | `@${string}`;
    "...on Mutation"?: Omit<ValueTypes["Mutation"], "...on Mutation">;
  }>;
  /** The mutation requires an authenticated logged-in user session, and none was provided or the session has expired. The recommended action varies depending on your application and whether you provided the bearer token in the `Authorization` header or not. If you did, you should probably attempt to refresh the token, and if that fails, prompt the user to log in again. If you did not provide a bearer token, you should just prompt the user to log in. */
  NotAuthenticatedError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on NotAuthenticatedError"?: Omit<
      ValueTypes["NotAuthenticatedError"],
      "...on NotAuthenticatedError"
    >;
  }>;
  /** The mutation requires higher permissions than the current user or token has. This is a bit vague, but it generally means you're attempting to modify an object you don't own, or perform an administrator action without being an administrator. It could also mean your token does not have the required scopes to perform the action. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotAuthorizedError: AliasType<{
    action?: boolean | `@${string}`;
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on NotAuthorizedError"?: Omit<
      ValueTypes["NotAuthorizedError"],
      "...on NotAuthorizedError"
    >;
  }>;
  /** An object required for your mutation was unable to be located. Usually this means the object you're attempting to modify or delete does not exist. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotFoundError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on NotFoundError"?: Omit<
      ValueTypes["NotFoundError"],
      "...on NotFoundError"
    >;
  }>;
  /** Information about pagination in a connection. */
  PageInfo: AliasType<{
    /** When paginating forwards, the cursor to continue. */
    endCursor?: boolean | `@${string}`;
    /** When paginating forwards, are there more items? */
    hasNextPage?: boolean | `@${string}`;
    /** When paginating backwards, are there more items? */
    hasPreviousPage?: boolean | `@${string}`;
    /** When paginating backwards, the cursor to continue. */
    startCursor?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on PageInfo"?: Omit<ValueTypes["PageInfo"], "...on PageInfo">;
  }>;
  /** A Voice Actor, Director, Animator, or other person who works in the creation and localization of media */
  Person: AliasType<{
    /** The day when this person was born */
    birthday?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** An image of the person */
    image?: ValueTypes["Image"];
    mediaStaff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MediaStaffConnection"],
    ];
    /** The primary name of this person. */
    name?: boolean | `@${string}`;
    /** The name of this person in various languages */
    names?: ValueTypes["TitlesList"];
    /** The URL-friendly identifier of this person. */
    slug?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    voices?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CharacterVoiceConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Person"?: Omit<ValueTypes["Person"], "...on Person">;
  }>;
  /** A post that is visible to your followers and globally in the news-feed. */
  Post: AliasType<{
    /** The user who created this post. */
    author?: ValueTypes["Profile"];
    comments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["CommentSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["CommentConnection"],
    ];
    /** Unmodified content. */
    content?: boolean | `@${string}`;
    /** Html formatted content. */
    contentFormatted?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    follows?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    id?: boolean | `@${string}`;
    /** If a post is Not-Safe-for-Work. */
    isNsfw?: boolean | `@${string}`;
    /** If this post spoils the tagged media. */
    isSpoiler?: boolean | `@${string}`;
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["PostLikeSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** When this post was locked. */
    lockedAt?: boolean | `@${string}`;
    /** The user who locked this post. */
    lockedBy?: ValueTypes["Profile"];
    /** The reason why this post was locked. */
    lockedReason?: boolean | `@${string}`;
    /** The media tagged in this post. */
    media?: ValueTypes["Media"];
    /** The profile of the target user of the post. */
    targetProfile?: ValueTypes["Profile"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Post"?: Omit<ValueTypes["Post"], "...on Post">;
  }>;
  /** The connection type for Post. */
  PostConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["PostEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Post"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on PostConnection"?: Omit<
      ValueTypes["PostConnection"],
      "...on PostConnection"
    >;
  }>;
  /** Autogenerated return type of PostCreate. */
  PostCreatePayload: AliasType<{
    errors?: ValueTypes["Error"];
    post?: ValueTypes["Post"];
    __typename?: boolean | `@${string}`;
    "...on PostCreatePayload"?: Omit<
      ValueTypes["PostCreatePayload"],
      "...on PostCreatePayload"
    >;
  }>;
  /** An edge in a connection. */
  PostEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Post"];
    __typename?: boolean | `@${string}`;
    "...on PostEdge"?: Omit<ValueTypes["PostEdge"], "...on PostEdge">;
  }>;
  /** Autogenerated return type of PostLock. */
  PostLockPayload: AliasType<{
    errors?: ValueTypes["Error"];
    post?: ValueTypes["Post"];
    __typename?: boolean | `@${string}`;
    "...on PostLockPayload"?: Omit<
      ValueTypes["PostLockPayload"],
      "...on PostLockPayload"
    >;
  }>;
  PostMutations: AliasType<{
    create?: [
      {
        /** Create a Post */
        input: ValueTypes["PostCreateInput"] | Variable<any, string>;
      },
      ValueTypes["PostCreatePayload"],
    ];
    lock?: [
      {
        /** Lock a Post. */
        input: ValueTypes["PostLockInput"] | Variable<any, string>;
      },
      ValueTypes["PostLockPayload"],
    ];
    unlock?: [
      {
        /** Unlock a Post. */
        input: ValueTypes["PostUnlockInput"] | Variable<any, string>;
      },
      ValueTypes["PostUnlockPayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on PostMutations"?: Omit<
      ValueTypes["PostMutations"],
      "...on PostMutations"
    >;
  }>;
  /** Autogenerated return type of PostUnlock. */
  PostUnlockPayload: AliasType<{
    errors?: ValueTypes["Error"];
    post?: ValueTypes["Post"];
    __typename?: boolean | `@${string}`;
    "...on PostUnlockPayload"?: Omit<
      ValueTypes["PostUnlockPayload"],
      "...on PostUnlockPayload"
    >;
  }>;
  ProMutations: AliasType<{
    setDiscord?: [
      {
        /** Your discord tag (Name#1234) */
        discord: string | Variable<any, string>;
      },
      ValueTypes["ProSetDiscordPayload"],
    ];
    setMessage?: [
      {
        /** The message to set for your Hall of Fame entry */
        message: string | Variable<any, string>;
      },
      ValueTypes["ProSetMessagePayload"],
    ];
    /** End the user's pro subscription */
    unsubscribe?: ValueTypes["ProUnsubscribePayload"];
    __typename?: boolean | `@${string}`;
    "...on ProMutations"?: Omit<
      ValueTypes["ProMutations"],
      "...on ProMutations"
    >;
  }>;
  /** Autogenerated return type of ProSetDiscord. */
  ProSetDiscordPayload: AliasType<{
    discord?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProSetDiscordPayload"?: Omit<
      ValueTypes["ProSetDiscordPayload"],
      "...on ProSetDiscordPayload"
    >;
  }>;
  /** Autogenerated return type of ProSetMessage. */
  ProSetMessagePayload: AliasType<{
    message?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProSetMessagePayload"?: Omit<
      ValueTypes["ProSetMessagePayload"],
      "...on ProSetMessagePayload"
    >;
  }>;
  /** A subscription to Kitsu PRO */
  ProSubscription: AliasType<{
    /** The account which is subscribed to Pro benefits */
    account?: ValueTypes["Account"];
    /** The billing service used for this subscription */
    billingService?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The tier of Pro the account is subscribed to */
    tier?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProSubscription"?: Omit<
      ValueTypes["ProSubscription"],
      "...on ProSubscription"
    >;
  }>;
  /** Autogenerated return type of ProUnsubscribe. */
  ProUnsubscribePayload: AliasType<{
    expiresAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProUnsubscribePayload"?: Omit<
      ValueTypes["ProUnsubscribePayload"],
      "...on ProUnsubscribePayload"
    >;
  }>;
  /** A company involved in the creation or localization of media */
  Producer: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The name of this production company */
    name?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Producer"?: Omit<ValueTypes["Producer"], "...on Producer">;
  }>;
  /** A user profile on Kitsu */
  Profile: AliasType<{
    /** A short biographical blurb about this profile */
    about?: boolean | `@${string}`;
    /** An avatar image to easily identify this profile */
    avatarImage?: ValueTypes["Image"];
    /** A banner to display at the top of the profile */
    bannerImage?: ValueTypes["Image"];
    /** When the user was born */
    birthday?: boolean | `@${string}`;
    comments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CommentConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    favorites?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["FavoriteConnection"],
    ];
    followers?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["FollowSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    following?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["FollowSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** What the user identifies as */
    gender?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The user library of their media */
    library?: ValueTypes["Library"];
    libraryEvents?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Will return all if not supplied */;
        kind?:
          | Array<ValueTypes["LibraryEventKindEnum"]>
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["LibraryEventSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["LibraryEventConnection"],
    ];
    /** The user's general location */
    location?: boolean | `@${string}`;
    mediaReactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["MediaReactionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["MediaReactionConnection"],
    ];
    /** A non-unique publicly visible name for the profile. Minimum of 3 characters and any valid Unicode character */
    name?: boolean | `@${string}`;
    /** Post pinned to the user profile */
    pinnedPost?: ValueTypes["Post"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["PostSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["PostConnection"],
    ];
    /** The message this user has submitted to the Hall of Fame */
    proMessage?: boolean | `@${string}`;
    /** The PRO level the user currently has */
    proTier?: boolean | `@${string}`;
    reviews?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ReviewConnection"],
    ];
    siteLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["SiteLinkConnection"],
    ];
    /** The URL-friendly identifier for this profile */
    slug?: boolean | `@${string}`;
    /** The different stats we calculate for this user. */
    stats?: ValueTypes["ProfileStats"];
    updatedAt?: boolean | `@${string}`;
    /** A fully qualified URL to the profile */
    url?: boolean | `@${string}`;
    /** The character this profile has declared as their waifu or husbando */
    waifu?: ValueTypes["Character"];
    /** The properly-gendered term for the user's waifu. This should normally only be 'Waifu' or 'Husbando' but some people are jerks, including the person who wrote this... */
    waifuOrHusbando?: boolean | `@${string}`;
    wikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Will return all if not supplied */;
        statuses?:
          | Array<ValueTypes["WikiSubmissionStatusEnum"]>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Profile"?: Omit<ValueTypes["Profile"], "...on Profile">;
  }>;
  /** The connection type for Profile. */
  ProfileConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["ProfileEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Profile"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProfileConnection"?: Omit<
      ValueTypes["ProfileConnection"],
      "...on ProfileConnection"
    >;
  }>;
  /** An edge in a connection. */
  ProfileEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on ProfileEdge"?: Omit<ValueTypes["ProfileEdge"], "...on ProfileEdge">;
  }>;
  /** Autogenerated return type of ProfileLinkCreate. */
  ProfileLinkCreatePayload: AliasType<{
    errors?: ValueTypes["ProfileLinkCreateErrorsUnion"];
    result?: ValueTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
    "...on ProfileLinkCreatePayload"?: Omit<
      ValueTypes["ProfileLinkCreatePayload"],
      "...on ProfileLinkCreatePayload"
    >;
  }>;
  /** Autogenerated return type of ProfileLinkDelete. */
  ProfileLinkDeletePayload: AliasType<{
    errors?: ValueTypes["ProfileLinkDeleteErrorsUnion"];
    result?: ValueTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
    "...on ProfileLinkDeletePayload"?: Omit<
      ValueTypes["ProfileLinkDeletePayload"],
      "...on ProfileLinkDeletePayload"
    >;
  }>;
  ProfileLinkMutations: AliasType<{
    create?: [
      { input: ValueTypes["ProfileLinkCreateInput"] | Variable<any, string> },
      ValueTypes["ProfileLinkCreatePayload"],
    ];
    delete?: [
      { input: ValueTypes["ProfileLinkDeleteInput"] | Variable<any, string> },
      ValueTypes["ProfileLinkDeletePayload"],
    ];
    update?: [
      { input: ValueTypes["ProfileLinkUpdateInput"] | Variable<any, string> },
      ValueTypes["ProfileLinkUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on ProfileLinkMutations"?: Omit<
      ValueTypes["ProfileLinkMutations"],
      "...on ProfileLinkMutations"
    >;
  }>;
  /** An external site that can be linked to a user. */
  ProfileLinkSite: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Name of the external profile website. */
    name?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** Regex pattern used to validate the profile link. */
    validateFind?: boolean | `@${string}`;
    /** Pattern to be replaced after validation. */
    validateReplace?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ProfileLinkSite"?: Omit<
      ValueTypes["ProfileLinkSite"],
      "...on ProfileLinkSite"
    >;
  }>;
  /** Autogenerated return type of ProfileLinkUpdate. */
  ProfileLinkUpdatePayload: AliasType<{
    errors?: ValueTypes["ProfileLinkUpdateErrorsUnion"];
    result?: ValueTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
    "...on ProfileLinkUpdatePayload"?: Omit<
      ValueTypes["ProfileLinkUpdatePayload"],
      "...on ProfileLinkUpdatePayload"
    >;
  }>;
  ProfileMutations: AliasType<{
    update?: [
      { input: ValueTypes["ProfileUpdateInput"] | Variable<any, string> },
      ValueTypes["ProfileUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on ProfileMutations"?: Omit<
      ValueTypes["ProfileMutations"],
      "...on ProfileMutations"
    >;
  }>;
  /** The different types of user stats that we calculate. */
  ProfileStats: AliasType<{
    /** The total amount of anime you have watched over your whole life. */
    animeAmountConsumed?: ValueTypes["AnimeAmountConsumed"];
    /** The breakdown of the different categories related to the anime you have completed */
    animeCategoryBreakdown?: ValueTypes["AnimeCategoryBreakdown"];
    /** The total amount of manga you ahve read over your whole life. */
    mangaAmountConsumed?: ValueTypes["MangaAmountConsumed"];
    /** The breakdown of the different categories related to the manga you have completed */
    mangaCategoryBreakdown?: ValueTypes["MangaCategoryBreakdown"];
    __typename?: boolean | `@${string}`;
    "...on ProfileStats"?: Omit<
      ValueTypes["ProfileStats"],
      "...on ProfileStats"
    >;
  }>;
  /** Autogenerated return type of ProfileUpdate. */
  ProfileUpdatePayload: AliasType<{
    errors?: ValueTypes["ProfileUpdateErrorsUnion"];
    result?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on ProfileUpdatePayload"?: Omit<
      ValueTypes["ProfileUpdatePayload"],
      "...on ProfileUpdatePayload"
    >;
  }>;
  Query: AliasType<{
    anime?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["AnimeConnection"],
    ];
    animeByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        status: ValueTypes["ReleaseStatusEnum"] | Variable<any, string>;
      },
      ValueTypes["AnimeConnection"],
    ];
    blocks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["BlockConnection"],
    ];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["CategoryConnection"],
    ];
    /** Kitsu account details. You must supply an Authorization token in header. */
    currentAccount?: ValueTypes["Account"];
    /** Your Kitsu profile. You must supply an Authorization token in header. */
    currentProfile?: ValueTypes["Profile"];
    findAnimeById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Anime"],
    ];
    findAnimeBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Anime"],
    ];
    findCategoryById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Category"],
    ];
    findCategoryBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Category"],
    ];
    findChapterById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Chapter"],
    ];
    findCharacterById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Character"],
    ];
    findCharacterBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Character"],
    ];
    findLibraryEntryById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["LibraryEntry"],
    ];
    findLibraryEventById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["LibraryEvent"],
    ];
    findMangaById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Manga"],
    ];
    findMangaBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Manga"],
    ];
    findMediaByIdAndType?: [
      {
        id: ValueTypes["ID"] | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    findPersonById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Person"],
    ];
    findPersonBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Person"],
    ];
    findPostById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Post"],
    ];
    findProfileById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Profile"],
    ];
    findProfileBySlug?: [
      { slug: string | Variable<any, string> },
      ValueTypes["Profile"],
    ];
    findReportById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["Report"],
    ];
    findWikiSubmissionById?: [
      { id: ValueTypes["ID"] | Variable<any, string> },
      ValueTypes["WikiSubmission"],
    ];
    franchises?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["FranchiseConnection"],
    ];
    globalTrending?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    libraryEntriesByMedia?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaId: ValueTypes["ID"] | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    libraryEntriesByMediaType?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["LibraryEntryConnection"],
    ];
    localTrending?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    lookupMapping?: [
      {
        externalId: ValueTypes["ID"] | Variable<any, string>;
        externalSite:
          | ValueTypes["MappingExternalSiteEnum"]
          | Variable<any, string>;
      },
      ValueTypes["MappingItemUnion"],
    ];
    manga?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["MangaConnection"],
    ];
    mangaByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        status: ValueTypes["ReleaseStatusEnum"] | Variable<any, string>;
      },
      ValueTypes["MangaConnection"],
    ];
    patrons?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    randomMedia?: [
      {
        ageRatings: Array<ValueTypes["AgeRatingEnum"]> | Variable<any, string>;
        mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
      },
      ValueTypes["Media"],
    ];
    reports?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ReportConnection"],
    ];
    reportsByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?:
          | number
          | undefined
          | null
          | Variable<any, string> /** Will return all if not supplied */;
        statuses?:
          | Array<ValueTypes["ReportStatusEnum"]>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["ReportConnection"],
    ];
    searchAnimeByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        title: string | Variable<any, string>;
      },
      ValueTypes["AnimeConnection"],
    ];
    searchMangaByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        title: string | Variable<any, string>;
      },
      ValueTypes["MangaConnection"],
    ];
    searchMediaByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Dynamically choose a specific media_type. If left blank, it will return results for both. */;
        mediaType?:
          | ValueTypes["MediaTypeEnum"]
          | undefined
          | null
          | Variable<any, string>;
        title: string | Variable<any, string>;
      },
      ValueTypes["MediaConnection"],
    ];
    searchProfileByUsername?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        username: string | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** Get your current session info */
    session?: ValueTypes["Session"];
    wikiSubmissionsByStatuses?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
        sort?:
          | Array<ValueTypes["WikiSubmissionSortOption"] | undefined | null>
          | undefined
          | null
          | Variable<any, string> /** Will return all if not supplied */;
        statuses?:
          | Array<ValueTypes["WikiSubmissionStatusEnum"]>
          | undefined
          | null
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Query"?: Omit<ValueTypes["Query"], "...on Query">;
  }>;
  /** A quote from a media */
  Quote: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    lines?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["QuoteLineConnection"],
    ];
    /** The media this quote is excerpted from */
    media?: ValueTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Quote"?: Omit<ValueTypes["Quote"], "...on Quote">;
  }>;
  /** The connection type for Quote. */
  QuoteConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["QuoteEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Quote"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on QuoteConnection"?: Omit<
      ValueTypes["QuoteConnection"],
      "...on QuoteConnection"
    >;
  }>;
  /** An edge in a connection. */
  QuoteEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Quote"];
    __typename?: boolean | `@${string}`;
    "...on QuoteEdge"?: Omit<ValueTypes["QuoteEdge"], "...on QuoteEdge">;
  }>;
  /** A line in a quote */
  QuoteLine: AliasType<{
    /** The character who said this line */
    character?: ValueTypes["Character"];
    /** The line that was spoken */
    content?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The quote this line is in */
    quote?: ValueTypes["Quote"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on QuoteLine"?: Omit<ValueTypes["QuoteLine"], "...on QuoteLine">;
  }>;
  /** The connection type for QuoteLine. */
  QuoteLineConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["QuoteLineEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["QuoteLine"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on QuoteLineConnection"?: Omit<
      ValueTypes["QuoteLineConnection"],
      "...on QuoteLineConnection"
    >;
  }>;
  /** An edge in a connection. */
  QuoteLineEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["QuoteLine"];
    __typename?: boolean | `@${string}`;
    "...on QuoteLineEdge"?: Omit<
      ValueTypes["QuoteLineEdge"],
      "...on QuoteLineEdge"
    >;
  }>;
  /** A report made by a user */
  Report: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Additional information related to why the report was made */
    explanation?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The moderator who responded to this report */
    moderator?: ValueTypes["Profile"];
    /** The entity that the report is related to */
    naughty?: ValueTypes["ReportItemUnion"];
    /** The reason for why the report was made */
    reason?: boolean | `@${string}`;
    /** The user who made this report */
    reporter?: ValueTypes["Profile"];
    /** The resolution status for this report */
    status?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Report"?: Omit<ValueTypes["Report"], "...on Report">;
  }>;
  /** The connection type for Report. */
  ReportConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["ReportEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Report"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ReportConnection"?: Omit<
      ValueTypes["ReportConnection"],
      "...on ReportConnection"
    >;
  }>;
  /** An edge in a connection. */
  ReportEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Report"];
    __typename?: boolean | `@${string}`;
    "...on ReportEdge"?: Omit<ValueTypes["ReportEdge"], "...on ReportEdge">;
  }>;
  /** A media review made by a user */
  Review: AliasType<{
    /** The author who wrote this review. */
    author?: ValueTypes["Profile"];
    /** The review data */
    content?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The review data formatted */
    formattedContent?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Does this review contain spoilers from the media */
    isSpoiler?: boolean | `@${string}`;
    /** The library entry related to this review. */
    libraryEntry?: ValueTypes["LibraryEntry"];
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ProfileConnection"],
    ];
    /** The media related to this review. */
    media?: ValueTypes["Media"];
    /** When this review was written based on media progress. */
    progress?: boolean | `@${string}`;
    /** The user rating for this media */
    rating?: boolean | `@${string}`;
    /** Potentially migrated over from hummingbird. */
    source?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Review"?: Omit<ValueTypes["Review"], "...on Review">;
  }>;
  /** The connection type for Review. */
  ReviewConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["ReviewEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Review"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ReviewConnection"?: Omit<
      ValueTypes["ReviewConnection"],
      "...on ReviewConnection"
    >;
  }>;
  /** An edge in a connection. */
  ReviewEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Review"];
    __typename?: boolean | `@${string}`;
    "...on ReviewEdge"?: Omit<ValueTypes["ReviewEdge"], "...on ReviewEdge">;
  }>;
  /** Information about a user session */
  Session: AliasType<{
    /** The account associated with this session */
    account?: ValueTypes["Account"];
    /** Single sign-on token for Nolt */
    noltToken?: boolean | `@${string}`;
    /** The profile associated with this session */
    profile?: ValueTypes["Profile"];
    __typename?: boolean | `@${string}`;
    "...on Session"?: Omit<ValueTypes["Session"], "...on Session">;
  }>;
  /** A link to a user's profile on an external site. */
  SiteLink: AliasType<{
    /** The user profile the site is linked to. */
    author?: ValueTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The actual linked website. */
    site?: ValueTypes["ProfileLinkSite"];
    updatedAt?: boolean | `@${string}`;
    /** A fully qualified URL of the user profile on an external site. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on SiteLink"?: Omit<ValueTypes["SiteLink"], "...on SiteLink">;
  }>;
  /** The connection type for SiteLink. */
  SiteLinkConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["SiteLinkEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["SiteLink"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on SiteLinkConnection"?: Omit<
      ValueTypes["SiteLinkConnection"],
      "...on SiteLinkConnection"
    >;
  }>;
  /** An edge in a connection. */
  SiteLinkEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
    "...on SiteLinkEdge"?: Omit<
      ValueTypes["SiteLinkEdge"],
      "...on SiteLinkEdge"
    >;
  }>;
  /** The streaming company. */
  Streamer: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The name of the site that is streaming this media. */
    siteName?: boolean | `@${string}`;
    streamingLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["StreamingLinkConnection"],
    ];
    updatedAt?: boolean | `@${string}`;
    videos?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["VideoConnection"],
    ];
    __typename?: boolean | `@${string}`;
    "...on Streamer"?: Omit<ValueTypes["Streamer"], "...on Streamer">;
  }>;
  /** The stream link. */
  StreamingLink: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media being streamed */
    media?: ValueTypes["Media"];
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ValueTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** Fully qualified URL for the streaming link. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StreamingLink"?: Omit<
      ValueTypes["StreamingLink"],
      "...on StreamingLink"
    >;
  }>;
  /** The connection type for StreamingLink. */
  StreamingLinkConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["StreamingLinkEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["StreamingLink"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on StreamingLinkConnection"?: Omit<
      ValueTypes["StreamingLinkConnection"],
      "...on StreamingLinkConnection"
    >;
  }>;
  /** An edge in a connection. */
  StreamingLinkEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["StreamingLink"];
    __typename?: boolean | `@${string}`;
    "...on StreamingLinkEdge"?: Omit<
      ValueTypes["StreamingLinkEdge"],
      "...on StreamingLinkEdge"
    >;
  }>;
  TitlesList: AliasType<{
    /** A list of additional, alternative, abbreviated, or unofficial titles */
    alternatives?: boolean | `@${string}`;
    /** The official or de facto international title */
    canonical?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the canonical title */
    canonicalLocale?: boolean | `@${string}`;
    localized?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    /** The original title of the media in the original language */
    original?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the original title */
    originalLocale?: boolean | `@${string}`;
    /** The title that best matches the user's preferred settings */
    preferred?: boolean | `@${string}`;
    /** The original title, romanized into latin script */
    romanized?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the romanized title */
    romanizedLocale?: boolean | `@${string}`;
    /** The title translated into the user's locale */
    translated?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the translated title */
    translatedLocale?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on TitlesList"?: Omit<ValueTypes["TitlesList"], "...on TitlesList">;
  }>;
  /** The mutation failed validation. This is usually because the input provided was invalid in some way, such as a missing required field or an invalid value for a field. There may be multiple of this error, one for each failed validation, and the `path` will generally refer to a location in the input parameters, that you can map back to the input fields in your form. The recommended action is to display validation errors to the user, and allow them to correct the input and resubmit. */
  ValidationError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on ValidationError"?: Omit<
      ValueTypes["ValidationError"],
      "...on ValidationError"
    >;
  }>;
  /** The media video. */
  Video: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    /** The episode of this video */
    episode?: ValueTypes["Episode"];
    id?: boolean | `@${string}`;
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ValueTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The url of the video. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Video"?: Omit<ValueTypes["Video"], "...on Video">;
  }>;
  /** The connection type for Video. */
  VideoConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["VideoEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Video"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on VideoConnection"?: Omit<
      ValueTypes["VideoConnection"],
      "...on VideoConnection"
    >;
  }>;
  /** An edge in a connection. */
  VideoEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Video"];
    __typename?: boolean | `@${string}`;
    "...on VideoEdge"?: Omit<ValueTypes["VideoEdge"], "...on VideoEdge">;
  }>;
  /** A manga volume which can contain multiple chapters. */
  Volume: AliasType<{
    chapters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null
          | Variable<
              any,
              string
            > /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null | Variable<any, string>;
      },
      ValueTypes["ChapterConnection"],
    ];
    /** The number of chapters in this volume. */
    chaptersCount?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null | Variable<any, string> },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The isbn number of this volume. */
    isbn?: boolean | `@${string}`;
    /** The manga this volume is in. */
    manga?: ValueTypes["Manga"];
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** The date when this chapter was released. */
    published?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ValueTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ValueTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on Volume"?: Omit<ValueTypes["Volume"], "...on Volume">;
  }>;
  /** The connection type for Volume. */
  VolumeConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["VolumeEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["Volume"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on VolumeConnection"?: Omit<
      ValueTypes["VolumeConnection"],
      "...on VolumeConnection"
    >;
  }>;
  /** An edge in a connection. */
  VolumeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["Volume"];
    __typename?: boolean | `@${string}`;
    "...on VolumeEdge"?: Omit<ValueTypes["VolumeEdge"], "...on VolumeEdge">;
  }>;
  /** A Wiki Submission is used to either create or edit existing data in our database. This will allow a simple and convient way for users to submit issues/corrections without all the work being left to the mods. */
  WikiSubmission: AliasType<{
    /** The user who created this draft */
    author?: ValueTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    /** The full object that holds all the details for any modifications/additions/deletions made to the entity you are editing. This will be validated using JSON Schema. */
    data?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Any additional information that may need to be provided related to the Wiki Submission */
    notes?: boolean | `@${string}`;
    /** The status of the Wiki Submission */
    status?: boolean | `@${string}`;
    /** The title given to the Wiki Submission. This will default to the title of what is being edited. */
    title?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on WikiSubmission"?: Omit<
      ValueTypes["WikiSubmission"],
      "...on WikiSubmission"
    >;
  }>;
  /** The connection type for WikiSubmission. */
  WikiSubmissionConnection: AliasType<{
    /** A list of edges. */
    edges?: ValueTypes["WikiSubmissionEdge"];
    /** A list of nodes. */
    nodes?: ValueTypes["WikiSubmission"];
    /** Information to aid in pagination. */
    pageInfo?: ValueTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionConnection"?: Omit<
      ValueTypes["WikiSubmissionConnection"],
      "...on WikiSubmissionConnection"
    >;
  }>;
  /** Autogenerated return type of WikiSubmissionCreateDraft. */
  WikiSubmissionCreateDraftPayload: AliasType<{
    errors?: ValueTypes["Error"];
    wikiSubmission?: ValueTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionCreateDraftPayload"?: Omit<
      ValueTypes["WikiSubmissionCreateDraftPayload"],
      "...on WikiSubmissionCreateDraftPayload"
    >;
  }>;
  /** An edge in a connection. */
  WikiSubmissionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ValueTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionEdge"?: Omit<
      ValueTypes["WikiSubmissionEdge"],
      "...on WikiSubmissionEdge"
    >;
  }>;
  WikiSubmissionMutations: AliasType<{
    createDraft?: [
      {
        /** Create a wiki submission draft. */
        input:
          | ValueTypes["WikiSubmissionCreateDraftInput"]
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionCreateDraftPayload"],
    ];
    submitDraft?: [
      {
        /** Submit a wiki submission draft. This will change the status to pending. */
        input:
          | ValueTypes["WikiSubmissionSubmitDraftInput"]
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionSubmitDraftPayload"],
    ];
    updateDraft?: [
      {
        /** Update a wiki submission draft. */
        input:
          | ValueTypes["WikiSubmissionUpdateDraftInput"]
          | Variable<any, string>;
      },
      ValueTypes["WikiSubmissionUpdateDraftPayload"],
    ];
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionMutations"?: Omit<
      ValueTypes["WikiSubmissionMutations"],
      "...on WikiSubmissionMutations"
    >;
  }>;
  /** Autogenerated return type of WikiSubmissionSubmitDraft. */
  WikiSubmissionSubmitDraftPayload: AliasType<{
    errors?: ValueTypes["Error"];
    wikiSubmission?: ValueTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionSubmitDraftPayload"?: Omit<
      ValueTypes["WikiSubmissionSubmitDraftPayload"],
      "...on WikiSubmissionSubmitDraftPayload"
    >;
  }>;
  /** Autogenerated return type of WikiSubmissionUpdateDraft. */
  WikiSubmissionUpdateDraftPayload: AliasType<{
    errors?: ValueTypes["Error"];
    wikiSubmission?: ValueTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
    "...on WikiSubmissionUpdateDraftPayload"?: Omit<
      ValueTypes["WikiSubmissionUpdateDraftPayload"],
      "...on WikiSubmissionUpdateDraftPayload"
    >;
  }>;
  AgeRatingEnum: AgeRatingEnum;
  AnimeSubtypeEnum: AnimeSubtypeEnum;
  ChapterSortEnum: ChapterSortEnum;
  CharacterRoleEnum: CharacterRoleEnum;
  CharacterVoiceSortEnum: CharacterVoiceSortEnum;
  CommentLikeSortEnum: CommentLikeSortEnum;
  CommentSortEnum: CommentSortEnum;
  EpisodeSortEnum: EpisodeSortEnum;
  ExternalIdentityProviderEnum: ExternalIdentityProviderEnum;
  FavoriteEnum: FavoriteEnum;
  FollowSortEnum: FollowSortEnum;
  InstallmentSortEnum: InstallmentSortEnum;
  InstallmentTagEnum: InstallmentTagEnum;
  LibraryEntrySortEnum: LibraryEntrySortEnum;
  LibraryEntryStatusEnum: LibraryEntryStatusEnum;
  LibraryEventKindEnum: LibraryEventKindEnum;
  LibraryEventSortEnum: LibraryEventSortEnum;
  LockedReasonEnum: LockedReasonEnum;
  MangaSubtypeEnum: MangaSubtypeEnum;
  MappingExternalSiteEnum: MappingExternalSiteEnum;
  MappingItemEnum: MappingItemEnum;
  MediaCategorySortEnum: MediaCategorySortEnum;
  MediaCharacterSortEnum: MediaCharacterSortEnum;
  MediaProductionRoleEnum: MediaProductionRoleEnum;
  MediaReactionSortEnum: MediaReactionSortEnum;
  MediaReactionVoteSortEnum: MediaReactionVoteSortEnum;
  /** The relationship kind from one media entry to another */
  MediaRelationshipKindEnum: MediaRelationshipKindEnum;
  /** これはアニメやマンガです */
  MediaTypeEnum: MediaTypeEnum;
  PostLikeSortEnum: PostLikeSortEnum;
  PostSortEnum: PostSortEnum;
  ProTierEnum: ProTierEnum;
  ProfileLinksSitesEnum: ProfileLinksSitesEnum;
  RatingSystemEnum: RatingSystemEnum;
  RecurringBillingServiceEnum: RecurringBillingServiceEnum;
  ReleaseSeasonEnum: ReleaseSeasonEnum;
  ReleaseStatusEnum: ReleaseStatusEnum;
  ReportReasonEnum: ReportReasonEnum;
  ReportStatusEnum: ReportStatusEnum;
  SfwFilterPreferenceEnum: SfwFilterPreferenceEnum;
  SitePermissionEnum: SitePermissionEnum;
  SiteThemeEnum: SiteThemeEnum;
  SortDirection: SortDirection;
  TitleLanguagePreferenceEnum: TitleLanguagePreferenceEnum;
  VolumeSortEnum: VolumeSortEnum;
  WaifuOrHusbandoEnum: WaifuOrHusbandoEnum;
  WikiSubmissionSortEnum: WikiSubmissionSortEnum;
  WikiSubmissionStatusEnum: WikiSubmissionStatusEnum;
  /** A date, expressed as an ISO8601 string */
  Date: unknown;
  /** An ISO 8601-encoded date */
  ISO8601Date: unknown;
  /** An ISO 8601-encoded datetime */
  ISO8601DateTime: unknown;
  /** Represents untyped JSON */
  JSON: unknown;
  /** A loose key-value map in GraphQL */
  Map: unknown;
  Upload: unknown;
  AccountChangePasswordInput: {
    /** The new password to set */
    newPassword: string | Variable<any, string>;
    /** The current, existing password for the account */
    oldPassword: string | Variable<any, string>;
  };
  AccountCreateInput: {
    /** The email address to reset the password for */
    email: string | Variable<any, string>;
    /** An external identity to associate with the account on creation */
    externalIdentity?:
      | ValueTypes["AccountExternalIdentityInput"]
      | undefined
      | null
      | Variable<any, string>;
    /** The name of the user */
    name: string | Variable<any, string>;
    /** The password for the user */
    password: string | Variable<any, string>;
  };
  AccountExternalIdentityInput: {
    id: string | Variable<any, string>;
    provider:
      | ValueTypes["ExternalIdentityProviderEnum"]
      | Variable<any, string>;
  };
  AccountUpdateInput: {
    /** The country of the user */
    country?: string | undefined | null | Variable<any, string>;
    /** How media titles will get visualized */
    preferredTitleLanguage?:
      | ValueTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null
      | Variable<any, string>;
    /** The preferred rating system */
    ratingSystem?:
      | ValueTypes["RatingSystemEnum"]
      | undefined
      | null
      | Variable<any, string>;
    /** The SFW Filter setting */
    sfwFilterPreference?:
      | ValueTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null
      | Variable<any, string>;
    /** The theme displayed on Kitsu */
    siteTheme?:
      | ValueTypes["SiteThemeEnum"]
      | undefined
      | null
      | Variable<any, string>;
    /** The time zone of the user */
    timeZone?: string | undefined | null | Variable<any, string>;
  };
  AnimeCreateInput: {
    ageRating?:
      | ValueTypes["AgeRatingEnum"]
      | undefined
      | null
      | Variable<any, string>;
    ageRatingGuide?: string | undefined | null | Variable<any, string>;
    bannerImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    description: ValueTypes["Map"] | Variable<any, string>;
    endDate?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    episodeCount?: number | undefined | null | Variable<any, string>;
    episodeLength?: number | undefined | null | Variable<any, string>;
    posterImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    startDate?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    tba?: string | undefined | null | Variable<any, string>;
    titles: ValueTypes["TitlesListInput"] | Variable<any, string>;
    youtubeTrailerVideoId?: string | undefined | null | Variable<any, string>;
  };
  AnimeUpdateInput: {
    ageRating?:
      | ValueTypes["AgeRatingEnum"]
      | undefined
      | null
      | Variable<any, string>;
    ageRatingGuide?: string | undefined | null | Variable<any, string>;
    bannerImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    description?: ValueTypes["Map"] | undefined | null | Variable<any, string>;
    endDate?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    episodeCount?: number | undefined | null | Variable<any, string>;
    episodeLength?: number | undefined | null | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    posterImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    startDate?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    tba?: string | undefined | null | Variable<any, string>;
    titles?:
      | ValueTypes["TitlesListInput"]
      | undefined
      | null
      | Variable<any, string>;
    youtubeTrailerVideoId?: string | undefined | null | Variable<any, string>;
  };
  BlockCreateInput: {
    /** The id of the user to block. */
    blockedId: ValueTypes["ID"] | Variable<any, string>;
  };
  BlockDeleteInput: {
    /** The id of the block. */
    blockId: ValueTypes["ID"] | Variable<any, string>;
  };
  ChapterSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["ChapterSortEnum"] | Variable<any, string>;
  };
  CharacterVoiceSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["CharacterVoiceSortEnum"] | Variable<any, string>;
  };
  CommentLikeSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["CommentLikeSortEnum"] | Variable<any, string>;
  };
  CommentSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["CommentSortEnum"] | Variable<any, string>;
  };
  EpisodeCreateInput: {
    description?: ValueTypes["Map"] | undefined | null | Variable<any, string>;
    length?: number | undefined | null | Variable<any, string>;
    mediaId: ValueTypes["ID"] | Variable<any, string>;
    mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
    number: number | Variable<any, string>;
    releasedAt?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    thumbnailImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    titles: ValueTypes["TitlesListInput"] | Variable<any, string>;
  };
  EpisodeSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["EpisodeSortEnum"] | Variable<any, string>;
  };
  EpisodeUpdateInput: {
    description?: ValueTypes["Map"] | undefined | null | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    length?: number | undefined | null | Variable<any, string>;
    number?: number | undefined | null | Variable<any, string>;
    releasedAt?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    thumbnailImage?:
      | ValueTypes["Upload"]
      | undefined
      | null
      | Variable<any, string>;
    titles?:
      | ValueTypes["TitlesListInput"]
      | undefined
      | null
      | Variable<any, string>;
  };
  FavoriteCreateInput: {
    /** The id of the entry */
    id: ValueTypes["ID"] | Variable<any, string>;
    /** The type of the entry. */
    type: ValueTypes["FavoriteEnum"] | Variable<any, string>;
  };
  FavoriteDeleteInput: {
    /** The id of the favorite entry. */
    favoriteId: ValueTypes["ID"] | Variable<any, string>;
  };
  FollowSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["FollowSortEnum"] | Variable<any, string>;
  };
  GenericDeleteInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
  };
  InstallmentSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["InstallmentSortEnum"] | Variable<any, string>;
  };
  LibraryEntryCreateInput: {
    finishedAt?:
      | ValueTypes["ISO8601DateTime"]
      | undefined
      | null
      | Variable<any, string>;
    mediaId: ValueTypes["ID"] | Variable<any, string>;
    mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
    notes?: string | undefined | null | Variable<any, string>;
    private?: boolean | undefined | null | Variable<any, string>;
    progress?: number | undefined | null | Variable<any, string>;
    rating?: number | undefined | null | Variable<any, string>;
    reconsumeCount?: number | undefined | null | Variable<any, string>;
    reconsuming?: boolean | undefined | null | Variable<any, string>;
    startedAt?:
      | ValueTypes["ISO8601DateTime"]
      | undefined
      | null
      | Variable<any, string>;
    status: ValueTypes["LibraryEntryStatusEnum"] | Variable<any, string>;
    volumesOwned?: number | undefined | null | Variable<any, string>;
  };
  LibraryEntrySortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["LibraryEntrySortEnum"] | Variable<any, string>;
  };
  LibraryEntryUpdateInput: {
    finishedAt?:
      | ValueTypes["ISO8601DateTime"]
      | undefined
      | null
      | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    notes?: string | undefined | null | Variable<any, string>;
    private?: boolean | undefined | null | Variable<any, string>;
    progress?: number | undefined | null | Variable<any, string>;
    rating?: number | undefined | null | Variable<any, string>;
    reconsumeCount?: number | undefined | null | Variable<any, string>;
    reconsuming?: boolean | undefined | null | Variable<any, string>;
    startedAt?:
      | ValueTypes["ISO8601DateTime"]
      | undefined
      | null
      | Variable<any, string>;
    status?:
      | ValueTypes["LibraryEntryStatusEnum"]
      | undefined
      | null
      | Variable<any, string>;
    volumesOwned?: number | undefined | null | Variable<any, string>;
  };
  LibraryEntryUpdateProgressByIdInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
    progress: number | Variable<any, string>;
  };
  LibraryEntryUpdateProgressByMediaInput: {
    mediaId: ValueTypes["ID"] | Variable<any, string>;
    mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
    progress: number | Variable<any, string>;
  };
  LibraryEntryUpdateRatingByIdInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
    /** A number between 2 - 20 */
    rating: number | Variable<any, string>;
  };
  LibraryEntryUpdateRatingByMediaInput: {
    mediaId: ValueTypes["ID"] | Variable<any, string>;
    mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
    /** A number between 2 - 20 */
    rating: number | Variable<any, string>;
  };
  LibraryEntryUpdateStatusByIdInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
    status: ValueTypes["LibraryEntryStatusEnum"] | Variable<any, string>;
  };
  LibraryEntryUpdateStatusByMediaInput: {
    mediaId: ValueTypes["ID"] | Variable<any, string>;
    mediaType: ValueTypes["MediaTypeEnum"] | Variable<any, string>;
    status: ValueTypes["LibraryEntryStatusEnum"] | Variable<any, string>;
  };
  LibraryEventSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["LibraryEventSortEnum"] | Variable<any, string>;
  };
  MappingCreateInput: {
    externalId: ValueTypes["ID"] | Variable<any, string>;
    externalSite: ValueTypes["MappingExternalSiteEnum"] | Variable<any, string>;
    itemId: ValueTypes["ID"] | Variable<any, string>;
    itemType: ValueTypes["MappingItemEnum"] | Variable<any, string>;
  };
  MappingUpdateInput: {
    externalId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    externalSite?:
      | ValueTypes["MappingExternalSiteEnum"]
      | undefined
      | null
      | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    itemId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    itemType?:
      | ValueTypes["MappingItemEnum"]
      | undefined
      | null
      | Variable<any, string>;
  };
  MediaCategorySortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["MediaCategorySortEnum"] | Variable<any, string>;
  };
  MediaCharacterSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["MediaCharacterSortEnum"] | Variable<any, string>;
  };
  MediaReactionCreateInput: {
    /** The ID of the entry in your library to react to */
    libraryEntryId: ValueTypes["ID"] | Variable<any, string>;
    /** The text of the reaction to the media */
    reaction: string | Variable<any, string>;
  };
  MediaReactionDeleteInput: {
    /** The reaction to delete */
    mediaReactionId: ValueTypes["ID"] | Variable<any, string>;
  };
  MediaReactionLikeInput: {
    /** The reaction to like */
    mediaReactionId: ValueTypes["ID"] | Variable<any, string>;
  };
  MediaReactionSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["MediaReactionSortEnum"] | Variable<any, string>;
  };
  MediaReactionUnlikeInput: {
    /** The reaction to remove your like from */
    mediaReactionId: ValueTypes["ID"] | Variable<any, string>;
  };
  MediaReactionVoteSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["MediaReactionVoteSortEnum"] | Variable<any, string>;
  };
  PostCreateInput: {
    content: string | Variable<any, string>;
    isNsfw?: boolean | undefined | null | Variable<any, string>;
    isSpoiler?: boolean | undefined | null | Variable<any, string>;
    mediaId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    mediaType?:
      | ValueTypes["MediaTypeEnum"]
      | undefined
      | null
      | Variable<any, string>;
    spoiledUnitId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    spoiledUnitType?: string | undefined | null | Variable<any, string>;
    targetUserId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
  };
  PostLikeSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["PostLikeSortEnum"] | Variable<any, string>;
  };
  PostLockInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
    lockedReason: ValueTypes["LockedReasonEnum"] | Variable<any, string>;
  };
  PostSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["PostSortEnum"] | Variable<any, string>;
  };
  PostUnlockInput: {
    id: ValueTypes["ID"] | Variable<any, string>;
  };
  ProfileLinkCreateInput: {
    /** The website. */
    profileLinkSite:
      | ValueTypes["ProfileLinksSitesEnum"]
      | Variable<any, string>;
    /** The url of the profile link */
    url: string | Variable<any, string>;
  };
  ProfileLinkDeleteInput: {
    /** The profile link to delete */
    profileLink: ValueTypes["ProfileLinksSitesEnum"] | Variable<any, string>;
  };
  ProfileLinkUpdateInput: {
    /** The website. */
    profileLinkSite:
      | ValueTypes["ProfileLinksSitesEnum"]
      | Variable<any, string>;
    /** The url of the profile link */
    url: string | Variable<any, string>;
  };
  ProfileUpdateInput: {
    /** About section of the profile. */
    about?: string | undefined | null | Variable<any, string>;
    /** The birthday of the user. */
    birthday?: ValueTypes["Date"] | undefined | null | Variable<any, string>;
    /** The preferred gender of the user. */
    gender?: string | undefined | null | Variable<any, string>;
    /** Your ID or the one of another user. */
    id?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    /** The display name of the user */
    name?: string | undefined | null | Variable<any, string>;
    /** The slug (@username) of the user */
    slug?: string | undefined | null | Variable<any, string>;
    /** The id of the waifu or husbando. */
    waifuId?: ValueTypes["ID"] | undefined | null | Variable<any, string>;
    /** The user preference of their partner. */
    waifuOrHusbando?:
      | ValueTypes["WaifuOrHusbandoEnum"]
      | undefined
      | null
      | Variable<any, string>;
  };
  TitlesListInput: {
    alternatives?: Array<string> | undefined | null | Variable<any, string>;
    canonical?: string | undefined | null | Variable<any, string>;
    canonicalLocale?: string | undefined | null | Variable<any, string>;
    localized?: ValueTypes["Map"] | undefined | null | Variable<any, string>;
  };
  VolumeSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["VolumeSortEnum"] | Variable<any, string>;
  };
  WikiSubmissionCreateDraftInput: {
    data: ValueTypes["JSON"] | Variable<any, string>;
    notes?: string | undefined | null | Variable<any, string>;
    title?: string | undefined | null | Variable<any, string>;
  };
  WikiSubmissionSortOption: {
    direction: ValueTypes["SortDirection"] | Variable<any, string>;
    on: ValueTypes["WikiSubmissionSortEnum"] | Variable<any, string>;
  };
  WikiSubmissionSubmitDraftInput: {
    data: ValueTypes["JSON"] | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    notes?: string | undefined | null | Variable<any, string>;
    title?: string | undefined | null | Variable<any, string>;
  };
  WikiSubmissionUpdateDraftInput: {
    data: ValueTypes["JSON"] | Variable<any, string>;
    id: ValueTypes["ID"] | Variable<any, string>;
    notes?: string | undefined | null | Variable<any, string>;
  };
  ID: unknown;
};

export type ResolverInputTypes = {
  schema: AliasType<{
    query?: ResolverInputTypes["Query"];
    mutation?: ResolverInputTypes["Mutation"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Generic Amount Consumed based on Media */
  AmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    "...on AnimeAmountConsumed"?: Omit<
      ResolverInputTypes["AnimeAmountConsumed"],
      keyof ResolverInputTypes["AmountConsumed"]
    >;
    "...on MangaAmountConsumed"?: Omit<
      ResolverInputTypes["MangaAmountConsumed"],
      keyof ResolverInputTypes["AmountConsumed"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** Generic Category Breakdown based on Media */
  CategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    "...on AnimeCategoryBreakdown"?: Omit<
      ResolverInputTypes["AnimeCategoryBreakdown"],
      keyof ResolverInputTypes["CategoryBreakdown"]
    >;
    "...on MangaCategoryBreakdown"?: Omit<
      ResolverInputTypes["MangaCategoryBreakdown"],
      keyof ResolverInputTypes["CategoryBreakdown"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** An episodic media in the Kitsu database */
  Episodic: AliasType<{
    /** The number of episodes in this series */
    episodeCount?: boolean | `@${string}`;
    /** The general length (in seconds) of each episode */
    episodeLength?: boolean | `@${string}`;
    episodes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["EpisodeSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["EpisodeConnection"],
    ];
    /** The total length (in seconds) of the entire series */
    totalLength?: boolean | `@${string}`;
    "...on Anime"?: Omit<
      ResolverInputTypes["Anime"],
      keyof ResolverInputTypes["Episodic"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** Generic error fields used by all errors. */
  Error: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    "...on GenericError"?: Omit<
      ResolverInputTypes["GenericError"],
      keyof ResolverInputTypes["Error"]
    >;
    "...on NotAuthenticatedError"?: Omit<
      ResolverInputTypes["NotAuthenticatedError"],
      keyof ResolverInputTypes["Error"]
    >;
    "...on NotAuthorizedError"?: Omit<
      ResolverInputTypes["NotAuthorizedError"],
      keyof ResolverInputTypes["Error"]
    >;
    "...on NotFoundError"?: Omit<
      ResolverInputTypes["NotFoundError"],
      keyof ResolverInputTypes["Error"]
    >;
    "...on ValidationError"?: Omit<
      ResolverInputTypes["ValidationError"],
      keyof ResolverInputTypes["Error"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** A media in the Kitsu database */
  Media: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ResolverInputTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCategorySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["CategoryConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCharacterSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaCharacterConnection"],
    ];
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ResolverInputTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ResolverInputTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["PostSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaReactionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaRelationshipConnection"],
    ];
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    "...on Anime"?: Omit<
      ResolverInputTypes["Anime"],
      keyof ResolverInputTypes["Media"]
    >;
    "...on Manga"?: Omit<
      ResolverInputTypes["Manga"],
      keyof ResolverInputTypes["Media"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media that is streamable. */
  Streamable: AliasType<{
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ResolverInputTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    "...on StreamingLink"?: Omit<
      ResolverInputTypes["StreamingLink"],
      keyof ResolverInputTypes["Streamable"]
    >;
    "...on Video"?: Omit<
      ResolverInputTypes["Video"],
      keyof ResolverInputTypes["Streamable"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  /** Media units such as episodes or chapters */
  Unit: AliasType<{
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ResolverInputTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    "...on Chapter"?: Omit<
      ResolverInputTypes["Chapter"],
      keyof ResolverInputTypes["Unit"]
    >;
    "...on Episode"?: Omit<
      ResolverInputTypes["Episode"],
      keyof ResolverInputTypes["Unit"]
    >;
    "...on Volume"?: Omit<
      ResolverInputTypes["Volume"],
      keyof ResolverInputTypes["Unit"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  WithTimestamps: AliasType<{
    createdAt?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    "...on Account"?: Omit<
      ResolverInputTypes["Account"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Anime"?: Omit<
      ResolverInputTypes["Anime"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Block"?: Omit<
      ResolverInputTypes["Block"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Category"?: Omit<
      ResolverInputTypes["Category"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Chapter"?: Omit<
      ResolverInputTypes["Chapter"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Character"?: Omit<
      ResolverInputTypes["Character"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on CharacterVoice"?: Omit<
      ResolverInputTypes["CharacterVoice"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Comment"?: Omit<
      ResolverInputTypes["Comment"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Episode"?: Omit<
      ResolverInputTypes["Episode"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Favorite"?: Omit<
      ResolverInputTypes["Favorite"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Franchise"?: Omit<
      ResolverInputTypes["Franchise"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Installment"?: Omit<
      ResolverInputTypes["Installment"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on LibraryEntry"?: Omit<
      ResolverInputTypes["LibraryEntry"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on LibraryEvent"?: Omit<
      ResolverInputTypes["LibraryEvent"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Manga"?: Omit<
      ResolverInputTypes["Manga"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Mapping"?: Omit<
      ResolverInputTypes["Mapping"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on MediaCharacter"?: Omit<
      ResolverInputTypes["MediaCharacter"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on MediaProduction"?: Omit<
      ResolverInputTypes["MediaProduction"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on MediaReaction"?: Omit<
      ResolverInputTypes["MediaReaction"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on MediaRelationship"?: Omit<
      ResolverInputTypes["MediaRelationship"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on MediaStaff"?: Omit<
      ResolverInputTypes["MediaStaff"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Person"?: Omit<
      ResolverInputTypes["Person"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Post"?: Omit<
      ResolverInputTypes["Post"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on ProSubscription"?: Omit<
      ResolverInputTypes["ProSubscription"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Producer"?: Omit<
      ResolverInputTypes["Producer"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Profile"?: Omit<
      ResolverInputTypes["Profile"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on ProfileLinkSite"?: Omit<
      ResolverInputTypes["ProfileLinkSite"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Quote"?: Omit<
      ResolverInputTypes["Quote"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on QuoteLine"?: Omit<
      ResolverInputTypes["QuoteLine"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Report"?: Omit<
      ResolverInputTypes["Report"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Review"?: Omit<
      ResolverInputTypes["Review"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on SiteLink"?: Omit<
      ResolverInputTypes["SiteLink"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Streamer"?: Omit<
      ResolverInputTypes["Streamer"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on StreamingLink"?: Omit<
      ResolverInputTypes["StreamingLink"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Video"?: Omit<
      ResolverInputTypes["Video"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on Volume"?: Omit<
      ResolverInputTypes["Volume"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    "...on WikiSubmission"?: Omit<
      ResolverInputTypes["WikiSubmission"],
      keyof ResolverInputTypes["WithTimestamps"]
    >;
    __typename?: boolean | `@${string}`;
  }>;
  AccountChangePasswordErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    ValidationError?: ResolverInputTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  AccountCreateErrorsUnion: AliasType<{
    ValidationError?: ResolverInputTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  AccountUpdateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  BlockCreateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  BlockDeleteErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  FavoriteCreateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  FavoriteDeleteErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Favoritable */
  FavoriteItemUnion: AliasType<{
    Anime?: ResolverInputTypes["Anime"];
    Character?: ResolverInputTypes["Character"];
    Manga?: ResolverInputTypes["Manga"];
    Person?: ResolverInputTypes["Person"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Mappable */
  MappingItemUnion: AliasType<{
    Anime?: ResolverInputTypes["Anime"];
    Category?: ResolverInputTypes["Category"];
    Character?: ResolverInputTypes["Character"];
    Episode?: ResolverInputTypes["Episode"];
    Manga?: ResolverInputTypes["Manga"];
    Person?: ResolverInputTypes["Person"];
    Producer?: ResolverInputTypes["Producer"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionCreateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    ValidationError?: ResolverInputTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionDeleteErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionLikeErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionUnlikeErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkCreateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    ValidationError?: ResolverInputTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkDeleteErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkUpdateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    ValidationError?: ResolverInputTypes["ValidationError"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileUpdateErrorsUnion: AliasType<{
    NotAuthenticatedError?: ResolverInputTypes["NotAuthenticatedError"];
    NotAuthorizedError?: ResolverInputTypes["NotAuthorizedError"];
    NotFoundError?: ResolverInputTypes["NotFoundError"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Objects which are Reportable */
  ReportItemUnion: AliasType<{
    Comment?: ResolverInputTypes["Comment"];
    MediaReaction?: ResolverInputTypes["MediaReaction"];
    Post?: ResolverInputTypes["Post"];
    Review?: ResolverInputTypes["Review"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A user account on Kitsu */
  Account: AliasType<{
    /** The country this user resides in */
    country?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The email addresses associated with this account */
    email?: boolean | `@${string}`;
    /** The features this user has access to */
    enabledFeatures?: boolean | `@${string}`;
    /** Facebook account linked to the account */
    facebookId?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Primary language for the account */
    language?: boolean | `@${string}`;
    /** Longest period an account has had a PRO subscription for in seconds */
    maxProStreak?: boolean | `@${string}`;
    /** The PRO subscription for this account */
    proSubscription?: ResolverInputTypes["ProSubscription"];
    /** The profile for this account */
    profile?: ResolverInputTypes["Profile"];
    /** Media rating system used for the account */
    ratingSystem?: boolean | `@${string}`;
    /** Whether Not Safe For Work content is accessible */
    sfwFilter?: boolean | `@${string}`;
    /** The level of the SFW Filter */
    sfwFilterPreference?: boolean | `@${string}`;
    /** The site-wide permissions this user has access to */
    sitePermissions?: boolean | `@${string}`;
    /** Time zone of the account */
    timeZone?: boolean | `@${string}`;
    /** Preferred language for media titles */
    titleLanguagePreference?: boolean | `@${string}`;
    /** Twitter account linked to the account */
    twitterId?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AccountChangePassword. */
  AccountChangePasswordPayload: AliasType<{
    errors?: ResolverInputTypes["AccountChangePasswordErrorsUnion"];
    result?: ResolverInputTypes["Account"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AccountCreate. */
  AccountCreatePayload: AliasType<{
    errors?: ResolverInputTypes["AccountCreateErrorsUnion"];
    result?: ResolverInputTypes["Account"];
    __typename?: boolean | `@${string}`;
  }>;
  AccountMutations: AliasType<{
    changePassword?: [
      { input: ResolverInputTypes["AccountChangePasswordInput"] },
      ResolverInputTypes["AccountChangePasswordPayload"],
    ];
    sendPasswordReset?: [
      {
        /** The email address to reset the password for */ email: string;
      },
      ResolverInputTypes["AccountSendPasswordResetPayload"],
    ];
    update?: [
      { input: ResolverInputTypes["AccountUpdateInput"] },
      ResolverInputTypes["AccountUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AccountSendPasswordReset. */
  AccountSendPasswordResetPayload: AliasType<{
    email?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AccountUpdate. */
  AccountUpdatePayload: AliasType<{
    errors?: ResolverInputTypes["AccountUpdateErrorsUnion"];
    result?: ResolverInputTypes["Account"];
    __typename?: boolean | `@${string}`;
  }>;
  Anime: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ResolverInputTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCategorySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["CategoryConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCharacterSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaCharacterConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of episodes in this series */
    episodeCount?: boolean | `@${string}`;
    /** The general length (in seconds) of each episode */
    episodeLength?: boolean | `@${string}`;
    episodes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["EpisodeSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["EpisodeConnection"],
    ];
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ResolverInputTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ResolverInputTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["PostSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaReactionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaRelationshipConnection"],
    ];
    /** The season this was released in */
    season?: boolean | `@${string}`;
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    streamingLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["StreamingLinkConnection"],
    ];
    /** A secondary type for categorizing Anime. */
    subtype?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    /** The total length (in seconds) of the entire series */
    totalLength?: boolean | `@${string}`;
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    /** Video id for a trailer on YouTube */
    youtubeTrailerVideoId?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  AnimeAmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total time spent in minutes. */
    time?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  AnimeCategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Anime. */
  AnimeConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["AnimeEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Anime"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AnimeCreate. */
  AnimeCreatePayload: AliasType<{
    anime?: ResolverInputTypes["Anime"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AnimeDelete. */
  AnimeDeletePayload: AliasType<{
    anime?: ResolverInputTypes["GenericDelete"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  AnimeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Anime"];
    __typename?: boolean | `@${string}`;
  }>;
  AnimeMutations: AliasType<{
    create?: [
      {
        /** Create an Anime. */ input: ResolverInputTypes["AnimeCreateInput"];
      },
      ResolverInputTypes["AnimeCreatePayload"],
    ];
    delete?: [
      {
        /** Delete an Anime. */ input: ResolverInputTypes["GenericDeleteInput"];
      },
      ResolverInputTypes["AnimeDeletePayload"],
    ];
    update?: [
      {
        /** Update an Anime. */ input: ResolverInputTypes["AnimeUpdateInput"];
      },
      ResolverInputTypes["AnimeUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of AnimeUpdate. */
  AnimeUpdatePayload: AliasType<{
    anime?: ResolverInputTypes["Anime"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A blocked user entry of an Account. */
  Block: AliasType<{
    /** User who got blocked. */
    blockedUser?: ResolverInputTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** User who blocked. */
    user?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Block. */
  BlockConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["BlockEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Block"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of BlockCreate. */
  BlockCreatePayload: AliasType<{
    errors?: ResolverInputTypes["BlockCreateErrorsUnion"];
    result?: ResolverInputTypes["Block"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of BlockDelete. */
  BlockDeletePayload: AliasType<{
    errors?: ResolverInputTypes["BlockDeleteErrorsUnion"];
    result?: ResolverInputTypes["Block"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  BlockEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Block"];
    __typename?: boolean | `@${string}`;
  }>;
  BlockMutations: AliasType<{
    create?: [
      { input: ResolverInputTypes["BlockCreateInput"] },
      ResolverInputTypes["BlockCreatePayload"],
    ];
    delete?: [
      { input: ResolverInputTypes["BlockDeleteInput"] },
      ResolverInputTypes["BlockDeletePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a specific Category */
  Category: AliasType<{
    children?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["CategoryConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** Whether the category is Not-Safe-for-Work. */
    isNsfw?: boolean | `@${string}`;
    /** The parent category. Each category can have one parent. */
    parent?: ResolverInputTypes["Category"];
    /** The top-level ancestor category */
    root?: ResolverInputTypes["Category"];
    /** The URL-friendly identifier of this Category. */
    slug?: boolean | `@${string}`;
    title?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Category. */
  CategoryConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["CategoryEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Category"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  CategoryEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Category"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A single chapter of a manga */
  Chapter: AliasType<{
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** Number of pages in chapter. */
    length?: boolean | `@${string}`;
    /** The manga this chapter is in. */
    manga?: ResolverInputTypes["Manga"];
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** When this chapter was released */
    releasedAt?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ResolverInputTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    /** The volume this chapter is in. */
    volume?: ResolverInputTypes["Volume"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Chapter. */
  ChapterConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["ChapterEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Chapter"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  ChapterEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Chapter"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a Character in the Kitsu database */
  Character: AliasType<{
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** An image of the character */
    image?: ResolverInputTypes["Image"];
    media?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaCharacterConnection"],
    ];
    /** The name for this character in various locales */
    names?: ResolverInputTypes["TitlesList"];
    /** The original media this character showed up in */
    primaryMedia?: ResolverInputTypes["Media"];
    /** The URL-friendly identifier of this character */
    slug?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a VA (Person) voicing a Character in a Media */
  CharacterVoice: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The company who hired this voice actor to play this role */
    licensor?: ResolverInputTypes["Producer"];
    /** The BCP47 locale tag for the voice acting role */
    locale?: boolean | `@${string}`;
    /** The MediaCharacter node */
    mediaCharacter?: ResolverInputTypes["MediaCharacter"];
    /** The person who voice acted this role */
    person?: ResolverInputTypes["Person"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for CharacterVoice. */
  CharacterVoiceConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["CharacterVoiceEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["CharacterVoice"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  CharacterVoiceEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["CharacterVoice"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A comment on a post */
  Comment: AliasType<{
    /** The user who created this comment for the parent post. */
    author?: ResolverInputTypes["Profile"];
    /** Unmodified content. */
    content?: boolean | `@${string}`;
    /** Html formatted content. */
    contentFormatted?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["CommentLikeSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** The parent comment if this comment was a reply to another. */
    parent?: ResolverInputTypes["Comment"];
    /** The post that this comment is attached to. */
    post?: ResolverInputTypes["Post"];
    replies?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["CommentSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["CommentConnection"],
    ];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Comment. */
  CommentConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["CommentEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Comment"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  CommentEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Comment"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An Episode of a Media */
  Episode: AliasType<{
    /** The anime this episode is in */
    anime?: ResolverInputTypes["Anime"];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The length of the episode in seconds */
    length?: boolean | `@${string}`;
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** When this episode aired */
    releasedAt?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ResolverInputTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Episode. */
  EpisodeConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["EpisodeEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Episode"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of EpisodeCreate. */
  EpisodeCreatePayload: AliasType<{
    episode?: ResolverInputTypes["Episode"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of EpisodeDelete. */
  EpisodeDeletePayload: AliasType<{
    episode?: ResolverInputTypes["GenericDelete"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  EpisodeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Episode"];
    __typename?: boolean | `@${string}`;
  }>;
  EpisodeMutations: AliasType<{
    create?: [
      {
        /** Create an Episode */
        input: ResolverInputTypes["EpisodeCreateInput"];
      },
      ResolverInputTypes["EpisodeCreatePayload"],
    ];
    delete?: [
      {
        /** Delete an Episode */
        input: ResolverInputTypes["GenericDeleteInput"];
      },
      ResolverInputTypes["EpisodeDeletePayload"],
    ];
    update?: [
      {
        /** Update an Episode */
        input: ResolverInputTypes["EpisodeUpdateInput"];
      },
      ResolverInputTypes["EpisodeUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of EpisodeUpdate. */
  EpisodeUpdatePayload: AliasType<{
    episode?: ResolverInputTypes["Episode"];
    errors?: ResolverInputTypes["Error"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Favorite media, characters, and people for a user */
  Favorite: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The kitsu object that is mapped */
    item?: ResolverInputTypes["FavoriteItemUnion"];
    updatedAt?: boolean | `@${string}`;
    /** The user who favorited this item */
    user?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Favorite. */
  FavoriteConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["FavoriteEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Favorite"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of FavoriteCreate. */
  FavoriteCreatePayload: AliasType<{
    errors?: ResolverInputTypes["FavoriteCreateErrorsUnion"];
    result?: ResolverInputTypes["Favorite"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of FavoriteDelete. */
  FavoriteDeletePayload: AliasType<{
    errors?: ResolverInputTypes["FavoriteDeleteErrorsUnion"];
    result?: ResolverInputTypes["Favorite"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  FavoriteEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Favorite"];
    __typename?: boolean | `@${string}`;
  }>;
  FavoriteMutations: AliasType<{
    create?: [
      { input: ResolverInputTypes["FavoriteCreateInput"] },
      ResolverInputTypes["FavoriteCreatePayload"],
    ];
    delete?: [
      { input: ResolverInputTypes["FavoriteDeleteInput"] },
      ResolverInputTypes["FavoriteDeletePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Related media grouped together */
  Franchise: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    installments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["InstallmentSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["InstallmentConnection"],
    ];
    /** The name of this franchise in various languages */
    titles?: ResolverInputTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Franchise. */
  FranchiseConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["FranchiseEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Franchise"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  FranchiseEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Franchise"];
    __typename?: boolean | `@${string}`;
  }>;
  GenericDelete: AliasType<{
    id?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  GenericError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  Image: AliasType<{
    /** A blurhash-encoded version of this image */
    blurhash?: boolean | `@${string}`;
    /** The original image */
    original?: ResolverInputTypes["ImageView"];
    views?: [
      { names?: Array<string> | undefined | null },
      ResolverInputTypes["ImageView"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  ImageView: AliasType<{
    /** The height of the image */
    height?: boolean | `@${string}`;
    /** The name of this view of the image */
    name?: boolean | `@${string}`;
    /** The URL of this view of the image */
    url?: boolean | `@${string}`;
    /** The width of the image */
    width?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Individual media that belongs to a franchise */
  Installment: AliasType<{
    /** Order based chronologically */
    alternativeOrder?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The franchise related to this installment */
    franchise?: ResolverInputTypes["Franchise"];
    id?: boolean | `@${string}`;
    /** The media related to this installment */
    media?: ResolverInputTypes["Media"];
    /** Order based by date released */
    releaseOrder?: boolean | `@${string}`;
    /** Further explains the media relationship corresponding to a franchise */
    tag?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Installment. */
  InstallmentConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["InstallmentEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Installment"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  InstallmentEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Installment"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The user library */
  Library: AliasType<{
    all?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
        status?:
          | Array<ResolverInputTypes["LibraryEntryStatusEnum"]>
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    completed?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    current?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    dropped?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    onHold?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    planned?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEntrySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    randomMedia?: [
      {
        mediaType: ResolverInputTypes["MediaTypeEnum"];
        status: Array<ResolverInputTypes["LibraryEntryStatusEnum"]>;
      },
      ResolverInputTypes["Media"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a specific media entry for a user */
  LibraryEntry: AliasType<{
    createdAt?: boolean | `@${string}`;
    events?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaTypes?:
          | Array<ResolverInputTypes["MediaTypeEnum"]>
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEventConnection"],
    ];
    /** When the user finished this media. */
    finishedAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The last unit consumed */
    lastUnit?: ResolverInputTypes["Unit"];
    /** The media related to this library entry. */
    media?: ResolverInputTypes["Media"];
    /** The next unit to be consumed */
    nextUnit?: ResolverInputTypes["Unit"];
    /** Notes left by the profile related to this library entry. */
    notes?: boolean | `@${string}`;
    /** If the media related to the library entry is Not-Safe-for-Work. */
    nsfw?: boolean | `@${string}`;
    /** If this library entry is publicly visibile from their profile, or hidden. */
    private?: boolean | `@${string}`;
    /** The number of episodes/chapters this user has watched/read */
    progress?: boolean | `@${string}`;
    /** When the user last watched an episode or read a chapter of this media. */
    progressedAt?: boolean | `@${string}`;
    /** How much you enjoyed this media (lower meaning not liking). */
    rating?: boolean | `@${string}`;
    /** The reaction based on the media of this library entry. */
    reaction?: ResolverInputTypes["MediaReaction"];
    /** Amount of times this media has been rewatched. */
    reconsumeCount?: boolean | `@${string}`;
    /** If the profile is currently rewatching this media. */
    reconsuming?: boolean | `@${string}`;
    /** When the user started this media. */
    startedAt?: boolean | `@${string}`;
    status?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The user who created this library entry. */
    user?: ResolverInputTypes["Profile"];
    /** Volumes that the profile owns (physically or digital). */
    volumesOwned?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for LibraryEntry. */
  LibraryEntryConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["LibraryEntryEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["LibraryEntry"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryCreate. */
  LibraryEntryCreatePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryDelete. */
  LibraryEntryDeletePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["GenericDelete"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  LibraryEntryEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  LibraryEntryMutations: AliasType<{
    create?: [
      {
        /** Create a Library Entry */
        input: ResolverInputTypes["LibraryEntryCreateInput"];
      },
      ResolverInputTypes["LibraryEntryCreatePayload"],
    ];
    delete?: [
      {
        /** Delete Library Entry */
        input: ResolverInputTypes["GenericDeleteInput"];
      },
      ResolverInputTypes["LibraryEntryDeletePayload"],
    ];
    update?: [
      {
        /** Update Library Entry */
        input: ResolverInputTypes["LibraryEntryUpdateInput"];
      },
      ResolverInputTypes["LibraryEntryUpdatePayload"],
    ];
    updateProgressById?: [
      {
        /** Update library entry progress by id */
        input: ResolverInputTypes["LibraryEntryUpdateProgressByIdInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateProgressByIdPayload"],
    ];
    updateProgressByMedia?: [
      {
        /** Update library entry progress by media */
        input: ResolverInputTypes["LibraryEntryUpdateProgressByMediaInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateProgressByMediaPayload"],
    ];
    updateRatingById?: [
      {
        /** Update library entry rating by id */
        input: ResolverInputTypes["LibraryEntryUpdateRatingByIdInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateRatingByIdPayload"],
    ];
    updateRatingByMedia?: [
      {
        /** Update library entry rating by media */
        input: ResolverInputTypes["LibraryEntryUpdateRatingByMediaInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateRatingByMediaPayload"],
    ];
    updateStatusById?: [
      {
        /** Update library entry status by id */
        input: ResolverInputTypes["LibraryEntryUpdateStatusByIdInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateStatusByIdPayload"],
    ];
    updateStatusByMedia?: [
      {
        /** Update library entry status by media */
        input: ResolverInputTypes["LibraryEntryUpdateStatusByMediaInput"];
      },
      ResolverInputTypes["LibraryEntryUpdateStatusByMediaPayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdate. */
  LibraryEntryUpdatePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateProgressById. */
  LibraryEntryUpdateProgressByIdPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateProgressByMedia. */
  LibraryEntryUpdateProgressByMediaPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateRatingById. */
  LibraryEntryUpdateRatingByIdPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateRatingByMedia. */
  LibraryEntryUpdateRatingByMediaPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateStatusById. */
  LibraryEntryUpdateStatusByIdPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of LibraryEntryUpdateStatusByMedia. */
  LibraryEntryUpdateStatusByMediaPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    __typename?: boolean | `@${string}`;
  }>;
  /** History of user actions for a library entry. */
  LibraryEvent: AliasType<{
    /** The data that was changed for this library event. */
    changedData?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The type of library event. */
    kind?: boolean | `@${string}`;
    /** The library entry related to this library event. */
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    /** The media related to this library event. */
    media?: ResolverInputTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    /** The user who created this library event */
    user?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for LibraryEvent. */
  LibraryEventConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["LibraryEventEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["LibraryEvent"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  LibraryEventEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["LibraryEvent"];
    __typename?: boolean | `@${string}`;
  }>;
  Manga: AliasType<{
    /** The recommended minimum age group for this media */
    ageRating?: boolean | `@${string}`;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: boolean | `@${string}`;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: boolean | `@${string}`;
    /** The rank of this media by rating */
    averageRatingRank?: boolean | `@${string}`;
    /** A large banner image for this media */
    bannerImage?: ResolverInputTypes["Image"];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCategorySortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["CategoryConnection"],
    ];
    chapter?: [{ number: number }, ResolverInputTypes["Chapter"]];
    /** The number of chapters in this manga. */
    chapterCount?: boolean | `@${string}`;
    /** The estimated number of chapters in this manga. */
    chapterCountGuess?: boolean | `@${string}`;
    chapters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["ChapterSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["ChapterConnection"],
    ];
    characters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaCharacterSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaCharacterConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    /** the day that this media made its final release */
    endDate?: boolean | `@${string}`;
    /** The number of users with this in their favorites */
    favoritesCount?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    mappings?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MappingConnection"],
    ];
    /** Your library entry related to this media. */
    myLibraryEntry?: ResolverInputTypes["LibraryEntry"];
    myWikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["WikiSubmissionConnection"],
    ];
    /** The time of the next release of this media */
    nextRelease?: boolean | `@${string}`;
    /** The countries in which the media was originally primarily produced */
    originCountries?: boolean | `@${string}`;
    /** The languages the media was originally produced in */
    originLanguages?: boolean | `@${string}`;
    /** The country in which the media was primarily produced */
    originalLocale?: boolean | `@${string}`;
    /** The poster image of this media */
    posterImage?: ResolverInputTypes["Image"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["PostSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["PostConnection"],
    ];
    productions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaProductionConnection"],
    ];
    quotes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["QuoteConnection"],
    ];
    reactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaReactionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaReactionConnection"],
    ];
    relationships?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaRelationshipConnection"],
    ];
    /** Whether the media is Safe-for-Work */
    sfw?: boolean | `@${string}`;
    /** The URL-friendly identifier of this media */
    slug?: boolean | `@${string}`;
    staff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaStaffConnection"],
    ];
    /** The day that this media first released */
    startDate?: boolean | `@${string}`;
    /** The current releasing status of this media */
    status?: boolean | `@${string}`;
    /** A secondary type for categorizing Manga. */
    subtype?: boolean | `@${string}`;
    /** Description of when this media is expected to release */
    tba?: boolean | `@${string}`;
    /** The titles for this media in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    /** Anime or Manga. */
    type?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The number of users with this in their library */
    userCount?: boolean | `@${string}`;
    /** The rank of this media by popularity */
    userCountRank?: boolean | `@${string}`;
    /** The number of volumes in this manga. */
    volumeCount?: boolean | `@${string}`;
    volumes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["VolumeSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["VolumeConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  MangaAmountConsumed: AliasType<{
    /** Total media completed atleast once. */
    completed?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Total amount of media. */
    media?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** Total progress of library including reconsuming. */
    units?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  MangaCategoryBreakdown: AliasType<{
    /** A Map of category_id -> count for all categories present on the library entries */
    categories?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The profile related to the user for this stat. */
    profile?: ResolverInputTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt?: boolean | `@${string}`;
    /** The total amount of library entries. */
    total?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Manga. */
  MangaConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MangaEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Manga"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MangaEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Manga"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Media Mappings from External Sites (MAL, Anilist, etc..) to Kitsu. */
  Mapping: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** The ID of the media from the external site. */
    externalId?: boolean | `@${string}`;
    /** The name of the site which kitsu media is being linked from. */
    externalSite?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The kitsu object that is mapped. */
    item?: ResolverInputTypes["MappingItemUnion"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Mapping. */
  MappingConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MappingEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Mapping"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MappingCreate. */
  MappingCreatePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    mapping?: ResolverInputTypes["Mapping"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MappingDelete. */
  MappingDeletePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    mapping?: ResolverInputTypes["GenericDelete"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MappingEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Mapping"];
    __typename?: boolean | `@${string}`;
  }>;
  MappingMutations: AliasType<{
    create?: [
      {
        /** Create a Mapping */ input: ResolverInputTypes["MappingCreateInput"];
      },
      ResolverInputTypes["MappingCreatePayload"],
    ];
    delete?: [
      {
        /** Delete a Mapping */ input: ResolverInputTypes["GenericDeleteInput"];
      },
      ResolverInputTypes["MappingDeletePayload"],
    ];
    update?: [
      {
        /** Update a Mapping */ input: ResolverInputTypes["MappingUpdateInput"];
      },
      ResolverInputTypes["MappingUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MappingUpdate. */
  MappingUpdatePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    mapping?: ResolverInputTypes["Mapping"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a Character starring in a Media */
  MediaCharacter: AliasType<{
    /** The character */
    character?: ResolverInputTypes["Character"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ResolverInputTypes["Media"];
    /** The role this character had in the media */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    voices?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        locale?: Array<string> | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["CharacterVoiceSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["CharacterVoiceConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for MediaCharacter. */
  MediaCharacterConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaCharacterEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["MediaCharacter"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaCharacterEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["MediaCharacter"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Media. */
  MediaConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Media"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Media"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The role a company played in the creation or localization of a media */
  MediaProduction: AliasType<{
    /** The production company */
    company?: ResolverInputTypes["Producer"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ResolverInputTypes["Media"];
    /** The role this company played */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for MediaProduction. */
  MediaProductionConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaProductionEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["MediaProduction"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaProductionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["MediaProduction"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A simple review that is 140 characters long expressing how you felt about a media */
  MediaReaction: AliasType<{
    /** The author who wrote this reaction. */
    author?: ResolverInputTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    /** Whether you have liked this media reaction */
    hasLiked?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The library entry related to this reaction. */
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              | ResolverInputTypes["MediaReactionVoteSortOption"]
              | undefined
              | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** The media related to this reaction. */
    media?: ResolverInputTypes["Media"];
    /** When this media reaction was written based on media progress. */
    progress?: boolean | `@${string}`;
    /** The reaction text related to a media. */
    reaction?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for MediaReaction. */
  MediaReactionConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaReactionEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["MediaReaction"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MediaReactionCreate. */
  MediaReactionCreatePayload: AliasType<{
    errors?: ResolverInputTypes["MediaReactionCreateErrorsUnion"];
    result?: ResolverInputTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MediaReactionDelete. */
  MediaReactionDeletePayload: AliasType<{
    errors?: ResolverInputTypes["MediaReactionDeleteErrorsUnion"];
    result?: ResolverInputTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaReactionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MediaReactionLike. */
  MediaReactionLikePayload: AliasType<{
    errors?: ResolverInputTypes["MediaReactionLikeErrorsUnion"];
    result?: ResolverInputTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
  }>;
  MediaReactionMutations: AliasType<{
    create?: [
      { input: ResolverInputTypes["MediaReactionCreateInput"] },
      ResolverInputTypes["MediaReactionCreatePayload"],
    ];
    delete?: [
      { input: ResolverInputTypes["MediaReactionDeleteInput"] },
      ResolverInputTypes["MediaReactionDeletePayload"],
    ];
    like?: [
      { input: ResolverInputTypes["MediaReactionLikeInput"] },
      ResolverInputTypes["MediaReactionLikePayload"],
    ];
    unlike?: [
      { input: ResolverInputTypes["MediaReactionUnlikeInput"] },
      ResolverInputTypes["MediaReactionUnlikePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of MediaReactionUnlike. */
  MediaReactionUnlikePayload: AliasType<{
    errors?: ResolverInputTypes["MediaReactionUnlikeErrorsUnion"];
    result?: ResolverInputTypes["MediaReaction"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A relationship from one media to another */
  MediaRelationship: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** The destination media */
    destination?: ResolverInputTypes["Media"];
    /** The kind of relationship */
    kind?: boolean | `@${string}`;
    /** The source media */
    source?: ResolverInputTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for MediaRelationship. */
  MediaRelationshipConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaRelationshipEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["MediaRelationship"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaRelationshipEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["MediaRelationship"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a person working on an anime */
  MediaStaff: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media */
    media?: ResolverInputTypes["Media"];
    /** The person */
    person?: ResolverInputTypes["Person"];
    /** The role this person had in the creation of this media */
    role?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for MediaStaff. */
  MediaStaffConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["MediaStaffEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["MediaStaff"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  MediaStaffEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["MediaStaff"];
    __typename?: boolean | `@${string}`;
  }>;
  Mutation: AliasType<{
    account?: ResolverInputTypes["AccountMutations"];
    accountCreate?: [
      { input: ResolverInputTypes["AccountCreateInput"] },
      ResolverInputTypes["AccountCreatePayload"],
    ];
    anime?: ResolverInputTypes["AnimeMutations"];
    block?: ResolverInputTypes["BlockMutations"];
    episode?: ResolverInputTypes["EpisodeMutations"];
    favorite?: ResolverInputTypes["FavoriteMutations"];
    libraryEntry?: ResolverInputTypes["LibraryEntryMutations"];
    mapping?: ResolverInputTypes["MappingMutations"];
    mediaReaction?: ResolverInputTypes["MediaReactionMutations"];
    post?: ResolverInputTypes["PostMutations"];
    pro?: ResolverInputTypes["ProMutations"];
    profile?: ResolverInputTypes["ProfileMutations"];
    profileLink?: ResolverInputTypes["ProfileLinkMutations"];
    wikiSubmission?: ResolverInputTypes["WikiSubmissionMutations"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The mutation requires an authenticated logged-in user session, and none was provided or the session has expired. The recommended action varies depending on your application and whether you provided the bearer token in the `Authorization` header or not. If you did, you should probably attempt to refresh the token, and if that fails, prompt the user to log in again. If you did not provide a bearer token, you should just prompt the user to log in. */
  NotAuthenticatedError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The mutation requires higher permissions than the current user or token has. This is a bit vague, but it generally means you're attempting to modify an object you don't own, or perform an administrator action without being an administrator. It could also mean your token does not have the required scopes to perform the action. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotAuthorizedError: AliasType<{
    action?: boolean | `@${string}`;
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An object required for your mutation was unable to be located. Usually this means the object you're attempting to modify or delete does not exist. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotFoundError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about pagination in a connection. */
  PageInfo: AliasType<{
    /** When paginating forwards, the cursor to continue. */
    endCursor?: boolean | `@${string}`;
    /** When paginating forwards, are there more items? */
    hasNextPage?: boolean | `@${string}`;
    /** When paginating backwards, are there more items? */
    hasPreviousPage?: boolean | `@${string}`;
    /** When paginating backwards, the cursor to continue. */
    startCursor?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A Voice Actor, Director, Animator, or other person who works in the creation and localization of media */
  Person: AliasType<{
    /** The day when this person was born */
    birthday?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** An image of the person */
    image?: ResolverInputTypes["Image"];
    mediaStaff?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MediaStaffConnection"],
    ];
    /** The primary name of this person. */
    name?: boolean | `@${string}`;
    /** The name of this person in various languages */
    names?: ResolverInputTypes["TitlesList"];
    /** The URL-friendly identifier of this person. */
    slug?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    voices?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["CharacterVoiceConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** A post that is visible to your followers and globally in the news-feed. */
  Post: AliasType<{
    /** The user who created this post. */
    author?: ResolverInputTypes["Profile"];
    comments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["CommentSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["CommentConnection"],
    ];
    /** Unmodified content. */
    content?: boolean | `@${string}`;
    /** Html formatted content. */
    contentFormatted?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    follows?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    id?: boolean | `@${string}`;
    /** If a post is Not-Safe-for-Work. */
    isNsfw?: boolean | `@${string}`;
    /** If this post spoils the tagged media. */
    isSpoiler?: boolean | `@${string}`;
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["PostLikeSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** When this post was locked. */
    lockedAt?: boolean | `@${string}`;
    /** The user who locked this post. */
    lockedBy?: ResolverInputTypes["Profile"];
    /** The reason why this post was locked. */
    lockedReason?: boolean | `@${string}`;
    /** The media tagged in this post. */
    media?: ResolverInputTypes["Media"];
    /** The profile of the target user of the post. */
    targetProfile?: ResolverInputTypes["Profile"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Post. */
  PostConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["PostEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Post"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of PostCreate. */
  PostCreatePayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    post?: ResolverInputTypes["Post"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  PostEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Post"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of PostLock. */
  PostLockPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    post?: ResolverInputTypes["Post"];
    __typename?: boolean | `@${string}`;
  }>;
  PostMutations: AliasType<{
    create?: [
      {
        /** Create a Post */ input: ResolverInputTypes["PostCreateInput"];
      },
      ResolverInputTypes["PostCreatePayload"],
    ];
    lock?: [
      {
        /** Lock a Post. */ input: ResolverInputTypes["PostLockInput"];
      },
      ResolverInputTypes["PostLockPayload"],
    ];
    unlock?: [
      {
        /** Unlock a Post. */ input: ResolverInputTypes["PostUnlockInput"];
      },
      ResolverInputTypes["PostUnlockPayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of PostUnlock. */
  PostUnlockPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    post?: ResolverInputTypes["Post"];
    __typename?: boolean | `@${string}`;
  }>;
  ProMutations: AliasType<{
    setDiscord?: [
      {
        /** Your discord tag (Name#1234) */ discord: string;
      },
      ResolverInputTypes["ProSetDiscordPayload"],
    ];
    setMessage?: [
      {
        /** The message to set for your Hall of Fame entry */ message: string;
      },
      ResolverInputTypes["ProSetMessagePayload"],
    ];
    /** End the user's pro subscription */
    unsubscribe?: ResolverInputTypes["ProUnsubscribePayload"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProSetDiscord. */
  ProSetDiscordPayload: AliasType<{
    discord?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProSetMessage. */
  ProSetMessagePayload: AliasType<{
    message?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A subscription to Kitsu PRO */
  ProSubscription: AliasType<{
    /** The account which is subscribed to Pro benefits */
    account?: ResolverInputTypes["Account"];
    /** The billing service used for this subscription */
    billingService?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The tier of Pro the account is subscribed to */
    tier?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProUnsubscribe. */
  ProUnsubscribePayload: AliasType<{
    expiresAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A company involved in the creation or localization of media */
  Producer: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The name of this production company */
    name?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** A user profile on Kitsu */
  Profile: AliasType<{
    /** A short biographical blurb about this profile */
    about?: boolean | `@${string}`;
    /** An avatar image to easily identify this profile */
    avatarImage?: ResolverInputTypes["Image"];
    /** A banner to display at the top of the profile */
    bannerImage?: ResolverInputTypes["Image"];
    /** When the user was born */
    birthday?: boolean | `@${string}`;
    comments?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["CommentConnection"],
    ];
    createdAt?: boolean | `@${string}`;
    favorites?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["FavoriteConnection"],
    ];
    followers?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["FollowSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    following?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["FollowSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** What the user identifies as */
    gender?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The user library of their media */
    library?: ResolverInputTypes["Library"];
    libraryEvents?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Will return all if not supplied */;
        kind?:
          | Array<ResolverInputTypes["LibraryEventKindEnum"]>
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["LibraryEventSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["LibraryEventConnection"],
    ];
    /** The user's general location */
    location?: boolean | `@${string}`;
    mediaReactions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["MediaReactionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["MediaReactionConnection"],
    ];
    /** A non-unique publicly visible name for the profile. Minimum of 3 characters and any valid Unicode character */
    name?: boolean | `@${string}`;
    /** Post pinned to the user profile */
    pinnedPost?: ResolverInputTypes["Post"];
    posts?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<ResolverInputTypes["PostSortOption"] | undefined | null>
          | undefined
          | null;
      },
      ResolverInputTypes["PostConnection"],
    ];
    /** The message this user has submitted to the Hall of Fame */
    proMessage?: boolean | `@${string}`;
    /** The PRO level the user currently has */
    proTier?: boolean | `@${string}`;
    reviews?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null;
      },
      ResolverInputTypes["ReviewConnection"],
    ];
    siteLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["SiteLinkConnection"],
    ];
    /** The URL-friendly identifier for this profile */
    slug?: boolean | `@${string}`;
    /** The different stats we calculate for this user. */
    stats?: ResolverInputTypes["ProfileStats"];
    updatedAt?: boolean | `@${string}`;
    /** A fully qualified URL to the profile */
    url?: boolean | `@${string}`;
    /** The character this profile has declared as their waifu or husbando */
    waifu?: ResolverInputTypes["Character"];
    /** The properly-gendered term for the user's waifu. This should normally only be 'Waifu' or 'Husbando' but some people are jerks, including the person who wrote this... */
    waifuOrHusbando?: boolean | `@${string}`;
    wikiSubmissions?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null /** Will return all if not supplied */;
        statuses?:
          | Array<ResolverInputTypes["WikiSubmissionStatusEnum"]>
          | undefined
          | null;
      },
      ResolverInputTypes["WikiSubmissionConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Profile. */
  ProfileConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["ProfileEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Profile"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  ProfileEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProfileLinkCreate. */
  ProfileLinkCreatePayload: AliasType<{
    errors?: ResolverInputTypes["ProfileLinkCreateErrorsUnion"];
    result?: ResolverInputTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProfileLinkDelete. */
  ProfileLinkDeletePayload: AliasType<{
    errors?: ResolverInputTypes["ProfileLinkDeleteErrorsUnion"];
    result?: ResolverInputTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileLinkMutations: AliasType<{
    create?: [
      { input: ResolverInputTypes["ProfileLinkCreateInput"] },
      ResolverInputTypes["ProfileLinkCreatePayload"],
    ];
    delete?: [
      { input: ResolverInputTypes["ProfileLinkDeleteInput"] },
      ResolverInputTypes["ProfileLinkDeletePayload"],
    ];
    update?: [
      { input: ResolverInputTypes["ProfileLinkUpdateInput"] },
      ResolverInputTypes["ProfileLinkUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** An external site that can be linked to a user. */
  ProfileLinkSite: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Name of the external profile website. */
    name?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** Regex pattern used to validate the profile link. */
    validateFind?: boolean | `@${string}`;
    /** Pattern to be replaced after validation. */
    validateReplace?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProfileLinkUpdate. */
  ProfileLinkUpdatePayload: AliasType<{
    errors?: ResolverInputTypes["ProfileLinkUpdateErrorsUnion"];
    result?: ResolverInputTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
  }>;
  ProfileMutations: AliasType<{
    update?: [
      { input: ResolverInputTypes["ProfileUpdateInput"] },
      ResolverInputTypes["ProfileUpdatePayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** The different types of user stats that we calculate. */
  ProfileStats: AliasType<{
    /** The total amount of anime you have watched over your whole life. */
    animeAmountConsumed?: ResolverInputTypes["AnimeAmountConsumed"];
    /** The breakdown of the different categories related to the anime you have completed */
    animeCategoryBreakdown?: ResolverInputTypes["AnimeCategoryBreakdown"];
    /** The total amount of manga you ahve read over your whole life. */
    mangaAmountConsumed?: ResolverInputTypes["MangaAmountConsumed"];
    /** The breakdown of the different categories related to the manga you have completed */
    mangaCategoryBreakdown?: ResolverInputTypes["MangaCategoryBreakdown"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of ProfileUpdate. */
  ProfileUpdatePayload: AliasType<{
    errors?: ResolverInputTypes["ProfileUpdateErrorsUnion"];
    result?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  Query: AliasType<{
    anime?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["AnimeConnection"],
    ];
    animeByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        status: ResolverInputTypes["ReleaseStatusEnum"];
      },
      ResolverInputTypes["AnimeConnection"],
    ];
    blocks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["BlockConnection"],
    ];
    categories?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["CategoryConnection"],
    ];
    /** Kitsu account details. You must supply an Authorization token in header. */
    currentAccount?: ResolverInputTypes["Account"];
    /** Your Kitsu profile. You must supply an Authorization token in header. */
    currentProfile?: ResolverInputTypes["Profile"];
    findAnimeById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Anime"],
    ];
    findAnimeBySlug?: [{ slug: string }, ResolverInputTypes["Anime"]];
    findCategoryById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Category"],
    ];
    findCategoryBySlug?: [{ slug: string }, ResolverInputTypes["Category"]];
    findChapterById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Chapter"],
    ];
    findCharacterById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Character"],
    ];
    findCharacterBySlug?: [{ slug: string }, ResolverInputTypes["Character"]];
    findLibraryEntryById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["LibraryEntry"],
    ];
    findLibraryEventById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["LibraryEvent"],
    ];
    findMangaById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Manga"],
    ];
    findMangaBySlug?: [{ slug: string }, ResolverInputTypes["Manga"]];
    findMediaByIdAndType?: [
      {
        id: ResolverInputTypes["ID"];
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["Media"],
    ];
    findPersonById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Person"],
    ];
    findPersonBySlug?: [{ slug: string }, ResolverInputTypes["Person"]];
    findPostById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Post"],
    ];
    findProfileById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Profile"],
    ];
    findProfileBySlug?: [{ slug: string }, ResolverInputTypes["Profile"]];
    findReportById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["Report"],
    ];
    findWikiSubmissionById?: [
      { id: ResolverInputTypes["ID"] },
      ResolverInputTypes["WikiSubmission"],
    ];
    franchises?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["FranchiseConnection"],
    ];
    globalTrending?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["MediaConnection"],
    ];
    libraryEntriesByMedia?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaId: ResolverInputTypes["ID"];
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    libraryEntriesByMediaType?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["LibraryEntryConnection"],
    ];
    localTrending?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["MediaConnection"],
    ];
    lookupMapping?: [
      {
        externalId: ResolverInputTypes["ID"];
        externalSite: ResolverInputTypes["MappingExternalSiteEnum"];
      },
      ResolverInputTypes["MappingItemUnion"],
    ];
    manga?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["MangaConnection"],
    ];
    mangaByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        status: ResolverInputTypes["ReleaseStatusEnum"];
      },
      ResolverInputTypes["MangaConnection"],
    ];
    patrons?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    randomMedia?: [
      {
        ageRatings: Array<ResolverInputTypes["AgeRatingEnum"]>;
        mediaType: ResolverInputTypes["MediaTypeEnum"];
      },
      ResolverInputTypes["Media"],
    ];
    reports?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["ReportConnection"],
    ];
    reportsByStatus?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null /** Will return all if not supplied */;
        statuses?:
          | Array<ResolverInputTypes["ReportStatusEnum"]>
          | undefined
          | null;
      },
      ResolverInputTypes["ReportConnection"],
    ];
    searchAnimeByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        title: string;
      },
      ResolverInputTypes["AnimeConnection"],
    ];
    searchMangaByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        title: string;
      },
      ResolverInputTypes["MangaConnection"],
    ];
    searchMediaByTitle?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?:
          | number
          | undefined
          | null /** Dynamically choose a specific media_type. If left blank, it will return results for both. */;
        mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
        title: string;
      },
      ResolverInputTypes["MediaConnection"],
    ];
    searchProfileByUsername?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        username: string;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** Get your current session info */
    session?: ResolverInputTypes["Session"];
    wikiSubmissionsByStatuses?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
        sort?:
          | Array<
              ResolverInputTypes["WikiSubmissionSortOption"] | undefined | null
            >
          | undefined
          | null /** Will return all if not supplied */;
        statuses?:
          | Array<ResolverInputTypes["WikiSubmissionStatusEnum"]>
          | undefined
          | null;
      },
      ResolverInputTypes["WikiSubmissionConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** A quote from a media */
  Quote: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    lines?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["QuoteLineConnection"],
    ];
    /** The media this quote is excerpted from */
    media?: ResolverInputTypes["Media"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Quote. */
  QuoteConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["QuoteEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Quote"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  QuoteEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Quote"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A line in a quote */
  QuoteLine: AliasType<{
    /** The character who said this line */
    character?: ResolverInputTypes["Character"];
    /** The line that was spoken */
    content?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The quote this line is in */
    quote?: ResolverInputTypes["Quote"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for QuoteLine. */
  QuoteLineConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["QuoteLineEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["QuoteLine"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  QuoteLineEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["QuoteLine"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A report made by a user */
  Report: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Additional information related to why the report was made */
    explanation?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The moderator who responded to this report */
    moderator?: ResolverInputTypes["Profile"];
    /** The entity that the report is related to */
    naughty?: ResolverInputTypes["ReportItemUnion"];
    /** The reason for why the report was made */
    reason?: boolean | `@${string}`;
    /** The user who made this report */
    reporter?: ResolverInputTypes["Profile"];
    /** The resolution status for this report */
    status?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Report. */
  ReportConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["ReportEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Report"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  ReportEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Report"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A media review made by a user */
  Review: AliasType<{
    /** The author who wrote this review. */
    author?: ResolverInputTypes["Profile"];
    /** The review data */
    content?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    /** The review data formatted */
    formattedContent?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Does this review contain spoilers from the media */
    isSpoiler?: boolean | `@${string}`;
    /** The library entry related to this review. */
    libraryEntry?: ResolverInputTypes["LibraryEntry"];
    likes?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["ProfileConnection"],
    ];
    /** The media related to this review. */
    media?: ResolverInputTypes["Media"];
    /** When this review was written based on media progress. */
    progress?: boolean | `@${string}`;
    /** The user rating for this media */
    rating?: boolean | `@${string}`;
    /** Potentially migrated over from hummingbird. */
    source?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Review. */
  ReviewConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["ReviewEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Review"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  ReviewEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Review"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Information about a user session */
  Session: AliasType<{
    /** The account associated with this session */
    account?: ResolverInputTypes["Account"];
    /** Single sign-on token for Nolt */
    noltToken?: boolean | `@${string}`;
    /** The profile associated with this session */
    profile?: ResolverInputTypes["Profile"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A link to a user's profile on an external site. */
  SiteLink: AliasType<{
    /** The user profile the site is linked to. */
    author?: ResolverInputTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The actual linked website. */
    site?: ResolverInputTypes["ProfileLinkSite"];
    updatedAt?: boolean | `@${string}`;
    /** A fully qualified URL of the user profile on an external site. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for SiteLink. */
  SiteLinkConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["SiteLinkEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["SiteLink"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  SiteLinkEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["SiteLink"];
    __typename?: boolean | `@${string}`;
  }>;
  /** The streaming company. */
  Streamer: AliasType<{
    createdAt?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The name of the site that is streaming this media. */
    siteName?: boolean | `@${string}`;
    streamingLinks?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["StreamingLinkConnection"],
    ];
    updatedAt?: boolean | `@${string}`;
    videos?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["VideoConnection"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** The stream link. */
  StreamingLink: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** The media being streamed */
    media?: ResolverInputTypes["Media"];
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ResolverInputTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** Fully qualified URL for the streaming link. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for StreamingLink. */
  StreamingLinkConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["StreamingLinkEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["StreamingLink"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  StreamingLinkEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["StreamingLink"];
    __typename?: boolean | `@${string}`;
  }>;
  TitlesList: AliasType<{
    /** A list of additional, alternative, abbreviated, or unofficial titles */
    alternatives?: boolean | `@${string}`;
    /** The official or de facto international title */
    canonical?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the canonical title */
    canonicalLocale?: boolean | `@${string}`;
    localized?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    /** The original title of the media in the original language */
    original?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the original title */
    originalLocale?: boolean | `@${string}`;
    /** The title that best matches the user's preferred settings */
    preferred?: boolean | `@${string}`;
    /** The original title, romanized into latin script */
    romanized?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the romanized title */
    romanizedLocale?: boolean | `@${string}`;
    /** The title translated into the user's locale */
    translated?: boolean | `@${string}`;
    /** The locale code that identifies which title is used as the translated title */
    translatedLocale?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The mutation failed validation. This is usually because the input provided was invalid in some way, such as a missing required field or an invalid value for a field. There may be multiple of this error, one for each failed validation, and the `path` will generally refer to a location in the input parameters, that you can map back to the input fields in your form. The recommended action is to display validation errors to the user, and allow them to correct the input and resubmit. */
  ValidationError: AliasType<{
    /** The error code. */
    code?: boolean | `@${string}`;
    /** A description of the error */
    message?: boolean | `@${string}`;
    /** Which input value this error came from */
    path?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The media video. */
  Video: AliasType<{
    createdAt?: boolean | `@${string}`;
    /** Spoken language is replaced by language of choice. */
    dubs?: boolean | `@${string}`;
    /** The episode of this video */
    episode?: ResolverInputTypes["Episode"];
    id?: boolean | `@${string}`;
    /** Which regions this video is available in. */
    regions?: boolean | `@${string}`;
    /** The site that is streaming this media. */
    streamer?: ResolverInputTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    /** The url of the video. */
    url?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Video. */
  VideoConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["VideoEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Video"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  VideoEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Video"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A manga volume which can contain multiple chapters. */
  Volume: AliasType<{
    chapters?: [
      {
        /** Returns the elements in the list that come after the specified cursor. */
        after?:
          | string
          | undefined
          | null /** Returns the elements in the list that come before the specified cursor. */;
        before?:
          | string
          | undefined
          | null /** Returns the first _n_ elements from the list. */;
        first?:
          | number
          | undefined
          | null /** Returns the last _n_ elements from the list. */;
        last?: number | undefined | null;
      },
      ResolverInputTypes["ChapterConnection"],
    ];
    /** The number of chapters in this volume. */
    chaptersCount?: boolean | `@${string}`;
    createdAt?: boolean | `@${string}`;
    description?: [
      { locales?: Array<string> | undefined | null },
      boolean | `@${string}`,
    ];
    id?: boolean | `@${string}`;
    /** The isbn number of this volume. */
    isbn?: boolean | `@${string}`;
    /** The manga this volume is in. */
    manga?: ResolverInputTypes["Manga"];
    /** The sequence number of this unit */
    number?: boolean | `@${string}`;
    /** The date when this chapter was released. */
    published?: boolean | `@${string}`;
    /** A thumbnail image for the unit */
    thumbnail?: ResolverInputTypes["Image"];
    /** The titles for this unit in various locales */
    titles?: ResolverInputTypes["TitlesList"];
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for Volume. */
  VolumeConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["VolumeEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["Volume"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  VolumeEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["Volume"];
    __typename?: boolean | `@${string}`;
  }>;
  /** A Wiki Submission is used to either create or edit existing data in our database. This will allow a simple and convient way for users to submit issues/corrections without all the work being left to the mods. */
  WikiSubmission: AliasType<{
    /** The user who created this draft */
    author?: ResolverInputTypes["Profile"];
    createdAt?: boolean | `@${string}`;
    /** The full object that holds all the details for any modifications/additions/deletions made to the entity you are editing. This will be validated using JSON Schema. */
    data?: boolean | `@${string}`;
    id?: boolean | `@${string}`;
    /** Any additional information that may need to be provided related to the Wiki Submission */
    notes?: boolean | `@${string}`;
    /** The status of the Wiki Submission */
    status?: boolean | `@${string}`;
    /** The title given to the Wiki Submission. This will default to the title of what is being edited. */
    title?: boolean | `@${string}`;
    updatedAt?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** The connection type for WikiSubmission. */
  WikiSubmissionConnection: AliasType<{
    /** A list of edges. */
    edges?: ResolverInputTypes["WikiSubmissionEdge"];
    /** A list of nodes. */
    nodes?: ResolverInputTypes["WikiSubmission"];
    /** Information to aid in pagination. */
    pageInfo?: ResolverInputTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount?: boolean | `@${string}`;
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of WikiSubmissionCreateDraft. */
  WikiSubmissionCreateDraftPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    wikiSubmission?: ResolverInputTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
  }>;
  /** An edge in a connection. */
  WikiSubmissionEdge: AliasType<{
    /** A cursor for use in pagination. */
    cursor?: boolean | `@${string}`;
    /** The item at the end of the edge. */
    node?: ResolverInputTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
  }>;
  WikiSubmissionMutations: AliasType<{
    createDraft?: [
      {
        /** Create a wiki submission draft. */
        input: ResolverInputTypes["WikiSubmissionCreateDraftInput"];
      },
      ResolverInputTypes["WikiSubmissionCreateDraftPayload"],
    ];
    submitDraft?: [
      {
        /** Submit a wiki submission draft. This will change the status to pending. */
        input: ResolverInputTypes["WikiSubmissionSubmitDraftInput"];
      },
      ResolverInputTypes["WikiSubmissionSubmitDraftPayload"],
    ];
    updateDraft?: [
      {
        /** Update a wiki submission draft. */
        input: ResolverInputTypes["WikiSubmissionUpdateDraftInput"];
      },
      ResolverInputTypes["WikiSubmissionUpdateDraftPayload"],
    ];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of WikiSubmissionSubmitDraft. */
  WikiSubmissionSubmitDraftPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    wikiSubmission?: ResolverInputTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
  }>;
  /** Autogenerated return type of WikiSubmissionUpdateDraft. */
  WikiSubmissionUpdateDraftPayload: AliasType<{
    errors?: ResolverInputTypes["Error"];
    wikiSubmission?: ResolverInputTypes["WikiSubmission"];
    __typename?: boolean | `@${string}`;
  }>;
  AgeRatingEnum: AgeRatingEnum;
  AnimeSubtypeEnum: AnimeSubtypeEnum;
  ChapterSortEnum: ChapterSortEnum;
  CharacterRoleEnum: CharacterRoleEnum;
  CharacterVoiceSortEnum: CharacterVoiceSortEnum;
  CommentLikeSortEnum: CommentLikeSortEnum;
  CommentSortEnum: CommentSortEnum;
  EpisodeSortEnum: EpisodeSortEnum;
  ExternalIdentityProviderEnum: ExternalIdentityProviderEnum;
  FavoriteEnum: FavoriteEnum;
  FollowSortEnum: FollowSortEnum;
  InstallmentSortEnum: InstallmentSortEnum;
  InstallmentTagEnum: InstallmentTagEnum;
  LibraryEntrySortEnum: LibraryEntrySortEnum;
  LibraryEntryStatusEnum: LibraryEntryStatusEnum;
  LibraryEventKindEnum: LibraryEventKindEnum;
  LibraryEventSortEnum: LibraryEventSortEnum;
  LockedReasonEnum: LockedReasonEnum;
  MangaSubtypeEnum: MangaSubtypeEnum;
  MappingExternalSiteEnum: MappingExternalSiteEnum;
  MappingItemEnum: MappingItemEnum;
  MediaCategorySortEnum: MediaCategorySortEnum;
  MediaCharacterSortEnum: MediaCharacterSortEnum;
  MediaProductionRoleEnum: MediaProductionRoleEnum;
  MediaReactionSortEnum: MediaReactionSortEnum;
  MediaReactionVoteSortEnum: MediaReactionVoteSortEnum;
  /** The relationship kind from one media entry to another */
  MediaRelationshipKindEnum: MediaRelationshipKindEnum;
  /** これはアニメやマンガです */
  MediaTypeEnum: MediaTypeEnum;
  PostLikeSortEnum: PostLikeSortEnum;
  PostSortEnum: PostSortEnum;
  ProTierEnum: ProTierEnum;
  ProfileLinksSitesEnum: ProfileLinksSitesEnum;
  RatingSystemEnum: RatingSystemEnum;
  RecurringBillingServiceEnum: RecurringBillingServiceEnum;
  ReleaseSeasonEnum: ReleaseSeasonEnum;
  ReleaseStatusEnum: ReleaseStatusEnum;
  ReportReasonEnum: ReportReasonEnum;
  ReportStatusEnum: ReportStatusEnum;
  SfwFilterPreferenceEnum: SfwFilterPreferenceEnum;
  SitePermissionEnum: SitePermissionEnum;
  SiteThemeEnum: SiteThemeEnum;
  SortDirection: SortDirection;
  TitleLanguagePreferenceEnum: TitleLanguagePreferenceEnum;
  VolumeSortEnum: VolumeSortEnum;
  WaifuOrHusbandoEnum: WaifuOrHusbandoEnum;
  WikiSubmissionSortEnum: WikiSubmissionSortEnum;
  WikiSubmissionStatusEnum: WikiSubmissionStatusEnum;
  /** A date, expressed as an ISO8601 string */
  Date: unknown;
  /** An ISO 8601-encoded date */
  ISO8601Date: unknown;
  /** An ISO 8601-encoded datetime */
  ISO8601DateTime: unknown;
  /** Represents untyped JSON */
  JSON: unknown;
  /** A loose key-value map in GraphQL */
  Map: unknown;
  Upload: unknown;
  AccountChangePasswordInput: {
    /** The new password to set */
    newPassword: string;
    /** The current, existing password for the account */
    oldPassword: string;
  };
  AccountCreateInput: {
    /** The email address to reset the password for */
    email: string;
    /** An external identity to associate with the account on creation */
    externalIdentity?:
      | ResolverInputTypes["AccountExternalIdentityInput"]
      | undefined
      | null;
    /** The name of the user */
    name: string;
    /** The password for the user */
    password: string;
  };
  AccountExternalIdentityInput: {
    id: string;
    provider: ResolverInputTypes["ExternalIdentityProviderEnum"];
  };
  AccountUpdateInput: {
    /** The country of the user */
    country?: string | undefined | null;
    /** How media titles will get visualized */
    preferredTitleLanguage?:
      | ResolverInputTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null;
    /** The preferred rating system */
    ratingSystem?: ResolverInputTypes["RatingSystemEnum"] | undefined | null;
    /** The SFW Filter setting */
    sfwFilterPreference?:
      | ResolverInputTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null;
    /** The theme displayed on Kitsu */
    siteTheme?: ResolverInputTypes["SiteThemeEnum"] | undefined | null;
    /** The time zone of the user */
    timeZone?: string | undefined | null;
  };
  AnimeCreateInput: {
    ageRating?: ResolverInputTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: ResolverInputTypes["Upload"] | undefined | null;
    description: ResolverInputTypes["Map"];
    endDate?: ResolverInputTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    posterImage?: ResolverInputTypes["Upload"] | undefined | null;
    startDate?: ResolverInputTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles: ResolverInputTypes["TitlesListInput"];
    youtubeTrailerVideoId?: string | undefined | null;
  };
  AnimeUpdateInput: {
    ageRating?: ResolverInputTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: ResolverInputTypes["Upload"] | undefined | null;
    description?: ResolverInputTypes["Map"] | undefined | null;
    endDate?: ResolverInputTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    id: ResolverInputTypes["ID"];
    posterImage?: ResolverInputTypes["Upload"] | undefined | null;
    startDate?: ResolverInputTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles?: ResolverInputTypes["TitlesListInput"] | undefined | null;
    youtubeTrailerVideoId?: string | undefined | null;
  };
  BlockCreateInput: {
    /** The id of the user to block. */
    blockedId: ResolverInputTypes["ID"];
  };
  BlockDeleteInput: {
    /** The id of the block. */
    blockId: ResolverInputTypes["ID"];
  };
  ChapterSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["ChapterSortEnum"];
  };
  CharacterVoiceSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["CharacterVoiceSortEnum"];
  };
  CommentLikeSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["CommentLikeSortEnum"];
  };
  CommentSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["CommentSortEnum"];
  };
  EpisodeCreateInput: {
    description?: ResolverInputTypes["Map"] | undefined | null;
    length?: number | undefined | null;
    mediaId: ResolverInputTypes["ID"];
    mediaType: ResolverInputTypes["MediaTypeEnum"];
    number: number;
    releasedAt?: ResolverInputTypes["Date"] | undefined | null;
    thumbnailImage?: ResolverInputTypes["Upload"] | undefined | null;
    titles: ResolverInputTypes["TitlesListInput"];
  };
  EpisodeSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["EpisodeSortEnum"];
  };
  EpisodeUpdateInput: {
    description?: ResolverInputTypes["Map"] | undefined | null;
    id: ResolverInputTypes["ID"];
    length?: number | undefined | null;
    number?: number | undefined | null;
    releasedAt?: ResolverInputTypes["Date"] | undefined | null;
    thumbnailImage?: ResolverInputTypes["Upload"] | undefined | null;
    titles?: ResolverInputTypes["TitlesListInput"] | undefined | null;
  };
  FavoriteCreateInput: {
    /** The id of the entry */
    id: ResolverInputTypes["ID"];
    /** The type of the entry. */
    type: ResolverInputTypes["FavoriteEnum"];
  };
  FavoriteDeleteInput: {
    /** The id of the favorite entry. */
    favoriteId: ResolverInputTypes["ID"];
  };
  FollowSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["FollowSortEnum"];
  };
  GenericDeleteInput: {
    id: ResolverInputTypes["ID"];
  };
  InstallmentSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["InstallmentSortEnum"];
  };
  LibraryEntryCreateInput: {
    finishedAt?: ResolverInputTypes["ISO8601DateTime"] | undefined | null;
    mediaId: ResolverInputTypes["ID"];
    mediaType: ResolverInputTypes["MediaTypeEnum"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: ResolverInputTypes["ISO8601DateTime"] | undefined | null;
    status: ResolverInputTypes["LibraryEntryStatusEnum"];
    volumesOwned?: number | undefined | null;
  };
  LibraryEntrySortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["LibraryEntrySortEnum"];
  };
  LibraryEntryUpdateInput: {
    finishedAt?: ResolverInputTypes["ISO8601DateTime"] | undefined | null;
    id: ResolverInputTypes["ID"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: ResolverInputTypes["ISO8601DateTime"] | undefined | null;
    status?: ResolverInputTypes["LibraryEntryStatusEnum"] | undefined | null;
    volumesOwned?: number | undefined | null;
  };
  LibraryEntryUpdateProgressByIdInput: {
    id: ResolverInputTypes["ID"];
    progress: number;
  };
  LibraryEntryUpdateProgressByMediaInput: {
    mediaId: ResolverInputTypes["ID"];
    mediaType: ResolverInputTypes["MediaTypeEnum"];
    progress: number;
  };
  LibraryEntryUpdateRatingByIdInput: {
    id: ResolverInputTypes["ID"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateRatingByMediaInput: {
    mediaId: ResolverInputTypes["ID"];
    mediaType: ResolverInputTypes["MediaTypeEnum"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateStatusByIdInput: {
    id: ResolverInputTypes["ID"];
    status: ResolverInputTypes["LibraryEntryStatusEnum"];
  };
  LibraryEntryUpdateStatusByMediaInput: {
    mediaId: ResolverInputTypes["ID"];
    mediaType: ResolverInputTypes["MediaTypeEnum"];
    status: ResolverInputTypes["LibraryEntryStatusEnum"];
  };
  LibraryEventSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["LibraryEventSortEnum"];
  };
  MappingCreateInput: {
    externalId: ResolverInputTypes["ID"];
    externalSite: ResolverInputTypes["MappingExternalSiteEnum"];
    itemId: ResolverInputTypes["ID"];
    itemType: ResolverInputTypes["MappingItemEnum"];
  };
  MappingUpdateInput: {
    externalId?: ResolverInputTypes["ID"] | undefined | null;
    externalSite?:
      | ResolverInputTypes["MappingExternalSiteEnum"]
      | undefined
      | null;
    id: ResolverInputTypes["ID"];
    itemId?: ResolverInputTypes["ID"] | undefined | null;
    itemType?: ResolverInputTypes["MappingItemEnum"] | undefined | null;
  };
  MediaCategorySortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["MediaCategorySortEnum"];
  };
  MediaCharacterSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["MediaCharacterSortEnum"];
  };
  MediaReactionCreateInput: {
    /** The ID of the entry in your library to react to */
    libraryEntryId: ResolverInputTypes["ID"];
    /** The text of the reaction to the media */
    reaction: string;
  };
  MediaReactionDeleteInput: {
    /** The reaction to delete */
    mediaReactionId: ResolverInputTypes["ID"];
  };
  MediaReactionLikeInput: {
    /** The reaction to like */
    mediaReactionId: ResolverInputTypes["ID"];
  };
  MediaReactionSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["MediaReactionSortEnum"];
  };
  MediaReactionUnlikeInput: {
    /** The reaction to remove your like from */
    mediaReactionId: ResolverInputTypes["ID"];
  };
  MediaReactionVoteSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["MediaReactionVoteSortEnum"];
  };
  PostCreateInput: {
    content: string;
    isNsfw?: boolean | undefined | null;
    isSpoiler?: boolean | undefined | null;
    mediaId?: ResolverInputTypes["ID"] | undefined | null;
    mediaType?: ResolverInputTypes["MediaTypeEnum"] | undefined | null;
    spoiledUnitId?: ResolverInputTypes["ID"] | undefined | null;
    spoiledUnitType?: string | undefined | null;
    targetUserId?: ResolverInputTypes["ID"] | undefined | null;
  };
  PostLikeSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["PostLikeSortEnum"];
  };
  PostLockInput: {
    id: ResolverInputTypes["ID"];
    lockedReason: ResolverInputTypes["LockedReasonEnum"];
  };
  PostSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["PostSortEnum"];
  };
  PostUnlockInput: {
    id: ResolverInputTypes["ID"];
  };
  ProfileLinkCreateInput: {
    /** The website. */
    profileLinkSite: ResolverInputTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileLinkDeleteInput: {
    /** The profile link to delete */
    profileLink: ResolverInputTypes["ProfileLinksSitesEnum"];
  };
  ProfileLinkUpdateInput: {
    /** The website. */
    profileLinkSite: ResolverInputTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileUpdateInput: {
    /** About section of the profile. */
    about?: string | undefined | null;
    /** The birthday of the user. */
    birthday?: ResolverInputTypes["Date"] | undefined | null;
    /** The preferred gender of the user. */
    gender?: string | undefined | null;
    /** Your ID or the one of another user. */
    id?: ResolverInputTypes["ID"] | undefined | null;
    /** The display name of the user */
    name?: string | undefined | null;
    /** The slug (@username) of the user */
    slug?: string | undefined | null;
    /** The id of the waifu or husbando. */
    waifuId?: ResolverInputTypes["ID"] | undefined | null;
    /** The user preference of their partner. */
    waifuOrHusbando?:
      | ResolverInputTypes["WaifuOrHusbandoEnum"]
      | undefined
      | null;
  };
  TitlesListInput: {
    alternatives?: Array<string> | undefined | null;
    canonical?: string | undefined | null;
    canonicalLocale?: string | undefined | null;
    localized?: ResolverInputTypes["Map"] | undefined | null;
  };
  VolumeSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["VolumeSortEnum"];
  };
  WikiSubmissionCreateDraftInput: {
    data: ResolverInputTypes["JSON"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionSortOption: {
    direction: ResolverInputTypes["SortDirection"];
    on: ResolverInputTypes["WikiSubmissionSortEnum"];
  };
  WikiSubmissionSubmitDraftInput: {
    data: ResolverInputTypes["JSON"];
    id: ResolverInputTypes["ID"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionUpdateDraftInput: {
    data: ResolverInputTypes["JSON"];
    id: ResolverInputTypes["ID"];
    notes?: string | undefined | null;
  };
  ID: unknown;
};

export type ModelTypes = {
  schema: {
    query?: ModelTypes["Query"] | undefined | null;
    mutation?: ModelTypes["Mutation"] | undefined | null;
  };
  /** Generic Amount Consumed based on Media */
  AmountConsumed:
    | ModelTypes["AnimeAmountConsumed"]
    | ModelTypes["MangaAmountConsumed"];
  /** Generic Category Breakdown based on Media */
  CategoryBreakdown:
    | ModelTypes["AnimeCategoryBreakdown"]
    | ModelTypes["MangaCategoryBreakdown"];
  /** An episodic media in the Kitsu database */
  Episodic: ModelTypes["Anime"];
  /** Generic error fields used by all errors. */
  Error:
    | ModelTypes["GenericError"]
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"]
    | ModelTypes["ValidationError"];
  /** A media in the Kitsu database */
  Media: ModelTypes["Anime"] | ModelTypes["Manga"];
  /** Media that is streamable. */
  Streamable: ModelTypes["StreamingLink"] | ModelTypes["Video"];
  /** Media units such as episodes or chapters */
  Unit: ModelTypes["Chapter"] | ModelTypes["Episode"] | ModelTypes["Volume"];
  WithTimestamps:
    | ModelTypes["Account"]
    | ModelTypes["Anime"]
    | ModelTypes["Block"]
    | ModelTypes["Category"]
    | ModelTypes["Chapter"]
    | ModelTypes["Character"]
    | ModelTypes["CharacterVoice"]
    | ModelTypes["Comment"]
    | ModelTypes["Episode"]
    | ModelTypes["Favorite"]
    | ModelTypes["Franchise"]
    | ModelTypes["Installment"]
    | ModelTypes["LibraryEntry"]
    | ModelTypes["LibraryEvent"]
    | ModelTypes["Manga"]
    | ModelTypes["Mapping"]
    | ModelTypes["MediaCharacter"]
    | ModelTypes["MediaProduction"]
    | ModelTypes["MediaReaction"]
    | ModelTypes["MediaRelationship"]
    | ModelTypes["MediaStaff"]
    | ModelTypes["Person"]
    | ModelTypes["Post"]
    | ModelTypes["ProSubscription"]
    | ModelTypes["Producer"]
    | ModelTypes["Profile"]
    | ModelTypes["ProfileLinkSite"]
    | ModelTypes["Quote"]
    | ModelTypes["QuoteLine"]
    | ModelTypes["Report"]
    | ModelTypes["Review"]
    | ModelTypes["SiteLink"]
    | ModelTypes["Streamer"]
    | ModelTypes["StreamingLink"]
    | ModelTypes["Video"]
    | ModelTypes["Volume"]
    | ModelTypes["WikiSubmission"];
  AccountChangePasswordErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["ValidationError"];
  AccountCreateErrorsUnion: ModelTypes["ValidationError"];
  AccountUpdateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  BlockCreateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  BlockDeleteErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  FavoriteCreateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  FavoriteDeleteErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  /** Objects which are Favoritable */
  FavoriteItemUnion:
    | ModelTypes["Anime"]
    | ModelTypes["Character"]
    | ModelTypes["Manga"]
    | ModelTypes["Person"];
  /** Objects which are Mappable */
  MappingItemUnion:
    | ModelTypes["Anime"]
    | ModelTypes["Category"]
    | ModelTypes["Character"]
    | ModelTypes["Episode"]
    | ModelTypes["Manga"]
    | ModelTypes["Person"]
    | ModelTypes["Producer"];
  MediaReactionCreateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"]
    | ModelTypes["ValidationError"];
  MediaReactionDeleteErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  MediaReactionLikeErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  MediaReactionUnlikeErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  ProfileLinkCreateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"]
    | ModelTypes["ValidationError"];
  ProfileLinkDeleteErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  ProfileLinkUpdateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"]
    | ModelTypes["ValidationError"];
  ProfileUpdateErrorsUnion:
    | ModelTypes["NotAuthenticatedError"]
    | ModelTypes["NotAuthorizedError"]
    | ModelTypes["NotFoundError"];
  /** Objects which are Reportable */
  ReportItemUnion:
    | ModelTypes["Comment"]
    | ModelTypes["MediaReaction"]
    | ModelTypes["Post"]
    | ModelTypes["Review"];
  /** A user account on Kitsu */
  Account: {
    /** The country this user resides in */
    country?: string | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The email addresses associated with this account */
    email: Array<string>;
    /** The features this user has access to */
    enabledFeatures: Array<string>;
    /** Facebook account linked to the account */
    facebookId?: string | undefined | null;
    id: ModelTypes["ID"];
    /** Primary language for the account */
    language?: string | undefined | null;
    /** Longest period an account has had a PRO subscription for in seconds */
    maxProStreak?: number | undefined | null;
    /** The PRO subscription for this account */
    proSubscription?: ModelTypes["ProSubscription"] | undefined | null;
    /** The profile for this account */
    profile: ModelTypes["Profile"];
    /** Media rating system used for the account */
    ratingSystem: ModelTypes["RatingSystemEnum"];
    /** Whether Not Safe For Work content is accessible */
    sfwFilter?: boolean | undefined | null;
    /** The level of the SFW Filter */
    sfwFilterPreference?:
      | ModelTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null;
    /** The site-wide permissions this user has access to */
    sitePermissions: Array<ModelTypes["SitePermissionEnum"]>;
    /** Time zone of the account */
    timeZone?: string | undefined | null;
    /** Preferred language for media titles */
    titleLanguagePreference?:
      | ModelTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null;
    /** Twitter account linked to the account */
    twitterId?: string | undefined | null;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** Autogenerated return type of AccountChangePassword. */
  AccountChangePasswordPayload: {
    errors?:
      | Array<ModelTypes["AccountChangePasswordErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["Account"] | undefined | null;
  };
  /** Autogenerated return type of AccountCreate. */
  AccountCreatePayload: {
    errors?: Array<ModelTypes["AccountCreateErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Account"] | undefined | null;
  };
  AccountMutations: {
    /** Change your Kitsu account password */
    changePassword?:
      | ModelTypes["AccountChangePasswordPayload"]
      | undefined
      | null;
    /** Send a password reset email */
    sendPasswordReset?:
      | ModelTypes["AccountSendPasswordResetPayload"]
      | undefined
      | null;
    /** Update the account of the current user. */
    update?: ModelTypes["AccountUpdatePayload"] | undefined | null;
  };
  /** Autogenerated return type of AccountSendPasswordReset. */
  AccountSendPasswordResetPayload: {
    email: string;
  };
  /** Autogenerated return type of AccountUpdate. */
  AccountUpdatePayload: {
    errors?: Array<ModelTypes["AccountUpdateErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Account"] | undefined | null;
  };
  Anime: {
    /** The recommended minimum age group for this media */
    ageRating?: ModelTypes["AgeRatingEnum"] | undefined | null;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: string | undefined | null;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: number | undefined | null;
    /** The rank of this media by rating */
    averageRatingRank?: number | undefined | null;
    /** A large banner image for this media */
    bannerImage?: ModelTypes["Image"] | undefined | null;
    /** A list of categories for this media */
    categories: ModelTypes["CategoryConnection"];
    /** The characters who starred in this media */
    characters: ModelTypes["MediaCharacterConnection"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief (mostly spoiler free) summary or description of the media. */
    description: ModelTypes["Map"];
    /** the day that this media made its final release */
    endDate?: ModelTypes["Date"] | undefined | null;
    /** The number of episodes in this series */
    episodeCount?: number | undefined | null;
    /** The general length (in seconds) of each episode */
    episodeLength?: number | undefined | null;
    /** Episodes for this media */
    episodes: ModelTypes["EpisodeConnection"];
    /** The number of users with this in their favorites */
    favoritesCount?: number | undefined | null;
    id: ModelTypes["ID"];
    /** A list of mappings for this media */
    mappings: ModelTypes["MappingConnection"];
    /** Your library entry related to this media. */
    myLibraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
    /** A list of your wiki submissions for this media */
    myWikiSubmissions: ModelTypes["WikiSubmissionConnection"];
    /** The time of the next release of this media */
    nextRelease?: ModelTypes["ISO8601DateTime"] | undefined | null;
    /** The countries in which the media was originally primarily produced */
    originCountries: Array<string>;
    /** The languages the media was originally produced in */
    originLanguages: Array<string>;
    /** The country in which the media was primarily produced */
    originalLocale?: string | undefined | null;
    /** The poster image of this media */
    posterImage?: ModelTypes["Image"] | undefined | null;
    /** All posts that tag this media. */
    posts: ModelTypes["PostConnection"];
    /** The companies which helped to produce this media */
    productions: ModelTypes["MediaProductionConnection"];
    /** A list of quotes from this media */
    quotes: ModelTypes["QuoteConnection"];
    /** A list of reactions for this media */
    reactions: ModelTypes["MediaReactionConnection"];
    /** A list of relationships for this media */
    relationships: ModelTypes["MediaRelationshipConnection"];
    /** The season this was released in */
    season?: ModelTypes["ReleaseSeasonEnum"] | undefined | null;
    /** Whether the media is Safe-for-Work */
    sfw: boolean;
    /** The URL-friendly identifier of this media */
    slug: string;
    /** The staff members who worked on this media */
    staff: ModelTypes["MediaStaffConnection"];
    /** The day that this media first released */
    startDate?: ModelTypes["Date"] | undefined | null;
    /** The current releasing status of this media */
    status: ModelTypes["ReleaseStatusEnum"];
    /** The stream links. */
    streamingLinks: ModelTypes["StreamingLinkConnection"];
    /** A secondary type for categorizing Anime. */
    subtype: ModelTypes["AnimeSubtypeEnum"];
    /** Description of when this media is expected to release */
    tba?: string | undefined | null;
    /** The titles for this media in various locales */
    titles: ModelTypes["TitlesList"];
    /** The total length (in seconds) of the entire series */
    totalLength?: number | undefined | null;
    /** Anime or Manga. */
    type: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The number of users with this in their library */
    userCount?: number | undefined | null;
    /** The rank of this media by popularity */
    userCountRank?: number | undefined | null;
    /** Video id for a trailer on YouTube */
    youtubeTrailerVideoId?: string | undefined | null;
  };
  AnimeAmountConsumed: {
    /** Total media completed atleast once. */
    completed: number;
    id: ModelTypes["ID"];
    /** Total amount of media. */
    media: number;
    /** The profile related to the user for this stat. */
    profile: ModelTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: ModelTypes["ISO8601Date"];
    /** Total time spent in minutes. */
    time: number;
    /** Total progress of library including reconsuming. */
    units: number;
  };
  AnimeCategoryBreakdown: {
    /** A Map of category_id -> count for all categories present on the library entries */
    categories: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** The profile related to the user for this stat. */
    profile: ModelTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: ModelTypes["ISO8601Date"];
    /** The total amount of library entries. */
    total: number;
  };
  /** The connection type for Anime. */
  AnimeConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["AnimeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Anime"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of AnimeCreate. */
  AnimeCreatePayload: {
    anime?: ModelTypes["Anime"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** Autogenerated return type of AnimeDelete. */
  AnimeDeletePayload: {
    anime?: ModelTypes["GenericDelete"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** An edge in a connection. */
  AnimeEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Anime"] | undefined | null;
  };
  AnimeMutations: {
    /** Create an Anime. */
    create?: ModelTypes["AnimeCreatePayload"] | undefined | null;
    /** Delete an Anime. */
    delete?: ModelTypes["AnimeDeletePayload"] | undefined | null;
    /** Update an Anime. */
    update?: ModelTypes["AnimeUpdatePayload"] | undefined | null;
  };
  /** Autogenerated return type of AnimeUpdate. */
  AnimeUpdatePayload: {
    anime?: ModelTypes["Anime"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** A blocked user entry of an Account. */
  Block: {
    /** User who got blocked. */
    blockedUser: ModelTypes["Profile"];
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** User who blocked. */
    user: ModelTypes["Profile"];
  };
  /** The connection type for Block. */
  BlockConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["BlockEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Block"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of BlockCreate. */
  BlockCreatePayload: {
    errors?: Array<ModelTypes["BlockCreateErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Block"] | undefined | null;
  };
  /** Autogenerated return type of BlockDelete. */
  BlockDeletePayload: {
    errors?: Array<ModelTypes["BlockDeleteErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Block"] | undefined | null;
  };
  /** An edge in a connection. */
  BlockEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Block"] | undefined | null;
  };
  BlockMutations: {
    /** Create a Block entry. */
    create?: ModelTypes["BlockCreatePayload"] | undefined | null;
    /** Delete a Block entry. */
    delete?: ModelTypes["BlockDeletePayload"] | undefined | null;
  };
  /** Information about a specific Category */
  Category: {
    /** The child categories. */
    children?: ModelTypes["CategoryConnection"] | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief summary or description of the catgory. */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** Whether the category is Not-Safe-for-Work. */
    isNsfw: boolean;
    /** The parent category. Each category can have one parent. */
    parent?: ModelTypes["Category"] | undefined | null;
    /** The top-level ancestor category */
    root?: ModelTypes["Category"] | undefined | null;
    /** The URL-friendly identifier of this Category. */
    slug: string;
    /** The name of the category. */
    title: ModelTypes["Map"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Category. */
  CategoryConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["CategoryEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Category"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  CategoryEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Category"] | undefined | null;
  };
  /** A single chapter of a manga */
  Chapter: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** Number of pages in chapter. */
    length?: number | undefined | null;
    /** The manga this chapter is in. */
    manga: ModelTypes["Manga"];
    /** The sequence number of this unit */
    number: number;
    /** When this chapter was released */
    releasedAt?: ModelTypes["ISO8601Date"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: ModelTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: ModelTypes["TitlesList"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The volume this chapter is in. */
    volume?: ModelTypes["Volume"] | undefined | null;
  };
  /** The connection type for Chapter. */
  ChapterConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["ChapterEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Chapter"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  ChapterEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Chapter"] | undefined | null;
  };
  /** Information about a Character in the Kitsu database */
  Character: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief summary or description of the character. */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** An image of the character */
    image?: ModelTypes["Image"] | undefined | null;
    /** Media this character appears in. */
    media?: ModelTypes["MediaCharacterConnection"] | undefined | null;
    /** The name for this character in various locales */
    names?: ModelTypes["TitlesList"] | undefined | null;
    /** The original media this character showed up in */
    primaryMedia?: ModelTypes["Media"] | undefined | null;
    /** The URL-friendly identifier of this character */
    slug: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** Information about a VA (Person) voicing a Character in a Media */
  CharacterVoice: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The company who hired this voice actor to play this role */
    licensor?: ModelTypes["Producer"] | undefined | null;
    /** The BCP47 locale tag for the voice acting role */
    locale: string;
    /** The MediaCharacter node */
    mediaCharacter: ModelTypes["MediaCharacter"];
    /** The person who voice acted this role */
    person: ModelTypes["Person"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for CharacterVoice. */
  CharacterVoiceConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["CharacterVoiceEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["CharacterVoice"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  CharacterVoiceEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["CharacterVoice"] | undefined | null;
  };
  /** A comment on a post */
  Comment: {
    /** The user who created this comment for the parent post. */
    author: ModelTypes["Profile"];
    /** Unmodified content. */
    content?: string | undefined | null;
    /** Html formatted content. */
    contentFormatted?: string | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** Users who liked this comment */
    likes: ModelTypes["ProfileConnection"];
    /** The parent comment if this comment was a reply to another. */
    parent?: ModelTypes["Comment"] | undefined | null;
    /** The post that this comment is attached to. */
    post: ModelTypes["Post"];
    /** Replies to this comment */
    replies: ModelTypes["CommentConnection"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Comment. */
  CommentConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["CommentEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Comment"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  CommentEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Comment"] | undefined | null;
  };
  /** An Episode of a Media */
  Episode: {
    /** The anime this episode is in */
    anime: ModelTypes["Anime"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** The length of the episode in seconds */
    length?: number | undefined | null;
    /** The sequence number of this unit */
    number: number;
    /** When this episode aired */
    releasedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: ModelTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: ModelTypes["TitlesList"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Episode. */
  EpisodeConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["EpisodeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Episode"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of EpisodeCreate. */
  EpisodeCreatePayload: {
    episode?: ModelTypes["Episode"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** Autogenerated return type of EpisodeDelete. */
  EpisodeDeletePayload: {
    episode?: ModelTypes["GenericDelete"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** An edge in a connection. */
  EpisodeEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Episode"] | undefined | null;
  };
  EpisodeMutations: {
    /** Create an Episode. */
    create?: ModelTypes["EpisodeCreatePayload"] | undefined | null;
    /** Delete an Episode. */
    delete?: ModelTypes["EpisodeDeletePayload"] | undefined | null;
    /** Update an Episode. */
    update?: ModelTypes["EpisodeUpdatePayload"] | undefined | null;
  };
  /** Autogenerated return type of EpisodeUpdate. */
  EpisodeUpdatePayload: {
    episode?: ModelTypes["Episode"] | undefined | null;
    errors?: Array<ModelTypes["Error"]> | undefined | null;
  };
  /** Favorite media, characters, and people for a user */
  Favorite: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The kitsu object that is mapped */
    item: ModelTypes["FavoriteItemUnion"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The user who favorited this item */
    user: ModelTypes["Profile"];
  };
  /** The connection type for Favorite. */
  FavoriteConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["FavoriteEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Favorite"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of FavoriteCreate. */
  FavoriteCreatePayload: {
    errors?: Array<ModelTypes["FavoriteCreateErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Favorite"] | undefined | null;
  };
  /** Autogenerated return type of FavoriteDelete. */
  FavoriteDeletePayload: {
    errors?: Array<ModelTypes["FavoriteDeleteErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Favorite"] | undefined | null;
  };
  /** An edge in a connection. */
  FavoriteEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Favorite"] | undefined | null;
  };
  FavoriteMutations: {
    /** Add a favorite entry */
    create?: ModelTypes["FavoriteCreatePayload"] | undefined | null;
    /** Delete a favorite entry */
    delete?: ModelTypes["FavoriteDeletePayload"] | undefined | null;
  };
  /** Related media grouped together */
  Franchise: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** All media related to a franchise */
    installments?: ModelTypes["InstallmentConnection"] | undefined | null;
    /** The name of this franchise in various languages */
    titles: ModelTypes["TitlesList"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Franchise. */
  FranchiseConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["FranchiseEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["Franchise"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  FranchiseEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Franchise"] | undefined | null;
  };
  GenericDelete: {
    id: ModelTypes["ID"];
  };
  GenericError: {
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
  };
  Image: {
    /** A blurhash-encoded version of this image */
    blurhash?: string | undefined | null;
    /** The original image */
    original: ModelTypes["ImageView"];
    /** The various generated views of this image */
    views: Array<ModelTypes["ImageView"]>;
  };
  ImageView: {
    /** The height of the image */
    height?: number | undefined | null;
    /** The name of this view of the image */
    name: string;
    /** The URL of this view of the image */
    url: string;
    /** The width of the image */
    width?: number | undefined | null;
  };
  /** Individual media that belongs to a franchise */
  Installment: {
    /** Order based chronologically */
    alternativeOrder?: number | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The franchise related to this installment */
    franchise: ModelTypes["Franchise"];
    id: ModelTypes["ID"];
    /** The media related to this installment */
    media: ModelTypes["Media"];
    /** Order based by date released */
    releaseOrder?: number | undefined | null;
    /** Further explains the media relationship corresponding to a franchise */
    tag?: ModelTypes["InstallmentTagEnum"] | undefined | null;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Installment. */
  InstallmentConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["InstallmentEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["Installment"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  InstallmentEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Installment"] | undefined | null;
  };
  /** The user library */
  Library: {
    /** All Library Entries */
    all: ModelTypes["LibraryEntryConnection"];
    /** Library Entries with the completed status */
    completed: ModelTypes["LibraryEntryConnection"];
    /** Library Entries with the current status */
    current: ModelTypes["LibraryEntryConnection"];
    /** Library Entries with the dropped status */
    dropped: ModelTypes["LibraryEntryConnection"];
    /** Library Entries with the on_hold status */
    onHold: ModelTypes["LibraryEntryConnection"];
    /** Library Entries with the planned status */
    planned: ModelTypes["LibraryEntryConnection"];
    /** Random anime or manga from this library */
    randomMedia?: ModelTypes["Media"] | undefined | null;
  };
  /** Information about a specific media entry for a user */
  LibraryEntry: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** History of user actions for this library entry. */
    events?: ModelTypes["LibraryEventConnection"] | undefined | null;
    /** When the user finished this media. */
    finishedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    id: ModelTypes["ID"];
    /** The last unit consumed */
    lastUnit?: ModelTypes["Unit"] | undefined | null;
    /** The media related to this library entry. */
    media: ModelTypes["Media"];
    /** The next unit to be consumed */
    nextUnit?: ModelTypes["Unit"] | undefined | null;
    /** Notes left by the profile related to this library entry. */
    notes?: string | undefined | null;
    /** If the media related to the library entry is Not-Safe-for-Work. */
    nsfw: boolean;
    /** If this library entry is publicly visibile from their profile, or hidden. */
    private: boolean;
    /** The number of episodes/chapters this user has watched/read */
    progress: number;
    /** When the user last watched an episode or read a chapter of this media. */
    progressedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    /** How much you enjoyed this media (lower meaning not liking). */
    rating?: number | undefined | null;
    /** The reaction based on the media of this library entry. */
    reaction?: ModelTypes["MediaReaction"] | undefined | null;
    /** Amount of times this media has been rewatched. */
    reconsumeCount: number;
    /** If the profile is currently rewatching this media. */
    reconsuming: boolean;
    /** When the user started this media. */
    startedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    status: ModelTypes["LibraryEntryStatusEnum"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The user who created this library entry. */
    user: ModelTypes["Profile"];
    /** Volumes that the profile owns (physically or digital). */
    volumesOwned: number;
  };
  /** The connection type for LibraryEntry. */
  LibraryEntryConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["LibraryEntryEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["LibraryEntry"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of LibraryEntryCreate. */
  LibraryEntryCreatePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryDelete. */
  LibraryEntryDeletePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["GenericDelete"] | undefined | null;
  };
  /** An edge in a connection. */
  LibraryEntryEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  LibraryEntryMutations: {
    /** Create a library entry */
    create?: ModelTypes["LibraryEntryCreatePayload"] | undefined | null;
    /** Delete a library entry */
    delete?: ModelTypes["LibraryEntryDeletePayload"] | undefined | null;
    /** Update a library entry */
    update?: ModelTypes["LibraryEntryUpdatePayload"] | undefined | null;
    /** Update library entry progress by id */
    updateProgressById?:
      | ModelTypes["LibraryEntryUpdateProgressByIdPayload"]
      | undefined
      | null;
    /** Update library entry progress by media */
    updateProgressByMedia?:
      | ModelTypes["LibraryEntryUpdateProgressByMediaPayload"]
      | undefined
      | null;
    /** Update library entry rating by id */
    updateRatingById?:
      | ModelTypes["LibraryEntryUpdateRatingByIdPayload"]
      | undefined
      | null;
    /** Update library entry rating by media */
    updateRatingByMedia?:
      | ModelTypes["LibraryEntryUpdateRatingByMediaPayload"]
      | undefined
      | null;
    /** Update library entry status by id */
    updateStatusById?:
      | ModelTypes["LibraryEntryUpdateStatusByIdPayload"]
      | undefined
      | null;
    /** Update library entry status by media */
    updateStatusByMedia?:
      | ModelTypes["LibraryEntryUpdateStatusByMediaPayload"]
      | undefined
      | null;
  };
  /** Autogenerated return type of LibraryEntryUpdate. */
  LibraryEntryUpdatePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateProgressById. */
  LibraryEntryUpdateProgressByIdPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateProgressByMedia. */
  LibraryEntryUpdateProgressByMediaPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateRatingById. */
  LibraryEntryUpdateRatingByIdPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateRatingByMedia. */
  LibraryEntryUpdateRatingByMediaPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateStatusById. */
  LibraryEntryUpdateStatusByIdPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** Autogenerated return type of LibraryEntryUpdateStatusByMedia. */
  LibraryEntryUpdateStatusByMediaPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    libraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
  };
  /** History of user actions for a library entry. */
  LibraryEvent: {
    /** The data that was changed for this library event. */
    changedData: ModelTypes["Map"];
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The type of library event. */
    kind: ModelTypes["LibraryEventKindEnum"];
    /** The library entry related to this library event. */
    libraryEntry: ModelTypes["LibraryEntry"];
    /** The media related to this library event. */
    media: ModelTypes["Media"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The user who created this library event */
    user: ModelTypes["Profile"];
  };
  /** The connection type for LibraryEvent. */
  LibraryEventConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["LibraryEventEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["LibraryEvent"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  LibraryEventEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["LibraryEvent"] | undefined | null;
  };
  Manga: {
    /** The recommended minimum age group for this media */
    ageRating?: ModelTypes["AgeRatingEnum"] | undefined | null;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: string | undefined | null;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: number | undefined | null;
    /** The rank of this media by rating */
    averageRatingRank?: number | undefined | null;
    /** A large banner image for this media */
    bannerImage?: ModelTypes["Image"] | undefined | null;
    /** A list of categories for this media */
    categories: ModelTypes["CategoryConnection"];
    /** Get a specific chapter of the manga. */
    chapter?: ModelTypes["Chapter"] | undefined | null;
    /** The number of chapters in this manga. */
    chapterCount?: number | undefined | null;
    /** The estimated number of chapters in this manga. */
    chapterCountGuess?: number | undefined | null;
    /** The chapters in the manga. */
    chapters?: ModelTypes["ChapterConnection"] | undefined | null;
    /** The characters who starred in this media */
    characters: ModelTypes["MediaCharacterConnection"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief (mostly spoiler free) summary or description of the media. */
    description: ModelTypes["Map"];
    /** the day that this media made its final release */
    endDate?: ModelTypes["Date"] | undefined | null;
    /** The number of users with this in their favorites */
    favoritesCount?: number | undefined | null;
    id: ModelTypes["ID"];
    /** A list of mappings for this media */
    mappings: ModelTypes["MappingConnection"];
    /** Your library entry related to this media. */
    myLibraryEntry?: ModelTypes["LibraryEntry"] | undefined | null;
    /** A list of your wiki submissions for this media */
    myWikiSubmissions: ModelTypes["WikiSubmissionConnection"];
    /** The time of the next release of this media */
    nextRelease?: ModelTypes["ISO8601DateTime"] | undefined | null;
    /** The countries in which the media was originally primarily produced */
    originCountries: Array<string>;
    /** The languages the media was originally produced in */
    originLanguages: Array<string>;
    /** The country in which the media was primarily produced */
    originalLocale?: string | undefined | null;
    /** The poster image of this media */
    posterImage?: ModelTypes["Image"] | undefined | null;
    /** All posts that tag this media. */
    posts: ModelTypes["PostConnection"];
    /** The companies which helped to produce this media */
    productions: ModelTypes["MediaProductionConnection"];
    /** A list of quotes from this media */
    quotes: ModelTypes["QuoteConnection"];
    /** A list of reactions for this media */
    reactions: ModelTypes["MediaReactionConnection"];
    /** A list of relationships for this media */
    relationships: ModelTypes["MediaRelationshipConnection"];
    /** Whether the media is Safe-for-Work */
    sfw: boolean;
    /** The URL-friendly identifier of this media */
    slug: string;
    /** The staff members who worked on this media */
    staff: ModelTypes["MediaStaffConnection"];
    /** The day that this media first released */
    startDate?: ModelTypes["Date"] | undefined | null;
    /** The current releasing status of this media */
    status: ModelTypes["ReleaseStatusEnum"];
    /** A secondary type for categorizing Manga. */
    subtype: ModelTypes["MangaSubtypeEnum"];
    /** Description of when this media is expected to release */
    tba?: string | undefined | null;
    /** The titles for this media in various locales */
    titles: ModelTypes["TitlesList"];
    /** Anime or Manga. */
    type: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The number of users with this in their library */
    userCount?: number | undefined | null;
    /** The rank of this media by popularity */
    userCountRank?: number | undefined | null;
    /** The number of volumes in this manga. */
    volumeCount?: number | undefined | null;
    /** The volumes in the manga. */
    volumes?: ModelTypes["VolumeConnection"] | undefined | null;
  };
  MangaAmountConsumed: {
    /** Total media completed atleast once. */
    completed: number;
    id: ModelTypes["ID"];
    /** Total amount of media. */
    media: number;
    /** The profile related to the user for this stat. */
    profile: ModelTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: ModelTypes["ISO8601Date"];
    /** Total progress of library including reconsuming. */
    units: number;
  };
  MangaCategoryBreakdown: {
    /** A Map of category_id -> count for all categories present on the library entries */
    categories: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** The profile related to the user for this stat. */
    profile: ModelTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: ModelTypes["ISO8601Date"];
    /** The total amount of library entries. */
    total: number;
  };
  /** The connection type for Manga. */
  MangaConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MangaEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Manga"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  MangaEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Manga"] | undefined | null;
  };
  /** Media Mappings from External Sites (MAL, Anilist, etc..) to Kitsu. */
  Mapping: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The ID of the media from the external site. */
    externalId: ModelTypes["ID"];
    /** The name of the site which kitsu media is being linked from. */
    externalSite: ModelTypes["MappingExternalSiteEnum"];
    id: ModelTypes["ID"];
    /** The kitsu object that is mapped. */
    item: ModelTypes["MappingItemUnion"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Mapping. */
  MappingConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MappingEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Mapping"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of MappingCreate. */
  MappingCreatePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    mapping?: ModelTypes["Mapping"] | undefined | null;
  };
  /** Autogenerated return type of MappingDelete. */
  MappingDeletePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    mapping?: ModelTypes["GenericDelete"] | undefined | null;
  };
  /** An edge in a connection. */
  MappingEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Mapping"] | undefined | null;
  };
  MappingMutations: {
    /** Create a Mapping */
    create?: ModelTypes["MappingCreatePayload"] | undefined | null;
    /** Delete a Mapping */
    delete?: ModelTypes["MappingDeletePayload"] | undefined | null;
    /** Update a Mapping */
    update?: ModelTypes["MappingUpdatePayload"] | undefined | null;
  };
  /** Autogenerated return type of MappingUpdate. */
  MappingUpdatePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    mapping?: ModelTypes["Mapping"] | undefined | null;
  };
  /** Information about a Character starring in a Media */
  MediaCharacter: {
    /** The character */
    character: ModelTypes["Character"];
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The media */
    media: ModelTypes["Media"];
    /** The role this character had in the media */
    role: ModelTypes["CharacterRoleEnum"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The voices of this character */
    voices?: ModelTypes["CharacterVoiceConnection"] | undefined | null;
  };
  /** The connection type for MediaCharacter. */
  MediaCharacterConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaCharacterEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["MediaCharacter"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  MediaCharacterEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["MediaCharacter"] | undefined | null;
  };
  /** The connection type for Media. */
  MediaConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Media"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
  };
  /** An edge in a connection. */
  MediaEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Media"] | undefined | null;
  };
  /** The role a company played in the creation or localization of a media */
  MediaProduction: {
    /** The production company */
    company: ModelTypes["Producer"];
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The media */
    media: ModelTypes["Media"];
    /** The role this company played */
    role: ModelTypes["MediaProductionRoleEnum"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for MediaProduction. */
  MediaProductionConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaProductionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["MediaProduction"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  MediaProductionEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["MediaProduction"] | undefined | null;
  };
  /** A simple review that is 140 characters long expressing how you felt about a media */
  MediaReaction: {
    /** The author who wrote this reaction. */
    author: ModelTypes["Profile"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Whether you have liked this media reaction */
    hasLiked: boolean;
    id: ModelTypes["ID"];
    /** The library entry related to this reaction. */
    libraryEntry: ModelTypes["LibraryEntry"];
    /** Users that have liked this reaction */
    likes: ModelTypes["ProfileConnection"];
    /** The media related to this reaction. */
    media: ModelTypes["Media"];
    /** When this media reaction was written based on media progress. */
    progress: number;
    /** The reaction text related to a media. */
    reaction: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for MediaReaction. */
  MediaReactionConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaReactionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["MediaReaction"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of MediaReactionCreate. */
  MediaReactionCreatePayload: {
    errors?:
      | Array<ModelTypes["MediaReactionCreateErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["MediaReaction"] | undefined | null;
  };
  /** Autogenerated return type of MediaReactionDelete. */
  MediaReactionDeletePayload: {
    errors?:
      | Array<ModelTypes["MediaReactionDeleteErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["MediaReaction"] | undefined | null;
  };
  /** An edge in a connection. */
  MediaReactionEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["MediaReaction"] | undefined | null;
  };
  /** Autogenerated return type of MediaReactionLike. */
  MediaReactionLikePayload: {
    errors?:
      | Array<ModelTypes["MediaReactionLikeErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["MediaReaction"] | undefined | null;
  };
  MediaReactionMutations: {
    /** Share a brief reaction to a media, tied to your library entry */
    create?: ModelTypes["MediaReactionCreatePayload"] | undefined | null;
    /** Delete a mutation */
    delete?: ModelTypes["MediaReactionDeletePayload"] | undefined | null;
    /** Like a media reaction */
    like?: ModelTypes["MediaReactionLikePayload"] | undefined | null;
    /** Remove your like from a media reaction */
    unlike?: ModelTypes["MediaReactionUnlikePayload"] | undefined | null;
  };
  /** Autogenerated return type of MediaReactionUnlike. */
  MediaReactionUnlikePayload: {
    errors?:
      | Array<ModelTypes["MediaReactionUnlikeErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["MediaReaction"] | undefined | null;
  };
  /** A relationship from one media to another */
  MediaRelationship: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The destination media */
    destination: ModelTypes["Media"];
    /** The kind of relationship */
    kind: ModelTypes["MediaRelationshipKindEnum"];
    /** The source media */
    source: ModelTypes["Media"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for MediaRelationship. */
  MediaRelationshipConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaRelationshipEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["MediaRelationship"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  MediaRelationshipEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["MediaRelationship"] | undefined | null;
  };
  /** Information about a person working on an anime */
  MediaStaff: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The media */
    media: ModelTypes["Media"];
    /** The person */
    person: ModelTypes["Person"];
    /** The role this person had in the creation of this media */
    role: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for MediaStaff. */
  MediaStaffConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["MediaStaffEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["MediaStaff"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  MediaStaffEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["MediaStaff"] | undefined | null;
  };
  Mutation: {
    account: ModelTypes["AccountMutations"];
    /** Create a new Kitsu account */
    accountCreate?: ModelTypes["AccountCreatePayload"] | undefined | null;
    anime: ModelTypes["AnimeMutations"];
    block: ModelTypes["BlockMutations"];
    episode: ModelTypes["EpisodeMutations"];
    favorite: ModelTypes["FavoriteMutations"];
    libraryEntry: ModelTypes["LibraryEntryMutations"];
    mapping: ModelTypes["MappingMutations"];
    mediaReaction: ModelTypes["MediaReactionMutations"];
    post: ModelTypes["PostMutations"];
    pro: ModelTypes["ProMutations"];
    profile: ModelTypes["ProfileMutations"];
    profileLink: ModelTypes["ProfileLinkMutations"];
    wikiSubmission: ModelTypes["WikiSubmissionMutations"];
  };
  /** The mutation requires an authenticated logged-in user session, and none was provided or the session has expired. The recommended action varies depending on your application and whether you provided the bearer token in the `Authorization` header or not. If you did, you should probably attempt to refresh the token, and if that fails, prompt the user to log in again. If you did not provide a bearer token, you should just prompt the user to log in. */
  NotAuthenticatedError: {
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
  };
  /** The mutation requires higher permissions than the current user or token has. This is a bit vague, but it generally means you're attempting to modify an object you don't own, or perform an administrator action without being an administrator. It could also mean your token does not have the required scopes to perform the action. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotAuthorizedError: {
    action?: string | undefined | null;
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
  };
  /** An object required for your mutation was unable to be located. Usually this means the object you're attempting to modify or delete does not exist. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotFoundError: {
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
  };
  /** Information about pagination in a connection. */
  PageInfo: {
    /** When paginating forwards, the cursor to continue. */
    endCursor?: string | undefined | null;
    /** When paginating forwards, are there more items? */
    hasNextPage: boolean;
    /** When paginating backwards, are there more items? */
    hasPreviousPage: boolean;
    /** When paginating backwards, the cursor to continue. */
    startCursor?: string | undefined | null;
  };
  /** A Voice Actor, Director, Animator, or other person who works in the creation and localization of media */
  Person: {
    /** The day when this person was born */
    birthday?: ModelTypes["Date"] | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief biography or description of the person. */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** An image of the person */
    image?: ModelTypes["Image"] | undefined | null;
    /** Information about the person working on specific media */
    mediaStaff?: ModelTypes["MediaStaffConnection"] | undefined | null;
    /** The primary name of this person. */
    name: string;
    /** The name of this person in various languages */
    names: ModelTypes["TitlesList"];
    /** The URL-friendly identifier of this person. */
    slug: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The voice-acting roles this person has had. */
    voices?: ModelTypes["CharacterVoiceConnection"] | undefined | null;
  };
  /** A post that is visible to your followers and globally in the news-feed. */
  Post: {
    /** The user who created this post. */
    author: ModelTypes["Profile"];
    /** All comments on this post */
    comments: ModelTypes["CommentConnection"];
    /** Unmodified content. */
    content?: string | undefined | null;
    /** Html formatted content. */
    contentFormatted?: string | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Users that are watching this post */
    follows: ModelTypes["ProfileConnection"];
    id: ModelTypes["ID"];
    /** If a post is Not-Safe-for-Work. */
    isNsfw: boolean;
    /** If this post spoils the tagged media. */
    isSpoiler: boolean;
    /** Users that have liked this post */
    likes: ModelTypes["ProfileConnection"];
    /** When this post was locked. */
    lockedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    /** The user who locked this post. */
    lockedBy?: ModelTypes["Profile"] | undefined | null;
    /** The reason why this post was locked. */
    lockedReason?: ModelTypes["LockedReasonEnum"] | undefined | null;
    /** The media tagged in this post. */
    media?: ModelTypes["Media"] | undefined | null;
    /** The profile of the target user of the post. */
    targetProfile: ModelTypes["Profile"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Post. */
  PostConnection: {
    /** A list of edges. */
    edges?: Array<ModelTypes["PostEdge"] | undefined | null> | undefined | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Post"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of PostCreate. */
  PostCreatePayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    post?: ModelTypes["Post"] | undefined | null;
  };
  /** An edge in a connection. */
  PostEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Post"] | undefined | null;
  };
  /** Autogenerated return type of PostLock. */
  PostLockPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    post?: ModelTypes["Post"] | undefined | null;
  };
  PostMutations: {
    /** Create a Post. */
    create?: ModelTypes["PostCreatePayload"] | undefined | null;
    /** Lock a Post. */
    lock?: ModelTypes["PostLockPayload"] | undefined | null;
    /** Unlock a Post. */
    unlock?: ModelTypes["PostUnlockPayload"] | undefined | null;
  };
  /** Autogenerated return type of PostUnlock. */
  PostUnlockPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    post?: ModelTypes["Post"] | undefined | null;
  };
  ProMutations: {
    /** Set the user's discord tag */
    setDiscord?: ModelTypes["ProSetDiscordPayload"] | undefined | null;
    /** Set the user's Hall-of-Fame message */
    setMessage?: ModelTypes["ProSetMessagePayload"] | undefined | null;
    /** End the user's pro subscription */
    unsubscribe?: ModelTypes["ProUnsubscribePayload"] | undefined | null;
  };
  /** Autogenerated return type of ProSetDiscord. */
  ProSetDiscordPayload: {
    discord: string;
  };
  /** Autogenerated return type of ProSetMessage. */
  ProSetMessagePayload: {
    message: string;
  };
  /** A subscription to Kitsu PRO */
  ProSubscription: {
    /** The account which is subscribed to Pro benefits */
    account: ModelTypes["Account"];
    /** The billing service used for this subscription */
    billingService: ModelTypes["RecurringBillingServiceEnum"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The tier of Pro the account is subscribed to */
    tier: ModelTypes["ProTierEnum"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** Autogenerated return type of ProUnsubscribe. */
  ProUnsubscribePayload: {
    expiresAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
  };
  /** A company involved in the creation or localization of media */
  Producer: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The name of this production company */
    name: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** A user profile on Kitsu */
  Profile: {
    /** A short biographical blurb about this profile */
    about?: string | undefined | null;
    /** An avatar image to easily identify this profile */
    avatarImage?: ModelTypes["Image"] | undefined | null;
    /** A banner to display at the top of the profile */
    bannerImage?: ModelTypes["Image"] | undefined | null;
    /** When the user was born */
    birthday?: ModelTypes["ISO8601Date"] | undefined | null;
    /** All comments to any post this user has made. */
    comments: ModelTypes["CommentConnection"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Favorite media, characters, and people */
    favorites: ModelTypes["FavoriteConnection"];
    /** People that follow the user */
    followers: ModelTypes["ProfileConnection"];
    /** People the user is following */
    following: ModelTypes["ProfileConnection"];
    /** What the user identifies as */
    gender?: string | undefined | null;
    id: ModelTypes["ID"];
    /** The user library of their media */
    library: ModelTypes["Library"];
    /** A list of library events for this user */
    libraryEvents: ModelTypes["LibraryEventConnection"];
    /** The user's general location */
    location?: string | undefined | null;
    /** Media reactions written by this user. */
    mediaReactions: ModelTypes["MediaReactionConnection"];
    /** A non-unique publicly visible name for the profile. Minimum of 3 characters and any valid Unicode character */
    name: string;
    /** Post pinned to the user profile */
    pinnedPost?: ModelTypes["Post"] | undefined | null;
    /** All posts this profile has made. */
    posts: ModelTypes["PostConnection"];
    /** The message this user has submitted to the Hall of Fame */
    proMessage?: string | undefined | null;
    /** The PRO level the user currently has */
    proTier?: ModelTypes["ProTierEnum"] | undefined | null;
    /** Reviews created by this user */
    reviews?: ModelTypes["ReviewConnection"] | undefined | null;
    /** Links to the user on other (social media) sites. */
    siteLinks?: ModelTypes["SiteLinkConnection"] | undefined | null;
    /** The URL-friendly identifier for this profile */
    slug?: string | undefined | null;
    /** The different stats we calculate for this user. */
    stats: ModelTypes["ProfileStats"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** A fully qualified URL to the profile */
    url?: string | undefined | null;
    /** The character this profile has declared as their waifu or husbando */
    waifu?: ModelTypes["Character"] | undefined | null;
    /** The properly-gendered term for the user's waifu. This should normally only be 'Waifu' or 'Husbando' but some people are jerks, including the person who wrote this... */
    waifuOrHusbando?: string | undefined | null;
    /** Wiki submissions created by this user */
    wikiSubmissions: ModelTypes["WikiSubmissionConnection"];
  };
  /** The connection type for Profile. */
  ProfileConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["ProfileEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Profile"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  ProfileEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Profile"] | undefined | null;
  };
  /** Autogenerated return type of ProfileLinkCreate. */
  ProfileLinkCreatePayload: {
    errors?:
      | Array<ModelTypes["ProfileLinkCreateErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["SiteLink"] | undefined | null;
  };
  /** Autogenerated return type of ProfileLinkDelete. */
  ProfileLinkDeletePayload: {
    errors?:
      | Array<ModelTypes["ProfileLinkDeleteErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["SiteLink"] | undefined | null;
  };
  ProfileLinkMutations: {
    /** Add a profile link. */
    create?: ModelTypes["ProfileLinkCreatePayload"] | undefined | null;
    /** Delete a profile link. */
    delete?: ModelTypes["ProfileLinkDeletePayload"] | undefined | null;
    /** Update a profile link. */
    update?: ModelTypes["ProfileLinkUpdatePayload"] | undefined | null;
  };
  /** An external site that can be linked to a user. */
  ProfileLinkSite: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** Name of the external profile website. */
    name: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** Regex pattern used to validate the profile link. */
    validateFind: string;
    /** Pattern to be replaced after validation. */
    validateReplace: string;
  };
  /** Autogenerated return type of ProfileLinkUpdate. */
  ProfileLinkUpdatePayload: {
    errors?:
      | Array<ModelTypes["ProfileLinkUpdateErrorsUnion"]>
      | undefined
      | null;
    result?: ModelTypes["SiteLink"] | undefined | null;
  };
  ProfileMutations: {
    /** Update the profile of the current user. */
    update?: ModelTypes["ProfileUpdatePayload"] | undefined | null;
  };
  /** The different types of user stats that we calculate. */
  ProfileStats: {
    /** The total amount of anime you have watched over your whole life. */
    animeAmountConsumed: ModelTypes["AnimeAmountConsumed"];
    /** The breakdown of the different categories related to the anime you have completed */
    animeCategoryBreakdown: ModelTypes["AnimeCategoryBreakdown"];
    /** The total amount of manga you ahve read over your whole life. */
    mangaAmountConsumed: ModelTypes["MangaAmountConsumed"];
    /** The breakdown of the different categories related to the manga you have completed */
    mangaCategoryBreakdown: ModelTypes["MangaCategoryBreakdown"];
  };
  /** Autogenerated return type of ProfileUpdate. */
  ProfileUpdatePayload: {
    errors?: Array<ModelTypes["ProfileUpdateErrorsUnion"]> | undefined | null;
    result?: ModelTypes["Profile"] | undefined | null;
  };
  Query: {
    /** All Anime in the Kitsu database */
    anime: ModelTypes["AnimeConnection"];
    /** All Anime with specific Status */
    animeByStatus?: ModelTypes["AnimeConnection"] | undefined | null;
    /** All blocked user of the current account. */
    blocks?: ModelTypes["BlockConnection"] | undefined | null;
    /** All Categories in the Kitsu Database */
    categories?: ModelTypes["CategoryConnection"] | undefined | null;
    /** Kitsu account details. You must supply an Authorization token in header. */
    currentAccount?: ModelTypes["Account"] | undefined | null;
    /** Your Kitsu profile. You must supply an Authorization token in header. */
    currentProfile?: ModelTypes["Profile"] | undefined | null;
    /** Find a single Anime by ID */
    findAnimeById?: ModelTypes["Anime"] | undefined | null;
    /** Find a single Anime by Slug */
    findAnimeBySlug?: ModelTypes["Anime"] | undefined | null;
    /** Find a single Category by ID */
    findCategoryById?: ModelTypes["Category"] | undefined | null;
    /** Find a single Category by Slug */
    findCategoryBySlug?: ModelTypes["Category"] | undefined | null;
    /** Find a single Manga Chapter by ID */
    findChapterById?: ModelTypes["Chapter"] | undefined | null;
    /** Find a single Character by ID */
    findCharacterById?: ModelTypes["Character"] | undefined | null;
    /** Find a single Character by Slug */
    findCharacterBySlug?: ModelTypes["Character"] | undefined | null;
    /** Find a single Library Entry by ID */
    findLibraryEntryById?: ModelTypes["LibraryEntry"] | undefined | null;
    /** Find a single Library Event by ID */
    findLibraryEventById?: ModelTypes["LibraryEvent"] | undefined | null;
    /** Find a single Manga by ID */
    findMangaById?: ModelTypes["Manga"] | undefined | null;
    /** Find a single Manga by Slug */
    findMangaBySlug?: ModelTypes["Manga"] | undefined | null;
    /** Find a single Media by ID and Type */
    findMediaByIdAndType?: ModelTypes["Media"] | undefined | null;
    /** Find a single Person by ID */
    findPersonById?: ModelTypes["Person"] | undefined | null;
    /** Find a single Person by Slug */
    findPersonBySlug?: ModelTypes["Person"] | undefined | null;
    /** Find a single Post by ID */
    findPostById?: ModelTypes["Post"] | undefined | null;
    /** Find a single User by ID */
    findProfileById?: ModelTypes["Profile"] | undefined | null;
    /** Find a single User by Slug */
    findProfileBySlug?: ModelTypes["Profile"] | undefined | null;
    /** Find a single Report by ID */
    findReportById?: ModelTypes["Report"] | undefined | null;
    /** Find a single Wiki Submission by ID */
    findWikiSubmissionById?: ModelTypes["WikiSubmission"] | undefined | null;
    /** All Franchise in the Kitsu database */
    franchises?: ModelTypes["FranchiseConnection"] | undefined | null;
    /** List trending media on Kitsu */
    globalTrending: ModelTypes["MediaConnection"];
    /** List of Library Entries by MediaType and MediaId */
    libraryEntriesByMedia?:
      | ModelTypes["LibraryEntryConnection"]
      | undefined
      | null;
    /** List of Library Entries by MediaType */
    libraryEntriesByMediaType?:
      | ModelTypes["LibraryEntryConnection"]
      | undefined
      | null;
    /** List trending media within your network */
    localTrending: ModelTypes["MediaConnection"];
    /** Find a specific Mapping Item by External ID and External Site. */
    lookupMapping?: ModelTypes["MappingItemUnion"] | undefined | null;
    /** All Manga in the Kitsu database */
    manga: ModelTypes["MangaConnection"];
    /** All Manga with specific Status */
    mangaByStatus?: ModelTypes["MangaConnection"] | undefined | null;
    /** Patrons sorted by a Proprietary Magic Algorithm */
    patrons: ModelTypes["ProfileConnection"];
    /** Random anime or manga */
    randomMedia: ModelTypes["Media"];
    /** All Reports in the Kitsu database */
    reports?: ModelTypes["ReportConnection"] | undefined | null;
    /** Select all Reports that match with a supplied status. */
    reportsByStatus?: ModelTypes["ReportConnection"] | undefined | null;
    /** Search for Anime by title using Algolia. The most relevant results will be at the top. */
    searchAnimeByTitle: ModelTypes["AnimeConnection"];
    /** Search for Manga by title using Algolia. The most relevant results will be at the top. */
    searchMangaByTitle: ModelTypes["MangaConnection"];
    /** Search for any media (Anime, Manga) by title using Algolia. If no media_type is supplied, it will search for both. The most relevant results will be at the top. */
    searchMediaByTitle: ModelTypes["MediaConnection"];
    /** Search for User by username using Algolia. The most relevant results will be at the top. */
    searchProfileByUsername?:
      | ModelTypes["ProfileConnection"]
      | undefined
      | null;
    /** Get your current session info */
    session: ModelTypes["Session"];
    /** Select all Wiki Submissions that match with a supplied status. */
    wikiSubmissionsByStatuses?:
      | ModelTypes["WikiSubmissionConnection"]
      | undefined
      | null;
  };
  /** A quote from a media */
  Quote: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The lines of the quote */
    lines: ModelTypes["QuoteLineConnection"];
    /** The media this quote is excerpted from */
    media: ModelTypes["Media"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Quote. */
  QuoteConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["QuoteEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Quote"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  QuoteEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Quote"] | undefined | null;
  };
  /** A line in a quote */
  QuoteLine: {
    /** The character who said this line */
    character: ModelTypes["Character"];
    /** The line that was spoken */
    content: string;
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The quote this line is in */
    quote: ModelTypes["Quote"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for QuoteLine. */
  QuoteLineConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["QuoteLineEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["QuoteLine"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  QuoteLineEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["QuoteLine"] | undefined | null;
  };
  /** A report made by a user */
  Report: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Additional information related to why the report was made */
    explanation?: string | undefined | null;
    id: ModelTypes["ID"];
    /** The moderator who responded to this report */
    moderator?: ModelTypes["Profile"] | undefined | null;
    /** The entity that the report is related to */
    naughty?: ModelTypes["ReportItemUnion"] | undefined | null;
    /** The reason for why the report was made */
    reason: ModelTypes["ReportReasonEnum"];
    /** The user who made this report */
    reporter: ModelTypes["Profile"];
    /** The resolution status for this report */
    status: ModelTypes["ReportStatusEnum"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Report. */
  ReportConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["ReportEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Report"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  ReportEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Report"] | undefined | null;
  };
  /** A media review made by a user */
  Review: {
    /** The author who wrote this review. */
    author: ModelTypes["Profile"];
    /** The review data */
    content: string;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The review data formatted */
    formattedContent: string;
    id: ModelTypes["ID"];
    /** Does this review contain spoilers from the media */
    isSpoiler: boolean;
    /** The library entry related to this review. */
    libraryEntry: ModelTypes["LibraryEntry"];
    /** Users who liked this review */
    likes: ModelTypes["ProfileConnection"];
    /** The media related to this review. */
    media: ModelTypes["Media"];
    /** When this review was written based on media progress. */
    progress: number;
    /** The user rating for this media */
    rating: number;
    /** Potentially migrated over from hummingbird. */
    source: string;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Review. */
  ReviewConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["ReviewEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Review"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  ReviewEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Review"] | undefined | null;
  };
  /** Information about a user session */
  Session: {
    /** The account associated with this session */
    account?: ModelTypes["Account"] | undefined | null;
    /** Single sign-on token for Nolt */
    noltToken: string;
    /** The profile associated with this session */
    profile?: ModelTypes["Profile"] | undefined | null;
  };
  /** A link to a user's profile on an external site. */
  SiteLink: {
    /** The user profile the site is linked to. */
    author: ModelTypes["Profile"];
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The actual linked website. */
    site: ModelTypes["ProfileLinkSite"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** A fully qualified URL of the user profile on an external site. */
    url: string;
  };
  /** The connection type for SiteLink. */
  SiteLinkConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["SiteLinkEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["SiteLink"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  SiteLinkEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["SiteLink"] | undefined | null;
  };
  /** The streaming company. */
  Streamer: {
    createdAt: ModelTypes["ISO8601DateTime"];
    id: ModelTypes["ID"];
    /** The name of the site that is streaming this media. */
    siteName: string;
    /** Additional media this site is streaming. */
    streamingLinks: ModelTypes["StreamingLinkConnection"];
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** Videos of the media being streamed. */
    videos: ModelTypes["VideoConnection"];
  };
  /** The stream link. */
  StreamingLink: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Spoken language is replaced by language of choice. */
    dubs: Array<string>;
    id: ModelTypes["ID"];
    /** The media being streamed */
    media: ModelTypes["Media"];
    /** Which regions this video is available in. */
    regions: Array<string>;
    /** The site that is streaming this media. */
    streamer: ModelTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs: Array<string>;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** Fully qualified URL for the streaming link. */
    url: string;
  };
  /** The connection type for StreamingLink. */
  StreamingLinkConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["StreamingLinkEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["StreamingLink"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  StreamingLinkEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["StreamingLink"] | undefined | null;
  };
  TitlesList: {
    /** A list of additional, alternative, abbreviated, or unofficial titles */
    alternatives?: Array<string> | undefined | null;
    /** The official or de facto international title */
    canonical: string;
    /** The locale code that identifies which title is used as the canonical title */
    canonicalLocale?: string | undefined | null;
    /** The list of localized titles keyed by locale */
    localized: ModelTypes["Map"];
    /** The original title of the media in the original language */
    original?: string | undefined | null;
    /** The locale code that identifies which title is used as the original title */
    originalLocale?: string | undefined | null;
    /** The title that best matches the user's preferred settings */
    preferred: string;
    /** The original title, romanized into latin script */
    romanized?: string | undefined | null;
    /** The locale code that identifies which title is used as the romanized title */
    romanizedLocale?: string | undefined | null;
    /** The title translated into the user's locale */
    translated?: string | undefined | null;
    /** The locale code that identifies which title is used as the translated title */
    translatedLocale?: string | undefined | null;
  };
  /** The mutation failed validation. This is usually because the input provided was invalid in some way, such as a missing required field or an invalid value for a field. There may be multiple of this error, one for each failed validation, and the `path` will generally refer to a location in the input parameters, that you can map back to the input fields in your form. The recommended action is to display validation errors to the user, and allow them to correct the input and resubmit. */
  ValidationError: {
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
  };
  /** The media video. */
  Video: {
    createdAt: ModelTypes["ISO8601DateTime"];
    /** Spoken language is replaced by language of choice. */
    dubs: Array<string>;
    /** The episode of this video */
    episode: ModelTypes["Episode"];
    id: ModelTypes["ID"];
    /** Which regions this video is available in. */
    regions: Array<string>;
    /** The site that is streaming this media. */
    streamer: ModelTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs: Array<string>;
    updatedAt: ModelTypes["ISO8601DateTime"];
    /** The url of the video. */
    url: string;
  };
  /** The connection type for Video. */
  VideoConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["VideoEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Video"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  VideoEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Video"] | undefined | null;
  };
  /** A manga volume which can contain multiple chapters. */
  Volume: {
    /** The chapters in this volume. */
    chapters?: ModelTypes["ChapterConnection"] | undefined | null;
    /** The number of chapters in this volume. */
    chaptersCount?: number | undefined | null;
    createdAt: ModelTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: ModelTypes["Map"];
    id: ModelTypes["ID"];
    /** The isbn number of this volume. */
    isbn: Array<string>;
    /** The manga this volume is in. */
    manga: ModelTypes["Manga"];
    /** The sequence number of this unit */
    number: number;
    /** The date when this chapter was released. */
    published?: ModelTypes["ISO8601Date"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: ModelTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: ModelTypes["TitlesList"];
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for Volume. */
  VolumeConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["VolumeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<ModelTypes["Volume"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** An edge in a connection. */
  VolumeEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["Volume"] | undefined | null;
  };
  /** A Wiki Submission is used to either create or edit existing data in our database. This will allow a simple and convient way for users to submit issues/corrections without all the work being left to the mods. */
  WikiSubmission: {
    /** The user who created this draft */
    author: ModelTypes["Profile"];
    createdAt: ModelTypes["ISO8601DateTime"];
    /** The full object that holds all the details for any modifications/additions/deletions made to the entity you are editing. This will be validated using JSON Schema. */
    data?: ModelTypes["JSON"] | undefined | null;
    id: ModelTypes["ID"];
    /** Any additional information that may need to be provided related to the Wiki Submission */
    notes?: string | undefined | null;
    /** The status of the Wiki Submission */
    status: ModelTypes["WikiSubmissionStatusEnum"];
    /** The title given to the Wiki Submission. This will default to the title of what is being edited. */
    title?: string | undefined | null;
    updatedAt: ModelTypes["ISO8601DateTime"];
  };
  /** The connection type for WikiSubmission. */
  WikiSubmissionConnection: {
    /** A list of edges. */
    edges?:
      | Array<ModelTypes["WikiSubmissionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<ModelTypes["WikiSubmission"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: ModelTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
  };
  /** Autogenerated return type of WikiSubmissionCreateDraft. */
  WikiSubmissionCreateDraftPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    wikiSubmission?: ModelTypes["WikiSubmission"] | undefined | null;
  };
  /** An edge in a connection. */
  WikiSubmissionEdge: {
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: ModelTypes["WikiSubmission"] | undefined | null;
  };
  WikiSubmissionMutations: {
    /** Create a wiki submission draft */
    createDraft?:
      | ModelTypes["WikiSubmissionCreateDraftPayload"]
      | undefined
      | null;
    /** Submit a wiki submission draft */
    submitDraft?:
      | ModelTypes["WikiSubmissionSubmitDraftPayload"]
      | undefined
      | null;
    /** Update a wiki submission draft */
    updateDraft?:
      | ModelTypes["WikiSubmissionUpdateDraftPayload"]
      | undefined
      | null;
  };
  /** Autogenerated return type of WikiSubmissionSubmitDraft. */
  WikiSubmissionSubmitDraftPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    wikiSubmission?: ModelTypes["WikiSubmission"] | undefined | null;
  };
  /** Autogenerated return type of WikiSubmissionUpdateDraft. */
  WikiSubmissionUpdateDraftPayload: {
    errors?: Array<ModelTypes["Error"]> | undefined | null;
    wikiSubmission?: ModelTypes["WikiSubmission"] | undefined | null;
  };
  AgeRatingEnum: AgeRatingEnum;
  AnimeSubtypeEnum: AnimeSubtypeEnum;
  ChapterSortEnum: ChapterSortEnum;
  CharacterRoleEnum: CharacterRoleEnum;
  CharacterVoiceSortEnum: CharacterVoiceSortEnum;
  CommentLikeSortEnum: CommentLikeSortEnum;
  CommentSortEnum: CommentSortEnum;
  EpisodeSortEnum: EpisodeSortEnum;
  ExternalIdentityProviderEnum: ExternalIdentityProviderEnum;
  FavoriteEnum: FavoriteEnum;
  FollowSortEnum: FollowSortEnum;
  InstallmentSortEnum: InstallmentSortEnum;
  InstallmentTagEnum: InstallmentTagEnum;
  LibraryEntrySortEnum: LibraryEntrySortEnum;
  LibraryEntryStatusEnum: LibraryEntryStatusEnum;
  LibraryEventKindEnum: LibraryEventKindEnum;
  LibraryEventSortEnum: LibraryEventSortEnum;
  LockedReasonEnum: LockedReasonEnum;
  MangaSubtypeEnum: MangaSubtypeEnum;
  MappingExternalSiteEnum: MappingExternalSiteEnum;
  MappingItemEnum: MappingItemEnum;
  MediaCategorySortEnum: MediaCategorySortEnum;
  MediaCharacterSortEnum: MediaCharacterSortEnum;
  MediaProductionRoleEnum: MediaProductionRoleEnum;
  MediaReactionSortEnum: MediaReactionSortEnum;
  MediaReactionVoteSortEnum: MediaReactionVoteSortEnum;
  MediaRelationshipKindEnum: MediaRelationshipKindEnum;
  MediaTypeEnum: MediaTypeEnum;
  PostLikeSortEnum: PostLikeSortEnum;
  PostSortEnum: PostSortEnum;
  ProTierEnum: ProTierEnum;
  ProfileLinksSitesEnum: ProfileLinksSitesEnum;
  RatingSystemEnum: RatingSystemEnum;
  RecurringBillingServiceEnum: RecurringBillingServiceEnum;
  ReleaseSeasonEnum: ReleaseSeasonEnum;
  ReleaseStatusEnum: ReleaseStatusEnum;
  ReportReasonEnum: ReportReasonEnum;
  ReportStatusEnum: ReportStatusEnum;
  SfwFilterPreferenceEnum: SfwFilterPreferenceEnum;
  SitePermissionEnum: SitePermissionEnum;
  SiteThemeEnum: SiteThemeEnum;
  SortDirection: SortDirection;
  TitleLanguagePreferenceEnum: TitleLanguagePreferenceEnum;
  VolumeSortEnum: VolumeSortEnum;
  WaifuOrHusbandoEnum: WaifuOrHusbandoEnum;
  WikiSubmissionSortEnum: WikiSubmissionSortEnum;
  WikiSubmissionStatusEnum: WikiSubmissionStatusEnum;
  /** A date, expressed as an ISO8601 string */
  Date: any;
  /** An ISO 8601-encoded date */
  ISO8601Date: any;
  /** An ISO 8601-encoded datetime */
  ISO8601DateTime: any;
  /** Represents untyped JSON */
  JSON: any;
  /** A loose key-value map in GraphQL */
  Map: any;
  Upload: any;
  AccountChangePasswordInput: {
    /** The new password to set */
    newPassword: string;
    /** The current, existing password for the account */
    oldPassword: string;
  };
  AccountCreateInput: {
    /** The email address to reset the password for */
    email: string;
    /** An external identity to associate with the account on creation */
    externalIdentity?:
      | ModelTypes["AccountExternalIdentityInput"]
      | undefined
      | null;
    /** The name of the user */
    name: string;
    /** The password for the user */
    password: string;
  };
  AccountExternalIdentityInput: {
    id: string;
    provider: ModelTypes["ExternalIdentityProviderEnum"];
  };
  AccountUpdateInput: {
    /** The country of the user */
    country?: string | undefined | null;
    /** How media titles will get visualized */
    preferredTitleLanguage?:
      | ModelTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null;
    /** The preferred rating system */
    ratingSystem?: ModelTypes["RatingSystemEnum"] | undefined | null;
    /** The SFW Filter setting */
    sfwFilterPreference?:
      | ModelTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null;
    /** The theme displayed on Kitsu */
    siteTheme?: ModelTypes["SiteThemeEnum"] | undefined | null;
    /** The time zone of the user */
    timeZone?: string | undefined | null;
  };
  AnimeCreateInput: {
    ageRating?: ModelTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: ModelTypes["Upload"] | undefined | null;
    description: ModelTypes["Map"];
    endDate?: ModelTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    posterImage?: ModelTypes["Upload"] | undefined | null;
    startDate?: ModelTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles: ModelTypes["TitlesListInput"];
    youtubeTrailerVideoId?: string | undefined | null;
  };
  AnimeUpdateInput: {
    ageRating?: ModelTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: ModelTypes["Upload"] | undefined | null;
    description?: ModelTypes["Map"] | undefined | null;
    endDate?: ModelTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    id: ModelTypes["ID"];
    posterImage?: ModelTypes["Upload"] | undefined | null;
    startDate?: ModelTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles?: ModelTypes["TitlesListInput"] | undefined | null;
    youtubeTrailerVideoId?: string | undefined | null;
  };
  BlockCreateInput: {
    /** The id of the user to block. */
    blockedId: ModelTypes["ID"];
  };
  BlockDeleteInput: {
    /** The id of the block. */
    blockId: ModelTypes["ID"];
  };
  ChapterSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["ChapterSortEnum"];
  };
  CharacterVoiceSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["CharacterVoiceSortEnum"];
  };
  CommentLikeSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["CommentLikeSortEnum"];
  };
  CommentSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["CommentSortEnum"];
  };
  EpisodeCreateInput: {
    description?: ModelTypes["Map"] | undefined | null;
    length?: number | undefined | null;
    mediaId: ModelTypes["ID"];
    mediaType: ModelTypes["MediaTypeEnum"];
    number: number;
    releasedAt?: ModelTypes["Date"] | undefined | null;
    thumbnailImage?: ModelTypes["Upload"] | undefined | null;
    titles: ModelTypes["TitlesListInput"];
  };
  EpisodeSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["EpisodeSortEnum"];
  };
  EpisodeUpdateInput: {
    description?: ModelTypes["Map"] | undefined | null;
    id: ModelTypes["ID"];
    length?: number | undefined | null;
    number?: number | undefined | null;
    releasedAt?: ModelTypes["Date"] | undefined | null;
    thumbnailImage?: ModelTypes["Upload"] | undefined | null;
    titles?: ModelTypes["TitlesListInput"] | undefined | null;
  };
  FavoriteCreateInput: {
    /** The id of the entry */
    id: ModelTypes["ID"];
    /** The type of the entry. */
    type: ModelTypes["FavoriteEnum"];
  };
  FavoriteDeleteInput: {
    /** The id of the favorite entry. */
    favoriteId: ModelTypes["ID"];
  };
  FollowSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["FollowSortEnum"];
  };
  GenericDeleteInput: {
    id: ModelTypes["ID"];
  };
  InstallmentSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["InstallmentSortEnum"];
  };
  LibraryEntryCreateInput: {
    finishedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    mediaId: ModelTypes["ID"];
    mediaType: ModelTypes["MediaTypeEnum"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    status: ModelTypes["LibraryEntryStatusEnum"];
    volumesOwned?: number | undefined | null;
  };
  LibraryEntrySortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["LibraryEntrySortEnum"];
  };
  LibraryEntryUpdateInput: {
    finishedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    id: ModelTypes["ID"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: ModelTypes["ISO8601DateTime"] | undefined | null;
    status?: ModelTypes["LibraryEntryStatusEnum"] | undefined | null;
    volumesOwned?: number | undefined | null;
  };
  LibraryEntryUpdateProgressByIdInput: {
    id: ModelTypes["ID"];
    progress: number;
  };
  LibraryEntryUpdateProgressByMediaInput: {
    mediaId: ModelTypes["ID"];
    mediaType: ModelTypes["MediaTypeEnum"];
    progress: number;
  };
  LibraryEntryUpdateRatingByIdInput: {
    id: ModelTypes["ID"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateRatingByMediaInput: {
    mediaId: ModelTypes["ID"];
    mediaType: ModelTypes["MediaTypeEnum"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateStatusByIdInput: {
    id: ModelTypes["ID"];
    status: ModelTypes["LibraryEntryStatusEnum"];
  };
  LibraryEntryUpdateStatusByMediaInput: {
    mediaId: ModelTypes["ID"];
    mediaType: ModelTypes["MediaTypeEnum"];
    status: ModelTypes["LibraryEntryStatusEnum"];
  };
  LibraryEventSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["LibraryEventSortEnum"];
  };
  MappingCreateInput: {
    externalId: ModelTypes["ID"];
    externalSite: ModelTypes["MappingExternalSiteEnum"];
    itemId: ModelTypes["ID"];
    itemType: ModelTypes["MappingItemEnum"];
  };
  MappingUpdateInput: {
    externalId?: ModelTypes["ID"] | undefined | null;
    externalSite?: ModelTypes["MappingExternalSiteEnum"] | undefined | null;
    id: ModelTypes["ID"];
    itemId?: ModelTypes["ID"] | undefined | null;
    itemType?: ModelTypes["MappingItemEnum"] | undefined | null;
  };
  MediaCategorySortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["MediaCategorySortEnum"];
  };
  MediaCharacterSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["MediaCharacterSortEnum"];
  };
  MediaReactionCreateInput: {
    /** The ID of the entry in your library to react to */
    libraryEntryId: ModelTypes["ID"];
    /** The text of the reaction to the media */
    reaction: string;
  };
  MediaReactionDeleteInput: {
    /** The reaction to delete */
    mediaReactionId: ModelTypes["ID"];
  };
  MediaReactionLikeInput: {
    /** The reaction to like */
    mediaReactionId: ModelTypes["ID"];
  };
  MediaReactionSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["MediaReactionSortEnum"];
  };
  MediaReactionUnlikeInput: {
    /** The reaction to remove your like from */
    mediaReactionId: ModelTypes["ID"];
  };
  MediaReactionVoteSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["MediaReactionVoteSortEnum"];
  };
  PostCreateInput: {
    content: string;
    isNsfw?: boolean | undefined | null;
    isSpoiler?: boolean | undefined | null;
    mediaId?: ModelTypes["ID"] | undefined | null;
    mediaType?: ModelTypes["MediaTypeEnum"] | undefined | null;
    spoiledUnitId?: ModelTypes["ID"] | undefined | null;
    spoiledUnitType?: string | undefined | null;
    targetUserId?: ModelTypes["ID"] | undefined | null;
  };
  PostLikeSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["PostLikeSortEnum"];
  };
  PostLockInput: {
    id: ModelTypes["ID"];
    lockedReason: ModelTypes["LockedReasonEnum"];
  };
  PostSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["PostSortEnum"];
  };
  PostUnlockInput: {
    id: ModelTypes["ID"];
  };
  ProfileLinkCreateInput: {
    /** The website. */
    profileLinkSite: ModelTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileLinkDeleteInput: {
    /** The profile link to delete */
    profileLink: ModelTypes["ProfileLinksSitesEnum"];
  };
  ProfileLinkUpdateInput: {
    /** The website. */
    profileLinkSite: ModelTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileUpdateInput: {
    /** About section of the profile. */
    about?: string | undefined | null;
    /** The birthday of the user. */
    birthday?: ModelTypes["Date"] | undefined | null;
    /** The preferred gender of the user. */
    gender?: string | undefined | null;
    /** Your ID or the one of another user. */
    id?: ModelTypes["ID"] | undefined | null;
    /** The display name of the user */
    name?: string | undefined | null;
    /** The slug (@username) of the user */
    slug?: string | undefined | null;
    /** The id of the waifu or husbando. */
    waifuId?: ModelTypes["ID"] | undefined | null;
    /** The user preference of their partner. */
    waifuOrHusbando?: ModelTypes["WaifuOrHusbandoEnum"] | undefined | null;
  };
  TitlesListInput: {
    alternatives?: Array<string> | undefined | null;
    canonical?: string | undefined | null;
    canonicalLocale?: string | undefined | null;
    localized?: ModelTypes["Map"] | undefined | null;
  };
  VolumeSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["VolumeSortEnum"];
  };
  WikiSubmissionCreateDraftInput: {
    data: ModelTypes["JSON"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionSortOption: {
    direction: ModelTypes["SortDirection"];
    on: ModelTypes["WikiSubmissionSortEnum"];
  };
  WikiSubmissionSubmitDraftInput: {
    data: ModelTypes["JSON"];
    id: ModelTypes["ID"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionUpdateDraftInput: {
    data: ModelTypes["JSON"];
    id: ModelTypes["ID"];
    notes?: string | undefined | null;
  };
  ID: any;
};

export type GraphQLTypes = {
  // This file was generated. Do not edit manually.;
  /** Generic Amount Consumed based on Media */
  AmountConsumed: {
    __typename: "AnimeAmountConsumed" | "MangaAmountConsumed";
    /** Total media completed atleast once. */
    completed: number;
    id: GraphQLTypes["ID"];
    /** Total amount of media. */
    media: number;
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** Total progress of library including reconsuming. */
    units: number;
    "...on AnimeAmountConsumed": "__union" &
      GraphQLTypes["AnimeAmountConsumed"];
    "...on MangaAmountConsumed": "__union" &
      GraphQLTypes["MangaAmountConsumed"];
  };
  /** Generic Category Breakdown based on Media */
  CategoryBreakdown: {
    __typename: "AnimeCategoryBreakdown" | "MangaCategoryBreakdown";
    /** A Map of category_id -> count for all categories present on the library entries */
    categories: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** The total amount of library entries. */
    total: number;
    "...on AnimeCategoryBreakdown": "__union" &
      GraphQLTypes["AnimeCategoryBreakdown"];
    "...on MangaCategoryBreakdown": "__union" &
      GraphQLTypes["MangaCategoryBreakdown"];
  };
  /** An episodic media in the Kitsu database */
  Episodic: {
    __typename: "Anime";
    /** The number of episodes in this series */
    episodeCount?: number | undefined | null;
    /** The general length (in seconds) of each episode */
    episodeLength?: number | undefined | null;
    /** Episodes for this media */
    episodes: GraphQLTypes["EpisodeConnection"];
    /** The total length (in seconds) of the entire series */
    totalLength?: number | undefined | null;
    "...on Anime": "__union" & GraphQLTypes["Anime"];
  };
  /** Generic error fields used by all errors. */
  Error: {
    __typename:
      | "GenericError"
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError"
      | "ValidationError";
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on GenericError": "__union" & GraphQLTypes["GenericError"];
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  /** A media in the Kitsu database */
  Media: {
    __typename: "Anime" | "Manga";
    /** The recommended minimum age group for this media */
    ageRating?: GraphQLTypes["AgeRatingEnum"] | undefined | null;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: string | undefined | null;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: number | undefined | null;
    /** The rank of this media by rating */
    averageRatingRank?: number | undefined | null;
    /** A large banner image for this media */
    bannerImage?: GraphQLTypes["Image"] | undefined | null;
    /** A list of categories for this media */
    categories: GraphQLTypes["CategoryConnection"];
    /** The characters who starred in this media */
    characters: GraphQLTypes["MediaCharacterConnection"];
    /** A brief (mostly spoiler free) summary or description of the media. */
    description: GraphQLTypes["Map"];
    /** the day that this media made its final release */
    endDate?: GraphQLTypes["Date"] | undefined | null;
    /** The number of users with this in their favorites */
    favoritesCount?: number | undefined | null;
    id: GraphQLTypes["ID"];
    /** A list of mappings for this media */
    mappings: GraphQLTypes["MappingConnection"];
    /** Your library entry related to this media. */
    myLibraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    /** A list of your wiki submissions for this media */
    myWikiSubmissions: GraphQLTypes["WikiSubmissionConnection"];
    /** The time of the next release of this media */
    nextRelease?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** The countries in which the media was originally primarily produced */
    originCountries: Array<string>;
    /** The languages the media was originally produced in */
    originLanguages: Array<string>;
    /** The country in which the media was primarily produced */
    originalLocale?: string | undefined | null;
    /** The poster image of this media */
    posterImage?: GraphQLTypes["Image"] | undefined | null;
    /** All posts that tag this media. */
    posts: GraphQLTypes["PostConnection"];
    /** The companies which helped to produce this media */
    productions: GraphQLTypes["MediaProductionConnection"];
    /** A list of quotes from this media */
    quotes: GraphQLTypes["QuoteConnection"];
    /** A list of reactions for this media */
    reactions: GraphQLTypes["MediaReactionConnection"];
    /** A list of relationships for this media */
    relationships: GraphQLTypes["MediaRelationshipConnection"];
    /** Whether the media is Safe-for-Work */
    sfw: boolean;
    /** The URL-friendly identifier of this media */
    slug: string;
    /** The staff members who worked on this media */
    staff: GraphQLTypes["MediaStaffConnection"];
    /** The day that this media first released */
    startDate?: GraphQLTypes["Date"] | undefined | null;
    /** The current releasing status of this media */
    status: GraphQLTypes["ReleaseStatusEnum"];
    /** Description of when this media is expected to release */
    tba?: string | undefined | null;
    /** The titles for this media in various locales */
    titles: GraphQLTypes["TitlesList"];
    /** Anime or Manga. */
    type: string;
    /** The number of users with this in their library */
    userCount?: number | undefined | null;
    /** The rank of this media by popularity */
    userCountRank?: number | undefined | null;
    "...on Anime": "__union" & GraphQLTypes["Anime"];
    "...on Manga": "__union" & GraphQLTypes["Manga"];
  };
  /** Media that is streamable. */
  Streamable: {
    __typename: "StreamingLink" | "Video";
    /** Spoken language is replaced by language of choice. */
    dubs: Array<string>;
    /** Which regions this video is available in. */
    regions: Array<string>;
    /** The site that is streaming this media. */
    streamer: GraphQLTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs: Array<string>;
    "...on StreamingLink": "__union" & GraphQLTypes["StreamingLink"];
    "...on Video": "__union" & GraphQLTypes["Video"];
  };
  /** Media units such as episodes or chapters */
  Unit: {
    __typename: "Chapter" | "Episode" | "Volume";
    /** A brief summary or description of the unit */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The sequence number of this unit */
    number: number;
    /** A thumbnail image for the unit */
    thumbnail?: GraphQLTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: GraphQLTypes["TitlesList"];
    "...on Chapter": "__union" & GraphQLTypes["Chapter"];
    "...on Episode": "__union" & GraphQLTypes["Episode"];
    "...on Volume": "__union" & GraphQLTypes["Volume"];
  };
  WithTimestamps: {
    __typename:
      | "Account"
      | "Anime"
      | "Block"
      | "Category"
      | "Chapter"
      | "Character"
      | "CharacterVoice"
      | "Comment"
      | "Episode"
      | "Favorite"
      | "Franchise"
      | "Installment"
      | "LibraryEntry"
      | "LibraryEvent"
      | "Manga"
      | "Mapping"
      | "MediaCharacter"
      | "MediaProduction"
      | "MediaReaction"
      | "MediaRelationship"
      | "MediaStaff"
      | "Person"
      | "Post"
      | "ProSubscription"
      | "Producer"
      | "Profile"
      | "ProfileLinkSite"
      | "Quote"
      | "QuoteLine"
      | "Report"
      | "Review"
      | "SiteLink"
      | "Streamer"
      | "StreamingLink"
      | "Video"
      | "Volume"
      | "WikiSubmission";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Account": "__union" & GraphQLTypes["Account"];
    "...on Anime": "__union" & GraphQLTypes["Anime"];
    "...on Block": "__union" & GraphQLTypes["Block"];
    "...on Category": "__union" & GraphQLTypes["Category"];
    "...on Chapter": "__union" & GraphQLTypes["Chapter"];
    "...on Character": "__union" & GraphQLTypes["Character"];
    "...on CharacterVoice": "__union" & GraphQLTypes["CharacterVoice"];
    "...on Comment": "__union" & GraphQLTypes["Comment"];
    "...on Episode": "__union" & GraphQLTypes["Episode"];
    "...on Favorite": "__union" & GraphQLTypes["Favorite"];
    "...on Franchise": "__union" & GraphQLTypes["Franchise"];
    "...on Installment": "__union" & GraphQLTypes["Installment"];
    "...on LibraryEntry": "__union" & GraphQLTypes["LibraryEntry"];
    "...on LibraryEvent": "__union" & GraphQLTypes["LibraryEvent"];
    "...on Manga": "__union" & GraphQLTypes["Manga"];
    "...on Mapping": "__union" & GraphQLTypes["Mapping"];
    "...on MediaCharacter": "__union" & GraphQLTypes["MediaCharacter"];
    "...on MediaProduction": "__union" & GraphQLTypes["MediaProduction"];
    "...on MediaReaction": "__union" & GraphQLTypes["MediaReaction"];
    "...on MediaRelationship": "__union" & GraphQLTypes["MediaRelationship"];
    "...on MediaStaff": "__union" & GraphQLTypes["MediaStaff"];
    "...on Person": "__union" & GraphQLTypes["Person"];
    "...on Post": "__union" & GraphQLTypes["Post"];
    "...on ProSubscription": "__union" & GraphQLTypes["ProSubscription"];
    "...on Producer": "__union" & GraphQLTypes["Producer"];
    "...on Profile": "__union" & GraphQLTypes["Profile"];
    "...on ProfileLinkSite": "__union" & GraphQLTypes["ProfileLinkSite"];
    "...on Quote": "__union" & GraphQLTypes["Quote"];
    "...on QuoteLine": "__union" & GraphQLTypes["QuoteLine"];
    "...on Report": "__union" & GraphQLTypes["Report"];
    "...on Review": "__union" & GraphQLTypes["Review"];
    "...on SiteLink": "__union" & GraphQLTypes["SiteLink"];
    "...on Streamer": "__union" & GraphQLTypes["Streamer"];
    "...on StreamingLink": "__union" & GraphQLTypes["StreamingLink"];
    "...on Video": "__union" & GraphQLTypes["Video"];
    "...on Volume": "__union" & GraphQLTypes["Volume"];
    "...on WikiSubmission": "__union" & GraphQLTypes["WikiSubmission"];
  };
  AccountChangePasswordErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "ValidationError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  AccountCreateErrorsUnion: {
    __typename: "ValidationError";
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  AccountUpdateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  BlockCreateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  BlockDeleteErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  FavoriteCreateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  FavoriteDeleteErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  /** Objects which are Favoritable */
  FavoriteItemUnion: {
    __typename: "Anime" | "Character" | "Manga" | "Person";
    "...on Anime": "__union" & GraphQLTypes["Anime"];
    "...on Character": "__union" & GraphQLTypes["Character"];
    "...on Manga": "__union" & GraphQLTypes["Manga"];
    "...on Person": "__union" & GraphQLTypes["Person"];
  };
  /** Objects which are Mappable */
  MappingItemUnion: {
    __typename:
      | "Anime"
      | "Category"
      | "Character"
      | "Episode"
      | "Manga"
      | "Person"
      | "Producer";
    "...on Anime": "__union" & GraphQLTypes["Anime"];
    "...on Category": "__union" & GraphQLTypes["Category"];
    "...on Character": "__union" & GraphQLTypes["Character"];
    "...on Episode": "__union" & GraphQLTypes["Episode"];
    "...on Manga": "__union" & GraphQLTypes["Manga"];
    "...on Person": "__union" & GraphQLTypes["Person"];
    "...on Producer": "__union" & GraphQLTypes["Producer"];
  };
  MediaReactionCreateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError"
      | "ValidationError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  MediaReactionDeleteErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  MediaReactionLikeErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  MediaReactionUnlikeErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  ProfileLinkCreateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError"
      | "ValidationError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  ProfileLinkDeleteErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  ProfileLinkUpdateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError"
      | "ValidationError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
    "...on ValidationError": "__union" & GraphQLTypes["ValidationError"];
  };
  ProfileUpdateErrorsUnion: {
    __typename:
      | "NotAuthenticatedError"
      | "NotAuthorizedError"
      | "NotFoundError";
    "...on NotAuthenticatedError": "__union" &
      GraphQLTypes["NotAuthenticatedError"];
    "...on NotAuthorizedError": "__union" & GraphQLTypes["NotAuthorizedError"];
    "...on NotFoundError": "__union" & GraphQLTypes["NotFoundError"];
  };
  /** Objects which are Reportable */
  ReportItemUnion: {
    __typename: "Comment" | "MediaReaction" | "Post" | "Review";
    "...on Comment": "__union" & GraphQLTypes["Comment"];
    "...on MediaReaction": "__union" & GraphQLTypes["MediaReaction"];
    "...on Post": "__union" & GraphQLTypes["Post"];
    "...on Review": "__union" & GraphQLTypes["Review"];
  };
  /** A user account on Kitsu */
  Account: {
    __typename: "Account";
    /** The country this user resides in */
    country?: string | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The email addresses associated with this account */
    email: Array<string>;
    /** The features this user has access to */
    enabledFeatures: Array<string>;
    /** Facebook account linked to the account */
    facebookId?: string | undefined | null;
    id: GraphQLTypes["ID"];
    /** Primary language for the account */
    language?: string | undefined | null;
    /** Longest period an account has had a PRO subscription for in seconds */
    maxProStreak?: number | undefined | null;
    /** The PRO subscription for this account */
    proSubscription?: GraphQLTypes["ProSubscription"] | undefined | null;
    /** The profile for this account */
    profile: GraphQLTypes["Profile"];
    /** Media rating system used for the account */
    ratingSystem: GraphQLTypes["RatingSystemEnum"];
    /** Whether Not Safe For Work content is accessible */
    sfwFilter?: boolean | undefined | null;
    /** The level of the SFW Filter */
    sfwFilterPreference?:
      | GraphQLTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null;
    /** The site-wide permissions this user has access to */
    sitePermissions: Array<GraphQLTypes["SitePermissionEnum"]>;
    /** Time zone of the account */
    timeZone?: string | undefined | null;
    /** Preferred language for media titles */
    titleLanguagePreference?:
      | GraphQLTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null;
    /** Twitter account linked to the account */
    twitterId?: string | undefined | null;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Account": Omit<GraphQLTypes["Account"], "...on Account">;
  };
  /** Autogenerated return type of AccountChangePassword. */
  AccountChangePasswordPayload: {
    __typename: "AccountChangePasswordPayload";
    errors?:
      | Array<GraphQLTypes["AccountChangePasswordErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["Account"] | undefined | null;
    "...on AccountChangePasswordPayload": Omit<
      GraphQLTypes["AccountChangePasswordPayload"],
      "...on AccountChangePasswordPayload"
    >;
  };
  /** Autogenerated return type of AccountCreate. */
  AccountCreatePayload: {
    __typename: "AccountCreatePayload";
    errors?: Array<GraphQLTypes["AccountCreateErrorsUnion"]> | undefined | null;
    result?: GraphQLTypes["Account"] | undefined | null;
    "...on AccountCreatePayload": Omit<
      GraphQLTypes["AccountCreatePayload"],
      "...on AccountCreatePayload"
    >;
  };
  AccountMutations: {
    __typename: "AccountMutations";
    /** Change your Kitsu account password */
    changePassword?:
      | GraphQLTypes["AccountChangePasswordPayload"]
      | undefined
      | null;
    /** Send a password reset email */
    sendPasswordReset?:
      | GraphQLTypes["AccountSendPasswordResetPayload"]
      | undefined
      | null;
    /** Update the account of the current user. */
    update?: GraphQLTypes["AccountUpdatePayload"] | undefined | null;
    "...on AccountMutations": Omit<
      GraphQLTypes["AccountMutations"],
      "...on AccountMutations"
    >;
  };
  /** Autogenerated return type of AccountSendPasswordReset. */
  AccountSendPasswordResetPayload: {
    __typename: "AccountSendPasswordResetPayload";
    email: string;
    "...on AccountSendPasswordResetPayload": Omit<
      GraphQLTypes["AccountSendPasswordResetPayload"],
      "...on AccountSendPasswordResetPayload"
    >;
  };
  /** Autogenerated return type of AccountUpdate. */
  AccountUpdatePayload: {
    __typename: "AccountUpdatePayload";
    errors?: Array<GraphQLTypes["AccountUpdateErrorsUnion"]> | undefined | null;
    result?: GraphQLTypes["Account"] | undefined | null;
    "...on AccountUpdatePayload": Omit<
      GraphQLTypes["AccountUpdatePayload"],
      "...on AccountUpdatePayload"
    >;
  };
  Anime: {
    __typename: "Anime";
    /** The recommended minimum age group for this media */
    ageRating?: GraphQLTypes["AgeRatingEnum"] | undefined | null;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: string | undefined | null;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: number | undefined | null;
    /** The rank of this media by rating */
    averageRatingRank?: number | undefined | null;
    /** A large banner image for this media */
    bannerImage?: GraphQLTypes["Image"] | undefined | null;
    /** A list of categories for this media */
    categories: GraphQLTypes["CategoryConnection"];
    /** The characters who starred in this media */
    characters: GraphQLTypes["MediaCharacterConnection"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief (mostly spoiler free) summary or description of the media. */
    description: GraphQLTypes["Map"];
    /** the day that this media made its final release */
    endDate?: GraphQLTypes["Date"] | undefined | null;
    /** The number of episodes in this series */
    episodeCount?: number | undefined | null;
    /** The general length (in seconds) of each episode */
    episodeLength?: number | undefined | null;
    /** Episodes for this media */
    episodes: GraphQLTypes["EpisodeConnection"];
    /** The number of users with this in their favorites */
    favoritesCount?: number | undefined | null;
    id: GraphQLTypes["ID"];
    /** A list of mappings for this media */
    mappings: GraphQLTypes["MappingConnection"];
    /** Your library entry related to this media. */
    myLibraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    /** A list of your wiki submissions for this media */
    myWikiSubmissions: GraphQLTypes["WikiSubmissionConnection"];
    /** The time of the next release of this media */
    nextRelease?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** The countries in which the media was originally primarily produced */
    originCountries: Array<string>;
    /** The languages the media was originally produced in */
    originLanguages: Array<string>;
    /** The country in which the media was primarily produced */
    originalLocale?: string | undefined | null;
    /** The poster image of this media */
    posterImage?: GraphQLTypes["Image"] | undefined | null;
    /** All posts that tag this media. */
    posts: GraphQLTypes["PostConnection"];
    /** The companies which helped to produce this media */
    productions: GraphQLTypes["MediaProductionConnection"];
    /** A list of quotes from this media */
    quotes: GraphQLTypes["QuoteConnection"];
    /** A list of reactions for this media */
    reactions: GraphQLTypes["MediaReactionConnection"];
    /** A list of relationships for this media */
    relationships: GraphQLTypes["MediaRelationshipConnection"];
    /** The season this was released in */
    season?: GraphQLTypes["ReleaseSeasonEnum"] | undefined | null;
    /** Whether the media is Safe-for-Work */
    sfw: boolean;
    /** The URL-friendly identifier of this media */
    slug: string;
    /** The staff members who worked on this media */
    staff: GraphQLTypes["MediaStaffConnection"];
    /** The day that this media first released */
    startDate?: GraphQLTypes["Date"] | undefined | null;
    /** The current releasing status of this media */
    status: GraphQLTypes["ReleaseStatusEnum"];
    /** The stream links. */
    streamingLinks: GraphQLTypes["StreamingLinkConnection"];
    /** A secondary type for categorizing Anime. */
    subtype: GraphQLTypes["AnimeSubtypeEnum"];
    /** Description of when this media is expected to release */
    tba?: string | undefined | null;
    /** The titles for this media in various locales */
    titles: GraphQLTypes["TitlesList"];
    /** The total length (in seconds) of the entire series */
    totalLength?: number | undefined | null;
    /** Anime or Manga. */
    type: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The number of users with this in their library */
    userCount?: number | undefined | null;
    /** The rank of this media by popularity */
    userCountRank?: number | undefined | null;
    /** Video id for a trailer on YouTube */
    youtubeTrailerVideoId?: string | undefined | null;
    "...on Anime": Omit<GraphQLTypes["Anime"], "...on Anime">;
  };
  AnimeAmountConsumed: {
    __typename: "AnimeAmountConsumed";
    /** Total media completed atleast once. */
    completed: number;
    id: GraphQLTypes["ID"];
    /** Total amount of media. */
    media: number;
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** Total time spent in minutes. */
    time: number;
    /** Total progress of library including reconsuming. */
    units: number;
    "...on AnimeAmountConsumed": Omit<
      GraphQLTypes["AnimeAmountConsumed"],
      "...on AnimeAmountConsumed"
    >;
  };
  AnimeCategoryBreakdown: {
    __typename: "AnimeCategoryBreakdown";
    /** A Map of category_id -> count for all categories present on the library entries */
    categories: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** The total amount of library entries. */
    total: number;
    "...on AnimeCategoryBreakdown": Omit<
      GraphQLTypes["AnimeCategoryBreakdown"],
      "...on AnimeCategoryBreakdown"
    >;
  };
  /** The connection type for Anime. */
  AnimeConnection: {
    __typename: "AnimeConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["AnimeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Anime"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on AnimeConnection": Omit<
      GraphQLTypes["AnimeConnection"],
      "...on AnimeConnection"
    >;
  };
  /** Autogenerated return type of AnimeCreate. */
  AnimeCreatePayload: {
    __typename: "AnimeCreatePayload";
    anime?: GraphQLTypes["Anime"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on AnimeCreatePayload": Omit<
      GraphQLTypes["AnimeCreatePayload"],
      "...on AnimeCreatePayload"
    >;
  };
  /** Autogenerated return type of AnimeDelete. */
  AnimeDeletePayload: {
    __typename: "AnimeDeletePayload";
    anime?: GraphQLTypes["GenericDelete"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on AnimeDeletePayload": Omit<
      GraphQLTypes["AnimeDeletePayload"],
      "...on AnimeDeletePayload"
    >;
  };
  /** An edge in a connection. */
  AnimeEdge: {
    __typename: "AnimeEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Anime"] | undefined | null;
    "...on AnimeEdge": Omit<GraphQLTypes["AnimeEdge"], "...on AnimeEdge">;
  };
  AnimeMutations: {
    __typename: "AnimeMutations";
    /** Create an Anime. */
    create?: GraphQLTypes["AnimeCreatePayload"] | undefined | null;
    /** Delete an Anime. */
    delete?: GraphQLTypes["AnimeDeletePayload"] | undefined | null;
    /** Update an Anime. */
    update?: GraphQLTypes["AnimeUpdatePayload"] | undefined | null;
    "...on AnimeMutations": Omit<
      GraphQLTypes["AnimeMutations"],
      "...on AnimeMutations"
    >;
  };
  /** Autogenerated return type of AnimeUpdate. */
  AnimeUpdatePayload: {
    __typename: "AnimeUpdatePayload";
    anime?: GraphQLTypes["Anime"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on AnimeUpdatePayload": Omit<
      GraphQLTypes["AnimeUpdatePayload"],
      "...on AnimeUpdatePayload"
    >;
  };
  /** A blocked user entry of an Account. */
  Block: {
    __typename: "Block";
    /** User who got blocked. */
    blockedUser: GraphQLTypes["Profile"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** User who blocked. */
    user: GraphQLTypes["Profile"];
    "...on Block": Omit<GraphQLTypes["Block"], "...on Block">;
  };
  /** The connection type for Block. */
  BlockConnection: {
    __typename: "BlockConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["BlockEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Block"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on BlockConnection": Omit<
      GraphQLTypes["BlockConnection"],
      "...on BlockConnection"
    >;
  };
  /** Autogenerated return type of BlockCreate. */
  BlockCreatePayload: {
    __typename: "BlockCreatePayload";
    errors?: Array<GraphQLTypes["BlockCreateErrorsUnion"]> | undefined | null;
    result?: GraphQLTypes["Block"] | undefined | null;
    "...on BlockCreatePayload": Omit<
      GraphQLTypes["BlockCreatePayload"],
      "...on BlockCreatePayload"
    >;
  };
  /** Autogenerated return type of BlockDelete. */
  BlockDeletePayload: {
    __typename: "BlockDeletePayload";
    errors?: Array<GraphQLTypes["BlockDeleteErrorsUnion"]> | undefined | null;
    result?: GraphQLTypes["Block"] | undefined | null;
    "...on BlockDeletePayload": Omit<
      GraphQLTypes["BlockDeletePayload"],
      "...on BlockDeletePayload"
    >;
  };
  /** An edge in a connection. */
  BlockEdge: {
    __typename: "BlockEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Block"] | undefined | null;
    "...on BlockEdge": Omit<GraphQLTypes["BlockEdge"], "...on BlockEdge">;
  };
  BlockMutations: {
    __typename: "BlockMutations";
    /** Create a Block entry. */
    create?: GraphQLTypes["BlockCreatePayload"] | undefined | null;
    /** Delete a Block entry. */
    delete?: GraphQLTypes["BlockDeletePayload"] | undefined | null;
    "...on BlockMutations": Omit<
      GraphQLTypes["BlockMutations"],
      "...on BlockMutations"
    >;
  };
  /** Information about a specific Category */
  Category: {
    __typename: "Category";
    /** The child categories. */
    children?: GraphQLTypes["CategoryConnection"] | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief summary or description of the catgory. */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** Whether the category is Not-Safe-for-Work. */
    isNsfw: boolean;
    /** The parent category. Each category can have one parent. */
    parent?: GraphQLTypes["Category"] | undefined | null;
    /** The top-level ancestor category */
    root?: GraphQLTypes["Category"] | undefined | null;
    /** The URL-friendly identifier of this Category. */
    slug: string;
    /** The name of the category. */
    title: GraphQLTypes["Map"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Category": Omit<GraphQLTypes["Category"], "...on Category">;
  };
  /** The connection type for Category. */
  CategoryConnection: {
    __typename: "CategoryConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["CategoryEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Category"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on CategoryConnection": Omit<
      GraphQLTypes["CategoryConnection"],
      "...on CategoryConnection"
    >;
  };
  /** An edge in a connection. */
  CategoryEdge: {
    __typename: "CategoryEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Category"] | undefined | null;
    "...on CategoryEdge": Omit<
      GraphQLTypes["CategoryEdge"],
      "...on CategoryEdge"
    >;
  };
  /** A single chapter of a manga */
  Chapter: {
    __typename: "Chapter";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** Number of pages in chapter. */
    length?: number | undefined | null;
    /** The manga this chapter is in. */
    manga: GraphQLTypes["Manga"];
    /** The sequence number of this unit */
    number: number;
    /** When this chapter was released */
    releasedAt?: GraphQLTypes["ISO8601Date"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: GraphQLTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: GraphQLTypes["TitlesList"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The volume this chapter is in. */
    volume?: GraphQLTypes["Volume"] | undefined | null;
    "...on Chapter": Omit<GraphQLTypes["Chapter"], "...on Chapter">;
  };
  /** The connection type for Chapter. */
  ChapterConnection: {
    __typename: "ChapterConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["ChapterEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Chapter"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on ChapterConnection": Omit<
      GraphQLTypes["ChapterConnection"],
      "...on ChapterConnection"
    >;
  };
  /** An edge in a connection. */
  ChapterEdge: {
    __typename: "ChapterEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Chapter"] | undefined | null;
    "...on ChapterEdge": Omit<GraphQLTypes["ChapterEdge"], "...on ChapterEdge">;
  };
  /** Information about a Character in the Kitsu database */
  Character: {
    __typename: "Character";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief summary or description of the character. */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** An image of the character */
    image?: GraphQLTypes["Image"] | undefined | null;
    /** Media this character appears in. */
    media?: GraphQLTypes["MediaCharacterConnection"] | undefined | null;
    /** The name for this character in various locales */
    names?: GraphQLTypes["TitlesList"] | undefined | null;
    /** The original media this character showed up in */
    primaryMedia?: GraphQLTypes["Media"] | undefined | null;
    /** The URL-friendly identifier of this character */
    slug: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Character": Omit<GraphQLTypes["Character"], "...on Character">;
  };
  /** Information about a VA (Person) voicing a Character in a Media */
  CharacterVoice: {
    __typename: "CharacterVoice";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The company who hired this voice actor to play this role */
    licensor?: GraphQLTypes["Producer"] | undefined | null;
    /** The BCP47 locale tag for the voice acting role */
    locale: string;
    /** The MediaCharacter node */
    mediaCharacter: GraphQLTypes["MediaCharacter"];
    /** The person who voice acted this role */
    person: GraphQLTypes["Person"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on CharacterVoice": Omit<
      GraphQLTypes["CharacterVoice"],
      "...on CharacterVoice"
    >;
  };
  /** The connection type for CharacterVoice. */
  CharacterVoiceConnection: {
    __typename: "CharacterVoiceConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["CharacterVoiceEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["CharacterVoice"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on CharacterVoiceConnection": Omit<
      GraphQLTypes["CharacterVoiceConnection"],
      "...on CharacterVoiceConnection"
    >;
  };
  /** An edge in a connection. */
  CharacterVoiceEdge: {
    __typename: "CharacterVoiceEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["CharacterVoice"] | undefined | null;
    "...on CharacterVoiceEdge": Omit<
      GraphQLTypes["CharacterVoiceEdge"],
      "...on CharacterVoiceEdge"
    >;
  };
  /** A comment on a post */
  Comment: {
    __typename: "Comment";
    /** The user who created this comment for the parent post. */
    author: GraphQLTypes["Profile"];
    /** Unmodified content. */
    content?: string | undefined | null;
    /** Html formatted content. */
    contentFormatted?: string | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** Users who liked this comment */
    likes: GraphQLTypes["ProfileConnection"];
    /** The parent comment if this comment was a reply to another. */
    parent?: GraphQLTypes["Comment"] | undefined | null;
    /** The post that this comment is attached to. */
    post: GraphQLTypes["Post"];
    /** Replies to this comment */
    replies: GraphQLTypes["CommentConnection"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Comment": Omit<GraphQLTypes["Comment"], "...on Comment">;
  };
  /** The connection type for Comment. */
  CommentConnection: {
    __typename: "CommentConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["CommentEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Comment"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on CommentConnection": Omit<
      GraphQLTypes["CommentConnection"],
      "...on CommentConnection"
    >;
  };
  /** An edge in a connection. */
  CommentEdge: {
    __typename: "CommentEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Comment"] | undefined | null;
    "...on CommentEdge": Omit<GraphQLTypes["CommentEdge"], "...on CommentEdge">;
  };
  /** An Episode of a Media */
  Episode: {
    __typename: "Episode";
    /** The anime this episode is in */
    anime: GraphQLTypes["Anime"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The length of the episode in seconds */
    length?: number | undefined | null;
    /** The sequence number of this unit */
    number: number;
    /** When this episode aired */
    releasedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: GraphQLTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: GraphQLTypes["TitlesList"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Episode": Omit<GraphQLTypes["Episode"], "...on Episode">;
  };
  /** The connection type for Episode. */
  EpisodeConnection: {
    __typename: "EpisodeConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["EpisodeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Episode"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on EpisodeConnection": Omit<
      GraphQLTypes["EpisodeConnection"],
      "...on EpisodeConnection"
    >;
  };
  /** Autogenerated return type of EpisodeCreate. */
  EpisodeCreatePayload: {
    __typename: "EpisodeCreatePayload";
    episode?: GraphQLTypes["Episode"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on EpisodeCreatePayload": Omit<
      GraphQLTypes["EpisodeCreatePayload"],
      "...on EpisodeCreatePayload"
    >;
  };
  /** Autogenerated return type of EpisodeDelete. */
  EpisodeDeletePayload: {
    __typename: "EpisodeDeletePayload";
    episode?: GraphQLTypes["GenericDelete"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on EpisodeDeletePayload": Omit<
      GraphQLTypes["EpisodeDeletePayload"],
      "...on EpisodeDeletePayload"
    >;
  };
  /** An edge in a connection. */
  EpisodeEdge: {
    __typename: "EpisodeEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Episode"] | undefined | null;
    "...on EpisodeEdge": Omit<GraphQLTypes["EpisodeEdge"], "...on EpisodeEdge">;
  };
  EpisodeMutations: {
    __typename: "EpisodeMutations";
    /** Create an Episode. */
    create?: GraphQLTypes["EpisodeCreatePayload"] | undefined | null;
    /** Delete an Episode. */
    delete?: GraphQLTypes["EpisodeDeletePayload"] | undefined | null;
    /** Update an Episode. */
    update?: GraphQLTypes["EpisodeUpdatePayload"] | undefined | null;
    "...on EpisodeMutations": Omit<
      GraphQLTypes["EpisodeMutations"],
      "...on EpisodeMutations"
    >;
  };
  /** Autogenerated return type of EpisodeUpdate. */
  EpisodeUpdatePayload: {
    __typename: "EpisodeUpdatePayload";
    episode?: GraphQLTypes["Episode"] | undefined | null;
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    "...on EpisodeUpdatePayload": Omit<
      GraphQLTypes["EpisodeUpdatePayload"],
      "...on EpisodeUpdatePayload"
    >;
  };
  /** Favorite media, characters, and people for a user */
  Favorite: {
    __typename: "Favorite";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The kitsu object that is mapped */
    item: GraphQLTypes["FavoriteItemUnion"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The user who favorited this item */
    user: GraphQLTypes["Profile"];
    "...on Favorite": Omit<GraphQLTypes["Favorite"], "...on Favorite">;
  };
  /** The connection type for Favorite. */
  FavoriteConnection: {
    __typename: "FavoriteConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["FavoriteEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Favorite"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on FavoriteConnection": Omit<
      GraphQLTypes["FavoriteConnection"],
      "...on FavoriteConnection"
    >;
  };
  /** Autogenerated return type of FavoriteCreate. */
  FavoriteCreatePayload: {
    __typename: "FavoriteCreatePayload";
    errors?:
      | Array<GraphQLTypes["FavoriteCreateErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["Favorite"] | undefined | null;
    "...on FavoriteCreatePayload": Omit<
      GraphQLTypes["FavoriteCreatePayload"],
      "...on FavoriteCreatePayload"
    >;
  };
  /** Autogenerated return type of FavoriteDelete. */
  FavoriteDeletePayload: {
    __typename: "FavoriteDeletePayload";
    errors?:
      | Array<GraphQLTypes["FavoriteDeleteErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["Favorite"] | undefined | null;
    "...on FavoriteDeletePayload": Omit<
      GraphQLTypes["FavoriteDeletePayload"],
      "...on FavoriteDeletePayload"
    >;
  };
  /** An edge in a connection. */
  FavoriteEdge: {
    __typename: "FavoriteEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Favorite"] | undefined | null;
    "...on FavoriteEdge": Omit<
      GraphQLTypes["FavoriteEdge"],
      "...on FavoriteEdge"
    >;
  };
  FavoriteMutations: {
    __typename: "FavoriteMutations";
    /** Add a favorite entry */
    create?: GraphQLTypes["FavoriteCreatePayload"] | undefined | null;
    /** Delete a favorite entry */
    delete?: GraphQLTypes["FavoriteDeletePayload"] | undefined | null;
    "...on FavoriteMutations": Omit<
      GraphQLTypes["FavoriteMutations"],
      "...on FavoriteMutations"
    >;
  };
  /** Related media grouped together */
  Franchise: {
    __typename: "Franchise";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** All media related to a franchise */
    installments?: GraphQLTypes["InstallmentConnection"] | undefined | null;
    /** The name of this franchise in various languages */
    titles: GraphQLTypes["TitlesList"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Franchise": Omit<GraphQLTypes["Franchise"], "...on Franchise">;
  };
  /** The connection type for Franchise. */
  FranchiseConnection: {
    __typename: "FranchiseConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["FranchiseEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Franchise"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on FranchiseConnection": Omit<
      GraphQLTypes["FranchiseConnection"],
      "...on FranchiseConnection"
    >;
  };
  /** An edge in a connection. */
  FranchiseEdge: {
    __typename: "FranchiseEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Franchise"] | undefined | null;
    "...on FranchiseEdge": Omit<
      GraphQLTypes["FranchiseEdge"],
      "...on FranchiseEdge"
    >;
  };
  GenericDelete: {
    __typename: "GenericDelete";
    id: GraphQLTypes["ID"];
    "...on GenericDelete": Omit<
      GraphQLTypes["GenericDelete"],
      "...on GenericDelete"
    >;
  };
  GenericError: {
    __typename: "GenericError";
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on GenericError": Omit<
      GraphQLTypes["GenericError"],
      "...on GenericError"
    >;
  };
  Image: {
    __typename: "Image";
    /** A blurhash-encoded version of this image */
    blurhash?: string | undefined | null;
    /** The original image */
    original: GraphQLTypes["ImageView"];
    /** The various generated views of this image */
    views: Array<GraphQLTypes["ImageView"]>;
    "...on Image": Omit<GraphQLTypes["Image"], "...on Image">;
  };
  ImageView: {
    __typename: "ImageView";
    /** The height of the image */
    height?: number | undefined | null;
    /** The name of this view of the image */
    name: string;
    /** The URL of this view of the image */
    url: string;
    /** The width of the image */
    width?: number | undefined | null;
    "...on ImageView": Omit<GraphQLTypes["ImageView"], "...on ImageView">;
  };
  /** Individual media that belongs to a franchise */
  Installment: {
    __typename: "Installment";
    /** Order based chronologically */
    alternativeOrder?: number | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The franchise related to this installment */
    franchise: GraphQLTypes["Franchise"];
    id: GraphQLTypes["ID"];
    /** The media related to this installment */
    media: GraphQLTypes["Media"];
    /** Order based by date released */
    releaseOrder?: number | undefined | null;
    /** Further explains the media relationship corresponding to a franchise */
    tag?: GraphQLTypes["InstallmentTagEnum"] | undefined | null;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Installment": Omit<GraphQLTypes["Installment"], "...on Installment">;
  };
  /** The connection type for Installment. */
  InstallmentConnection: {
    __typename: "InstallmentConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["InstallmentEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Installment"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on InstallmentConnection": Omit<
      GraphQLTypes["InstallmentConnection"],
      "...on InstallmentConnection"
    >;
  };
  /** An edge in a connection. */
  InstallmentEdge: {
    __typename: "InstallmentEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Installment"] | undefined | null;
    "...on InstallmentEdge": Omit<
      GraphQLTypes["InstallmentEdge"],
      "...on InstallmentEdge"
    >;
  };
  /** The user library */
  Library: {
    __typename: "Library";
    /** All Library Entries */
    all: GraphQLTypes["LibraryEntryConnection"];
    /** Library Entries with the completed status */
    completed: GraphQLTypes["LibraryEntryConnection"];
    /** Library Entries with the current status */
    current: GraphQLTypes["LibraryEntryConnection"];
    /** Library Entries with the dropped status */
    dropped: GraphQLTypes["LibraryEntryConnection"];
    /** Library Entries with the on_hold status */
    onHold: GraphQLTypes["LibraryEntryConnection"];
    /** Library Entries with the planned status */
    planned: GraphQLTypes["LibraryEntryConnection"];
    /** Random anime or manga from this library */
    randomMedia?: GraphQLTypes["Media"] | undefined | null;
    "...on Library": Omit<GraphQLTypes["Library"], "...on Library">;
  };
  /** Information about a specific media entry for a user */
  LibraryEntry: {
    __typename: "LibraryEntry";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** History of user actions for this library entry. */
    events?: GraphQLTypes["LibraryEventConnection"] | undefined | null;
    /** When the user finished this media. */
    finishedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    id: GraphQLTypes["ID"];
    /** The last unit consumed */
    lastUnit?: GraphQLTypes["Unit"] | undefined | null;
    /** The media related to this library entry. */
    media: GraphQLTypes["Media"];
    /** The next unit to be consumed */
    nextUnit?: GraphQLTypes["Unit"] | undefined | null;
    /** Notes left by the profile related to this library entry. */
    notes?: string | undefined | null;
    /** If the media related to the library entry is Not-Safe-for-Work. */
    nsfw: boolean;
    /** If this library entry is publicly visibile from their profile, or hidden. */
    private: boolean;
    /** The number of episodes/chapters this user has watched/read */
    progress: number;
    /** When the user last watched an episode or read a chapter of this media. */
    progressedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** How much you enjoyed this media (lower meaning not liking). */
    rating?: number | undefined | null;
    /** The reaction based on the media of this library entry. */
    reaction?: GraphQLTypes["MediaReaction"] | undefined | null;
    /** Amount of times this media has been rewatched. */
    reconsumeCount: number;
    /** If the profile is currently rewatching this media. */
    reconsuming: boolean;
    /** When the user started this media. */
    startedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    status: GraphQLTypes["LibraryEntryStatusEnum"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The user who created this library entry. */
    user: GraphQLTypes["Profile"];
    /** Volumes that the profile owns (physically or digital). */
    volumesOwned: number;
    "...on LibraryEntry": Omit<
      GraphQLTypes["LibraryEntry"],
      "...on LibraryEntry"
    >;
  };
  /** The connection type for LibraryEntry. */
  LibraryEntryConnection: {
    __typename: "LibraryEntryConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["LibraryEntryEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["LibraryEntry"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on LibraryEntryConnection": Omit<
      GraphQLTypes["LibraryEntryConnection"],
      "...on LibraryEntryConnection"
    >;
  };
  /** Autogenerated return type of LibraryEntryCreate. */
  LibraryEntryCreatePayload: {
    __typename: "LibraryEntryCreatePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryCreatePayload": Omit<
      GraphQLTypes["LibraryEntryCreatePayload"],
      "...on LibraryEntryCreatePayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryDelete. */
  LibraryEntryDeletePayload: {
    __typename: "LibraryEntryDeletePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["GenericDelete"] | undefined | null;
    "...on LibraryEntryDeletePayload": Omit<
      GraphQLTypes["LibraryEntryDeletePayload"],
      "...on LibraryEntryDeletePayload"
    >;
  };
  /** An edge in a connection. */
  LibraryEntryEdge: {
    __typename: "LibraryEntryEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryEdge": Omit<
      GraphQLTypes["LibraryEntryEdge"],
      "...on LibraryEntryEdge"
    >;
  };
  LibraryEntryMutations: {
    __typename: "LibraryEntryMutations";
    /** Create a library entry */
    create?: GraphQLTypes["LibraryEntryCreatePayload"] | undefined | null;
    /** Delete a library entry */
    delete?: GraphQLTypes["LibraryEntryDeletePayload"] | undefined | null;
    /** Update a library entry */
    update?: GraphQLTypes["LibraryEntryUpdatePayload"] | undefined | null;
    /** Update library entry progress by id */
    updateProgressById?:
      | GraphQLTypes["LibraryEntryUpdateProgressByIdPayload"]
      | undefined
      | null;
    /** Update library entry progress by media */
    updateProgressByMedia?:
      | GraphQLTypes["LibraryEntryUpdateProgressByMediaPayload"]
      | undefined
      | null;
    /** Update library entry rating by id */
    updateRatingById?:
      | GraphQLTypes["LibraryEntryUpdateRatingByIdPayload"]
      | undefined
      | null;
    /** Update library entry rating by media */
    updateRatingByMedia?:
      | GraphQLTypes["LibraryEntryUpdateRatingByMediaPayload"]
      | undefined
      | null;
    /** Update library entry status by id */
    updateStatusById?:
      | GraphQLTypes["LibraryEntryUpdateStatusByIdPayload"]
      | undefined
      | null;
    /** Update library entry status by media */
    updateStatusByMedia?:
      | GraphQLTypes["LibraryEntryUpdateStatusByMediaPayload"]
      | undefined
      | null;
    "...on LibraryEntryMutations": Omit<
      GraphQLTypes["LibraryEntryMutations"],
      "...on LibraryEntryMutations"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdate. */
  LibraryEntryUpdatePayload: {
    __typename: "LibraryEntryUpdatePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdatePayload": Omit<
      GraphQLTypes["LibraryEntryUpdatePayload"],
      "...on LibraryEntryUpdatePayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateProgressById. */
  LibraryEntryUpdateProgressByIdPayload: {
    __typename: "LibraryEntryUpdateProgressByIdPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateProgressByIdPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateProgressByIdPayload"],
      "...on LibraryEntryUpdateProgressByIdPayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateProgressByMedia. */
  LibraryEntryUpdateProgressByMediaPayload: {
    __typename: "LibraryEntryUpdateProgressByMediaPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateProgressByMediaPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateProgressByMediaPayload"],
      "...on LibraryEntryUpdateProgressByMediaPayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateRatingById. */
  LibraryEntryUpdateRatingByIdPayload: {
    __typename: "LibraryEntryUpdateRatingByIdPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateRatingByIdPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateRatingByIdPayload"],
      "...on LibraryEntryUpdateRatingByIdPayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateRatingByMedia. */
  LibraryEntryUpdateRatingByMediaPayload: {
    __typename: "LibraryEntryUpdateRatingByMediaPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateRatingByMediaPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateRatingByMediaPayload"],
      "...on LibraryEntryUpdateRatingByMediaPayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateStatusById. */
  LibraryEntryUpdateStatusByIdPayload: {
    __typename: "LibraryEntryUpdateStatusByIdPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateStatusByIdPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateStatusByIdPayload"],
      "...on LibraryEntryUpdateStatusByIdPayload"
    >;
  };
  /** Autogenerated return type of LibraryEntryUpdateStatusByMedia. */
  LibraryEntryUpdateStatusByMediaPayload: {
    __typename: "LibraryEntryUpdateStatusByMediaPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    libraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    "...on LibraryEntryUpdateStatusByMediaPayload": Omit<
      GraphQLTypes["LibraryEntryUpdateStatusByMediaPayload"],
      "...on LibraryEntryUpdateStatusByMediaPayload"
    >;
  };
  /** History of user actions for a library entry. */
  LibraryEvent: {
    __typename: "LibraryEvent";
    /** The data that was changed for this library event. */
    changedData: GraphQLTypes["Map"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The type of library event. */
    kind: GraphQLTypes["LibraryEventKindEnum"];
    /** The library entry related to this library event. */
    libraryEntry: GraphQLTypes["LibraryEntry"];
    /** The media related to this library event. */
    media: GraphQLTypes["Media"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The user who created this library event */
    user: GraphQLTypes["Profile"];
    "...on LibraryEvent": Omit<
      GraphQLTypes["LibraryEvent"],
      "...on LibraryEvent"
    >;
  };
  /** The connection type for LibraryEvent. */
  LibraryEventConnection: {
    __typename: "LibraryEventConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["LibraryEventEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["LibraryEvent"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on LibraryEventConnection": Omit<
      GraphQLTypes["LibraryEventConnection"],
      "...on LibraryEventConnection"
    >;
  };
  /** An edge in a connection. */
  LibraryEventEdge: {
    __typename: "LibraryEventEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["LibraryEvent"] | undefined | null;
    "...on LibraryEventEdge": Omit<
      GraphQLTypes["LibraryEventEdge"],
      "...on LibraryEventEdge"
    >;
  };
  Manga: {
    __typename: "Manga";
    /** The recommended minimum age group for this media */
    ageRating?: GraphQLTypes["AgeRatingEnum"] | undefined | null;
    /** An explanation of why this received the age rating it did */
    ageRatingGuide?: string | undefined | null;
    /** The average rating of this media amongst all Kitsu users */
    averageRating?: number | undefined | null;
    /** The rank of this media by rating */
    averageRatingRank?: number | undefined | null;
    /** A large banner image for this media */
    bannerImage?: GraphQLTypes["Image"] | undefined | null;
    /** A list of categories for this media */
    categories: GraphQLTypes["CategoryConnection"];
    /** Get a specific chapter of the manga. */
    chapter?: GraphQLTypes["Chapter"] | undefined | null;
    /** The number of chapters in this manga. */
    chapterCount?: number | undefined | null;
    /** The estimated number of chapters in this manga. */
    chapterCountGuess?: number | undefined | null;
    /** The chapters in the manga. */
    chapters?: GraphQLTypes["ChapterConnection"] | undefined | null;
    /** The characters who starred in this media */
    characters: GraphQLTypes["MediaCharacterConnection"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief (mostly spoiler free) summary or description of the media. */
    description: GraphQLTypes["Map"];
    /** the day that this media made its final release */
    endDate?: GraphQLTypes["Date"] | undefined | null;
    /** The number of users with this in their favorites */
    favoritesCount?: number | undefined | null;
    id: GraphQLTypes["ID"];
    /** A list of mappings for this media */
    mappings: GraphQLTypes["MappingConnection"];
    /** Your library entry related to this media. */
    myLibraryEntry?: GraphQLTypes["LibraryEntry"] | undefined | null;
    /** A list of your wiki submissions for this media */
    myWikiSubmissions: GraphQLTypes["WikiSubmissionConnection"];
    /** The time of the next release of this media */
    nextRelease?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** The countries in which the media was originally primarily produced */
    originCountries: Array<string>;
    /** The languages the media was originally produced in */
    originLanguages: Array<string>;
    /** The country in which the media was primarily produced */
    originalLocale?: string | undefined | null;
    /** The poster image of this media */
    posterImage?: GraphQLTypes["Image"] | undefined | null;
    /** All posts that tag this media. */
    posts: GraphQLTypes["PostConnection"];
    /** The companies which helped to produce this media */
    productions: GraphQLTypes["MediaProductionConnection"];
    /** A list of quotes from this media */
    quotes: GraphQLTypes["QuoteConnection"];
    /** A list of reactions for this media */
    reactions: GraphQLTypes["MediaReactionConnection"];
    /** A list of relationships for this media */
    relationships: GraphQLTypes["MediaRelationshipConnection"];
    /** Whether the media is Safe-for-Work */
    sfw: boolean;
    /** The URL-friendly identifier of this media */
    slug: string;
    /** The staff members who worked on this media */
    staff: GraphQLTypes["MediaStaffConnection"];
    /** The day that this media first released */
    startDate?: GraphQLTypes["Date"] | undefined | null;
    /** The current releasing status of this media */
    status: GraphQLTypes["ReleaseStatusEnum"];
    /** A secondary type for categorizing Manga. */
    subtype: GraphQLTypes["MangaSubtypeEnum"];
    /** Description of when this media is expected to release */
    tba?: string | undefined | null;
    /** The titles for this media in various locales */
    titles: GraphQLTypes["TitlesList"];
    /** Anime or Manga. */
    type: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The number of users with this in their library */
    userCount?: number | undefined | null;
    /** The rank of this media by popularity */
    userCountRank?: number | undefined | null;
    /** The number of volumes in this manga. */
    volumeCount?: number | undefined | null;
    /** The volumes in the manga. */
    volumes?: GraphQLTypes["VolumeConnection"] | undefined | null;
    "...on Manga": Omit<GraphQLTypes["Manga"], "...on Manga">;
  };
  MangaAmountConsumed: {
    __typename: "MangaAmountConsumed";
    /** Total media completed atleast once. */
    completed: number;
    id: GraphQLTypes["ID"];
    /** Total amount of media. */
    media: number;
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** Total progress of library including reconsuming. */
    units: number;
    "...on MangaAmountConsumed": Omit<
      GraphQLTypes["MangaAmountConsumed"],
      "...on MangaAmountConsumed"
    >;
  };
  MangaCategoryBreakdown: {
    __typename: "MangaCategoryBreakdown";
    /** A Map of category_id -> count for all categories present on the library entries */
    categories: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The profile related to the user for this stat. */
    profile: GraphQLTypes["Profile"];
    /** Last time we fully recalculated this stat. */
    recalculatedAt: GraphQLTypes["ISO8601Date"];
    /** The total amount of library entries. */
    total: number;
    "...on MangaCategoryBreakdown": Omit<
      GraphQLTypes["MangaCategoryBreakdown"],
      "...on MangaCategoryBreakdown"
    >;
  };
  /** The connection type for Manga. */
  MangaConnection: {
    __typename: "MangaConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MangaEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Manga"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MangaConnection": Omit<
      GraphQLTypes["MangaConnection"],
      "...on MangaConnection"
    >;
  };
  /** An edge in a connection. */
  MangaEdge: {
    __typename: "MangaEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Manga"] | undefined | null;
    "...on MangaEdge": Omit<GraphQLTypes["MangaEdge"], "...on MangaEdge">;
  };
  /** Media Mappings from External Sites (MAL, Anilist, etc..) to Kitsu. */
  Mapping: {
    __typename: "Mapping";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The ID of the media from the external site. */
    externalId: GraphQLTypes["ID"];
    /** The name of the site which kitsu media is being linked from. */
    externalSite: GraphQLTypes["MappingExternalSiteEnum"];
    id: GraphQLTypes["ID"];
    /** The kitsu object that is mapped. */
    item: GraphQLTypes["MappingItemUnion"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Mapping": Omit<GraphQLTypes["Mapping"], "...on Mapping">;
  };
  /** The connection type for Mapping. */
  MappingConnection: {
    __typename: "MappingConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MappingEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Mapping"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MappingConnection": Omit<
      GraphQLTypes["MappingConnection"],
      "...on MappingConnection"
    >;
  };
  /** Autogenerated return type of MappingCreate. */
  MappingCreatePayload: {
    __typename: "MappingCreatePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    mapping?: GraphQLTypes["Mapping"] | undefined | null;
    "...on MappingCreatePayload": Omit<
      GraphQLTypes["MappingCreatePayload"],
      "...on MappingCreatePayload"
    >;
  };
  /** Autogenerated return type of MappingDelete. */
  MappingDeletePayload: {
    __typename: "MappingDeletePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    mapping?: GraphQLTypes["GenericDelete"] | undefined | null;
    "...on MappingDeletePayload": Omit<
      GraphQLTypes["MappingDeletePayload"],
      "...on MappingDeletePayload"
    >;
  };
  /** An edge in a connection. */
  MappingEdge: {
    __typename: "MappingEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Mapping"] | undefined | null;
    "...on MappingEdge": Omit<GraphQLTypes["MappingEdge"], "...on MappingEdge">;
  };
  MappingMutations: {
    __typename: "MappingMutations";
    /** Create a Mapping */
    create?: GraphQLTypes["MappingCreatePayload"] | undefined | null;
    /** Delete a Mapping */
    delete?: GraphQLTypes["MappingDeletePayload"] | undefined | null;
    /** Update a Mapping */
    update?: GraphQLTypes["MappingUpdatePayload"] | undefined | null;
    "...on MappingMutations": Omit<
      GraphQLTypes["MappingMutations"],
      "...on MappingMutations"
    >;
  };
  /** Autogenerated return type of MappingUpdate. */
  MappingUpdatePayload: {
    __typename: "MappingUpdatePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    mapping?: GraphQLTypes["Mapping"] | undefined | null;
    "...on MappingUpdatePayload": Omit<
      GraphQLTypes["MappingUpdatePayload"],
      "...on MappingUpdatePayload"
    >;
  };
  /** Information about a Character starring in a Media */
  MediaCharacter: {
    __typename: "MediaCharacter";
    /** The character */
    character: GraphQLTypes["Character"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The media */
    media: GraphQLTypes["Media"];
    /** The role this character had in the media */
    role: GraphQLTypes["CharacterRoleEnum"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The voices of this character */
    voices?: GraphQLTypes["CharacterVoiceConnection"] | undefined | null;
    "...on MediaCharacter": Omit<
      GraphQLTypes["MediaCharacter"],
      "...on MediaCharacter"
    >;
  };
  /** The connection type for MediaCharacter. */
  MediaCharacterConnection: {
    __typename: "MediaCharacterConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaCharacterEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["MediaCharacter"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MediaCharacterConnection": Omit<
      GraphQLTypes["MediaCharacterConnection"],
      "...on MediaCharacterConnection"
    >;
  };
  /** An edge in a connection. */
  MediaCharacterEdge: {
    __typename: "MediaCharacterEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["MediaCharacter"] | undefined | null;
    "...on MediaCharacterEdge": Omit<
      GraphQLTypes["MediaCharacterEdge"],
      "...on MediaCharacterEdge"
    >;
  };
  /** The connection type for Media. */
  MediaConnection: {
    __typename: "MediaConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Media"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    "...on MediaConnection": Omit<
      GraphQLTypes["MediaConnection"],
      "...on MediaConnection"
    >;
  };
  /** An edge in a connection. */
  MediaEdge: {
    __typename: "MediaEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Media"] | undefined | null;
    "...on MediaEdge": Omit<GraphQLTypes["MediaEdge"], "...on MediaEdge">;
  };
  /** The role a company played in the creation or localization of a media */
  MediaProduction: {
    __typename: "MediaProduction";
    /** The production company */
    company: GraphQLTypes["Producer"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The media */
    media: GraphQLTypes["Media"];
    /** The role this company played */
    role: GraphQLTypes["MediaProductionRoleEnum"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on MediaProduction": Omit<
      GraphQLTypes["MediaProduction"],
      "...on MediaProduction"
    >;
  };
  /** The connection type for MediaProduction. */
  MediaProductionConnection: {
    __typename: "MediaProductionConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaProductionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["MediaProduction"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MediaProductionConnection": Omit<
      GraphQLTypes["MediaProductionConnection"],
      "...on MediaProductionConnection"
    >;
  };
  /** An edge in a connection. */
  MediaProductionEdge: {
    __typename: "MediaProductionEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["MediaProduction"] | undefined | null;
    "...on MediaProductionEdge": Omit<
      GraphQLTypes["MediaProductionEdge"],
      "...on MediaProductionEdge"
    >;
  };
  /** A simple review that is 140 characters long expressing how you felt about a media */
  MediaReaction: {
    __typename: "MediaReaction";
    /** The author who wrote this reaction. */
    author: GraphQLTypes["Profile"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Whether you have liked this media reaction */
    hasLiked: boolean;
    id: GraphQLTypes["ID"];
    /** The library entry related to this reaction. */
    libraryEntry: GraphQLTypes["LibraryEntry"];
    /** Users that have liked this reaction */
    likes: GraphQLTypes["ProfileConnection"];
    /** The media related to this reaction. */
    media: GraphQLTypes["Media"];
    /** When this media reaction was written based on media progress. */
    progress: number;
    /** The reaction text related to a media. */
    reaction: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on MediaReaction": Omit<
      GraphQLTypes["MediaReaction"],
      "...on MediaReaction"
    >;
  };
  /** The connection type for MediaReaction. */
  MediaReactionConnection: {
    __typename: "MediaReactionConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaReactionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["MediaReaction"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MediaReactionConnection": Omit<
      GraphQLTypes["MediaReactionConnection"],
      "...on MediaReactionConnection"
    >;
  };
  /** Autogenerated return type of MediaReactionCreate. */
  MediaReactionCreatePayload: {
    __typename: "MediaReactionCreatePayload";
    errors?:
      | Array<GraphQLTypes["MediaReactionCreateErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["MediaReaction"] | undefined | null;
    "...on MediaReactionCreatePayload": Omit<
      GraphQLTypes["MediaReactionCreatePayload"],
      "...on MediaReactionCreatePayload"
    >;
  };
  /** Autogenerated return type of MediaReactionDelete. */
  MediaReactionDeletePayload: {
    __typename: "MediaReactionDeletePayload";
    errors?:
      | Array<GraphQLTypes["MediaReactionDeleteErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["MediaReaction"] | undefined | null;
    "...on MediaReactionDeletePayload": Omit<
      GraphQLTypes["MediaReactionDeletePayload"],
      "...on MediaReactionDeletePayload"
    >;
  };
  /** An edge in a connection. */
  MediaReactionEdge: {
    __typename: "MediaReactionEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["MediaReaction"] | undefined | null;
    "...on MediaReactionEdge": Omit<
      GraphQLTypes["MediaReactionEdge"],
      "...on MediaReactionEdge"
    >;
  };
  /** Autogenerated return type of MediaReactionLike. */
  MediaReactionLikePayload: {
    __typename: "MediaReactionLikePayload";
    errors?:
      | Array<GraphQLTypes["MediaReactionLikeErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["MediaReaction"] | undefined | null;
    "...on MediaReactionLikePayload": Omit<
      GraphQLTypes["MediaReactionLikePayload"],
      "...on MediaReactionLikePayload"
    >;
  };
  MediaReactionMutations: {
    __typename: "MediaReactionMutations";
    /** Share a brief reaction to a media, tied to your library entry */
    create?: GraphQLTypes["MediaReactionCreatePayload"] | undefined | null;
    /** Delete a mutation */
    delete?: GraphQLTypes["MediaReactionDeletePayload"] | undefined | null;
    /** Like a media reaction */
    like?: GraphQLTypes["MediaReactionLikePayload"] | undefined | null;
    /** Remove your like from a media reaction */
    unlike?: GraphQLTypes["MediaReactionUnlikePayload"] | undefined | null;
    "...on MediaReactionMutations": Omit<
      GraphQLTypes["MediaReactionMutations"],
      "...on MediaReactionMutations"
    >;
  };
  /** Autogenerated return type of MediaReactionUnlike. */
  MediaReactionUnlikePayload: {
    __typename: "MediaReactionUnlikePayload";
    errors?:
      | Array<GraphQLTypes["MediaReactionUnlikeErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["MediaReaction"] | undefined | null;
    "...on MediaReactionUnlikePayload": Omit<
      GraphQLTypes["MediaReactionUnlikePayload"],
      "...on MediaReactionUnlikePayload"
    >;
  };
  /** A relationship from one media to another */
  MediaRelationship: {
    __typename: "MediaRelationship";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The destination media */
    destination: GraphQLTypes["Media"];
    /** The kind of relationship */
    kind: GraphQLTypes["MediaRelationshipKindEnum"];
    /** The source media */
    source: GraphQLTypes["Media"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on MediaRelationship": Omit<
      GraphQLTypes["MediaRelationship"],
      "...on MediaRelationship"
    >;
  };
  /** The connection type for MediaRelationship. */
  MediaRelationshipConnection: {
    __typename: "MediaRelationshipConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaRelationshipEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["MediaRelationship"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MediaRelationshipConnection": Omit<
      GraphQLTypes["MediaRelationshipConnection"],
      "...on MediaRelationshipConnection"
    >;
  };
  /** An edge in a connection. */
  MediaRelationshipEdge: {
    __typename: "MediaRelationshipEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["MediaRelationship"] | undefined | null;
    "...on MediaRelationshipEdge": Omit<
      GraphQLTypes["MediaRelationshipEdge"],
      "...on MediaRelationshipEdge"
    >;
  };
  /** Information about a person working on an anime */
  MediaStaff: {
    __typename: "MediaStaff";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The media */
    media: GraphQLTypes["Media"];
    /** The person */
    person: GraphQLTypes["Person"];
    /** The role this person had in the creation of this media */
    role: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on MediaStaff": Omit<GraphQLTypes["MediaStaff"], "...on MediaStaff">;
  };
  /** The connection type for MediaStaff. */
  MediaStaffConnection: {
    __typename: "MediaStaffConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["MediaStaffEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["MediaStaff"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on MediaStaffConnection": Omit<
      GraphQLTypes["MediaStaffConnection"],
      "...on MediaStaffConnection"
    >;
  };
  /** An edge in a connection. */
  MediaStaffEdge: {
    __typename: "MediaStaffEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["MediaStaff"] | undefined | null;
    "...on MediaStaffEdge": Omit<
      GraphQLTypes["MediaStaffEdge"],
      "...on MediaStaffEdge"
    >;
  };
  Mutation: {
    __typename: "Mutation";
    account: GraphQLTypes["AccountMutations"];
    /** Create a new Kitsu account */
    accountCreate?: GraphQLTypes["AccountCreatePayload"] | undefined | null;
    anime: GraphQLTypes["AnimeMutations"];
    block: GraphQLTypes["BlockMutations"];
    episode: GraphQLTypes["EpisodeMutations"];
    favorite: GraphQLTypes["FavoriteMutations"];
    libraryEntry: GraphQLTypes["LibraryEntryMutations"];
    mapping: GraphQLTypes["MappingMutations"];
    mediaReaction: GraphQLTypes["MediaReactionMutations"];
    post: GraphQLTypes["PostMutations"];
    pro: GraphQLTypes["ProMutations"];
    profile: GraphQLTypes["ProfileMutations"];
    profileLink: GraphQLTypes["ProfileLinkMutations"];
    wikiSubmission: GraphQLTypes["WikiSubmissionMutations"];
    "...on Mutation": Omit<GraphQLTypes["Mutation"], "...on Mutation">;
  };
  /** The mutation requires an authenticated logged-in user session, and none was provided or the session has expired. The recommended action varies depending on your application and whether you provided the bearer token in the `Authorization` header or not. If you did, you should probably attempt to refresh the token, and if that fails, prompt the user to log in again. If you did not provide a bearer token, you should just prompt the user to log in. */
  NotAuthenticatedError: {
    __typename: "NotAuthenticatedError";
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on NotAuthenticatedError": Omit<
      GraphQLTypes["NotAuthenticatedError"],
      "...on NotAuthenticatedError"
    >;
  };
  /** The mutation requires higher permissions than the current user or token has. This is a bit vague, but it generally means you're attempting to modify an object you don't own, or perform an administrator action without being an administrator. It could also mean your token does not have the required scopes to perform the action. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotAuthorizedError: {
    __typename: "NotAuthorizedError";
    action?: string | undefined | null;
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on NotAuthorizedError": Omit<
      GraphQLTypes["NotAuthorizedError"],
      "...on NotAuthorizedError"
    >;
  };
  /** An object required for your mutation was unable to be located. Usually this means the object you're attempting to modify or delete does not exist. The recommended action is to display a message to the user informing them that their action failed and that retrying will generally *not* help. */
  NotFoundError: {
    __typename: "NotFoundError";
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on NotFoundError": Omit<
      GraphQLTypes["NotFoundError"],
      "...on NotFoundError"
    >;
  };
  /** Information about pagination in a connection. */
  PageInfo: {
    __typename: "PageInfo";
    /** When paginating forwards, the cursor to continue. */
    endCursor?: string | undefined | null;
    /** When paginating forwards, are there more items? */
    hasNextPage: boolean;
    /** When paginating backwards, are there more items? */
    hasPreviousPage: boolean;
    /** When paginating backwards, the cursor to continue. */
    startCursor?: string | undefined | null;
    "...on PageInfo": Omit<GraphQLTypes["PageInfo"], "...on PageInfo">;
  };
  /** A Voice Actor, Director, Animator, or other person who works in the creation and localization of media */
  Person: {
    __typename: "Person";
    /** The day when this person was born */
    birthday?: GraphQLTypes["Date"] | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief biography or description of the person. */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** An image of the person */
    image?: GraphQLTypes["Image"] | undefined | null;
    /** Information about the person working on specific media */
    mediaStaff?: GraphQLTypes["MediaStaffConnection"] | undefined | null;
    /** The primary name of this person. */
    name: string;
    /** The name of this person in various languages */
    names: GraphQLTypes["TitlesList"];
    /** The URL-friendly identifier of this person. */
    slug: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The voice-acting roles this person has had. */
    voices?: GraphQLTypes["CharacterVoiceConnection"] | undefined | null;
    "...on Person": Omit<GraphQLTypes["Person"], "...on Person">;
  };
  /** A post that is visible to your followers and globally in the news-feed. */
  Post: {
    __typename: "Post";
    /** The user who created this post. */
    author: GraphQLTypes["Profile"];
    /** All comments on this post */
    comments: GraphQLTypes["CommentConnection"];
    /** Unmodified content. */
    content?: string | undefined | null;
    /** Html formatted content. */
    contentFormatted?: string | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Users that are watching this post */
    follows: GraphQLTypes["ProfileConnection"];
    id: GraphQLTypes["ID"];
    /** If a post is Not-Safe-for-Work. */
    isNsfw: boolean;
    /** If this post spoils the tagged media. */
    isSpoiler: boolean;
    /** Users that have liked this post */
    likes: GraphQLTypes["ProfileConnection"];
    /** When this post was locked. */
    lockedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    /** The user who locked this post. */
    lockedBy?: GraphQLTypes["Profile"] | undefined | null;
    /** The reason why this post was locked. */
    lockedReason?: GraphQLTypes["LockedReasonEnum"] | undefined | null;
    /** The media tagged in this post. */
    media?: GraphQLTypes["Media"] | undefined | null;
    /** The profile of the target user of the post. */
    targetProfile: GraphQLTypes["Profile"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Post": Omit<GraphQLTypes["Post"], "...on Post">;
  };
  /** The connection type for Post. */
  PostConnection: {
    __typename: "PostConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["PostEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Post"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on PostConnection": Omit<
      GraphQLTypes["PostConnection"],
      "...on PostConnection"
    >;
  };
  /** Autogenerated return type of PostCreate. */
  PostCreatePayload: {
    __typename: "PostCreatePayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    post?: GraphQLTypes["Post"] | undefined | null;
    "...on PostCreatePayload": Omit<
      GraphQLTypes["PostCreatePayload"],
      "...on PostCreatePayload"
    >;
  };
  /** An edge in a connection. */
  PostEdge: {
    __typename: "PostEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Post"] | undefined | null;
    "...on PostEdge": Omit<GraphQLTypes["PostEdge"], "...on PostEdge">;
  };
  /** Autogenerated return type of PostLock. */
  PostLockPayload: {
    __typename: "PostLockPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    post?: GraphQLTypes["Post"] | undefined | null;
    "...on PostLockPayload": Omit<
      GraphQLTypes["PostLockPayload"],
      "...on PostLockPayload"
    >;
  };
  PostMutations: {
    __typename: "PostMutations";
    /** Create a Post. */
    create?: GraphQLTypes["PostCreatePayload"] | undefined | null;
    /** Lock a Post. */
    lock?: GraphQLTypes["PostLockPayload"] | undefined | null;
    /** Unlock a Post. */
    unlock?: GraphQLTypes["PostUnlockPayload"] | undefined | null;
    "...on PostMutations": Omit<
      GraphQLTypes["PostMutations"],
      "...on PostMutations"
    >;
  };
  /** Autogenerated return type of PostUnlock. */
  PostUnlockPayload: {
    __typename: "PostUnlockPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    post?: GraphQLTypes["Post"] | undefined | null;
    "...on PostUnlockPayload": Omit<
      GraphQLTypes["PostUnlockPayload"],
      "...on PostUnlockPayload"
    >;
  };
  ProMutations: {
    __typename: "ProMutations";
    /** Set the user's discord tag */
    setDiscord?: GraphQLTypes["ProSetDiscordPayload"] | undefined | null;
    /** Set the user's Hall-of-Fame message */
    setMessage?: GraphQLTypes["ProSetMessagePayload"] | undefined | null;
    /** End the user's pro subscription */
    unsubscribe?: GraphQLTypes["ProUnsubscribePayload"] | undefined | null;
    "...on ProMutations": Omit<
      GraphQLTypes["ProMutations"],
      "...on ProMutations"
    >;
  };
  /** Autogenerated return type of ProSetDiscord. */
  ProSetDiscordPayload: {
    __typename: "ProSetDiscordPayload";
    discord: string;
    "...on ProSetDiscordPayload": Omit<
      GraphQLTypes["ProSetDiscordPayload"],
      "...on ProSetDiscordPayload"
    >;
  };
  /** Autogenerated return type of ProSetMessage. */
  ProSetMessagePayload: {
    __typename: "ProSetMessagePayload";
    message: string;
    "...on ProSetMessagePayload": Omit<
      GraphQLTypes["ProSetMessagePayload"],
      "...on ProSetMessagePayload"
    >;
  };
  /** A subscription to Kitsu PRO */
  ProSubscription: {
    __typename: "ProSubscription";
    /** The account which is subscribed to Pro benefits */
    account: GraphQLTypes["Account"];
    /** The billing service used for this subscription */
    billingService: GraphQLTypes["RecurringBillingServiceEnum"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The tier of Pro the account is subscribed to */
    tier: GraphQLTypes["ProTierEnum"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on ProSubscription": Omit<
      GraphQLTypes["ProSubscription"],
      "...on ProSubscription"
    >;
  };
  /** Autogenerated return type of ProUnsubscribe. */
  ProUnsubscribePayload: {
    __typename: "ProUnsubscribePayload";
    expiresAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    "...on ProUnsubscribePayload": Omit<
      GraphQLTypes["ProUnsubscribePayload"],
      "...on ProUnsubscribePayload"
    >;
  };
  /** A company involved in the creation or localization of media */
  Producer: {
    __typename: "Producer";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The name of this production company */
    name: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Producer": Omit<GraphQLTypes["Producer"], "...on Producer">;
  };
  /** A user profile on Kitsu */
  Profile: {
    __typename: "Profile";
    /** A short biographical blurb about this profile */
    about?: string | undefined | null;
    /** An avatar image to easily identify this profile */
    avatarImage?: GraphQLTypes["Image"] | undefined | null;
    /** A banner to display at the top of the profile */
    bannerImage?: GraphQLTypes["Image"] | undefined | null;
    /** When the user was born */
    birthday?: GraphQLTypes["ISO8601Date"] | undefined | null;
    /** All comments to any post this user has made. */
    comments: GraphQLTypes["CommentConnection"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Favorite media, characters, and people */
    favorites: GraphQLTypes["FavoriteConnection"];
    /** People that follow the user */
    followers: GraphQLTypes["ProfileConnection"];
    /** People the user is following */
    following: GraphQLTypes["ProfileConnection"];
    /** What the user identifies as */
    gender?: string | undefined | null;
    id: GraphQLTypes["ID"];
    /** The user library of their media */
    library: GraphQLTypes["Library"];
    /** A list of library events for this user */
    libraryEvents: GraphQLTypes["LibraryEventConnection"];
    /** The user's general location */
    location?: string | undefined | null;
    /** Media reactions written by this user. */
    mediaReactions: GraphQLTypes["MediaReactionConnection"];
    /** A non-unique publicly visible name for the profile. Minimum of 3 characters and any valid Unicode character */
    name: string;
    /** Post pinned to the user profile */
    pinnedPost?: GraphQLTypes["Post"] | undefined | null;
    /** All posts this profile has made. */
    posts: GraphQLTypes["PostConnection"];
    /** The message this user has submitted to the Hall of Fame */
    proMessage?: string | undefined | null;
    /** The PRO level the user currently has */
    proTier?: GraphQLTypes["ProTierEnum"] | undefined | null;
    /** Reviews created by this user */
    reviews?: GraphQLTypes["ReviewConnection"] | undefined | null;
    /** Links to the user on other (social media) sites. */
    siteLinks?: GraphQLTypes["SiteLinkConnection"] | undefined | null;
    /** The URL-friendly identifier for this profile */
    slug?: string | undefined | null;
    /** The different stats we calculate for this user. */
    stats: GraphQLTypes["ProfileStats"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** A fully qualified URL to the profile */
    url?: string | undefined | null;
    /** The character this profile has declared as their waifu or husbando */
    waifu?: GraphQLTypes["Character"] | undefined | null;
    /** The properly-gendered term for the user's waifu. This should normally only be 'Waifu' or 'Husbando' but some people are jerks, including the person who wrote this... */
    waifuOrHusbando?: string | undefined | null;
    /** Wiki submissions created by this user */
    wikiSubmissions: GraphQLTypes["WikiSubmissionConnection"];
    "...on Profile": Omit<GraphQLTypes["Profile"], "...on Profile">;
  };
  /** The connection type for Profile. */
  ProfileConnection: {
    __typename: "ProfileConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["ProfileEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["Profile"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on ProfileConnection": Omit<
      GraphQLTypes["ProfileConnection"],
      "...on ProfileConnection"
    >;
  };
  /** An edge in a connection. */
  ProfileEdge: {
    __typename: "ProfileEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Profile"] | undefined | null;
    "...on ProfileEdge": Omit<GraphQLTypes["ProfileEdge"], "...on ProfileEdge">;
  };
  /** Autogenerated return type of ProfileLinkCreate. */
  ProfileLinkCreatePayload: {
    __typename: "ProfileLinkCreatePayload";
    errors?:
      | Array<GraphQLTypes["ProfileLinkCreateErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["SiteLink"] | undefined | null;
    "...on ProfileLinkCreatePayload": Omit<
      GraphQLTypes["ProfileLinkCreatePayload"],
      "...on ProfileLinkCreatePayload"
    >;
  };
  /** Autogenerated return type of ProfileLinkDelete. */
  ProfileLinkDeletePayload: {
    __typename: "ProfileLinkDeletePayload";
    errors?:
      | Array<GraphQLTypes["ProfileLinkDeleteErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["SiteLink"] | undefined | null;
    "...on ProfileLinkDeletePayload": Omit<
      GraphQLTypes["ProfileLinkDeletePayload"],
      "...on ProfileLinkDeletePayload"
    >;
  };
  ProfileLinkMutations: {
    __typename: "ProfileLinkMutations";
    /** Add a profile link. */
    create?: GraphQLTypes["ProfileLinkCreatePayload"] | undefined | null;
    /** Delete a profile link. */
    delete?: GraphQLTypes["ProfileLinkDeletePayload"] | undefined | null;
    /** Update a profile link. */
    update?: GraphQLTypes["ProfileLinkUpdatePayload"] | undefined | null;
    "...on ProfileLinkMutations": Omit<
      GraphQLTypes["ProfileLinkMutations"],
      "...on ProfileLinkMutations"
    >;
  };
  /** An external site that can be linked to a user. */
  ProfileLinkSite: {
    __typename: "ProfileLinkSite";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** Name of the external profile website. */
    name: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** Regex pattern used to validate the profile link. */
    validateFind: string;
    /** Pattern to be replaced after validation. */
    validateReplace: string;
    "...on ProfileLinkSite": Omit<
      GraphQLTypes["ProfileLinkSite"],
      "...on ProfileLinkSite"
    >;
  };
  /** Autogenerated return type of ProfileLinkUpdate. */
  ProfileLinkUpdatePayload: {
    __typename: "ProfileLinkUpdatePayload";
    errors?:
      | Array<GraphQLTypes["ProfileLinkUpdateErrorsUnion"]>
      | undefined
      | null;
    result?: GraphQLTypes["SiteLink"] | undefined | null;
    "...on ProfileLinkUpdatePayload": Omit<
      GraphQLTypes["ProfileLinkUpdatePayload"],
      "...on ProfileLinkUpdatePayload"
    >;
  };
  ProfileMutations: {
    __typename: "ProfileMutations";
    /** Update the profile of the current user. */
    update?: GraphQLTypes["ProfileUpdatePayload"] | undefined | null;
    "...on ProfileMutations": Omit<
      GraphQLTypes["ProfileMutations"],
      "...on ProfileMutations"
    >;
  };
  /** The different types of user stats that we calculate. */
  ProfileStats: {
    __typename: "ProfileStats";
    /** The total amount of anime you have watched over your whole life. */
    animeAmountConsumed: GraphQLTypes["AnimeAmountConsumed"];
    /** The breakdown of the different categories related to the anime you have completed */
    animeCategoryBreakdown: GraphQLTypes["AnimeCategoryBreakdown"];
    /** The total amount of manga you ahve read over your whole life. */
    mangaAmountConsumed: GraphQLTypes["MangaAmountConsumed"];
    /** The breakdown of the different categories related to the manga you have completed */
    mangaCategoryBreakdown: GraphQLTypes["MangaCategoryBreakdown"];
    "...on ProfileStats": Omit<
      GraphQLTypes["ProfileStats"],
      "...on ProfileStats"
    >;
  };
  /** Autogenerated return type of ProfileUpdate. */
  ProfileUpdatePayload: {
    __typename: "ProfileUpdatePayload";
    errors?: Array<GraphQLTypes["ProfileUpdateErrorsUnion"]> | undefined | null;
    result?: GraphQLTypes["Profile"] | undefined | null;
    "...on ProfileUpdatePayload": Omit<
      GraphQLTypes["ProfileUpdatePayload"],
      "...on ProfileUpdatePayload"
    >;
  };
  Query: {
    __typename: "Query";
    /** All Anime in the Kitsu database */
    anime: GraphQLTypes["AnimeConnection"];
    /** All Anime with specific Status */
    animeByStatus?: GraphQLTypes["AnimeConnection"] | undefined | null;
    /** All blocked user of the current account. */
    blocks?: GraphQLTypes["BlockConnection"] | undefined | null;
    /** All Categories in the Kitsu Database */
    categories?: GraphQLTypes["CategoryConnection"] | undefined | null;
    /** Kitsu account details. You must supply an Authorization token in header. */
    currentAccount?: GraphQLTypes["Account"] | undefined | null;
    /** Your Kitsu profile. You must supply an Authorization token in header. */
    currentProfile?: GraphQLTypes["Profile"] | undefined | null;
    /** Find a single Anime by ID */
    findAnimeById?: GraphQLTypes["Anime"] | undefined | null;
    /** Find a single Anime by Slug */
    findAnimeBySlug?: GraphQLTypes["Anime"] | undefined | null;
    /** Find a single Category by ID */
    findCategoryById?: GraphQLTypes["Category"] | undefined | null;
    /** Find a single Category by Slug */
    findCategoryBySlug?: GraphQLTypes["Category"] | undefined | null;
    /** Find a single Manga Chapter by ID */
    findChapterById?: GraphQLTypes["Chapter"] | undefined | null;
    /** Find a single Character by ID */
    findCharacterById?: GraphQLTypes["Character"] | undefined | null;
    /** Find a single Character by Slug */
    findCharacterBySlug?: GraphQLTypes["Character"] | undefined | null;
    /** Find a single Library Entry by ID */
    findLibraryEntryById?: GraphQLTypes["LibraryEntry"] | undefined | null;
    /** Find a single Library Event by ID */
    findLibraryEventById?: GraphQLTypes["LibraryEvent"] | undefined | null;
    /** Find a single Manga by ID */
    findMangaById?: GraphQLTypes["Manga"] | undefined | null;
    /** Find a single Manga by Slug */
    findMangaBySlug?: GraphQLTypes["Manga"] | undefined | null;
    /** Find a single Media by ID and Type */
    findMediaByIdAndType?: GraphQLTypes["Media"] | undefined | null;
    /** Find a single Person by ID */
    findPersonById?: GraphQLTypes["Person"] | undefined | null;
    /** Find a single Person by Slug */
    findPersonBySlug?: GraphQLTypes["Person"] | undefined | null;
    /** Find a single Post by ID */
    findPostById?: GraphQLTypes["Post"] | undefined | null;
    /** Find a single User by ID */
    findProfileById?: GraphQLTypes["Profile"] | undefined | null;
    /** Find a single User by Slug */
    findProfileBySlug?: GraphQLTypes["Profile"] | undefined | null;
    /** Find a single Report by ID */
    findReportById?: GraphQLTypes["Report"] | undefined | null;
    /** Find a single Wiki Submission by ID */
    findWikiSubmissionById?: GraphQLTypes["WikiSubmission"] | undefined | null;
    /** All Franchise in the Kitsu database */
    franchises?: GraphQLTypes["FranchiseConnection"] | undefined | null;
    /** List trending media on Kitsu */
    globalTrending: GraphQLTypes["MediaConnection"];
    /** List of Library Entries by MediaType and MediaId */
    libraryEntriesByMedia?:
      | GraphQLTypes["LibraryEntryConnection"]
      | undefined
      | null;
    /** List of Library Entries by MediaType */
    libraryEntriesByMediaType?:
      | GraphQLTypes["LibraryEntryConnection"]
      | undefined
      | null;
    /** List trending media within your network */
    localTrending: GraphQLTypes["MediaConnection"];
    /** Find a specific Mapping Item by External ID and External Site. */
    lookupMapping?: GraphQLTypes["MappingItemUnion"] | undefined | null;
    /** All Manga in the Kitsu database */
    manga: GraphQLTypes["MangaConnection"];
    /** All Manga with specific Status */
    mangaByStatus?: GraphQLTypes["MangaConnection"] | undefined | null;
    /** Patrons sorted by a Proprietary Magic Algorithm */
    patrons: GraphQLTypes["ProfileConnection"];
    /** Random anime or manga */
    randomMedia: GraphQLTypes["Media"];
    /** All Reports in the Kitsu database */
    reports?: GraphQLTypes["ReportConnection"] | undefined | null;
    /** Select all Reports that match with a supplied status. */
    reportsByStatus?: GraphQLTypes["ReportConnection"] | undefined | null;
    /** Search for Anime by title using Algolia. The most relevant results will be at the top. */
    searchAnimeByTitle: GraphQLTypes["AnimeConnection"];
    /** Search for Manga by title using Algolia. The most relevant results will be at the top. */
    searchMangaByTitle: GraphQLTypes["MangaConnection"];
    /** Search for any media (Anime, Manga) by title using Algolia. If no media_type is supplied, it will search for both. The most relevant results will be at the top. */
    searchMediaByTitle: GraphQLTypes["MediaConnection"];
    /** Search for User by username using Algolia. The most relevant results will be at the top. */
    searchProfileByUsername?:
      | GraphQLTypes["ProfileConnection"]
      | undefined
      | null;
    /** Get your current session info */
    session: GraphQLTypes["Session"];
    /** Select all Wiki Submissions that match with a supplied status. */
    wikiSubmissionsByStatuses?:
      | GraphQLTypes["WikiSubmissionConnection"]
      | undefined
      | null;
    "...on Query": Omit<GraphQLTypes["Query"], "...on Query">;
  };
  /** A quote from a media */
  Quote: {
    __typename: "Quote";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The lines of the quote */
    lines: GraphQLTypes["QuoteLineConnection"];
    /** The media this quote is excerpted from */
    media: GraphQLTypes["Media"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Quote": Omit<GraphQLTypes["Quote"], "...on Quote">;
  };
  /** The connection type for Quote. */
  QuoteConnection: {
    __typename: "QuoteConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["QuoteEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Quote"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on QuoteConnection": Omit<
      GraphQLTypes["QuoteConnection"],
      "...on QuoteConnection"
    >;
  };
  /** An edge in a connection. */
  QuoteEdge: {
    __typename: "QuoteEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Quote"] | undefined | null;
    "...on QuoteEdge": Omit<GraphQLTypes["QuoteEdge"], "...on QuoteEdge">;
  };
  /** A line in a quote */
  QuoteLine: {
    __typename: "QuoteLine";
    /** The character who said this line */
    character: GraphQLTypes["Character"];
    /** The line that was spoken */
    content: string;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The quote this line is in */
    quote: GraphQLTypes["Quote"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on QuoteLine": Omit<GraphQLTypes["QuoteLine"], "...on QuoteLine">;
  };
  /** The connection type for QuoteLine. */
  QuoteLineConnection: {
    __typename: "QuoteLineConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["QuoteLineEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["QuoteLine"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on QuoteLineConnection": Omit<
      GraphQLTypes["QuoteLineConnection"],
      "...on QuoteLineConnection"
    >;
  };
  /** An edge in a connection. */
  QuoteLineEdge: {
    __typename: "QuoteLineEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["QuoteLine"] | undefined | null;
    "...on QuoteLineEdge": Omit<
      GraphQLTypes["QuoteLineEdge"],
      "...on QuoteLineEdge"
    >;
  };
  /** A report made by a user */
  Report: {
    __typename: "Report";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Additional information related to why the report was made */
    explanation?: string | undefined | null;
    id: GraphQLTypes["ID"];
    /** The moderator who responded to this report */
    moderator?: GraphQLTypes["Profile"] | undefined | null;
    /** The entity that the report is related to */
    naughty?: GraphQLTypes["ReportItemUnion"] | undefined | null;
    /** The reason for why the report was made */
    reason: GraphQLTypes["ReportReasonEnum"];
    /** The user who made this report */
    reporter: GraphQLTypes["Profile"];
    /** The resolution status for this report */
    status: GraphQLTypes["ReportStatusEnum"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Report": Omit<GraphQLTypes["Report"], "...on Report">;
  };
  /** The connection type for Report. */
  ReportConnection: {
    __typename: "ReportConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["ReportEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Report"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on ReportConnection": Omit<
      GraphQLTypes["ReportConnection"],
      "...on ReportConnection"
    >;
  };
  /** An edge in a connection. */
  ReportEdge: {
    __typename: "ReportEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Report"] | undefined | null;
    "...on ReportEdge": Omit<GraphQLTypes["ReportEdge"], "...on ReportEdge">;
  };
  /** A media review made by a user */
  Review: {
    __typename: "Review";
    /** The author who wrote this review. */
    author: GraphQLTypes["Profile"];
    /** The review data */
    content: string;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The review data formatted */
    formattedContent: string;
    id: GraphQLTypes["ID"];
    /** Does this review contain spoilers from the media */
    isSpoiler: boolean;
    /** The library entry related to this review. */
    libraryEntry: GraphQLTypes["LibraryEntry"];
    /** Users who liked this review */
    likes: GraphQLTypes["ProfileConnection"];
    /** The media related to this review. */
    media: GraphQLTypes["Media"];
    /** When this review was written based on media progress. */
    progress: number;
    /** The user rating for this media */
    rating: number;
    /** Potentially migrated over from hummingbird. */
    source: string;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Review": Omit<GraphQLTypes["Review"], "...on Review">;
  };
  /** The connection type for Review. */
  ReviewConnection: {
    __typename: "ReviewConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["ReviewEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Review"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on ReviewConnection": Omit<
      GraphQLTypes["ReviewConnection"],
      "...on ReviewConnection"
    >;
  };
  /** An edge in a connection. */
  ReviewEdge: {
    __typename: "ReviewEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Review"] | undefined | null;
    "...on ReviewEdge": Omit<GraphQLTypes["ReviewEdge"], "...on ReviewEdge">;
  };
  /** Information about a user session */
  Session: {
    __typename: "Session";
    /** The account associated with this session */
    account?: GraphQLTypes["Account"] | undefined | null;
    /** Single sign-on token for Nolt */
    noltToken: string;
    /** The profile associated with this session */
    profile?: GraphQLTypes["Profile"] | undefined | null;
    "...on Session": Omit<GraphQLTypes["Session"], "...on Session">;
  };
  /** A link to a user's profile on an external site. */
  SiteLink: {
    __typename: "SiteLink";
    /** The user profile the site is linked to. */
    author: GraphQLTypes["Profile"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The actual linked website. */
    site: GraphQLTypes["ProfileLinkSite"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** A fully qualified URL of the user profile on an external site. */
    url: string;
    "...on SiteLink": Omit<GraphQLTypes["SiteLink"], "...on SiteLink">;
  };
  /** The connection type for SiteLink. */
  SiteLinkConnection: {
    __typename: "SiteLinkConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["SiteLinkEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["SiteLink"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on SiteLinkConnection": Omit<
      GraphQLTypes["SiteLinkConnection"],
      "...on SiteLinkConnection"
    >;
  };
  /** An edge in a connection. */
  SiteLinkEdge: {
    __typename: "SiteLinkEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["SiteLink"] | undefined | null;
    "...on SiteLinkEdge": Omit<
      GraphQLTypes["SiteLinkEdge"],
      "...on SiteLinkEdge"
    >;
  };
  /** The streaming company. */
  Streamer: {
    __typename: "Streamer";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    id: GraphQLTypes["ID"];
    /** The name of the site that is streaming this media. */
    siteName: string;
    /** Additional media this site is streaming. */
    streamingLinks: GraphQLTypes["StreamingLinkConnection"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** Videos of the media being streamed. */
    videos: GraphQLTypes["VideoConnection"];
    "...on Streamer": Omit<GraphQLTypes["Streamer"], "...on Streamer">;
  };
  /** The stream link. */
  StreamingLink: {
    __typename: "StreamingLink";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Spoken language is replaced by language of choice. */
    dubs: Array<string>;
    id: GraphQLTypes["ID"];
    /** The media being streamed */
    media: GraphQLTypes["Media"];
    /** Which regions this video is available in. */
    regions: Array<string>;
    /** The site that is streaming this media. */
    streamer: GraphQLTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs: Array<string>;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** Fully qualified URL for the streaming link. */
    url: string;
    "...on StreamingLink": Omit<
      GraphQLTypes["StreamingLink"],
      "...on StreamingLink"
    >;
  };
  /** The connection type for StreamingLink. */
  StreamingLinkConnection: {
    __typename: "StreamingLinkConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["StreamingLinkEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["StreamingLink"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on StreamingLinkConnection": Omit<
      GraphQLTypes["StreamingLinkConnection"],
      "...on StreamingLinkConnection"
    >;
  };
  /** An edge in a connection. */
  StreamingLinkEdge: {
    __typename: "StreamingLinkEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["StreamingLink"] | undefined | null;
    "...on StreamingLinkEdge": Omit<
      GraphQLTypes["StreamingLinkEdge"],
      "...on StreamingLinkEdge"
    >;
  };
  TitlesList: {
    __typename: "TitlesList";
    /** A list of additional, alternative, abbreviated, or unofficial titles */
    alternatives?: Array<string> | undefined | null;
    /** The official or de facto international title */
    canonical: string;
    /** The locale code that identifies which title is used as the canonical title */
    canonicalLocale?: string | undefined | null;
    /** The list of localized titles keyed by locale */
    localized: GraphQLTypes["Map"];
    /** The original title of the media in the original language */
    original?: string | undefined | null;
    /** The locale code that identifies which title is used as the original title */
    originalLocale?: string | undefined | null;
    /** The title that best matches the user's preferred settings */
    preferred: string;
    /** The original title, romanized into latin script */
    romanized?: string | undefined | null;
    /** The locale code that identifies which title is used as the romanized title */
    romanizedLocale?: string | undefined | null;
    /** The title translated into the user's locale */
    translated?: string | undefined | null;
    /** The locale code that identifies which title is used as the translated title */
    translatedLocale?: string | undefined | null;
    "...on TitlesList": Omit<GraphQLTypes["TitlesList"], "...on TitlesList">;
  };
  /** The mutation failed validation. This is usually because the input provided was invalid in some way, such as a missing required field or an invalid value for a field. There may be multiple of this error, one for each failed validation, and the `path` will generally refer to a location in the input parameters, that you can map back to the input fields in your form. The recommended action is to display validation errors to the user, and allow them to correct the input and resubmit. */
  ValidationError: {
    __typename: "ValidationError";
    /** The error code. */
    code?: string | undefined | null;
    /** A description of the error */
    message: string;
    /** Which input value this error came from */
    path?: Array<string> | undefined | null;
    "...on ValidationError": Omit<
      GraphQLTypes["ValidationError"],
      "...on ValidationError"
    >;
  };
  /** The media video. */
  Video: {
    __typename: "Video";
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** Spoken language is replaced by language of choice. */
    dubs: Array<string>;
    /** The episode of this video */
    episode: GraphQLTypes["Episode"];
    id: GraphQLTypes["ID"];
    /** Which regions this video is available in. */
    regions: Array<string>;
    /** The site that is streaming this media. */
    streamer: GraphQLTypes["Streamer"];
    /** Languages this is translated to. Usually placed at bottom of media. */
    subs: Array<string>;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    /** The url of the video. */
    url: string;
    "...on Video": Omit<GraphQLTypes["Video"], "...on Video">;
  };
  /** The connection type for Video. */
  VideoConnection: {
    __typename: "VideoConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["VideoEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Video"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on VideoConnection": Omit<
      GraphQLTypes["VideoConnection"],
      "...on VideoConnection"
    >;
  };
  /** An edge in a connection. */
  VideoEdge: {
    __typename: "VideoEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Video"] | undefined | null;
    "...on VideoEdge": Omit<GraphQLTypes["VideoEdge"], "...on VideoEdge">;
  };
  /** A manga volume which can contain multiple chapters. */
  Volume: {
    __typename: "Volume";
    /** The chapters in this volume. */
    chapters?: GraphQLTypes["ChapterConnection"] | undefined | null;
    /** The number of chapters in this volume. */
    chaptersCount?: number | undefined | null;
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** A brief summary or description of the unit */
    description: GraphQLTypes["Map"];
    id: GraphQLTypes["ID"];
    /** The isbn number of this volume. */
    isbn: Array<string>;
    /** The manga this volume is in. */
    manga: GraphQLTypes["Manga"];
    /** The sequence number of this unit */
    number: number;
    /** The date when this chapter was released. */
    published?: GraphQLTypes["ISO8601Date"] | undefined | null;
    /** A thumbnail image for the unit */
    thumbnail?: GraphQLTypes["Image"] | undefined | null;
    /** The titles for this unit in various locales */
    titles: GraphQLTypes["TitlesList"];
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on Volume": Omit<GraphQLTypes["Volume"], "...on Volume">;
  };
  /** The connection type for Volume. */
  VolumeConnection: {
    __typename: "VolumeConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["VolumeEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?: Array<GraphQLTypes["Volume"] | undefined | null> | undefined | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on VolumeConnection": Omit<
      GraphQLTypes["VolumeConnection"],
      "...on VolumeConnection"
    >;
  };
  /** An edge in a connection. */
  VolumeEdge: {
    __typename: "VolumeEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["Volume"] | undefined | null;
    "...on VolumeEdge": Omit<GraphQLTypes["VolumeEdge"], "...on VolumeEdge">;
  };
  /** A Wiki Submission is used to either create or edit existing data in our database. This will allow a simple and convient way for users to submit issues/corrections without all the work being left to the mods. */
  WikiSubmission: {
    __typename: "WikiSubmission";
    /** The user who created this draft */
    author: GraphQLTypes["Profile"];
    createdAt: GraphQLTypes["ISO8601DateTime"];
    /** The full object that holds all the details for any modifications/additions/deletions made to the entity you are editing. This will be validated using JSON Schema. */
    data?: GraphQLTypes["JSON"] | undefined | null;
    id: GraphQLTypes["ID"];
    /** Any additional information that may need to be provided related to the Wiki Submission */
    notes?: string | undefined | null;
    /** The status of the Wiki Submission */
    status: GraphQLTypes["WikiSubmissionStatusEnum"];
    /** The title given to the Wiki Submission. This will default to the title of what is being edited. */
    title?: string | undefined | null;
    updatedAt: GraphQLTypes["ISO8601DateTime"];
    "...on WikiSubmission": Omit<
      GraphQLTypes["WikiSubmission"],
      "...on WikiSubmission"
    >;
  };
  /** The connection type for WikiSubmission. */
  WikiSubmissionConnection: {
    __typename: "WikiSubmissionConnection";
    /** A list of edges. */
    edges?:
      | Array<GraphQLTypes["WikiSubmissionEdge"] | undefined | null>
      | undefined
      | null;
    /** A list of nodes. */
    nodes?:
      | Array<GraphQLTypes["WikiSubmission"] | undefined | null>
      | undefined
      | null;
    /** Information to aid in pagination. */
    pageInfo: GraphQLTypes["PageInfo"];
    /** The total amount of nodes. */
    totalCount: number;
    "...on WikiSubmissionConnection": Omit<
      GraphQLTypes["WikiSubmissionConnection"],
      "...on WikiSubmissionConnection"
    >;
  };
  /** Autogenerated return type of WikiSubmissionCreateDraft. */
  WikiSubmissionCreateDraftPayload: {
    __typename: "WikiSubmissionCreateDraftPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    wikiSubmission?: GraphQLTypes["WikiSubmission"] | undefined | null;
    "...on WikiSubmissionCreateDraftPayload": Omit<
      GraphQLTypes["WikiSubmissionCreateDraftPayload"],
      "...on WikiSubmissionCreateDraftPayload"
    >;
  };
  /** An edge in a connection. */
  WikiSubmissionEdge: {
    __typename: "WikiSubmissionEdge";
    /** A cursor for use in pagination. */
    cursor: string;
    /** The item at the end of the edge. */
    node?: GraphQLTypes["WikiSubmission"] | undefined | null;
    "...on WikiSubmissionEdge": Omit<
      GraphQLTypes["WikiSubmissionEdge"],
      "...on WikiSubmissionEdge"
    >;
  };
  WikiSubmissionMutations: {
    __typename: "WikiSubmissionMutations";
    /** Create a wiki submission draft */
    createDraft?:
      | GraphQLTypes["WikiSubmissionCreateDraftPayload"]
      | undefined
      | null;
    /** Submit a wiki submission draft */
    submitDraft?:
      | GraphQLTypes["WikiSubmissionSubmitDraftPayload"]
      | undefined
      | null;
    /** Update a wiki submission draft */
    updateDraft?:
      | GraphQLTypes["WikiSubmissionUpdateDraftPayload"]
      | undefined
      | null;
    "...on WikiSubmissionMutations": Omit<
      GraphQLTypes["WikiSubmissionMutations"],
      "...on WikiSubmissionMutations"
    >;
  };
  /** Autogenerated return type of WikiSubmissionSubmitDraft. */
  WikiSubmissionSubmitDraftPayload: {
    __typename: "WikiSubmissionSubmitDraftPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    wikiSubmission?: GraphQLTypes["WikiSubmission"] | undefined | null;
    "...on WikiSubmissionSubmitDraftPayload": Omit<
      GraphQLTypes["WikiSubmissionSubmitDraftPayload"],
      "...on WikiSubmissionSubmitDraftPayload"
    >;
  };
  /** Autogenerated return type of WikiSubmissionUpdateDraft. */
  WikiSubmissionUpdateDraftPayload: {
    __typename: "WikiSubmissionUpdateDraftPayload";
    errors?: Array<GraphQLTypes["Error"]> | undefined | null;
    wikiSubmission?: GraphQLTypes["WikiSubmission"] | undefined | null;
    "...on WikiSubmissionUpdateDraftPayload": Omit<
      GraphQLTypes["WikiSubmissionUpdateDraftPayload"],
      "...on WikiSubmissionUpdateDraftPayload"
    >;
  };
  AgeRatingEnum: AgeRatingEnum;
  AnimeSubtypeEnum: AnimeSubtypeEnum;
  ChapterSortEnum: ChapterSortEnum;
  CharacterRoleEnum: CharacterRoleEnum;
  CharacterVoiceSortEnum: CharacterVoiceSortEnum;
  CommentLikeSortEnum: CommentLikeSortEnum;
  CommentSortEnum: CommentSortEnum;
  EpisodeSortEnum: EpisodeSortEnum;
  ExternalIdentityProviderEnum: ExternalIdentityProviderEnum;
  FavoriteEnum: FavoriteEnum;
  FollowSortEnum: FollowSortEnum;
  InstallmentSortEnum: InstallmentSortEnum;
  InstallmentTagEnum: InstallmentTagEnum;
  LibraryEntrySortEnum: LibraryEntrySortEnum;
  LibraryEntryStatusEnum: LibraryEntryStatusEnum;
  LibraryEventKindEnum: LibraryEventKindEnum;
  LibraryEventSortEnum: LibraryEventSortEnum;
  LockedReasonEnum: LockedReasonEnum;
  MangaSubtypeEnum: MangaSubtypeEnum;
  MappingExternalSiteEnum: MappingExternalSiteEnum;
  MappingItemEnum: MappingItemEnum;
  MediaCategorySortEnum: MediaCategorySortEnum;
  MediaCharacterSortEnum: MediaCharacterSortEnum;
  MediaProductionRoleEnum: MediaProductionRoleEnum;
  MediaReactionSortEnum: MediaReactionSortEnum;
  MediaReactionVoteSortEnum: MediaReactionVoteSortEnum;
  /** The relationship kind from one media entry to another */
  MediaRelationshipKindEnum: MediaRelationshipKindEnum;
  /** これはアニメやマンガです */
  MediaTypeEnum: MediaTypeEnum;
  PostLikeSortEnum: PostLikeSortEnum;
  PostSortEnum: PostSortEnum;
  ProTierEnum: ProTierEnum;
  ProfileLinksSitesEnum: ProfileLinksSitesEnum;
  RatingSystemEnum: RatingSystemEnum;
  RecurringBillingServiceEnum: RecurringBillingServiceEnum;
  ReleaseSeasonEnum: ReleaseSeasonEnum;
  ReleaseStatusEnum: ReleaseStatusEnum;
  ReportReasonEnum: ReportReasonEnum;
  ReportStatusEnum: ReportStatusEnum;
  SfwFilterPreferenceEnum: SfwFilterPreferenceEnum;
  SitePermissionEnum: SitePermissionEnum;
  SiteThemeEnum: SiteThemeEnum;
  SortDirection: SortDirection;
  TitleLanguagePreferenceEnum: TitleLanguagePreferenceEnum;
  VolumeSortEnum: VolumeSortEnum;
  WaifuOrHusbandoEnum: WaifuOrHusbandoEnum;
  WikiSubmissionSortEnum: WikiSubmissionSortEnum;
  WikiSubmissionStatusEnum: WikiSubmissionStatusEnum;
  /** A date, expressed as an ISO8601 string */
  Date: "scalar" & { name: "Date" };
  /** An ISO 8601-encoded date */
  ISO8601Date: "scalar" & { name: "ISO8601Date" };
  /** An ISO 8601-encoded datetime */
  ISO8601DateTime: "scalar" & { name: "ISO8601DateTime" };
  /** Represents untyped JSON */
  JSON: "scalar" & { name: "JSON" };
  /** A loose key-value map in GraphQL */
  Map: "scalar" & { name: "Map" };
  Upload: "scalar" & { name: "Upload" };
  AccountChangePasswordInput: {
    /** The new password to set */
    newPassword: string;
    /** The current, existing password for the account */
    oldPassword: string;
  };
  AccountCreateInput: {
    /** The email address to reset the password for */
    email: string;
    /** An external identity to associate with the account on creation */
    externalIdentity?:
      | GraphQLTypes["AccountExternalIdentityInput"]
      | undefined
      | null;
    /** The name of the user */
    name: string;
    /** The password for the user */
    password: string;
  };
  AccountExternalIdentityInput: {
    id: string;
    provider: GraphQLTypes["ExternalIdentityProviderEnum"];
  };
  AccountUpdateInput: {
    /** The country of the user */
    country?: string | undefined | null;
    /** How media titles will get visualized */
    preferredTitleLanguage?:
      | GraphQLTypes["TitleLanguagePreferenceEnum"]
      | undefined
      | null;
    /** The preferred rating system */
    ratingSystem?: GraphQLTypes["RatingSystemEnum"] | undefined | null;
    /** The SFW Filter setting */
    sfwFilterPreference?:
      | GraphQLTypes["SfwFilterPreferenceEnum"]
      | undefined
      | null;
    /** The theme displayed on Kitsu */
    siteTheme?: GraphQLTypes["SiteThemeEnum"] | undefined | null;
    /** The time zone of the user */
    timeZone?: string | undefined | null;
  };
  AnimeCreateInput: {
    ageRating?: GraphQLTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: GraphQLTypes["Upload"] | undefined | null;
    description: GraphQLTypes["Map"];
    endDate?: GraphQLTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    posterImage?: GraphQLTypes["Upload"] | undefined | null;
    startDate?: GraphQLTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles: GraphQLTypes["TitlesListInput"];
    youtubeTrailerVideoId?: string | undefined | null;
  };
  AnimeUpdateInput: {
    ageRating?: GraphQLTypes["AgeRatingEnum"] | undefined | null;
    ageRatingGuide?: string | undefined | null;
    bannerImage?: GraphQLTypes["Upload"] | undefined | null;
    description?: GraphQLTypes["Map"] | undefined | null;
    endDate?: GraphQLTypes["Date"] | undefined | null;
    episodeCount?: number | undefined | null;
    episodeLength?: number | undefined | null;
    id: GraphQLTypes["ID"];
    posterImage?: GraphQLTypes["Upload"] | undefined | null;
    startDate?: GraphQLTypes["Date"] | undefined | null;
    tba?: string | undefined | null;
    titles?: GraphQLTypes["TitlesListInput"] | undefined | null;
    youtubeTrailerVideoId?: string | undefined | null;
  };
  BlockCreateInput: {
    /** The id of the user to block. */
    blockedId: GraphQLTypes["ID"];
  };
  BlockDeleteInput: {
    /** The id of the block. */
    blockId: GraphQLTypes["ID"];
  };
  ChapterSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["ChapterSortEnum"];
  };
  CharacterVoiceSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["CharacterVoiceSortEnum"];
  };
  CommentLikeSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["CommentLikeSortEnum"];
  };
  CommentSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["CommentSortEnum"];
  };
  EpisodeCreateInput: {
    description?: GraphQLTypes["Map"] | undefined | null;
    length?: number | undefined | null;
    mediaId: GraphQLTypes["ID"];
    mediaType: GraphQLTypes["MediaTypeEnum"];
    number: number;
    releasedAt?: GraphQLTypes["Date"] | undefined | null;
    thumbnailImage?: GraphQLTypes["Upload"] | undefined | null;
    titles: GraphQLTypes["TitlesListInput"];
  };
  EpisodeSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["EpisodeSortEnum"];
  };
  EpisodeUpdateInput: {
    description?: GraphQLTypes["Map"] | undefined | null;
    id: GraphQLTypes["ID"];
    length?: number | undefined | null;
    number?: number | undefined | null;
    releasedAt?: GraphQLTypes["Date"] | undefined | null;
    thumbnailImage?: GraphQLTypes["Upload"] | undefined | null;
    titles?: GraphQLTypes["TitlesListInput"] | undefined | null;
  };
  FavoriteCreateInput: {
    /** The id of the entry */
    id: GraphQLTypes["ID"];
    /** The type of the entry. */
    type: GraphQLTypes["FavoriteEnum"];
  };
  FavoriteDeleteInput: {
    /** The id of the favorite entry. */
    favoriteId: GraphQLTypes["ID"];
  };
  FollowSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["FollowSortEnum"];
  };
  GenericDeleteInput: {
    id: GraphQLTypes["ID"];
  };
  InstallmentSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["InstallmentSortEnum"];
  };
  LibraryEntryCreateInput: {
    finishedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    mediaId: GraphQLTypes["ID"];
    mediaType: GraphQLTypes["MediaTypeEnum"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    status: GraphQLTypes["LibraryEntryStatusEnum"];
    volumesOwned?: number | undefined | null;
  };
  LibraryEntrySortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["LibraryEntrySortEnum"];
  };
  LibraryEntryUpdateInput: {
    finishedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    id: GraphQLTypes["ID"];
    notes?: string | undefined | null;
    private?: boolean | undefined | null;
    progress?: number | undefined | null;
    rating?: number | undefined | null;
    reconsumeCount?: number | undefined | null;
    reconsuming?: boolean | undefined | null;
    startedAt?: GraphQLTypes["ISO8601DateTime"] | undefined | null;
    status?: GraphQLTypes["LibraryEntryStatusEnum"] | undefined | null;
    volumesOwned?: number | undefined | null;
  };
  LibraryEntryUpdateProgressByIdInput: {
    id: GraphQLTypes["ID"];
    progress: number;
  };
  LibraryEntryUpdateProgressByMediaInput: {
    mediaId: GraphQLTypes["ID"];
    mediaType: GraphQLTypes["MediaTypeEnum"];
    progress: number;
  };
  LibraryEntryUpdateRatingByIdInput: {
    id: GraphQLTypes["ID"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateRatingByMediaInput: {
    mediaId: GraphQLTypes["ID"];
    mediaType: GraphQLTypes["MediaTypeEnum"];
    /** A number between 2 - 20 */
    rating: number;
  };
  LibraryEntryUpdateStatusByIdInput: {
    id: GraphQLTypes["ID"];
    status: GraphQLTypes["LibraryEntryStatusEnum"];
  };
  LibraryEntryUpdateStatusByMediaInput: {
    mediaId: GraphQLTypes["ID"];
    mediaType: GraphQLTypes["MediaTypeEnum"];
    status: GraphQLTypes["LibraryEntryStatusEnum"];
  };
  LibraryEventSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["LibraryEventSortEnum"];
  };
  MappingCreateInput: {
    externalId: GraphQLTypes["ID"];
    externalSite: GraphQLTypes["MappingExternalSiteEnum"];
    itemId: GraphQLTypes["ID"];
    itemType: GraphQLTypes["MappingItemEnum"];
  };
  MappingUpdateInput: {
    externalId?: GraphQLTypes["ID"] | undefined | null;
    externalSite?: GraphQLTypes["MappingExternalSiteEnum"] | undefined | null;
    id: GraphQLTypes["ID"];
    itemId?: GraphQLTypes["ID"] | undefined | null;
    itemType?: GraphQLTypes["MappingItemEnum"] | undefined | null;
  };
  MediaCategorySortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["MediaCategorySortEnum"];
  };
  MediaCharacterSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["MediaCharacterSortEnum"];
  };
  MediaReactionCreateInput: {
    /** The ID of the entry in your library to react to */
    libraryEntryId: GraphQLTypes["ID"];
    /** The text of the reaction to the media */
    reaction: string;
  };
  MediaReactionDeleteInput: {
    /** The reaction to delete */
    mediaReactionId: GraphQLTypes["ID"];
  };
  MediaReactionLikeInput: {
    /** The reaction to like */
    mediaReactionId: GraphQLTypes["ID"];
  };
  MediaReactionSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["MediaReactionSortEnum"];
  };
  MediaReactionUnlikeInput: {
    /** The reaction to remove your like from */
    mediaReactionId: GraphQLTypes["ID"];
  };
  MediaReactionVoteSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["MediaReactionVoteSortEnum"];
  };
  PostCreateInput: {
    content: string;
    isNsfw?: boolean | undefined | null;
    isSpoiler?: boolean | undefined | null;
    mediaId?: GraphQLTypes["ID"] | undefined | null;
    mediaType?: GraphQLTypes["MediaTypeEnum"] | undefined | null;
    spoiledUnitId?: GraphQLTypes["ID"] | undefined | null;
    spoiledUnitType?: string | undefined | null;
    targetUserId?: GraphQLTypes["ID"] | undefined | null;
  };
  PostLikeSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["PostLikeSortEnum"];
  };
  PostLockInput: {
    id: GraphQLTypes["ID"];
    lockedReason: GraphQLTypes["LockedReasonEnum"];
  };
  PostSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["PostSortEnum"];
  };
  PostUnlockInput: {
    id: GraphQLTypes["ID"];
  };
  ProfileLinkCreateInput: {
    /** The website. */
    profileLinkSite: GraphQLTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileLinkDeleteInput: {
    /** The profile link to delete */
    profileLink: GraphQLTypes["ProfileLinksSitesEnum"];
  };
  ProfileLinkUpdateInput: {
    /** The website. */
    profileLinkSite: GraphQLTypes["ProfileLinksSitesEnum"];
    /** The url of the profile link */
    url: string;
  };
  ProfileUpdateInput: {
    /** About section of the profile. */
    about?: string | undefined | null;
    /** The birthday of the user. */
    birthday?: GraphQLTypes["Date"] | undefined | null;
    /** The preferred gender of the user. */
    gender?: string | undefined | null;
    /** Your ID or the one of another user. */
    id?: GraphQLTypes["ID"] | undefined | null;
    /** The display name of the user */
    name?: string | undefined | null;
    /** The slug (@username) of the user */
    slug?: string | undefined | null;
    /** The id of the waifu or husbando. */
    waifuId?: GraphQLTypes["ID"] | undefined | null;
    /** The user preference of their partner. */
    waifuOrHusbando?: GraphQLTypes["WaifuOrHusbandoEnum"] | undefined | null;
  };
  TitlesListInput: {
    alternatives?: Array<string> | undefined | null;
    canonical?: string | undefined | null;
    canonicalLocale?: string | undefined | null;
    localized?: GraphQLTypes["Map"] | undefined | null;
  };
  VolumeSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["VolumeSortEnum"];
  };
  WikiSubmissionCreateDraftInput: {
    data: GraphQLTypes["JSON"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionSortOption: {
    direction: GraphQLTypes["SortDirection"];
    on: GraphQLTypes["WikiSubmissionSortEnum"];
  };
  WikiSubmissionSubmitDraftInput: {
    data: GraphQLTypes["JSON"];
    id: GraphQLTypes["ID"];
    notes?: string | undefined | null;
    title?: string | undefined | null;
  };
  WikiSubmissionUpdateDraftInput: {
    data: GraphQLTypes["JSON"];
    id: GraphQLTypes["ID"];
    notes?: string | undefined | null;
  };
  ID: "scalar" & { name: "ID" };
};
export enum AgeRatingEnum {
  G = "G",
  PG = "PG",
  R = "R",
  R18 = "R18",
}
export enum AnimeSubtypeEnum {
  MOVIE = "MOVIE",
  MUSIC = "MUSIC",
  ONA = "ONA",
  OVA = "OVA",
  SPECIAL = "SPECIAL",
  TV = "TV",
}
export enum ChapterSortEnum {
  CREATED_AT = "CREATED_AT",
  NUMBER = "NUMBER",
  UPDATED_AT = "UPDATED_AT",
}
export enum CharacterRoleEnum {
  BACKGROUND = "BACKGROUND",
  CAMEO = "CAMEO",
  MAIN = "MAIN",
  RECURRING = "RECURRING",
}
export enum CharacterVoiceSortEnum {
  CREATED_AT = "CREATED_AT",
  UPDATED_AT = "UPDATED_AT",
}
export enum CommentLikeSortEnum {
  CREATED_AT = "CREATED_AT",
  FOLLOWING = "FOLLOWING",
}
export enum CommentSortEnum {
  CREATED_AT = "CREATED_AT",
  FOLLOWING = "FOLLOWING",
  LIKES_COUNT = "LIKES_COUNT",
}
export enum EpisodeSortEnum {
  CREATED_AT = "CREATED_AT",
  NUMBER = "NUMBER",
  UPDATED_AT = "UPDATED_AT",
}
export enum ExternalIdentityProviderEnum {
  FACEBOOK = "FACEBOOK",
}
export enum FavoriteEnum {
  ANIME = "ANIME",
  CHARACTER = "CHARACTER",
  MANGA = "MANGA",
  PERSON = "PERSON",
}
export enum FollowSortEnum {
  CREATED_AT = "CREATED_AT",
  FOLLOWING_FOLLOWED = "FOLLOWING_FOLLOWED",
  FOLLOWING_FOLLOWER = "FOLLOWING_FOLLOWER",
}
export enum InstallmentSortEnum {
  ALTERNATIVE_ORDER = "ALTERNATIVE_ORDER",
  RELEASE_ORDER = "RELEASE_ORDER",
}
export enum InstallmentTagEnum {
  ALTERNATE_SETTING = "ALTERNATE_SETTING",
  ALTERNATE_VERSION = "ALTERNATE_VERSION",
  CROSSOVER = "CROSSOVER",
  MAIN_STORY = "MAIN_STORY",
  SIDE_STORY = "SIDE_STORY",
  SPINOFF = "SPINOFF",
}
export enum LibraryEntrySortEnum {
  CREATED_AT = "CREATED_AT",
  FINISHED_AT = "FINISHED_AT",
  MEDIA_TYPE = "MEDIA_TYPE",
  PROGRESS = "PROGRESS",
  RATING = "RATING",
  STARTED_AT = "STARTED_AT",
  STATUS = "STATUS",
  TITLE = "TITLE",
  UPDATED_AT = "UPDATED_AT",
}
export enum LibraryEntryStatusEnum {
  COMPLETED = "COMPLETED",
  CURRENT = "CURRENT",
  DROPPED = "DROPPED",
  ON_HOLD = "ON_HOLD",
  PLANNED = "PLANNED",
}
export enum LibraryEventKindEnum {
  ANNOTATED = "ANNOTATED",
  PROGRESSED = "PROGRESSED",
  RATED = "RATED",
  REACTED = "REACTED",
  UPDATED = "UPDATED",
}
export enum LibraryEventSortEnum {
  CREATED_AT = "CREATED_AT",
  UPDATED_AT = "UPDATED_AT",
}
export enum LockedReasonEnum {
  CLOSED = "CLOSED",
  SPAM = "SPAM",
  TOO_HEATED = "TOO_HEATED",
}
export enum MangaSubtypeEnum {
  DOUJIN = "DOUJIN",
  MANGA = "MANGA",
  MANHUA = "MANHUA",
  MANHWA = "MANHWA",
  NOVEL = "NOVEL",
  OEL = "OEL",
  ONESHOT = "ONESHOT",
}
export enum MappingExternalSiteEnum {
  ANIDB = "ANIDB",
  ANILIST_ANIME = "ANILIST_ANIME",
  ANILIST_MANGA = "ANILIST_MANGA",
  ANIMENEWSNETWORK = "ANIMENEWSNETWORK",
  AOZORA = "AOZORA",
  HULU = "HULU",
  IMDB_EPISODES = "IMDB_EPISODES",
  MANGAUPDATES = "MANGAUPDATES",
  MYANIMELIST_ANIME = "MYANIMELIST_ANIME",
  MYANIMELIST_CHARACTERS = "MYANIMELIST_CHARACTERS",
  MYANIMELIST_MANGA = "MYANIMELIST_MANGA",
  MYANIMELIST_PEOPLE = "MYANIMELIST_PEOPLE",
  MYANIMELIST_PRODUCERS = "MYANIMELIST_PRODUCERS",
  MYDRAMALIST = "MYDRAMALIST",
  THETVDB = "THETVDB",
  THETVDB_SEASON = "THETVDB_SEASON",
  THETVDB_SERIES = "THETVDB_SERIES",
  TRAKT = "TRAKT",
}
export enum MappingItemEnum {
  ANIME = "ANIME",
  CATEGORY = "CATEGORY",
  CHARACTER = "CHARACTER",
  EPISODE = "EPISODE",
  MANGA = "MANGA",
  PERSON = "PERSON",
  PRODUCER = "PRODUCER",
}
export enum MediaCategorySortEnum {
  ANCESTRY = "ANCESTRY",
  CREATED_AT = "CREATED_AT",
}
export enum MediaCharacterSortEnum {
  CREATED_AT = "CREATED_AT",
  ROLE = "ROLE",
  UPDATED_AT = "UPDATED_AT",
}
export enum MediaProductionRoleEnum {
  LICENSOR = "LICENSOR",
  PRODUCER = "PRODUCER",
  SERIALIZATION = "SERIALIZATION",
  STUDIO = "STUDIO",
}
export enum MediaReactionSortEnum {
  CREATED_AT = "CREATED_AT",
  UPDATED_AT = "UPDATED_AT",
  UP_VOTES_COUNT = "UP_VOTES_COUNT",
}
export enum MediaReactionVoteSortEnum {
  CREATED_AT = "CREATED_AT",
  FOLLOWING = "FOLLOWING",
}
/** The relationship kind from one media entry to another */
export enum MediaRelationshipKindEnum {
  ADAPTATION = "ADAPTATION",
  ALTERNATIVE_SETTING = "ALTERNATIVE_SETTING",
  ALTERNATIVE_VERSION = "ALTERNATIVE_VERSION",
  CHARACTER = "CHARACTER",
  FULL_STORY = "FULL_STORY",
  OTHER = "OTHER",
  PARENT_STORY = "PARENT_STORY",
  PREQUEL = "PREQUEL",
  SEQUEL = "SEQUEL",
  SIDE_STORY = "SIDE_STORY",
  SPINOFF = "SPINOFF",
  SUMMARY = "SUMMARY",
}
/** これはアニメやマンガです */
export enum MediaTypeEnum {
  ANIME = "ANIME",
  MANGA = "MANGA",
}
export enum PostLikeSortEnum {
  CREATED_AT = "CREATED_AT",
  FOLLOWING = "FOLLOWING",
}
export enum PostSortEnum {
  CREATED_AT = "CREATED_AT",
}
export enum ProTierEnum {
  AO_PRO = "AO_PRO",
  AO_PRO_PLUS = "AO_PRO_PLUS",
  PATRON = "PATRON",
  PRO = "PRO",
}
export enum ProfileLinksSitesEnum {
  BATTLENET = "BATTLENET",
  DAILYMOTION = "DAILYMOTION",
  DEVIANTART = "DEVIANTART",
  DISCORD = "DISCORD",
  DRIBBBLE = "DRIBBBLE",
  FACEBOOK = "FACEBOOK",
  GITHUB = "GITHUB",
  GOOGLE = "GOOGLE",
  IMDB = "IMDB",
  INSTAGRAM = "INSTAGRAM",
  KICKSTARTER = "KICKSTARTER",
  LASTFM = "LASTFM",
  LETTERBOXD = "LETTERBOXD",
  MEDIUM = "MEDIUM",
  MOBCRUSH = "MOBCRUSH",
  OSU = "OSU",
  PATREON = "PATREON",
  PLAYERME = "PLAYERME",
  RAPTR = "RAPTR",
  REDDIT = "REDDIT",
  SOUNDCLOUD = "SOUNDCLOUD",
  STEAM = "STEAM",
  TRAKT = "TRAKT",
  TUMBLR = "TUMBLR",
  TWITCH = "TWITCH",
  TWITTER = "TWITTER",
  VIMEO = "VIMEO",
  WEBSITE = "WEBSITE",
  YOUTUBE = "YOUTUBE",
}
export enum RatingSystemEnum {
  ADVANCED = "ADVANCED",
  REGULAR = "REGULAR",
  SIMPLE = "SIMPLE",
}
export enum RecurringBillingServiceEnum {
  APPLE = "APPLE",
  GOOGLE_PLAY = "GOOGLE_PLAY",
  PAYPAL = "PAYPAL",
  STRIPE = "STRIPE",
}
export enum ReleaseSeasonEnum {
  FALL = "FALL",
  SPRING = "SPRING",
  SUMMER = "SUMMER",
  WINTER = "WINTER",
}
export enum ReleaseStatusEnum {
  CURRENT = "CURRENT",
  FINISHED = "FINISHED",
  TBA = "TBA",
  UNRELEASED = "UNRELEASED",
  UPCOMING = "UPCOMING",
}
export enum ReportReasonEnum {
  BULLYING = "BULLYING",
  NSFW = "NSFW",
  OFFENSIVE = "OFFENSIVE",
  OTHER = "OTHER",
  SPAM = "SPAM",
  SPOILER = "SPOILER",
}
export enum ReportStatusEnum {
  DECLINED = "DECLINED",
  REPORTED = "REPORTED",
  RESOLVED = "RESOLVED",
}
export enum SfwFilterPreferenceEnum {
  NSFW_EVERYWHERE = "NSFW_EVERYWHERE",
  NSFW_SOMETIMES = "NSFW_SOMETIMES",
  SFW = "SFW",
}
export enum SitePermissionEnum {
  ADMIN = "ADMIN",
  COMMUNITY_MOD = "COMMUNITY_MOD",
  DATABASE_MOD = "DATABASE_MOD",
}
export enum SiteThemeEnum {
  DARK = "DARK",
  LIGHT = "LIGHT",
}
export enum SortDirection {
  ASCENDING = "ASCENDING",
  DESCENDING = "DESCENDING",
}
export enum TitleLanguagePreferenceEnum {
  CANONICAL = "CANONICAL",
  LOCALIZED = "LOCALIZED",
  ROMANIZED = "ROMANIZED",
}
export enum VolumeSortEnum {
  CREATED_AT = "CREATED_AT",
  NUMBER = "NUMBER",
  UPDATED_AT = "UPDATED_AT",
}
export enum WaifuOrHusbandoEnum {
  HUSBANDO = "HUSBANDO",
  WAIFU = "WAIFU",
}
export enum WikiSubmissionSortEnum {
  CREATED_AT = "CREATED_AT",
  UPDATED_AT = "UPDATED_AT",
}
export enum WikiSubmissionStatusEnum {
  APPROVED = "APPROVED",
  DRAFT = "DRAFT",
  PENDING = "PENDING",
  REJECTED = "REJECTED",
}

type ZEUS_VARIABLES = {
  AgeRatingEnum: ValueTypes["AgeRatingEnum"];
  AnimeSubtypeEnum: ValueTypes["AnimeSubtypeEnum"];
  ChapterSortEnum: ValueTypes["ChapterSortEnum"];
  CharacterRoleEnum: ValueTypes["CharacterRoleEnum"];
  CharacterVoiceSortEnum: ValueTypes["CharacterVoiceSortEnum"];
  CommentLikeSortEnum: ValueTypes["CommentLikeSortEnum"];
  CommentSortEnum: ValueTypes["CommentSortEnum"];
  EpisodeSortEnum: ValueTypes["EpisodeSortEnum"];
  ExternalIdentityProviderEnum: ValueTypes["ExternalIdentityProviderEnum"];
  FavoriteEnum: ValueTypes["FavoriteEnum"];
  FollowSortEnum: ValueTypes["FollowSortEnum"];
  InstallmentSortEnum: ValueTypes["InstallmentSortEnum"];
  InstallmentTagEnum: ValueTypes["InstallmentTagEnum"];
  LibraryEntrySortEnum: ValueTypes["LibraryEntrySortEnum"];
  LibraryEntryStatusEnum: ValueTypes["LibraryEntryStatusEnum"];
  LibraryEventKindEnum: ValueTypes["LibraryEventKindEnum"];
  LibraryEventSortEnum: ValueTypes["LibraryEventSortEnum"];
  LockedReasonEnum: ValueTypes["LockedReasonEnum"];
  MangaSubtypeEnum: ValueTypes["MangaSubtypeEnum"];
  MappingExternalSiteEnum: ValueTypes["MappingExternalSiteEnum"];
  MappingItemEnum: ValueTypes["MappingItemEnum"];
  MediaCategorySortEnum: ValueTypes["MediaCategorySortEnum"];
  MediaCharacterSortEnum: ValueTypes["MediaCharacterSortEnum"];
  MediaProductionRoleEnum: ValueTypes["MediaProductionRoleEnum"];
  MediaReactionSortEnum: ValueTypes["MediaReactionSortEnum"];
  MediaReactionVoteSortEnum: ValueTypes["MediaReactionVoteSortEnum"];
  MediaRelationshipKindEnum: ValueTypes["MediaRelationshipKindEnum"];
  MediaTypeEnum: ValueTypes["MediaTypeEnum"];
  PostLikeSortEnum: ValueTypes["PostLikeSortEnum"];
  PostSortEnum: ValueTypes["PostSortEnum"];
  ProTierEnum: ValueTypes["ProTierEnum"];
  ProfileLinksSitesEnum: ValueTypes["ProfileLinksSitesEnum"];
  RatingSystemEnum: ValueTypes["RatingSystemEnum"];
  RecurringBillingServiceEnum: ValueTypes["RecurringBillingServiceEnum"];
  ReleaseSeasonEnum: ValueTypes["ReleaseSeasonEnum"];
  ReleaseStatusEnum: ValueTypes["ReleaseStatusEnum"];
  ReportReasonEnum: ValueTypes["ReportReasonEnum"];
  ReportStatusEnum: ValueTypes["ReportStatusEnum"];
  SfwFilterPreferenceEnum: ValueTypes["SfwFilterPreferenceEnum"];
  SitePermissionEnum: ValueTypes["SitePermissionEnum"];
  SiteThemeEnum: ValueTypes["SiteThemeEnum"];
  SortDirection: ValueTypes["SortDirection"];
  TitleLanguagePreferenceEnum: ValueTypes["TitleLanguagePreferenceEnum"];
  VolumeSortEnum: ValueTypes["VolumeSortEnum"];
  WaifuOrHusbandoEnum: ValueTypes["WaifuOrHusbandoEnum"];
  WikiSubmissionSortEnum: ValueTypes["WikiSubmissionSortEnum"];
  WikiSubmissionStatusEnum: ValueTypes["WikiSubmissionStatusEnum"];
  Date: ValueTypes["Date"];
  ISO8601Date: ValueTypes["ISO8601Date"];
  ISO8601DateTime: ValueTypes["ISO8601DateTime"];
  JSON: ValueTypes["JSON"];
  Map: ValueTypes["Map"];
  Upload: ValueTypes["Upload"];
  AccountChangePasswordInput: ValueTypes["AccountChangePasswordInput"];
  AccountCreateInput: ValueTypes["AccountCreateInput"];
  AccountExternalIdentityInput: ValueTypes["AccountExternalIdentityInput"];
  AccountUpdateInput: ValueTypes["AccountUpdateInput"];
  AnimeCreateInput: ValueTypes["AnimeCreateInput"];
  AnimeUpdateInput: ValueTypes["AnimeUpdateInput"];
  BlockCreateInput: ValueTypes["BlockCreateInput"];
  BlockDeleteInput: ValueTypes["BlockDeleteInput"];
  ChapterSortOption: ValueTypes["ChapterSortOption"];
  CharacterVoiceSortOption: ValueTypes["CharacterVoiceSortOption"];
  CommentLikeSortOption: ValueTypes["CommentLikeSortOption"];
  CommentSortOption: ValueTypes["CommentSortOption"];
  EpisodeCreateInput: ValueTypes["EpisodeCreateInput"];
  EpisodeSortOption: ValueTypes["EpisodeSortOption"];
  EpisodeUpdateInput: ValueTypes["EpisodeUpdateInput"];
  FavoriteCreateInput: ValueTypes["FavoriteCreateInput"];
  FavoriteDeleteInput: ValueTypes["FavoriteDeleteInput"];
  FollowSortOption: ValueTypes["FollowSortOption"];
  GenericDeleteInput: ValueTypes["GenericDeleteInput"];
  InstallmentSortOption: ValueTypes["InstallmentSortOption"];
  LibraryEntryCreateInput: ValueTypes["LibraryEntryCreateInput"];
  LibraryEntrySortOption: ValueTypes["LibraryEntrySortOption"];
  LibraryEntryUpdateInput: ValueTypes["LibraryEntryUpdateInput"];
  LibraryEntryUpdateProgressByIdInput: ValueTypes["LibraryEntryUpdateProgressByIdInput"];
  LibraryEntryUpdateProgressByMediaInput: ValueTypes["LibraryEntryUpdateProgressByMediaInput"];
  LibraryEntryUpdateRatingByIdInput: ValueTypes["LibraryEntryUpdateRatingByIdInput"];
  LibraryEntryUpdateRatingByMediaInput: ValueTypes["LibraryEntryUpdateRatingByMediaInput"];
  LibraryEntryUpdateStatusByIdInput: ValueTypes["LibraryEntryUpdateStatusByIdInput"];
  LibraryEntryUpdateStatusByMediaInput: ValueTypes["LibraryEntryUpdateStatusByMediaInput"];
  LibraryEventSortOption: ValueTypes["LibraryEventSortOption"];
  MappingCreateInput: ValueTypes["MappingCreateInput"];
  MappingUpdateInput: ValueTypes["MappingUpdateInput"];
  MediaCategorySortOption: ValueTypes["MediaCategorySortOption"];
  MediaCharacterSortOption: ValueTypes["MediaCharacterSortOption"];
  MediaReactionCreateInput: ValueTypes["MediaReactionCreateInput"];
  MediaReactionDeleteInput: ValueTypes["MediaReactionDeleteInput"];
  MediaReactionLikeInput: ValueTypes["MediaReactionLikeInput"];
  MediaReactionSortOption: ValueTypes["MediaReactionSortOption"];
  MediaReactionUnlikeInput: ValueTypes["MediaReactionUnlikeInput"];
  MediaReactionVoteSortOption: ValueTypes["MediaReactionVoteSortOption"];
  PostCreateInput: ValueTypes["PostCreateInput"];
  PostLikeSortOption: ValueTypes["PostLikeSortOption"];
  PostLockInput: ValueTypes["PostLockInput"];
  PostSortOption: ValueTypes["PostSortOption"];
  PostUnlockInput: ValueTypes["PostUnlockInput"];
  ProfileLinkCreateInput: ValueTypes["ProfileLinkCreateInput"];
  ProfileLinkDeleteInput: ValueTypes["ProfileLinkDeleteInput"];
  ProfileLinkUpdateInput: ValueTypes["ProfileLinkUpdateInput"];
  ProfileUpdateInput: ValueTypes["ProfileUpdateInput"];
  TitlesListInput: ValueTypes["TitlesListInput"];
  VolumeSortOption: ValueTypes["VolumeSortOption"];
  WikiSubmissionCreateDraftInput: ValueTypes["WikiSubmissionCreateDraftInput"];
  WikiSubmissionSortOption: ValueTypes["WikiSubmissionSortOption"];
  WikiSubmissionSubmitDraftInput: ValueTypes["WikiSubmissionSubmitDraftInput"];
  WikiSubmissionUpdateDraftInput: ValueTypes["WikiSubmissionUpdateDraftInput"];
  ID: ValueTypes["ID"];
};
