import Ajv from "ajv";
import { insist } from "./validation.mjs";
const text = { type: "string" };
const attributes = { type: "array", items: { $ref: "#/$defs/attribute" } };
const validate = new Ajv({ allErrors: false }).compile({
  type: "object",
  required: ["resourceSpans"],
  properties: {
    resourceSpans: {
      type: "array",
      items: {
        type: "object",
        required: ["scopeSpans"],
        properties: {
          resource: { type: "object", properties: { attributes } },
          scopeSpans: {
            type: "array",
            items: {
              type: "object",
              required: ["spans"],
              properties: {
                spans: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "traceId",
                      "spanId",
                      "kind",
                      "startTimeUnixNano",
                      "endTimeUnixNano",
                    ],
                    properties: {
                      traceId: text,
                      spanId: text,
                      parentSpanId: text,
                      kind: { type: "integer", minimum: 0, maximum: 5 },
                      startTimeUnixNano: text,
                      endTimeUnixNano: text,
                      attributes,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    attribute: {
      type: "object",
      required: ["key", "value"],
      properties: {
        key: { type: "string", minLength: 1 },
        value: { $ref: "#/$defs/value" },
      },
    },
    value: {
      oneOf: [
        ...["stringValue", "bytesValue"].map((k) => ({
          type: "object",
          additionalProperties: false,
          required: [k],
          properties: { [k]: text },
        })),
        {
          type: "object",
          additionalProperties: false,
          required: ["boolValue"],
          properties: { boolValue: { type: "boolean" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["intValue"],
          properties: {
            intValue: {
              anyOf: [
                { type: "string", pattern: "^-?[0-9]{1,20}$" },
                {
                  type: "integer",
                  minimum: Number.MIN_SAFE_INTEGER,
                  maximum: Number.MAX_SAFE_INTEGER,
                },
              ],
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["doubleValue"],
          properties: { doubleValue: { type: "number" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["arrayValue"],
          properties: {
            arrayValue: {
              type: "object",
              properties: {
                values: { type: "array", items: { $ref: "#/$defs/value" } },
              },
            },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kvlistValue"],
          properties: {
            kvlistValue: { type: "object", properties: { values: attributes } },
          },
        },
        { type: "object", maxProperties: 0 },
      ],
    },
  },
});
export function validateOtlp(payload) {
  insist(validate(payload), "invalid OTLP payload structure");
}
