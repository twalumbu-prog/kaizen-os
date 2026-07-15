/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_parsers_csv from "../lib/parsers/csv.js";
import type * as lib_parsers_excel from "../lib/parsers/excel.js";
import type * as lib_parsers_pdf from "../lib/parsers/pdf.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as profiles from "../profiles.js";
import type * as validators_bankReconciliation from "../validators/bankReconciliation.js";
import type * as validators_registry from "../validators/registry.js";
import type * as validators_types from "../validators/types.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "lib/parsers/csv": typeof lib_parsers_csv;
  "lib/parsers/excel": typeof lib_parsers_excel;
  "lib/parsers/pdf": typeof lib_parsers_pdf;
  "lib/roles": typeof lib_roles;
  "lib/scoring": typeof lib_scoring;
  profiles: typeof profiles;
  "validators/bankReconciliation": typeof validators_bankReconciliation;
  "validators/registry": typeof validators_registry;
  "validators/types": typeof validators_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
