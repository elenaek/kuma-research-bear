/**
 * JSON Schema Utilities for Chrome Prompt API Structured Output
 *
 * Provides type-safe helpers for creating JSON schemas that work with
 * Chrome's responseConstraint parameter. Since TypeScript types don't exist
 * at runtime, these are helper functions to manually construct schemas.
 *
 * @see https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
 */

/**
 * JSON Schema type definitions
 */
export type JSONSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

export interface JSONSchemaProperty {
  type: JSONSchemaType | JSONSchemaType[];
  description?: string;
  items?: JSONSchema;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: (string | number | boolean)[];
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export interface JSONSchema extends JSONSchemaProperty {
  $schema?: string;
}

/**
 * Helper to create a string property schema
 */
export function stringProp(description?: string, options?: {
  enum?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}): JSONSchemaProperty {
  return {
    type: 'string',
    description,
    ...options,
  };
}

/**
 * Helper to create a number property schema
 */
export function numberProp(description?: string, options?: {
  minimum?: number;
  maximum?: number;
}): JSONSchemaProperty {
  return {
    type: 'number',
    description,
    ...options,
  };
}

/**
 * Helper to create an integer property schema
 */
export function integerProp(description?: string, options?: {
  minimum?: number;
  maximum?: number;
}): JSONSchemaProperty {
  return {
    type: 'integer',
    description,
    ...options,
  };
}

/**
 * Helper to create a boolean property schema
 */
export function booleanProp(description?: string): JSONSchemaProperty {
  return {
    type: 'boolean',
    description,
  };
}

/**
 * Helper to create an array property schema
 */
export function arrayProp(
  items: JSONSchema,
  description?: string,
  options?: {
    minItems?: number;
    maxItems?: number;
  }
): JSONSchemaProperty {
  return {
    type: 'array',
    description,
    items,
    ...options,
  };
}

/**
 * Helper to create an object property schema
 */
export function objectProp(
  properties: Record<string, JSONSchema>,
  required: string[],
  description?: string,
  additionalProperties = false
): JSONSchemaProperty {
  return {
    type: 'object',
    description,
    properties,
    required,
    additionalProperties,
  };
}

/**
 * Helper to create a nullable property (union with null)
 */
export function nullableProp(
  baseType: Exclude<JSONSchemaType, 'null'>,
  description?: string
): JSONSchemaProperty {
  return {
    type: [baseType, 'null'],
    description,
  };
}

/**
 * Helper to create a full JSON schema object
 */
export function createSchema(
  properties: Record<string, JSONSchema>,
  required: string[],
  additionalProperties = false
): JSONSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties,
  };
}

/**
 * Validates that a response matches the expected schema structure
 * (Basic validation - Chrome API handles actual schema enforcement)
 */
export function validateResponse<T>(
  response: unknown,
  requiredFields: (keyof T)[]
): response is T {
  if (!response || typeof response !== 'object') {
    return false;
  }

  for (const field of requiredFields) {
    if (!(field in response)) {
      return false;
    }
  }

  return true;
}
