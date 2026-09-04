/**
 * A deliberately minimal subset of the OpenAPI 3.x object model — just enough
 * to structurally walk paths, operations, parameters, request/response bodies
 * and JSON Schema-ish schema objects. This is NOT a full OpenAPI type system
 * and does not validate documents; it only types what the diff engine reads.
 */

export interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  enum?: unknown[];
  additionalProperties?: boolean | SchemaObject;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  $ref?: string;
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  description?: string;
  [key: string]: unknown;
}

export interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaObject;
  [key: string]: unknown;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  [key: string]: unknown;
}

export interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
  [key: string]: unknown;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
  [key: string]: unknown;
}

export interface OperationObject {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  [key: string]: unknown;
}

export type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

export interface PathItemObject {
  parameters?: ParameterObject[];
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
  trace?: OperationObject;
  [key: string]: unknown;
}

export type PathsObject = Record<string, PathItemObject>;

export interface ComponentsObject {
  schemas?: Record<string, SchemaObject>;
  [key: string]: unknown;
}

export interface OpenAPIDocument {
  openapi?: string;
  paths?: PathsObject;
  components?: ComponentsObject;
  [key: string]: unknown;
}

export type Severity = "breaking" | "safe";

export interface Change {
  severity: Severity;
  category: string;
  path: string;
  message: string;
  before?: unknown;
  after?: unknown;
}
